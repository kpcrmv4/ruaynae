import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { todayInBangkok } from '@/lib/format'
import { isUuid } from '@/lib/transactions'
import { MAX_NAME_RECURRING, monthToDate } from '@/lib/recurring'

export const runtime = 'nodejs'

/**
 * POST /api/settings/recurring — ตั้งค่าใช้จ่ายรายเดือน แล้ว**ลงย้อนหลังให้ทันที**
 *
 * 🔴 สร้างกฎแล้วไม่ลงย้อนหลังให้ = เจ้าของต้องจำว่ายังต้องกดอีกปุ่ม ซึ่งจะลืม
 * แล้วเดือนที่ผ่านมาจะหายไปจากบัญชีเงียบ ๆ · การสร้างกับการลงย้อนหลังจึงเป็น
 * คำขอเดียวกัน · กดซ้ำไม่เกิดรายการซ้ำเพราะ unique (recurring_id, period_month)
 */
export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  let b: Record<string, unknown>
  try {
    b = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const name = String(b.name ?? '').trim().slice(0, MAX_NAME_RECURRING)
  if (!name) return NextResponse.json({ error: 'NAME_REQUIRED' }, { status: 400 })

  const amount = Number(String(b.amount ?? '').replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'AMOUNT_INVALID' }, { status: 400 })
  }

  if (!isUuid(b.categoryId)) {
    return NextResponse.json({ error: 'CATEGORY_REQUIRED' }, { status: 400 })
  }

  const day = Number(b.dayOfMonth)
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return NextResponse.json({ error: 'DAY_INVALID' }, { status: 400 })
  }

  const startMonth = monthToDate(String(b.startMonth ?? ''))
  if (!startMonth) return NextResponse.json({ error: 'MONTH_INVALID' }, { status: 400 })
  // ปีเกิน 2200 = กรอก พ.ศ. ลงไป · `2569-01` เป็นเดือนที่ถูกไวยากรณ์ทุกประการ
  if (Number(startMonth.slice(0, 4)) > 2200) {
    return NextResponse.json({ error: 'MONTH_BUDDHIST_ERA' }, { status: 400 })
  }

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('recurring_expenses')
    .insert({
      name,
      amount,
      category_id: b.categoryId,
      site_id: isUuid(b.siteId) ? b.siteId : null,
      employee_id: isUuid(b.employeeId) ? b.employeeId : null,
      day_of_month: day,
      start_month: startMonth,
      pay_method: b.payMethod === 'cash' ? 'cash' : 'transfer',
      note: typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 200) : null,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    if (/EMPLOYEE_NOT_MONTHLY/.test(error.message ?? '')) {
      return NextResponse.json({ error: 'EMPLOYEE_NOT_MONTHLY' }, { status: 400 })
    }
    if (/row-level security/i.test(error.message ?? '')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
    console.error('[recurring] สร้างกฎไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  // ลงย้อนหลังตั้งแต่เดือนที่เลือกจนถึงเดือนปัจจุบันทันที
  const { data: made, error: rErr } = await sb.rpc('run_recurring_expense', {
    p_rule: data.id,
    p_through: todayInBangkok(),
  })
  if (rErr) {
    // กฎถูกสร้างแล้ว แต่ลงย้อนหลังไม่สำเร็จ — ต้องบอกตรง ๆ ไม่ใช่ตอบ ok เฉย ๆ
    console.error('[recurring] ลงย้อนหลังไม่สำเร็จ', rErr.message)
    return NextResponse.json({ ok: true, id: data.id, created: 0, backfillFailed: true })
  }

  return NextResponse.json({ ok: true, id: data.id, created: Number(made ?? 0) }, { status: 201 })
}
