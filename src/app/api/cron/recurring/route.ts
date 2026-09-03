import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { todayInBangkok } from '@/lib/format'

export const runtime = 'nodejs'

/**
 * GET /api/cron/recurring — ลงรายจ่ายรายเดือนที่ถึงกำหนดแล้ว
 *
 * เรียกด้วย pg_cron + pg_net ทุกวัน 08:00 เวลาไทย (pg_cron เป็น UTC = `0 1 * * *`)
 * ไม่ใช่ Vercel cron ซึ่ง Hobby ได้แค่ 2 งานวันละครั้ง (CLAUDE.md §8)
 *
 * 🔴 วันไหนที่ยังไม่ถึงวันจ่ายของกฎนั้น **จะไม่ลง** — RPC ตัดสินเองจาก
 * `day_of_month` เทียบกับวันนี้ตามเวลาไทย · เรียกซ้ำกี่รอบก็ไม่เกิดรายการซ้ำ
 * เพราะ unique (recurring_id, period_month) เป็นตัวกัน ไม่ใช่ความถี่ของ cron
 *
 * ใช้ service-role เพราะเป็นงานระบบ ไม่มีเซสชันของมนุษย์อยู่เบื้องหลัง —
 * `run_recurring_expenses` จึง grant ให้ `service_role` เท่านั้น
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

  const through = todayInBangkok()
  const { data, error } = await getSupabaseAdmin().rpc('run_recurring_expenses', {
    p_through: through,
  })

  if (error) {
    console.error('[cron] ลงรายจ่ายรายเดือนไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'RUN_FAILED' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, through, created: Number(data ?? 0) })
}
