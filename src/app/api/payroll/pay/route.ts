import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'

export const runtime = 'nodejs'

/**
 * POST /api/payroll/pay — จ่ายค่าแรงที่ค้างอยู่ของคนคนหนึ่งให้หมด
 *
 * 🔴 งานทั้งหมดอยู่ใน RPC `pay_employee_wage` = ทรานแซกชันเดียว
 * แยกเป็นหลาย request จากที่นี่แล้ววันหนึ่งจะบันทึกว่าจ่ายแล้วสำเร็จ แต่หัก
 * ยอดเบิกไม่สำเร็จ เหลือใบเบิกที่ยังไม่ถูกหักซึ่งจะถูกหักซ้ำในครั้งถัดไป
 *
 * เจ้าของไม่ต้องเลือกช่วงวัน — RPC ใช้ "วันแรกถึงวันสุดท้ายที่คนนี้ยังไม่ได้รับเงิน"
 * จึงไม่มีทางเลือกช่วงผิดจนจ่ายไม่ครบ หรือเลือกซ้อนกับที่จ่ายไปแล้ว
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

  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('pay_employee_wage', { p_employee: employeeId })

  if (error) {
    const msg = error.message ?? ''
    if (/NOT_FOUND/.test(msg)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (/NOTHING_TO_PAY/.test(msg)) {
      return NextResponse.json({ error: 'NOTHING_TO_PAY' }, { status: 409 })
    }
    if (/FORBIDDEN|row-level security/i.test(msg)) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
    console.error('[payroll] จ่ายค่าแรงไม่สำเร็จ', msg)
    return NextResponse.json({ error: 'PAY_FAILED' }, { status: 500 })
  }

  const row = data?.[0]
  return NextResponse.json({
    ok: true,
    days: Number(row?.days ?? 0),
    accrued: Number(row?.accrued ?? 0),
    deducted: Number(row?.deducted ?? 0),
    paid: Number(row?.paid ?? 0),
  })
}
