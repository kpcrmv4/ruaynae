import type { BadgeTone } from '@/components/ui/badge'
import { parseAmount, parseDate } from '@/lib/sites'

/**
 * หลักประกันสัญญา + ประกันผลงาน (R11 · คำสั่งเจ้าของ 19 ก.ย. 2569)
 *
 * งานราชการถูกหักหลักประกันราว 5% ของค่าจ้าง ได้คืนเมื่อครบประกันผลงาน
 * (ค่าเริ่มต้น 24 เดือน นับจากวันส่งมอบงวดสุดท้าย) · ไฟล์นี้คือค่าคงที่และตัวตรวจ
 * ที่ฟอร์มโครงการ · API · หน้ารายงาน · หน้าแรก · สรุปเช้า ใช้ร่วมกัน
 */
export type BondKind = 'cash' | 'bank_guarantee'
export const BOND_KINDS = ['cash', 'bank_guarantee'] as const satisfies readonly BondKind[]
export const BOND_KIND_LABEL: Record<BondKind, string> = {
  cash: 'เงินสดหักไว้',
  bank_guarantee: 'หนังสือค้ำประกัน',
}
export const isBondKind = (v: unknown): v is BondKind => v === 'cash' || v === 'bank_guarantee'

/** อัตราหลักประกันที่ระบบเติมให้ก่อน — แก้ได้เสมอ (เจ้าของตัดสิน 19 ก.ย. 2569) */
export const BOND_DEFAULT_RATE = 0.05
export const WARRANTY_DEFAULT_MONTHS = 24
/** แจ้งเตือนล่วงหน้ากี่วัน (เจ้าของตัดสิน 19 ก.ย. 2569) */
export const BOND_SOON_DAYS = 30
export const MAX_CONTRACT_NO = 40
export const MAX_BOND_REF = 120

export type BondStatus =
  | 'none'
  | 'pending_handover'
  | 'in_warranty'
  | 'due_soon'
  | 'overdue'
  | 'returned'

export const BOND_STATUS_LABEL: Record<BondStatus, string> = {
  none: 'ไม่มีหลักประกัน',
  pending_handover: 'ยังไม่ส่งมอบ',
  in_warranty: 'อยู่ในประกัน',
  due_soon: 'ใกล้ครบประกัน',
  overdue: 'ครบแล้ว รอทวงคืน',
  returned: 'ได้คืนแล้ว',
}

export const BOND_STATUS_TONE: Record<BondStatus, BadgeTone> = {
  none: 'pending',
  pending_handover: 'pending',
  in_warranty: 'info',
  due_soon: 'progress',
  overdue: 'urgent',
  returned: 'done',
}

export const isBondStatus = (v: unknown): v is BondStatus =>
  typeof v === 'string' && v in BOND_STATUS_LABEL

/** ยอดหลักประกันที่ระบบเติมให้จากค่างาน — ปัดเป็นสตางค์ */
export const suggestBond = (contractAmount: number) =>
  Math.round(contractAmount * BOND_DEFAULT_RATE * 100) / 100

/** คอลัมน์หลักประกันบน `site_finance` ที่ฟอร์มโครงการแก้ได้ */
export type BondFields = {
  contract_no: string | null
  contract_date: string | null
  bond_kind: BondKind | null
  bond_amount: number
  bond_ref: string | null
  handover_date: string | null
  warranty_months: number
}

export type BondParse = { ok: true; fields: BondFields } | { ok: false; error: string }

const text = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').trim().slice(0, max)
  return s === '' ? null : s
}

/**
 * ตรวจฟิลด์หลักประกันจาก payload ของ POST/PATCH โครงการ — ตัวเดียวทั้งสองทาง
 * · ค่าว่างทั้งชุด = ไม่มีหลักประกัน (งานเอกชน) ไม่ใช่ค่าผิด
 */
export function parseBondFields(b: unknown): BondParse {
  const o = (b ?? {}) as Record<string, unknown>

  const rawKind = o.bondKind ?? o.bond_kind
  const bondKind = rawKind === '' || rawKind === null || rawKind === undefined ? null : rawKind
  if (bondKind !== null && !isBondKind(bondKind)) return { ok: false, error: 'BOND_KIND_INVALID' }

  const amount = parseAmount(o.bondAmount ?? o.bond_amount)
  if (!amount.ok) return { ok: false, error: 'BOND_AMOUNT_INVALID' }

  const contractDate = parseDate(o.contractDate ?? o.contract_date)
  if (!contractDate.ok) return { ok: false, error: contractDate.error }
  const handover = parseDate(o.handoverDate ?? o.handover_date)
  if (!handover.ok) return { ok: false, error: handover.error }

  const rawMonths = o.warrantyMonths ?? o.warranty_months
  let months = WARRANTY_DEFAULT_MONTHS
  if (rawMonths !== undefined && rawMonths !== null && rawMonths !== '') {
    const n = Number(rawMonths)
    if (!Number.isInteger(n) || n < 0 || n > 120) return { ok: false, error: 'WARRANTY_INVALID' }
    months = n
  }

  return {
    ok: true,
    fields: {
      contract_no: text(o.contractNo ?? o.contract_no, MAX_CONTRACT_NO),
      contract_date: contractDate.value,
      bond_kind: bondKind,
      // ไม่มีชนิด = ไม่มีหลักประกัน · ยอดที่ค้างอยู่ไม่ควรถูกนับเป็นเงินรอทวง
      bond_amount: bondKind === null ? 0 : amount.value,
      bond_ref: text(o.bondRef ?? o.bond_ref, MAX_BOND_REF),
      handover_date: handover.value,
      warranty_months: months,
    },
  }
}

export const BOND_ERRORS: Record<string, string> = {
  BOND_KIND_INVALID: 'ชนิดหลักประกันไม่ถูกต้อง',
  BOND_AMOUNT_INVALID: 'ยอดหลักประกันต้องเป็นตัวเลขที่ไม่ติดลบ',
  WARRANTY_INVALID: 'ระยะประกันต้องเป็นจำนวนเดือน 0–120',
  BOND_NONE: 'โครงการนี้ไม่มีหลักประกันสัญญา — ตั้งชนิดและยอดในกล่องแก้ไขก่อน',
  BOND_ALREADY_RETURNED: 'บันทึกว่าได้รับหลักประกันคืนไปแล้ว',
  BOND_NOT_HANDED_OVER: 'ยังไม่ได้ระบุวันส่งมอบงวดสุดท้าย — ใส่ในกล่องแก้ไขก่อน',
  RETURN_DATE_REQUIRED: 'กรุณาระบุวันที่ได้รับคืน',
  RETURN_AMOUNT_INVALID: 'ยอดที่ได้คืนต้องเป็นตัวเลขมากกว่า 0',
  CATEGORY_MISSING: 'ไม่พบหมวดรายรับ "หลักประกันสัญญาคืน" — เปิดหมวดนี้ในหน้าตั้งค่าก่อน',
  RETURN_FAILED: 'บันทึกการรับคืนไม่สำเร็จ กรุณาลองใหม่',
}

/** แถว `site_finance` ที่หน้าโครงการอ่านมา — ชุดคอลัมน์หลักประกันเท่านั้น */
export type BondRow = {
  bond_kind: BondKind | null
  bond_amount: number
  handover_date: string | null
  warranty_end: string | null
  bond_returned_at: string | null
}

/**
 * สถานะของโครงการเดียว — **สูตรเดียวกับ RPC `bond_status`** (คิดจากวันที่ตอนอ่าน)
 * ใช้ในหน้าโครงการซึ่งอ่าน `site_finance` ตรงอยู่แล้ว ไม่ต้องยิง RPC เพิ่ม
 * · `daysLeft` ติดลบ = เลยมาแล้วกี่วัน · null = ยังไม่ส่งมอบ
 */
export function bondStatusOf(
  f: BondRow,
  today: string,
  soonDays = BOND_SOON_DAYS,
): { status: BondStatus; daysLeft: number | null } {
  const daysLeft = f.warranty_end
    ? Math.round((Date.parse(`${f.warranty_end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
    : null
  if (!f.bond_kind || f.bond_amount <= 0) return { status: 'none', daysLeft }
  if (f.bond_returned_at) return { status: 'returned', daysLeft }
  if (!f.handover_date || daysLeft === null) return { status: 'pending_handover', daysLeft }
  if (daysLeft < 0) return { status: 'overdue', daysLeft }
  if (daysLeft <= soonDays) return { status: 'due_soon', daysLeft }
  return { status: 'in_warranty', daysLeft }
}
