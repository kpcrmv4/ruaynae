import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { todayInBangkok } from '@/lib/format'
import { advanceGuardCode, parseAdvanceFields } from '@/lib/advances'

export const runtime = 'nodejs'

/**
 * POST /api/advances — บันทึกเบิกล่วงหน้า
 *
 * สองทางที่ต่างกันคนละเรื่อง (คำสั่งเจ้าของ 21 ก.ย. 2569):
 *  - **เจ้าของ** = จ่ายเงินจริงเดี๋ยวนี้ → เข้าเป็น `approved` ทันที
 *  - **หัวหน้าโครงการ** = ยื่นคำขอแทนลูกน้อง → เข้าเป็น `pending` รอเจ้าของกด
 *    · ต้องผูกโครงการที่ตัวเองดูแล · คำขอยังไม่ใช่เงิน ไม่กระทบยอดใด ๆ
 *
 * 🔴 **เบิกเกินค่าแรงค้างจ่ายได้** (20 ก.ย. 2569) — ฐานข้อมูลไม่ห้าม
 * คนตัดสินใจคือเจ้าของตอนกดอนุมัติ และหน้าจอของเจ้าของเป็นคนเตือน
 *
 * 🔴 ยอดคงเหลือคืนให้เฉพาะเจ้าของ — ค่าแรงเป็นความลับจากหัวหน้าโครงการ (P4.5)
 * ตั้งแต่ R14 `employee_balance()` ปฏิเสธคนที่ไม่ใช่เจ้าของที่ฐานข้อมูลด้วย
 */
export async function POST(req: NextRequest) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const isOwner = me.role === 'owner'
  const parsed = parseAdvanceFields(body, todayInBangkok(), { requireSite: !isOwner })
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('advances')
    .insert({
      ...parsed.fields,
      // 🔴 สถานะมาจาก role ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่เคยมาจาก payload
      // (guard trigger ปฏิเสธซ้ำอีกชั้นถ้าหัวหน้าโครงการส่งค่าอื่นมา)
      status: isOwner ? 'approved' : 'pending',
    })
    .select('id, amount, status, advance_date')
    .maybeSingle()

  if (error) {
    const code = advanceGuardCode(error.message ?? '')
    if (code) return NextResponse.json({ error: code }, { status: 403 })
    if (/row-level security/i.test(error.message ?? '')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
    console.error('[advances] บันทึกเบิกไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  // RLS ที่ปฏิเสธไม่คืน error เสมอไป — อ่านแถวกลับมาดูว่ามีจริง
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  if (!isOwner) {
    return NextResponse.json({ ok: true, advance: data }, { status: 201 })
  }

  // ยอดคงเหลือ **หลังบันทึกแล้ว** — ติดลบ = เบิกเกินค่าแรงที่ทำไปแล้ว
  // 🔴 อ่านกลับจากฐานข้อมูล ไม่ใช่ลบเอาเองจากยอดที่หน้าจอถืออยู่ เพราะระหว่างนั้น
  // อาจมีคนลงชื่อเข้าโครงการเพิ่มหรือเบิกอีกใบ แล้วตัวเลขที่เตือนจะไม่ใช่ของจริง
  const { data: bal } = await sb
    .rpc('employee_balance', { p_employee: parsed.fields.employee_id })
    .maybeSingle()
  const balance = bal ? Number(bal.balance) : null

  return NextResponse.json(
    { ok: true, advance: data, balance, overdrawn: balance !== null && balance < 0 },
    { status: 201 },
  )
}
