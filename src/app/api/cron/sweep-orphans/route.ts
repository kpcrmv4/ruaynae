import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { deleteObject } from '@/lib/r2'

export const runtime = 'nodejs'

/** กวาดครั้งละเท่านี้ — งานที่กวาดทีเดียวหมดจะ timeout วันที่ค้างเยอะ */
const BATCH = 200

/**
 * GET /api/cron/sweep-orphans — ลบไฟล์ที่อัปขึ้น R2 แล้วไม่มีใครใช้
 *
 * 🔴 ปัญหาที่มีไว้แก้: อัปไฟล์สำเร็จ แล้วผู้ใช้ปิดแอปก่อนกดบันทึก
 * (หรือการบันทึกล้มเหลว) ไฟล์จะค้างใน bucket **ตลอดไป** โดยไม่มีแถวไหน
 * ชี้ถึง และไม่มี error ที่ไหนเลย · ทางที่ล้มเหลวคือทางที่สร้างขยะ
 * และเป็นทางที่ไม่มีใครทดสอบ
 *
 * เรียกด้วย pg_cron + pg_net ทุกชั่วโมง (ไม่ใช่ Vercel cron ซึ่ง Hobby
 * ได้แค่ 2 งานวันละครั้ง) · pg_cron ทำงานเป็น UTC
 *
 * ใช้ service-role เพราะกวาดของทุกคน ไม่ใช่ของใครคนใดคนหนึ่ง —
 * เป็นงานระบบ ไม่มีเซสชันของมนุษย์อยู่เบื้องหลัง
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron] CRON_SECRET ยังไม่ได้ตั้ง — ปฏิเสธไว้ก่อน')
    return NextResponse.json({ error: 'NOT_CONFIGURED' }, { status: 503 })
  }
  // รับได้ทั้งสองแบบ: Authorization ของ pg_net และ query ของการเรียกด้วยมือ
  const header = req.headers.get('authorization') ?? ''
  const fromQuery = new URL(req.url).searchParams.get('secret') ?? ''
  const given = header.startsWith('Bearer ') ? header.slice(7) : fromQuery
  if (given !== secret) {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  }

  const admin = getSupabaseAdmin()

  // เฉพาะที่ **หมดอายุแล้วและยังไม่ถูกใช้** — ไฟล์ที่ consumed แล้วคือสลิปจริง
  // ของรายการที่บันทึกไปแล้ว ห้ามแตะเด็ดขาด
  const { data: stale, error } = await admin
    .from('upload_intents')
    .select('id, object_key, thumb_key')
    .is('consumed_at', null)
    .lt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true })
    .range(0, BATCH - 1)

  if (error) {
    console.error('[cron] อ่าน upload_intents ไม่ได้', error.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }

  let deletedFiles = 0
  const cleanedIds: string[] = []

  for (const row of stale ?? []) {
    // ลบไฟล์ให้ครบก่อนค่อยลบแถว — ลบแถวก่อนแล้วไฟล์ลบไม่สำเร็จ
    // จะได้ไฟล์กำพร้าที่ไม่มีใครรู้จักอีกเลย ซึ่งแย่กว่าเดิม
    let ok = true
    for (const key of [row.object_key, row.thumb_key]) {
      try {
        await deleteObject(key)
        deletedFiles += 1
      } catch (e) {
        ok = false
        console.error('[cron] ลบไฟล์ไม่สำเร็จ', key, e instanceof Error ? e.message : e)
      }
    }
    if (ok) cleanedIds.push(row.id)
  }

  if (cleanedIds.length > 0) {
    const { error: dErr } = await admin
      .from('upload_intents').delete().in('id', cleanedIds)
    if (dErr) console.error('[cron] ลบแถว upload_intents ไม่สำเร็จ', dErr.message)
  }

  return NextResponse.json({
    ok: true,
    scanned: stale?.length ?? 0,
    deletedFiles,
    cleanedIntents: cleanedIds.length,
  })
}
