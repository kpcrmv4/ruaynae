import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { todayInBangkok } from '@/lib/format'
import { isUuid, MAX_NOTE, isPayMethod } from '@/lib/transactions'
import { parseAmount } from '@/lib/sites'

export const runtime = 'nodejs'

/**
 * POST /api/advances — บันทึกเบิกล่วงหน้า (เจ้าของเท่านั้น)
 *
 * 🔴 **เบิกเกินค่าแรงค้างจ่ายได้** (คำสั่งเจ้าของ 20 ก.ย. 2569) — เดิม
 * `guard_advance` ปฏิเสธด้วย `ADVANCE_OVER_CEILING` ตอนนี้ไม่ปฏิเสธแล้ว
 * · ยอดคงเหลือที่คืนไปติดลบได้ และเป็นหน้าที่ของหน้าจอที่จะเตือน
 * ไม่ใช่หน้าที่ของฐานข้อมูลที่จะห้าม — คนตัดสินใจคือเจ้าของ
 *
 * วันที่รับจาก client ได้ (ลงย้อนหลังได้) แต่ยังห้ามวันในอนาคต
 * และห้ามปี พ.ศ. หลุดลงฐานข้อมูล
 */
export async function POST(req: NextRequest) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const employeeId = body.employeeId ?? body.employee_id
  if (!isUuid(employeeId)) {
    return NextResponse.json({ error: 'EMPLOYEE_REQUIRED' }, { status: 400 })
  }

  const amount = parseAmount(body.amount)
  if (!amount.ok || amount.value <= 0) {
    return NextResponse.json({ error: 'AMOUNT_INVALID' }, { status: 400 })
  }

  const date = String(body.advanceDate ?? body.advance_date ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'DATE_INVALID' }, { status: 400 })
  }
  // ปีเกิน 2200 = กรอก พ.ศ. ลงไป · ฐานข้อมูลรับได้แต่วันเพี้ยน 543 ปี
  if (Number(date.slice(0, 4)) > 2200) {
    return NextResponse.json({ error: 'DATE_BUDDHIST_ERA' }, { status: 400 })
  }
  if (date > todayInBangkok()) {
    return NextResponse.json({ error: 'DATE_FUTURE' }, { status: 400 })
  }

  const siteId = body.siteId ?? body.site_id
  const note = String(body.note ?? '').trim().slice(0, MAX_NOTE)
  const payMethod = body.payMethod ?? body.pay_method

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('advances')
    .insert({
      employee_id: employeeId,
      amount: amount.value,
      advance_date: date,
      pay_method: isPayMethod(payMethod) ? payMethod : 'cash',
      site_id: isUuid(siteId) ? siteId : null,
      note: note === '' ? null : note,
    })
    .select('id, amount')
    .maybeSingle()

  if (error) {
    if (/PAYROLL_CLOSED/.test(error.message ?? '')) {
      return NextResponse.json({ error: 'PAYROLL_CLOSED' }, { status: 409 })
    }
    if (/row-level security/i.test(error.message ?? '')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
    console.error('[advances] บันทึกเบิกไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  // RLS ที่ปฏิเสธไม่คืน error เสมอไป — อ่านแถวกลับมาดูว่ามีจริง
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  // ยอดคงเหลือ **หลังบันทึกแล้ว** — ติดลบ = เบิกเกินค่าแรงที่ทำไปแล้ว
  // 🔴 อ่านกลับจากฐานข้อมูล ไม่ใช่ลบเอาเองจากยอดที่หน้าจอถืออยู่ เพราะระหว่างนั้น
  // อาจมีคนลงชื่อเข้าโครงการเพิ่มหรือเบิกอีกใบ แล้วตัวเลขที่เตือนจะไม่ใช่ของจริง
  const { data: bal } = await sb.rpc('employee_balance', { p_employee: employeeId }).maybeSingle()
  const balance = bal ? Number(bal.balance) : null

  return NextResponse.json(
    { ok: true, advance: data, balance, overdrawn: balance !== null && balance < 0 },
    { status: 201 },
  )
}
