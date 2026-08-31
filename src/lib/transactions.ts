import type { Database } from '@/lib/database.types'
import type { Role } from '@/lib/auth/current-user'
import type { BadgeTone } from '@/components/ui/badge'
import { parseAmount, parseDate } from '@/lib/sites'

export type TxnKind = Database['public']['Enums']['txn_kind']
export type TxnStatus = Database['public']['Enums']['txn_status']
export type PayMethod = Database['public']['Enums']['pay_method']
export type IncomeKind = Database['public']['Enums']['income_kind']

export const TXN_KINDS = ['income', 'expense'] as const satisfies readonly TxnKind[]
export const TXN_STATUSES = ['pending', 'approved', 'rejected'] as const satisfies readonly TxnStatus[]
export const PAY_METHODS = ['cash', 'transfer'] as const satisfies readonly PayMethod[]
export const INCOME_KINDS = [
  'deposit', 'installment', 'variation_order', 'other',
] as const satisfies readonly IncomeKind[]

/**
 * ป้ายภาษาไทยของทุก enum
 *
 * `Record<Enum, string>` ไม่ใช่ `Record<string, string>` — เพิ่มค่าใหม่เข้า enum
 * แล้วรัน generate types ใหม่ ไฟล์นี้จะแดงทันที · ถ้าใช้ `string` ค่าใหม่จะโผล่
 * บนหน้าจอเป็นภาษาอังกฤษดิบเงียบ ๆ
 */
export const TXN_KIND_LABEL: Record<TxnKind, string> = {
  income: 'รายรับ',
  expense: 'รายจ่าย',
}

export const TXN_STATUS_LABEL: Record<TxnStatus, string> = {
  pending: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ตีกลับ',
}

export const TXN_STATUS_TONE: Record<TxnStatus, BadgeTone> = {
  pending: 'progress',
  approved: 'done',
  rejected: 'urgent',
}

export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  cash: 'เงินสด',
  transfer: 'โอน',
}

export const INCOME_KIND_LABEL: Record<IncomeKind, string> = {
  deposit: 'มัดจำ / เงินล่วงหน้า',
  installment: 'งวดงาน',
  variation_order: 'ค่างานเพิ่ม (VO)',
  other: 'อื่น ๆ',
}

const isIn = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v)

export const isTxnKind = (v: unknown): v is TxnKind => isIn(TXN_KINDS, v)
export const isTxnStatus = (v: unknown): v is TxnStatus => isIn(TXN_STATUSES, v)
export const isPayMethod = (v: unknown): v is PayMethod => isIn(PAY_METHODS, v)
export const isIncomeKind = (v: unknown): v is IncomeKind => isIn(INCOME_KINDS, v)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

export const MAX_NOTE = 500

/**
 * ใครแก้/ลบรายการไหนได้ — **สำเนาของ policy `transactions_update` และ
 * `transactions_delete` ในรูปที่หน้าจอใช้ตัดสินว่าจะวาดปุ่มไหม**
 *
 * 🔴 ฐานข้อมูลยังเป็นคนบังคับจริงเสมอ ตรงนี้ไม่ใช่ด่าน — มันมีไว้เพื่อไม่ให้
 * มีปุ่มที่กดแล้วโดนปฏิเสธทุกครั้ง (CLAUDE.md §15) · ปุ่มที่ไม่ควรมี ต้อง
 * ไม่วาด ไม่ใช่วาดแล้ว disable
 *
 * เงื่อนไข `supervises_site` ไม่ต้องเช็คซ้ำที่นี่ เพราะแถวที่หัวหน้าไซต์
 * **มองเห็น** ผ่าน `transactions_select` ผ่านเงื่อนไขนั้นมาแล้วทุกแถว
 */
export function canModifyTxn(
  txn: { status: TxnStatus; created_by: string | null },
  me: { id: string; role: Role },
): boolean {
  // เจ้าของแก้และลบได้ทุกแถว รวมที่อนุมัติแล้ว — เพราะรายการที่เจ้าของคีย์เอง
  // เกิดมาเป็น `approved` ตั้งแต่แรก ล็อกไว้แปลว่าพิมพ์ผิดแล้วแก้ไม่ได้เลย
  // ทุกการแก้/ลบถูกบันทึกใน `audit_log` ซึ่งเจ้าของย้อนดูได้ที่ /audit
  if (me.role === 'owner') return true
  return txn.created_by === me.id && txn.status !== 'approved'
}

export type TxnFields = {
  kind: TxnKind
  site_id: string | null
  category_id: string
  amount: number
  txn_date: string
  pay_method: PayMethod
  income_kind: IncomeKind | null
  installment_no: number | null
  note: string | null
  client_ref: string | null
}

export type TxnParse = { ok: true; fields: TxnFields } | { ok: false; error: string }

/**
 * ตรวจ payload ของการบันทึกรายการ
 *
 * 🔴 **`status` ไม่อยู่ในนี้โดยตั้งใจ** — ค่าที่ client ส่งมาต้องถูกเพิกเฉย
 * เสมอ · สถานะเริ่มต้นตัดสินฝั่งเซิร์ฟเวอร์จาก role ของคนที่กด และการเปลี่ยน
 * สถานะเป็นคนละ endpoint ที่มีด่านของตัวเอง
 *
 * @param today วันนี้ตามเวลาไทย (`todayInBangkok()`) — ห้ามให้ฟังก์ชันนี้
 *   เรียก `new Date()` เอง ไม่งั้นบนเซิร์ฟเวอร์ UTC ตอนหนึ่งทุ่มของไทย
 *   รายการของ "วันนี้" จะถูกปฏิเสธว่าเป็นวันในอนาคต
 */
export function parseTxnFields(b: unknown, today: string): TxnParse {
  const o = (b ?? {}) as Record<string, unknown>

  const kind = o.kind
  if (!isTxnKind(kind)) return { ok: false, error: 'KIND_INVALID' }

  if (!isUuid(o.categoryId ?? o.category_id)) return { ok: false, error: 'CATEGORY_REQUIRED' }
  const categoryId = String(o.categoryId ?? o.category_id)

  // `null`/ว่าง = ส่วนกลาง (ไม่ผูกไซต์) ซึ่งเป็นค่าที่ตั้งใจ ไม่ใช่ "ยังไม่ได้เลือก"
  const rawSite = o.siteId ?? o.site_id
  const siteId = rawSite === null || rawSite === undefined || rawSite === '' ? null : String(rawSite)
  if (siteId !== null && !isUuid(siteId)) return { ok: false, error: 'SITE_INVALID' }

  const amount = parseAmount(o.amount)
  if (!amount.ok) return { ok: false, error: amount.error }
  // parseAmount ยอมให้ 0 ได้ (ค่างานที่ยังไม่ตั้ง) แต่รายการเงินต้องมากกว่า 0
  if (amount.value <= 0) return { ok: false, error: 'AMOUNT_INVALID' }

  const date = parseDate(o.txnDate ?? o.txn_date)
  if (!date.ok) return { ok: false, error: date.error }
  if (!date.value) return { ok: false, error: 'DATE_REQUIRED' }
  // บันทึกรายจ่ายของพรุ่งนี้ไม่ได้ — วันที่ในอนาคตเกือบทุกครั้งคือพิมพ์ปีผิด
  // หรือเครื่องตั้งวันที่ผิด ซึ่งจะทำให้รายงานประจำเดือนขาดหายไปเงียบ ๆ
  if (date.value > today) return { ok: false, error: 'DATE_FUTURE' }

  const payMethod = o.payMethod ?? o.pay_method
  if (payMethod !== undefined && payMethod !== null && !isPayMethod(payMethod)) {
    return { ok: false, error: 'PAY_METHOD_INVALID' }
  }

  const rawIncomeKind = o.incomeKind ?? o.income_kind
  let incomeKind: IncomeKind | null = null
  let installmentNo: number | null = null

  if (kind === 'income') {
    if (!isIncomeKind(rawIncomeKind)) return { ok: false, error: 'INCOME_KIND_REQUIRED' }
    incomeKind = rawIncomeKind
    if (incomeKind === 'installment') {
      const n = Number(o.installmentNo ?? o.installment_no)
      if (!Number.isInteger(n) || n < 1 || n > 999) {
        return { ok: false, error: 'INSTALLMENT_INVALID' }
      }
      installmentNo = n
    }
  } else if (rawIncomeKind !== undefined && rawIncomeKind !== null && rawIncomeKind !== '') {
    // ฝั่งรายจ่ายห้ามมีฟิลด์ของรายรับติดมา — check constraint ในฐานข้อมูล
    // ก็กันอยู่ แต่ตอบ 400 พร้อมเหตุผลดีกว่าปล่อยให้กลายเป็น 500
    return { ok: false, error: 'INCOME_FIELDS_ON_EXPENSE' }
  }

  const note = String(o.note ?? '').trim().slice(0, MAX_NOTE)
  const clientRef = o.clientRef ?? o.client_ref
  if (clientRef !== undefined && clientRef !== null && clientRef !== '' && !isUuid(clientRef)) {
    return { ok: false, error: 'CLIENT_REF_INVALID' }
  }

  return {
    ok: true,
    fields: {
      kind,
      site_id: siteId,
      category_id: categoryId,
      amount: amount.value,
      txn_date: date.value,
      pay_method: isPayMethod(payMethod) ? payMethod : 'cash',
      income_kind: incomeKind,
      installment_no: installmentNo,
      note: note === '' ? null : note,
      client_ref: isUuid(clientRef) ? clientRef : null,
    },
  }
}

/**
 * รหัสเหตุผลจาก API และจาก guard trigger → ข้อความภาษาคน
 *
 * อยู่ที่นี่ที่เดียวเพราะมีสองหน้าที่ต้องแปลรหัสชุดเดียวกัน (ฟอร์มบันทึก
 * กับคิวอนุมัติ) · ก๊อปไปวางสองที่แล้ววันหนึ่งจะเหลือที่เดียวที่อัปเดต
 * แล้วผู้ใช้จะเห็นข้อความคนละอย่างจากความผิดพลาดเดียวกัน
 */
export const TXN_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'ไม่มีสิทธิ์ทำรายการนี้',
  INCOME_FORBIDDEN: 'หัวหน้าไซต์บันทึกรายรับไม่ได้ — เจ้าของเป็นคนบันทึกเอง',
  SITE_REQUIRED: 'กรุณาเลือกไซต์งาน',
  KIND_INVALID: 'ชนิดรายการไม่ถูกต้อง',
  CATEGORY_REQUIRED: 'กรุณาเลือกหมวด',
  CATEGORY_KIND_MISMATCH: 'หมวดที่เลือกไม่ตรงกับชนิดรายการ',
  AMOUNT_INVALID: 'จำนวนเงินต้องมากกว่า 0',
  DATE_REQUIRED: 'กรุณาเลือกวันที่',
  DATE_INVALID: 'รูปแบบวันที่ไม่ถูกต้อง',
  DATE_BUDDHIST_ERA: 'ปีที่กรอกเป็น พ.ศ. — ระบบเก็บเป็น ค.ศ. กรุณาเลือกวันจากปฏิทิน',
  DATE_FUTURE: 'บันทึกรายการของวันในอนาคตไม่ได้',
  INCOME_KIND_REQUIRED: 'กรุณาเลือกประเภทของรายรับ',
  INSTALLMENT_INVALID: 'เลขงวดต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป',
  CREATE_FAILED: 'บันทึกไม่สำเร็จ กรุณาลองใหม่',
  UNSUPPORTED_TYPE: 'รองรับเฉพาะไฟล์รูปภาพ',
  FILE_TOO_LARGE: 'ไฟล์ใหญ่เกินไป ลองถ่ายใหม่หรือเลือกรูปที่เล็กกว่า',
  TOO_MANY_ATTACHMENTS: 'แนบรูปได้ไม่เกินจำนวนที่กำหนดต่อรายการ',
  INTENT_NOT_FOUND: 'สลิปหมดอายุแล้ว กรุณาแนบใหม่',
  FILE_NOT_UPLOADED: 'อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่',
  ATTACH_FAILED: 'บันทึกรายการแล้ว แต่แนบสลิปไม่สำเร็จ',
  // ── คิวอนุมัติ ──────────────────────────────────────────────────
  NOT_FOUND: 'ไม่พบรายการนี้ — อาจถูกลบไปแล้ว',
  ALREADY_APPROVED: 'รายการนี้ถูกอนุมัติไปแล้ว',
  REASON_REQUIRED: 'กรุณาบอกเหตุผลที่ตีกลับ',
  APPROVE_FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่อนุมัติได้',
  AMOUNT_LOCKED: 'แก้จำนวนเงินของรายการที่อนุมัติแล้วไม่ได้ — เจ้าของเป็นคนแก้ให้',
  APPROVED_IMMUTABLE: 'ลบรายการที่อนุมัติแล้วไม่ได้ — เจ้าของเป็นคนลบให้',
  UPDATE_FAILED: 'บันทึกไม่สำเร็จ กรุณาลองใหม่',
  // ── แก้ไข / ลบ รายการที่บันทึกแล้ว ─────────────────────────────
  EDIT_FORBIDDEN: 'แก้รายการนี้ไม่ได้ — แก้ได้เฉพาะรายการที่คุณคีย์เองและยังไม่อนุมัติ',
  DELETE_FORBIDDEN: 'ลบรายการนี้ไม่ได้ — ลบได้เฉพาะรายการที่คุณคีย์เองและยังไม่อนุมัติ',
  DELETE_FAILED: 'ลบไม่สำเร็จ กรุณาลองใหม่',
  READ_FAILED: 'อ่านข้อมูลไม่สำเร็จ กรุณาลองใหม่',
  ATTACHMENT_INVALID: 'สลิปที่แนบมาไม่ถูกต้อง กรุณาแนบใหม่',
}

export const txnError = (code?: string) =>
  TXN_MESSAGES[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'
