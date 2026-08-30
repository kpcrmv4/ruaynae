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
