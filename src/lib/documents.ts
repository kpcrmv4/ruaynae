import type { BadgeTone } from '@/components/ui/badge'

/**
 * ใบเสนอราคา + ใบเสร็จรับเงิน/ใบกำกับภาษี (R12) — ค่าคงที่ · ตัวตรวจ · สูตรเงิน
 *
 * 🔴 สูตรในไฟล์นี้ถูกเขียน **สองที่** (ที่นี่ และ `doc_recalc()` ในฐานข้อมูล)
 * จึงต้องขับด้วย **ตารางเคสชุดเดียวกัน** แล้วยืนยันว่าสองฝั่งตอบเท่ากัน —
 * ไม่ใช่เขียนเทสต์แยกสองชุดซึ่งจะเห็นตรงกันเฉพาะเคสที่คนเขียนนึกออกทั้งคู่
 * (`scripts/verify-doc-math.mjs` เป็นตัวกระทบยอด)
 */

export type DocKind = 'quotation' | 'invoice' | 'receipt'
export type DocStatus = 'draft' | 'issued' | 'sent' | 'accepted' | 'void'
export type VatMode = 'inclusive' | 'exclusive' | 'none'

/** เรียงตามลำดับงานจริง: เสนอราคา → แจ้งหนี้ → เก็บเงิน */
export const DOC_KINDS = ['quotation', 'invoice', 'receipt'] as const satisfies readonly DocKind[]
export const DOC_KIND_LABEL: Record<DocKind, string> = {
  quotation: 'ใบเสนอราคา',
  invoice: 'ใบแจ้งหนี้',
  receipt: 'ใบเสร็จรับเงิน / ใบกำกับภาษี',
}
/** ชื่อสั้นสำหรับปุ่มและแท็บ — ชื่อเต็มยาวเกินไปบนจอ 390px */
export const DOC_KIND_SHORT: Record<DocKind, string> = {
  quotation: 'ใบเสนอราคา',
  invoice: 'ใบแจ้งหนี้',
  receipt: 'ใบเสร็จ',
}

/**
 * ใบชนิดนี้สร้างใบชนิดไหนต่อได้บ้าง (ปุ่ม "สร้าง… จากใบนี้")
 *
 * 🔴 ใบเสนอราคาข้ามไปออกใบเสร็จได้เลย — งานเล็กที่รับเงินสดหน้างานไม่มีใคร
 * วางบิลก่อน · บังคับให้ผ่านใบแจ้งหนี้เมื่อไหร่ เจ้าของจะออกใบแจ้งหนี้ทิ้ง
 * เปล่า ๆ เพียงเพื่อผ่านด่าน แล้วเลขที่ใบแจ้งหนี้จะกลายเป็นเลขที่ไม่มีความหมาย
 */
export const CONVERT_TARGETS: Record<DocKind, readonly DocKind[]> = {
  quotation: ['invoice', 'receipt'],
  invoice: ['receipt'],
  receipt: [],
}

/**
 * ป้ายของ `valid_until` ซึ่งแปลว่าคนละเรื่องกันในแต่ละชนิด
 *
 * ใช้คอลัมน์เดียวกันเพราะมันคือ "วันที่สองของหัวกระดาษ" ทั้งคู่ และทั้งคู่
 * ต้องไม่ก่อนวันที่เอกสาร (`documents_valid_until_after`) — แยกคอลัมน์
 * จะได้ช่องที่ว่างตลอดกาลหนึ่งช่องต่อชนิด โดยไม่มีหน้าจอไหนได้ประโยชน์
 * · `null` = ชนิดนี้ไม่มีวันที่สอง และ route จะล้างค่าทิ้งให้เอง
 */
export const SECOND_DATE_LABEL: Record<DocKind, string | null> = {
  quotation: 'ยืนราคาถึง',
  invoice: 'กำหนดชำระ',
  receipt: null,
}
export const hasSecondDate = (kind: DocKind) => SECOND_DATE_LABEL[kind] !== null

export const DOC_STATUSES = ['draft', 'issued', 'sent', 'accepted', 'void'] as const
export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  draft: 'ร่าง',
  issued: 'ออกเลขแล้ว',
  sent: 'ส่งให้ลูกค้าแล้ว',
  accepted: 'ลูกค้าตอบรับแล้ว',
  void: 'ยกเลิกแล้ว',
}
export const DOC_STATUS_TONE: Record<DocStatus, BadgeTone> = {
  draft: 'pending',
  issued: 'info',
  sent: 'progress',
  accepted: 'done',
  void: 'urgent',
}

export const VAT_MODES = ['inclusive', 'exclusive', 'none'] as const
export const VAT_MODE_LABEL: Record<VatMode, string> = {
  inclusive: 'ยอดที่กรอกรวม VAT แล้ว',
  exclusive: 'ยอดที่กรอกยังไม่รวม VAT',
  none: 'ไม่คิด VAT',
}

export const DEFAULT_VAT_RATE = 0.07
/** หัก ณ ที่จ่ายของงานรับเหมา — **ไม่ขึ้นกระดาษ** (D1) ใช้คำนวณบรรทัดบอกใบ้เท่านั้น */
export const WHT_RATE = 0.01

export const MAX_LINES = 30
export const MAX_DESCRIPTION = 300
export const MAX_CUSTOMER_NAME = 120

export const isDocKind = (v: unknown): v is DocKind =>
  v === 'quotation' || v === 'invoice' || v === 'receipt'
export const isDocStatus = (v: unknown): v is DocStatus =>
  typeof v === 'string' && v in DOC_STATUS_LABEL
export const isVatMode = (v: unknown): v is VatMode =>
  v === 'inclusive' || v === 'exclusive' || v === 'none'

/** ปัดเป็นสตางค์ — ใช้ตัวเดียวกันทุกที่ในไฟล์นี้ */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

export type DocLineInput = {
  /** จำนวน — ทศนิยมได้ถึง 3 ตำแหน่ง (0.5 งวด · 1.5 ตัน) */
  qty: number
  /** ราคาที่ **เจ้าของพิมพ์** · โหมด inclusive = รวม VAT แล้ว */
  unitPrice: number
}

export type DocTotals = {
  /** ยอดก่อน VAT ของแต่ละบรรทัด — ผลบวกคือ `subtotal` เป๊ะ */
  lineTotals: number[]
  subtotal: number
  vat: number
  total: number
}

/**
 * สูตรเงินของเอกสาร
 *
 * ```
 * inclusive : gross = Σ round(qty × ราคาที่พิมพ์)
 *             lineTotal = round(qty × ราคาที่พิมพ์ ÷ (1+rate))
 *             subtotal = Σ lineTotal · vat = gross − subtotal · total = gross
 * exclusive : subtotal = Σ round(qty × ราคา) · vat = round(subtotal × rate) · total = subtotal + vat
 * none      : vat = 0 · total = subtotal
 * ```
 *
 * 🔴 **ทำไม VAT ต้องเป็นตัวรับเศษในโหมด inclusive**
 * ยอดตั้งต้นของเจ้าของคือยอดสุทธิที่ตกลงกับลูกค้า (122,500 · 580,000)
 * ถ้าคิด `round(subtotal × 7%)` ยอดรวมของ CM011 จะกลายเป็น 579,999.99
 * — หายไปหนึ่งสตางค์จากตัวเลขที่เซ็นสัญญากันไว้ · ให้ VAT ดูดเศษแทน
 * ยอดรวมบนกระดาษจึงตรงกับที่ตกลงเสมอ และ VAT ยังเพี้ยนไม่เกินสองสตางค์
 *
 * 🔴 **ทำไม subtotal ต้องเป็นผลบวกของบรรทัด ไม่ใช่ `round(gross ÷ 1.07)`**
 * สามบรรทัดละ ฿10 ให้ผลต่างกัน: Σ บรรทัด = 28.05 แต่ `round(30÷1.07)` = 28.04
 * · บรรทัดบนใบกำกับภาษีต้องบวกได้ยอดข้างล่างเป๊ะ ไม่งั้นกระดาษขัดกันเอง
 */
export function docTotals(
  lines: readonly DocLineInput[],
  mode: VatMode,
  rate: number = DEFAULT_VAT_RATE,
): DocTotals {
  const safe = lines.map((l) => ({
    qty: Number.isFinite(l.qty) ? l.qty : 0,
    unitPrice: Number.isFinite(l.unitPrice) ? l.unitPrice : 0,
  }))

  if (mode === 'inclusive') {
    const lineTotals = safe.map((l) => round2((l.qty * l.unitPrice) / (1 + rate)))
    const subtotal = round2(lineTotals.reduce((s, n) => s + n, 0))
    const gross = round2(safe.reduce((s, l) => s + round2(l.qty * l.unitPrice), 0))
    return { lineTotals, subtotal, vat: round2(gross - subtotal), total: gross }
  }

  const lineTotals = safe.map((l) => round2(l.qty * l.unitPrice))
  const subtotal = round2(lineTotals.reduce((s, n) => s + n, 0))
  if (mode === 'none') return { lineTotals, subtotal, vat: 0, total: subtotal }
  const vat = round2(subtotal * rate)
  return { lineTotals, subtotal, vat, total: round2(subtotal + vat) }
}

/**
 * หัก ณ ที่จ่าย 1% ที่ราชการจะหักไป — **คำนวณสด ไม่เก็บ ไม่ขึ้นกระดาษ** (D1)
 *
 * เจ้าของเอาใบยอดเต็มไปแลกหนังสือรับรอง ผู้จ่ายเงินเป็นคนหักเอง
 * ยอดที่เข้าบัญชีจึงไม่เท่ากับยอดบนใบเสร็จอยู่แล้ว — บรรทัดนี้มีไว้ให้
 * กระทบยอดกับสเตทเมนต์ได้โดยไม่ต้องเปิดเครื่องคิดเลข
 */
export const whtHint = (subtotal: number, total: number) => {
  const wht = round2(subtotal * WHT_RATE)
  return { wht, netReceived: round2(total - wht) }
}

/** เลขที่เอกสารถัดไปจาก "เลขล่าสุด" ที่เจ้าของกรอก — `RC1140` → `RC1141` */
export type DocNoParts = { prefix: string; pad: number; lastNo: number }

/**
 * แยก `RC1140` เป็น prefix/pad/เลข
 *
 * 🔴 `pad` มาจากจำนวนหลักที่พิมพ์ ไม่ใช่ค่าคงที่ — `CM011` ต้องออกใบถัดไปเป็น
 * `CM012` ไม่ใช่ `CM0012` · ไฟล์จริงของเจ้าของใช้คนละความยาวในสองชนิด
 */
export function parseDocNo(input: string): DocNoParts | null {
  const m = /^([^\d]*)(\d{1,9})$/.exec(input.trim())
  if (!m) return null
  const prefix = m[1].trim()
  if (prefix.length > 10) return null
  return { prefix, pad: m[2].length, lastNo: Number(m[2]) }
}

export const formatDocNo = (p: DocNoParts, n: number) =>
  `${p.prefix}${String(n).padStart(p.pad, '0')}`

/** เลขของใบถัดไปที่จะออก — ใช้โชว์ในหน้าตั้งค่าว่า "ใบต่อไปจะเป็นอะไร" */
export const nextDocNoPreview = (p: DocNoParts) => formatDocNo(p, p.lastNo + 1)

/** ส่วนตัวเลขของเลขที่เอกสาร — ใช้กันตั้งเลขย้อนหลังไปทับใบที่ออกไปแล้ว */
export const docNoSeq = (docNo: string): number => {
  const m = /(\d+)$/.exec(docNo)
  return m ? Number(m[1]) : -1
}

/** เอกสารที่ยังแก้ได้ไหม — ส่งให้ลูกค้าแล้วหรือผูกรายรับแล้วคือจบ (D4) */
export const isEditable = (status: DocStatus, txnId: string | null) =>
  (status === 'draft' || status === 'issued') && !txnId

/**
 * ค่าตั้งต้นของฟอร์มเอกสาร
 *
 * 🔴 อยู่ในไฟล์นี้ **ไม่ใช่ใน `doc-form.tsx`** เพราะหน้า `/documents/new` เป็น
 * Server Component ที่เรียกมันตอนเรนเดอร์ · ฟังก์ชันที่ export จากโมดูล
 * `'use client'` เรียกจากเซิร์ฟเวอร์ไม่ได้ และอาการคือ **หน้าพังทั้งหน้า
 * ให้ผู้ใช้จริงทุกคน โดย `fetch` ยังได้ 200 พร้อม HTML ที่ดูปกติ**
 * — error เกิดตอนเบราว์เซอร์ประมวลผลสตรีม RSC เท่านั้น
 * (เคสเดียวกับ `wageRowKey` · ดู `src/lib/wage-row-key.ts` และ P0-BROWSER-01)
 */
export type LineDraft = { description: string; qty: string; unit: string; unitPrice: string }

export type DocFormInitial = {
  customerId: string
  customerName: string
  customerTaxId: string
  customerBranch: string
  customerAddress: string
  customerPhone: string
  siteId: string
  docDate: string
  validUntil: string
  vatMode: VatMode
  vatRate: number
  note: string
  lines: LineDraft[]
}

export const emptyDraft = (today: string, siteId = ''): DocFormInitial => ({
  customerId: '',
  customerName: '',
  customerTaxId: '',
  customerBranch: '',
  customerAddress: '',
  customerPhone: '',
  siteId,
  docDate: today,
  validUntil: '',
  vatMode: 'inclusive',
  vatRate: DEFAULT_VAT_RATE,
  note: '',
  lines: [{ description: '', qty: '1', unit: '', unitPrice: '' }],
})
