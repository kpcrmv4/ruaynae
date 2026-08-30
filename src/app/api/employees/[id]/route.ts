import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { parseEmployeeFields } from '@/lib/employees'

export const runtime = 'nodejs'

/**
 * PATCH /api/employees/[id] — แก้คนงาน หรือปิด/เปิดใช้งาน (เจ้าของเท่านั้น)
 *
 * `{ isActive: false }` อย่างเดียว = ปิดใช้งาน · ไม่มีปุ่มลบเลยโดยตั้งใจ
 * ลบคนที่มีประวัติค่าแรงทิ้งคือการลบต้นทุนของงานที่ปิดไปแล้ว —
 * `attendance.employee_id` เป็น `on delete restrict` ก็กันไว้อีกชั้นที่ฐานข้อมูล
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await ctx.params
  const sb = await getSupabaseServer()

  const { data: existing, error: rErr } = await sb
    .from('employees')
    .select('id, full_name, job_title, wage_type, daily_rate, monthly_salary, default_site_id, is_active, profile_id')
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

  // สลับสถานะอย่างเดียว — ไม่ต้องส่งทั้งฟอร์มมาเพื่อกดปุ่มเดียว
  const onlyActive =
    Object.keys(body).length === 1 && (body.isActive !== undefined || body.is_active !== undefined)

  const patch = onlyActive
    ? { is_active: Boolean(body.isActive ?? body.is_active) }
    : (() => {
        // เติมค่าเดิมให้ฟิลด์ที่ไม่ได้ส่งมา เพื่อให้กฎ "รายวันต้องมีเรต"
        // ตัดสินจากภาพรวมของแถว ไม่ใช่จากเศษที่ client ส่งมาครั้งนี้
        const merged = { ...existing, ...body }
        const parsed = parseEmployeeFields(merged)
        return parsed.ok ? parsed.fields : parsed.error
      })()

  if (typeof patch === 'string') {
    return NextResponse.json({ error: patch }, { status: 400 })
  }

  const { data, error } = await sb
    .from('employees')
    .update(patch)
    .eq('id', id)
    .select('id, is_active')
    .maybeSingle()

  if (error) {
    if (/employees_profile_id_key/.test(error.message)) {
      return NextResponse.json({ error: 'PROFILE_TAKEN' }, { status: 409 })
    }
    console.error('[employees] แก้คนงานไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  // 🔴 update ที่โดน 0 แถวไม่ใช่ error — ต้องอ่านแถวกลับมาดูเอง
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true, employee: data })
}
