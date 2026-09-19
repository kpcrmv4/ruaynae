import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { fmtBaht, todayInBangkok } from '@/lib/format'
import { BOND_SOON_DAYS } from '@/lib/bonds'

export const runtime = 'nodejs'

/** เจ้าของกี่คนก็ได้ แต่ระบบนี้เป็นบริษัทเดียว — เพดานกันลิสต์ยาวผิดปกติ */
const MAX_OWNERS = 20

/**
 * GET /api/cron/daily-digest — สรุปของค้างส่งให้เจ้าของทุกเช้า 8 โมง
 *
 * 🔴 **วันที่ไม่มีอะไรค้าง ไม่ส่ง** — แจ้งเตือนที่เด้งทุกเช้าไม่ว่าจะมีอะไร
 * หรือไม่ คือแจ้งเตือนที่คนปิดทิ้งภายในสัปดาห์เดียว แล้ววันที่มีของค้างจริง
 * ก็จะไม่มีใครเห็น
 *
 * 🔴 **ไม่ยิง push เอง** — แค่เขียนแถวลง `notifications` แล้ว `push-dispatch`
 * (ทุก 5 นาที) เป็นคนส่งต่อ · ตัวส่ง push อยู่ที่เดียวทั้งระบบ ไม่งั้นวันที่
 * ต้องแก้เรื่อง VAPID หรือการลบ subscription ที่ตายแล้ว จะมีที่ให้แก้สองที่
 * แล้วที่หนึ่งจะเงียบไม่ตาม
 *
 * 🔴 กันส่งซ้ำที่ **ฐานข้อมูล** (`notifications_digest_once`) ไม่ใช่ที่ความหวัง
 * ว่า cron จะถูกเรียกวันละครั้ง — เรียกซ้ำกี่รอบก็ได้แถวเดียวต่อคนต่อวัน
 *
 * เรียกด้วย pg_cron + pg_net · pg_cron เป็น UTC → 8 โมงเช้าไทยคือ `0 1 * * *`
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron] CRON_SECRET ยังไม่ได้ตั้ง — ปฏิเสธไว้ก่อน')
    return NextResponse.json({ error: 'NOT_CONFIGURED' }, { status: 503 })
  }
  // 🔴 **รับกุญแจทาง header เท่านั้น** — เคยรับทาง `?secret=` ไว้ให้เรียกด้วยมือ
  // สะดวก แล้วมันไปโผล่ใน access log ของทุกชั้นที่คำขอวิ่งผ่าน (dev server,
  // Vercel, proxy) กับประวัติเบราว์เซอร์ · ความลับที่นอนอยู่ในไฟล์ log คือ
  // ความลับที่รั่วไปแล้วโดยไม่มีใครรู้ตัว (เจอจริง 4 ก.ย. 2569)
  // เรียกด้วยมือ: curl -H "Authorization: Bearer <CRON_SECRET>" <url>
  const header = req.headers.get('authorization') ?? ''
  const given = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (given !== secret) {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  }

  const admin = getSupabaseAdmin()
  // ⚠️ วันไทยคำนวณฝั่งแอป ไม่ใช่ `now()::date` ของฐานข้อมูลซึ่งเป็น UTC —
  // ตอนตีห้าของไทยยังเป็นเมื่อวานในสายตาเซิร์ฟเวอร์
  const today = todayInBangkok()

  // ── ของค้างทั้งบริษัท ────────────────────────────────────────────
  // 🔴 นับในฐานข้อมูลด้วย head + count · ไม่ดึงแถวมานับใน JS (§7)
  const [
    { count: pendingCount, error: cErr },
    { data: sums, error: sErr },
    { data: bondRows, error: bErr },
  ] = await Promise.all([
    admin.from('transactions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    admin
      .from('transactions')
      .select('amount, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .range(0, 999),
    // หลักประกันสัญญา (R11) — service role ข้าม RLS จึงเห็นครบ · นับในฐานข้อมูล
    admin.rpc('bond_summary', { p_on: today, p_soon_days: BOND_SOON_DAYS }),
  ])

  if (cErr || sErr || bErr) {
    console.error('[cron] อ่านของค้างไม่ได้', cErr?.message ?? sErr?.message ?? bErr?.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }

  const n = pendingCount ?? 0
  const bond = bondRows?.[0]
  const bondOverdue = Number(bond?.overdue_count ?? 0)
  const bondOverdueAmt = Number(bond?.overdue_amount ?? 0)
  const bondSoon = Number(bond?.due_soon_count ?? 0)
  // "วันสำคัญ" ของหลักประกัน = เหลือพอดี 30 วัน หรือครบวันนี้/เมื่อวาน — วันที่ควรเด้งแม้ไม่มีของค้างอื่น
  const bondEvent = Number(bond?.event_count ?? 0)

  // 🔴 ไม่มีอะไรค้างเลย = ไม่ส่ง · หลักประกันที่เกินแล้วนับเป็นของค้าง (เงินที่ยังไม่ได้ทวง)
  if (n === 0 && bondOverdue === 0 && bondEvent === 0) {
    return NextResponse.json({ ok: true, today, pending: 0, sent: 0, skipped: 'ไม่มีของค้าง' })
  }

  const rows = sums ?? []
  const total = rows.reduce((s, t) => s + Number(t.amount), 0)
  // ยอดอาจไม่ครบถ้าค้างเกิน 1,000 รายการ — บอกตรง ๆ ดีกว่าโชว์ยอดขาด
  const partial = n > rows.length
  const oldestAt = rows[0]?.created_at
  const oldestDays = oldestAt
    ? Math.max(
        0,
        Math.floor((Date.parse(`${today}T23:59:59+07:00`) - Date.parse(oldestAt)) / 86_400_000),
      )
    : 0

  // ── เจ้าของที่ยังใช้งานอยู่ ───────────────────────────────────────
  const { data: owners, error: oErr } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'owner')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .range(0, MAX_OWNERS - 1)

  if (oErr) {
    console.error('[cron] อ่านรายชื่อเจ้าของไม่ได้', oErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!owners || owners.length === 0) {
    return NextResponse.json({ ok: true, today, pending: n, sent: 0, skipped: 'ไม่มีเจ้าของที่ใช้งานอยู่' })
  }

  const bondLine =
    (bondOverdue > 0 ? `หลักประกันครบแล้วรอทวงคืน ${bondOverdue} งาน (${fmtBaht(bondOverdueAmt)})` : '') +
    (bondOverdue > 0 && bondSoon > 0 ? ' · ' : '') +
    (bondSoon > 0 ? `ใกล้ครบใน ${BOND_SOON_DAYS} วัน ${bondSoon} งาน` : '')
  const pendingLine =
    n > 0
      ? `รวม ${fmtBaht(total)}${partial ? ' (บางส่วน)' : ''}` +
        (oldestDays >= 1 ? ` · เก่าสุดค้างมา ${oldestDays} วัน` : '')
      : ''
  const body = [pendingLine, bondLine].filter(Boolean).join(' · ')
  const title =
    n > 0
      ? `มี ${n} รายการรออนุมัติ${bondOverdue > 0 ? ` · หลักประกันรอทวง ${bondOverdue} งาน` : ''}`
      : bondOverdue > 0
        ? `หลักประกันสัญญาครบกำหนดแล้ว ${bondOverdue} งาน`
        : `หลักประกันสัญญาใกล้ครบกำหนด ${bondSoon} งาน`
  const link = n > 0 ? '/approvals' : '/reports?tab=bonds'

  // `ignoreDuplicates` = ยิงซ้ำวันเดิมได้ไม่มีแถวที่สอง (unique index เป็นตัวกัน)
  const { data: made, error: iErr } = await admin
    .from('notifications')
    .upsert(
      owners.map((o) => ({
        user_id: o.id,
        kind: 'daily_digest' as const,
        title,
        body,
        link,
        digest_date: today,
      })),
      { onConflict: 'user_id,digest_date', ignoreDuplicates: true },
    )
    .select('id')

  if (iErr) {
    console.error('[cron] สร้างสรุปประจำวันไม่ได้', iErr.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }

  // push ถูกส่งต่อโดย `push-dispatch` ภายใน 5 นาที — ที่นี่ไม่ยิงเอง
  return NextResponse.json({
    ok: true,
    today,
    pending: n,
    total,
    oldestDays,
    bondOverdue,
    bondSoon,
    sent: made?.length ?? 0,
  })
}
