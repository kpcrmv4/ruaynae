import { NextResponse, type NextRequest } from 'next/server'
import webpush from 'web-push'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

/** ส่งครั้งละเท่านี้ — งานที่ส่งทีเดียวหมดจะ timeout วันที่ค้างเยอะ */
const BATCH = 100

/**
 * GET /api/cron/push-dispatch — ส่ง web push ของแจ้งเตือนที่ยังไม่ได้ส่ง
 *
 * 🔴 ทำไมเป็น cron ไม่ใช่ยิงตอนสร้างแจ้งเตือน: แจ้งเตือนเกิดจาก **trigger
 * ในฐานข้อมูล** (เพื่อให้ทุกเส้นทางได้ครบ) และ trigger ส่ง web push เองไม่ได้
 * เพราะต้องมี VAPID กับการเข้ารหัสฝั่ง Node · ถ้าย้ายการส่งไปไว้ที่ route
 * แต่ละเส้นทาง เส้นทางที่ลืมใส่จะเงียบหายไปแบบเดียวกับ audit log
 *
 * 🔴 subscription ที่ตายแล้ว (410/404) **ต้องลบทิ้ง** — เก็บไว้แปลว่าทุกรอบ
 * จะยิงไปที่ที่ไม่มีอยู่ แล้ววันหนึ่งโควตาจะหมดไปกับเครื่องที่ถอนแอปไปแล้ว
 *
 * เรียกด้วย pg_cron + pg_net ทุกนาที · pg_cron ทำงานเป็น UTC
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron] CRON_SECRET ยังไม่ได้ตั้ง — ปฏิเสธไว้ก่อน')
    return NextResponse.json({ error: 'NOT_CONFIGURED' }, { status: 503 })
  }
  const header = req.headers.get('authorization') ?? ''
  const fromQuery = new URL(req.url).searchParams.get('secret') ?? ''
  const given = header.startsWith('Bearer ') ? header.slice(7) : fromQuery
  if (given !== secret) {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  }

  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!pub || !priv || !subject || subject === 'mailto:') {
    // ยังไม่ได้ตั้ง VAPID = ยังส่งไม่ได้ · ตอบให้ชัดดีกว่าเงียบแล้วดูเหมือนสำเร็จ
    return NextResponse.json({ error: 'VAPID_NOT_CONFIGURED' }, { status: 503 })
  }
  webpush.setVapidDetails(subject, pub, priv)

  const admin = getSupabaseAdmin()

  const { data: pending, error: nErr } = await admin
    .from('notifications')
    .select('id, user_id, kind, title, body, link')
    .is('pushed_at', null)
    .order('created_at', { ascending: true })
    .range(0, BATCH - 1)

  if (nErr) {
    console.error('[cron] อ่านแจ้งเตือนที่ยังไม่ส่งไม่ได้', nErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!pending || pending.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, removed: 0, marked: 0 })
  }

  const userIds = [...new Set(pending.map((n) => n.user_id))]
  const { data: subs, error: sErr } = await admin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', userIds)
    .order('id', { ascending: true })
    .range(0, 500)

  if (sErr) {
    console.error('[cron] อ่าน subscription ไม่ได้', sErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }

  // จำนวนที่ยังไม่อ่านของแต่ละคน — ใช้ตั้งตัวเลขบนไอคอนแอปจากใน service worker
  const unread = new Map<string, number>()
  for (const uid of userIds) {
    const { count } = await admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uid)
      .is('read_at', null)
    unread.set(uid, count ?? 0)
  }

  const byUser = new Map<string, typeof subs>()
  for (const s of subs ?? []) {
    const list = byUser.get(s.user_id) ?? []
    list.push(s)
    byUser.set(s.user_id, list)
  }

  const dead: string[] = []
  let sent = 0

  for (const n of pending) {
    for (const s of byUser.get(n.user_id) ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({
            title: n.title,
            body: n.body ?? '',
            link: n.link ?? '/',
            tag: `notif-${n.kind}`,
            unread: unread.get(n.user_id) ?? 0,
          }),
        )
        sent += 1
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        // 410 Gone / 404 Not Found = เครื่องนั้นไม่รับแล้ว — ลบทิ้ง
        if (status === 410 || status === 404) dead.push(s.id)
        else console.error('[cron] ส่ง push ไม่สำเร็จ', status, (e as Error).message)
      }
    }
  }

  if (dead.length > 0) {
    const { error } = await admin.from('push_subscriptions').delete().in('id', dead)
    if (error) console.error('[cron] ลบ subscription ที่ตายแล้วไม่สำเร็จ', error.message)
  }

  // 🔴 มาร์คว่าส่งแล้วเสมอ **แม้ไม่มี subscription เลย** — ไม่งั้นแจ้งเตือน
  // ของคนที่ยังไม่เคยเปิด push จะถูกหยิบมาพยายามส่งใหม่ทุกนาทีตลอดไป
  const ids = pending.map((n) => n.id)
  const { error: uErr } = await admin
    .from('notifications')
    .update({ pushed_at: new Date().toISOString() })
    .in('id', ids)
  if (uErr) {
    console.error('[cron] มาร์คว่าส่งแล้วไม่สำเร็จ', uErr.message)
    return NextResponse.json({ error: 'MARK_FAILED' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, sent, removed: dead.length, marked: ids.length })
}
