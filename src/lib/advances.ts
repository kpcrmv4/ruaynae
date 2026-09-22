import type { Database } from '@/lib/database.types'
import type { BadgeTone } from '@/components/ui/badge'
import { isUuid, MAX_NOTE, isPayMethod } from '@/lib/transactions'
import { parseAmount } from '@/lib/sites'

/**
 * ใบเบิกล่วงหน้า — สูตรและคำที่ใช้ร่วมกันทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์
 *
 * 🔴 ไฟล์นี้ **ห้ามมี `'use client'`** และห้าม import อะไรที่มี —
 * หน้า server component กับกล่องฟอร์มฝั่ง client เรียกตัวเดียวกัน
 * ฟังก์ชันที่ export จากโมดูล client แล้วถูกเรียกจากเซิร์ฟเวอร์ = หน้าพัง
 * ให้ผู้ใช้ทุกคนโดยที่ `tsc` และ `next build` เขียวทั้งคู่ (§17 ข้อ 25)
 */
export type AdvanceStatus = Database['public']['Enums']['advance_status']

export const ADVANCE_STATUSES = ['pending', 'approved', 'rejected'] as const satisfies
  readonly AdvanceStatus[]

export const isAdvanceStatus = (v: unknown): v is AdvanceStatus =>
  typeof v === 'string' && (ADVANCE_STATUSES as readonly string[]).includes(v)

/**
 * คำบนหน้าจอ
 *
 * ⚠️ "อนุมัติแล้ว" ของใบเบิกแปลว่า **เงินออกจากมือเจ้าของแล้ว** ไม่ใช่แค่
 * ผ่านการตรวจ — ใบที่อนุมัติจะถูกหักคืนจากค่าแรงงวดถัดไปทันที
 */
export const ADVANCE_STATUS_LABEL: Record<AdvanceStatus, string> = {
  pending: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ถูกตีกลับ',
}

export const ADVANCE_STATUS_TONE: Record<AdvanceStatus, BadgeTone> = {
  pending: 'progress',
  approved: 'done',
  rejected: 'urgent',
}

/** แก้/ลบได้ไหม — กติกาเดียวกับ policy `advances_update` / `advances_delete` */
export const canEditAdvance = (
  row: { status: AdvanceStatus; created_by: string | null; deducted_amount?: number | null },
  me: { id: string; role: Database['public']['Enums']['user_role'] },
): boolean => {
  if (Number(row.deducted_amount ?? 0) > 0) return false
  if (me.role === 'owner') return true
  return row.created_by === me.id && row.status !== 'approved'
}

export type AdvanceFields = {
  employee_id: string
  amount: number
  advance_date: string
  site_id: string | null
  pay_method: Database['public']['Enums']['pay_method']
  note: string | null
}

export type AdvanceParse =
  | { ok: true; fields: AdvanceFields }
  | { ok: false; error: string }

/**
 * ตรวจฟิลด์ที่ client ส่งมา — ตัวเดียวกันทั้งตอนสร้างและตอนแก้
 *
 * 🔴 `requireSite` = true สำหรับหัวหน้าโครงการ · ขอบเขตของเขาคือโครงการ
 * ใบที่ไม่ผูกโครงการจึงเป็นของเจ้าของเท่านั้น (เหมือนรายจ่ายส่วนกลาง)
 */
export function parseAdvanceFields(
  b: unknown,
  today: string,
  opts: { requireSite: boolean },
): AdvanceParse {
  const body = (b ?? {}) as Record<string, unknown>

  const employeeId = body.employeeId ?? body.employee_id
  if (!isUuid(employeeId)) return { ok: false, error: 'EMPLOYEE_REQUIRED' }

  const amount = parseAmount(body.amount)
  if (!amount.ok || amount.value <= 0) return { ok: false, error: 'AMOUNT_INVALID' }

  const date = String(body.advanceDate ?? body.advance_date ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'DATE_INVALID' }
  // ปีเกิน 2200 = กรอก พ.ศ. ลงไป · ฐานข้อมูลรับได้แต่วันเพี้ยนไป 543 ปี
  if (Number(date.slice(0, 4)) > 2200) return { ok: false, error: 'DATE_BUDDHIST_ERA' }
  if (date > today) return { ok: false, error: 'DATE_FUTURE' }

  const siteRaw = body.siteId ?? body.site_id
  const siteId = isUuid(siteRaw) ? siteRaw : null
  if (opts.requireSite && !siteId) return { ok: false, error: 'SITE_REQUIRED' }

  const note = String(body.note ?? '').trim().slice(0, MAX_NOTE)
  const payMethod = body.payMethod ?? body.pay_method

  return {
    ok: true,
    fields: {
      employee_id: employeeId,
      amount: amount.value,
      advance_date: date,
      site_id: siteId,
      pay_method: isPayMethod(payMethod) ? payMethod : 'cash',
      note: note === '' ? null : note,
    },
  }
}

/** รหัสที่ guard trigger โยนออกมา — route ส่งต่อให้ client แปลเป็นภาษาคน */
export const ADVANCE_GUARD_CODES = [
  'APPROVE_FORBIDDEN', 'SITE_REQUIRED', 'PAYROLL_CLOSED',
  'DATE_FUTURE', 'ADVANCE_DEDUCTED_EXCEEDS',
]
export const advanceGuardCode = (msg: string) =>
  ADVANCE_GUARD_CODES.find((c) => msg.includes(c))

export const ADVANCE_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'ไม่มีสิทธิ์ทำรายการนี้',
  EDIT_FORBIDDEN: 'คำขอนี้แก้ไม่ได้แล้ว',
  APPROVE_FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่อนุมัติหรือตีกลับได้',
  ALREADY_APPROVED: 'คำขอนี้ถูกอนุมัติไปแล้ว',
  REASON_REQUIRED: 'กรุณาบอกเหตุผลที่ตีกลับ',
  EMPLOYEE_REQUIRED: 'กรุณาเลือกคนงาน',
  AMOUNT_INVALID: 'จำนวนเงินต้องมากกว่า 0',
  DATE_INVALID: 'รูปแบบวันที่ไม่ถูกต้อง',
  DATE_BUDDHIST_ERA: 'ปีที่กรอกเป็น พ.ศ. — ระบบเก็บเป็น ค.ศ. กรุณาเลือกวันจากปฏิทิน',
  DATE_FUTURE: 'บันทึกเบิกของวันในอนาคตไม่ได้',
  SITE_REQUIRED: 'กรุณาเลือกโครงการ',
  PAYROLL_CLOSED: 'ใบเบิกนี้ถูกหักตอนจ่ายค่าแรงไปแล้ว แก้หรือลบไม่ได้',
  ADVANCE_DEDUCTED_EXCEEDS: 'ยอดที่หักคืนแล้วมากกว่ายอดในใบเบิก',
  NOT_FOUND: 'ไม่พบรายการนี้',
}

/** 🔴 แสดงเฉพาะข้อความที่เราเขียนเอง — ที่เหลือใช้ประโยคกลาง (§17 ข้อ 13) */
export const advanceError = (code?: string) =>
  ADVANCE_MESSAGES[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'
