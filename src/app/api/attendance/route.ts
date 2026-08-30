import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { todayInBangkok } from '@/lib/format'
import { isUuid, MAX_NOTE } from '@/lib/transactions'

export const runtime = 'nodejs'

/** รหัสเหตุผลที่ guard trigger โยนออกมา — ส่งต่อให้ client อ่านเป็นภาษาคนได้ */
const GUARD_CODES = ['WORK_UNITS_EXCEEDED', 'EMPLOYEE_INACTIVE', 'EMPLOYEE_NOT_FOUND']
const guardCode = (msg: string) => GUARD_CODES.find((c) => msg.includes(c))

/**
 * POST /api/attendance — ลงชื่อคนเข้าไซต์หนึ่งคน
 *
 * 🔴 `wage_snapshot` ไม่รับจาก client เลย — trigger เป็นคนถ่ายจากเรตในฐานข้อมูล
 * (ดู P4-DB-09) · ที่นี่ส่งแค่ ใคร · ไซต์ไหน · วันไหน · กี่ส่วน · OT เท่าไหร่
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

  const siteId = body.siteId ?? body.site_id
  const employeeId = body.employeeId ?? body.employee_id
  if (!isUuid(siteId)) return NextResponse.json({ error: 'SITE_REQUIRED' }, { status: 400 })
  if (!isUuid(employeeId)) return NextResponse.json({ error: 'EMPLOYEE_REQUIRED' }, { status: 400 })

  const workDate = String(body.workDate ?? body.work_date ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return NextResponse.json({ error: 'DATE_INVALID' }, { status: 400 })
  }
  // 🔴 ปีเกิน 2200 = คนกรอก พ.ศ. ลงไป · ฐานข้อมูลรับได้ตามไวยากรณ์แต่วันเพี้ยน 543 ปี
  if (Number(workDate.slice(0, 4)) > 2200) {
    return NextResponse.json({ error: 'DATE_BUDDHIST_ERA' }, { status: 400 })
  }
  // ค่าแรงของวันที่ยังไม่มาถึงคือต้นทุนที่ยังไม่เกิด
  if (workDate > todayInBangkok()) {
    return NextResponse.json({ error: 'DATE_FUTURE' }, { status: 400 })
  }

  const rawUnits = Number(body.workUnits ?? body.work_units ?? 1)
  if (rawUnits !== 0.5 && rawUnits !== 1) {
    return NextResponse.json({ error: 'WORK_UNITS_INVALID' }, { status: 400 })
  }
  // 🔴 OT เป็นเงิน — หัวหน้าไซต์ไม่เห็นและไม่ตั้ง (เจ้าของสั่งไว้ 31 ส.ค. 2569)
  // ค่าที่หัวหน้าไซต์ส่งมาถูกเพิกเฉย ไม่ใช่ตอบ error เพราะหน้าจอของเขาไม่มีช่องนี้อยู่แล้ว
  const ot = me.role === 'owner' ? Number(body.otAmount ?? body.ot_amount ?? 0) : 0
  if (!Number.isFinite(ot) || ot < 0 || ot > 999_999) {
    return NextResponse.json({ error: 'OT_INVALID' }, { status: 400 })
  }
  const note = String(body.note ?? '').trim().slice(0, MAX_NOTE)

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('attendance')
    .insert({
      site_id: siteId,
      employee_id: employeeId,
      work_date: workDate,
      work_units: rawUnits,
      note: note === '' ? null : note,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    const code = guardCode(error.message ?? '')
    if (code) return NextResponse.json({ error: code }, { status: 409 })
    if (/attendance_once_per_site/.test(error.message ?? '')) {
      return NextResponse.json({ error: 'ALREADY_SIGNED_IN' }, { status: 409 })
    }
    if (/row-level security/i.test(error.message ?? '')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
    console.error('[attendance] ลงชื่อไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  // 🔴 RLS ที่ปฏิเสธไม่คืน error เสมอไป — อ่านแถวกลับมาดูว่ามีจริง
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  // ยอดเงินอยู่คนละตาราง (`attendance_wages` เจ้าของอ่านได้คนเดียว) และ trigger
  // เป็นคนสร้างแถวให้แล้ว · เหลือแค่ OT ที่เจ้าของกรอกเอง
  if (ot > 0) {
    const { error: otErr } = await sb
      .from('attendance_wages')
      .update({ ot_amount: Math.round(ot * 100) / 100 })
      .eq('attendance_id', data.id)
      .select('attendance_id')
      .maybeSingle()
    if (otErr) {
      console.error('[attendance] บันทึก OT ไม่สำเร็จ', otErr.message)
      return NextResponse.json({ ok: true, attendance: data, otError: 'OT_FAILED' }, { status: 201 })
    }
  }

  return NextResponse.json({ ok: true, attendance: data }, { status: 201 })
}
