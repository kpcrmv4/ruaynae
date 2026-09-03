import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { todayInBangkok } from '@/lib/format'
import { isUuid } from '@/lib/transactions'

export const runtime = 'nodejs'

/** รหัสเหตุผลที่ฟังก์ชัน/guard โยนออกมา — ส่งต่อให้หน้าจอแปลเป็นภาษาคน */
const CODES = [
  'FORBIDDEN',
  'DATE_FUTURE',
  'WORK_UNITS_INVALID',
  'WORK_UNITS_EXCEEDED',
  'AMOUNT_INVALID',
  'PAYROLL_CLOSED',
  'EMPLOYEE_INACTIVE',
  'EMPLOYEE_NOT_FOUND',
]
const codeOf = (msg: string) => CODES.find((c) => msg.includes(c))

/**
 * POST /api/payroll/day — บันทึกช่องเดียวของตารางการทำงาน (เจ้าของเท่านั้น)
 *
 * ต่างจาก `POST /api/attendance` ตรงที่ **รับค่าแรงของวันนั้นมาด้วย** — เจ้าของ
 * แก้ได้เป็นวัน ๆ (ค่าเริ่มต้นมาจากเรตของคนนั้น) ซึ่งงานรับเหมาตกลงกันแบบนั้นจริง
 * · ของเดิมยึดเรตปัจจุบันเสมอและตั้งใจให้เป็นแบบนั้นสำหรับหัวหน้าโครงการ จึงไม่แก้
 *
 * งานทั้งหมดอยู่ในฟังก์ชัน `save_attendance_day` — สองตารางต้องเปลี่ยนพร้อมกัน
 * (attendance + attendance_wages) แยกเป็นสอง request แล้ววันหนึ่งอันที่สองจะล้ม
 * เหลือวันทำงานที่ค่าแรงเป็นเรตเก่าโดยไม่มีใครรู้
 */
export async function POST(req: NextRequest) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  // ฟังก์ชันเช็คซ้ำอีกชั้นอยู่แล้ว — ตรงนี้แค่ไม่ยิงไปให้เสียเที่ยว
  if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const employeeId = body.employeeId ?? body.employee_id
  const siteId = body.siteId ?? body.site_id
  if (!isUuid(employeeId)) return NextResponse.json({ error: 'EMPLOYEE_REQUIRED' }, { status: 400 })
  if (!isUuid(siteId)) return NextResponse.json({ error: 'SITE_REQUIRED' }, { status: 400 })

  const workDate = String(body.workDate ?? body.work_date ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return NextResponse.json({ error: 'DATE_INVALID' }, { status: 400 })
  }
  // 🔴 ปีเกิน 2200 = คนกรอก พ.ศ. ลงไป · วันจะเพี้ยน 543 ปีโดยไม่มี error
  if (Number(workDate.slice(0, 4)) > 2200) {
    return NextResponse.json({ error: 'DATE_BUDDHIST_ERA' }, { status: 400 })
  }
  if (workDate > todayInBangkok()) {
    return NextResponse.json({ error: 'DATE_FUTURE' }, { status: 400 })
  }

  const units = Number(body.workUnits ?? body.work_units ?? 1)
  if (units !== 0.5 && units !== 1) {
    return NextResponse.json({ error: 'WORK_UNITS_INVALID' }, { status: 400 })
  }

  const wage = Number(body.wage ?? body.wage_snapshot ?? 0)
  const ot = Number(body.otAmount ?? body.ot_amount ?? 0)
  if (!Number.isFinite(wage) || wage < 0 || wage > 9_999_999) {
    return NextResponse.json({ error: 'AMOUNT_INVALID' }, { status: 400 })
  }
  if (!Number.isFinite(ot) || ot < 0 || ot > 999_999) {
    return NextResponse.json({ error: 'OT_INVALID' }, { status: 400 })
  }

  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('save_attendance_day', {
    p_employee: String(employeeId),
    p_site: String(siteId),
    p_date: workDate,
    p_work_units: units,
    p_wage: Math.round(wage * 100) / 100,
    p_ot: Math.round(ot * 100) / 100,
  })

  if (error) {
    const code = codeOf(error.message ?? '')
    if (code) {
      return NextResponse.json({ error: code }, { status: code === 'FORBIDDEN' ? 403 : 409 })
    }
    console.error('[payroll/day] บันทึกไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'SAVE_FAILED' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, attendanceId: data }, { status: 200 })
}
