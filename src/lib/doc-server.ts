import 'server-only'

import { getSupabaseServer } from '@/lib/supabase/server'
import {
  DEFAULT_VAT_RATE, MAX_DESCRIPTION, MAX_LINES, isVatMode,
  type DocKind, type VatMode,
} from '@/lib/documents'

/**
 * ฝั่งเซิร์ฟเวอร์ของเอกสาร — สำเนาผู้ขาย และตัวอ่าน/เขียนบรรทัดรายการ
 *
 * 🔴 **สำเนาผู้ขายถูกแช่แข็งตอนออกเอกสาร** ไม่ได้ join กลับไปตอนพิมพ์
 * วันที่เจ้าของแก้ที่อยู่บริษัทหรือเปลี่ยนชื่อผู้ลงนาม ใบที่ออกไปแล้วต้องพิมพ์
 * ออกมาเหมือนใบที่ลูกค้าถืออยู่ทุกตัวอักษร เหตุผลเดียวกับ `wage_snapshot`
 */
export type SellerSnapshot = {
  companyName: string
  branchLabel: string | null
  address: string | null
  taxId: string | null
  phone: string | null
  email: string | null
  bankAccount: string | null
  signatoryName: string | null
  signatoryTitle: string | null
  footer: string | null
}

export async function sellerSnapshot(): Promise<SellerSnapshot> {
  const sb = await getSupabaseServer()
  const [{ data: branding, error: bErr }, { data: settings, error: sErr }] = await Promise.all([
    sb.from('branding').select('company_name').maybeSingle(),
    sb
      .from('app_settings')
      .select('address, tax_id, phone, email, branch_label, bank_account, doc_footer, signatory_name, signatory_title')
      .maybeSingle(),
  ])
  if (bErr) console.error('[documents] อ่านแบรนด์ไม่ได้', bErr.message)
  if (sErr) console.error('[documents] อ่านตั้งค่าไม่ได้', sErr.message)

  return {
    companyName: branding?.company_name ?? '',
    branchLabel: settings?.branch_label ?? null,
    address: settings?.address ?? null,
    taxId: settings?.tax_id ?? null,
    phone: settings?.phone ?? null,
    email: settings?.email ?? null,
    bankAccount: settings?.bank_account ?? null,
    signatoryName: settings?.signatory_name ?? null,
    signatoryTitle: settings?.signatory_title ?? null,
    footer: settings?.doc_footer ?? null,
  }
}

export type LineInput = {
  description: string
  qty: number
  unit: string | null
  unitPrice: number
}

export type ParsedLines =
  | { ok: true; lines: LineInput[] }
  | { ok: false; error: string }

/**
 * ตรวจบรรทัดรายการที่ส่งมาจากฟอร์ม
 *
 * 🔴 ยอดเงินของเอกสาร **ไม่รับจากหน้าจอเลย** — ฐานข้อมูลคิดเองจากบรรทัด
 * (`doc_recalc`) กระดาษจึงขัดกับบรรทัดของตัวเองไม่ได้ แม้มีคนยิง API ตรง
 */
export function parseLines(raw: unknown): ParsedLines {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'DOC_LINES_EMPTY' }
  if (raw.length > MAX_LINES) return { ok: false, error: 'DOC_LINES_TOO_MANY' }

  const lines: LineInput[] = []
  for (const r of raw) {
    const description = String((r as Record<string, unknown>)?.description ?? '').trim()
    if (!description) return { ok: false, error: 'DOC_LINE_DESCRIPTION_REQUIRED' }

    const qty = Number((r as Record<string, unknown>)?.qty ?? 1)
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1_000_000) {
      return { ok: false, error: 'DOC_LINE_QTY_INVALID' }
    }

    const unitPrice = Number((r as Record<string, unknown>)?.unitPrice ?? 0)
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 999_999_999) {
      return { ok: false, error: 'DOC_LINE_PRICE_INVALID' }
    }

    const unitRaw = String((r as Record<string, unknown>)?.unit ?? '').trim()
    lines.push({
      description: description.slice(0, MAX_DESCRIPTION),
      qty,
      unit: unitRaw === '' ? null : unitRaw.slice(0, 20),
      unitPrice,
    })
  }
  return { ok: true, lines }
}

/** เขียนบรรทัดใหม่ทั้งชุด — ลบของเดิมแล้วใส่ใหม่ ง่ายกว่าไล่ diff ทีละแถว */
export async function replaceLines(documentId: string, lines: LineInput[]) {
  const sb = await getSupabaseServer()
  const { error: dErr } = await sb.from('document_lines').delete().eq('document_id', documentId)
  if (dErr) return dErr
  const { error: iErr } = await sb.from('document_lines').insert(
    lines.map((l, i) => ({
      document_id: documentId,
      seq: i + 1,
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      unit_price: l.unitPrice,
    })),
  )
  return iErr
}

export const parseVatMode = (v: unknown): VatMode => (isVatMode(v) ? v : 'inclusive')

export const parseVatRate = (v: unknown): number => {
  const n = Number(v ?? DEFAULT_VAT_RATE)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_VAT_RATE
}

export const isDocKindValue = (v: unknown): v is DocKind => v === 'quotation' || v === 'receipt'
