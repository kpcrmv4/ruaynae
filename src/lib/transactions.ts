import type { Database } from '@/lib/database.types'
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
