import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { parseEmployeeFields, type EmployeeArgs } from '@/lib/employees'
import type { Database } from '@/lib/database.types'

export const runtime = 'nodejs'

/** ชนิดที่ Supabase สร้างให้เขียนพารามิเตอร์เป็น non-null ทั้งที่ SQL รับ NULL ได้ */
const rpcArgs = (a: EmployeeArgs) =>
  a as unknown as Database['public']['Functions']['save_employee']['Args']

/**
 * PATCH /api/employees/[id] — แก้คนงาน หรือปิด/เปิดใช้งาน (เจ้าของเท่านั้น)
 *
 * ไม่มีปุ่มลบเลยโดยตั้งใจ — ลบคนที่มีประวัติค่าแรงทิ้งคือการลบต้นทุนของงาน
 * ที่ปิดไปแล้ว · `attendance.employee_id` เป็น `on delete restrict` กันไว้อีกชั้น
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await ctx.params
  const sb = await getSupabaseServer()

  // อ่านของเดิมทั้งสองตารางก่อน — PATCH ที่ตีความว่า body คือทั้งแถวคือ PUT
  // ที่ใส่ชื่อผิด และจะลบฟิลด์ที่ client ไม่ได้ส่งมาทิ้งทั้งหมด
  const { data: existing, error: rErr } = await sb
    .from('employees')
    .select('id, full_name, job_title, default_site_id, is_active, profile_id, employee_wages(wage_type, daily_rate, monthly_salary)')
    .eq('id', id)
    .maybeSingle()
  if (rErr) {
    console.error('[employees] อ่านคนงานไม่ได้', rErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const wages = existing.employee_wages
  const merged = {
    full_name: existing.full_name,
    job_title: existing.job_title,
    default_site_id: existing.default_site_id,
    is_active: existing.is_active,
    profile_id: existing.profile_id,
    wage_type: wages?.wage_type ?? 'daily',
    daily_rate: wages?.daily_rate ?? null,
    monthly_salary: wages?.monthly_salary ?? null,
    ...body,
  }

  const parsed = parseEmployeeFields(merged, id)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { error } = await sb.rpc('save_employee', rpcArgs(parsed.args))

  if (error) {
    if (/employees_profile_id_key/.test(error.message)) {
      return NextResponse.json({ error: 'PROFILE_TAKEN' }, { status: 409 })
    }
    if (/NOT_FOUND/.test(error.message)) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    }
    if (/FORBIDDEN/.test(error.message)) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
    console.error('[employees] แก้คนงานไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, employee: { id } })
}

/**
 * DELETE /api/employees/[id] — ลบคนงานทิ้งถาวร (เจ้าของเท่านั้น)
 *
 * 🔴 กติกาอยู่ใน `delete_employee()` ที่ฐานข้อมูล ไม่ใช่ที่นี่ — route นี้แค่
 * แปลรหัสให้เป็นข้อความไทย · เส้นแบ่งคือ **เงินที่จ่ายออกไปแล้ว**: เคยอยู่ใน
 * รอบจ่ายที่ปิดแล้ว = ลบไม่ได้ตลอดไป (ยอดของรอบนั้นจะอ้างถึงคนที่ไม่มีอยู่)
 * ส่วนคนที่ยังไม่เคยปิดรอบ ลบได้พร้อมประวัติลงชื่อและใบเบิกในทรานแซกชันเดียว
 *
 * ⚠️ กล่องยืนยันบนหน้าจอต้องบอก **ยอดค้างจ่ายที่กำลังจะหายไป** ก่อนกด —
 * ตัวเลขนั้นมาจาก `employees_delete_info()` ที่หน้าคนงานโหลดมาพร้อมรายชื่อแล้ว
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await ctx.params
  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('delete_employee', { p_id: id })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('EMPLOYEE_IN_PAYROLL')) {
      return NextResponse.json({ error: 'EMPLOYEE_IN_PAYROLL' }, { status: 409 })
    }
    if (msg.includes('NOT_FOUND')) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (msg.includes('FORBIDDEN')) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    // 23503 = ยังมีตารางอื่นอ้างถึงคนนี้อยู่ (on delete restrict) — ของที่เพิ่ม
    // วันหน้าจะมาโผล่ตรงนี้ ไม่ใช่กลายเป็น 500 ที่อ่านไม่รู้เรื่อง
    if (error.code === '23503') {
      return NextResponse.json({ error: 'EMPLOYEE_HAS_HISTORY' }, { status: 409 })
    }
    console.error('[employees] ลบคนงานไม่สำเร็จ', msg)
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, deleted: data })
}
