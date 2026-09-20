'use client'

import { BookUser, Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { fmtBaht } from '@/lib/format'
import {
  DOC_KIND_SHORT, MAX_LINES, VAT_MODES, VAT_MODE_LABEL,
  docTotals, whtHint,
  type DocFormInitial, type DocKind, type LineDraft, type VatMode,
} from '@/lib/documents'

export type { DocFormInitial }

type Option = { id: string; name: string }
type CustomerOption = Option & {
  tax_id: string | null
  branch: string | null
  address: string | null
  phone: string | null
}

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่ทำได้',
  DOC_KIND_INVALID: 'ชนิดเอกสารไม่ถูกต้อง',
  DOC_CUSTOMER_REQUIRED: 'กรอกชื่อลูกค้า',
  DOC_LINES_EMPTY: 'ต้องมีอย่างน้อยหนึ่งรายการ',
  DOC_LINES_TOO_MANY: `ใส่ได้ไม่เกิน ${MAX_LINES} รายการต่อใบ`,
  DOC_LINE_DESCRIPTION_REQUIRED: 'กรอกรายละเอียดให้ครบทุกบรรทัด',
  DOC_LINE_QTY_INVALID: 'จำนวนต้องมากกว่า 0',
  DOC_LINE_PRICE_INVALID: 'ราคาต้องไม่ติดลบ',
  DATE_INVALID: 'รูปแบบวันที่ไม่ถูกต้อง',
  DATE_BUDDHIST_ERA: 'ปีที่กรอกเป็น พ.ศ. — ระบบเก็บเป็น ค.ศ. กรุณาเลือกวันจากปฏิทิน',
  VALID_UNTIL_BEFORE_DATE: 'วันยืนราคาต้องไม่ก่อนวันที่เอกสาร',
  SITE_NOT_FOUND: 'ไม่พบโครงการที่เลือก',
  DOC_LOCKED: 'เอกสารนี้ส่งให้ลูกค้าหรือผูกรายรับไปแล้ว แก้ไม่ได้',
  NAME_REQUIRED: 'กรอกชื่อลูกค้าก่อน',
  CUSTOMER_DUPLICATE: 'มีลูกค้าชื่อนี้ในทะเบียนอยู่แล้ว — เลือกจากรายการด้านบนได้เลย',
}
const fail = (code?: string) => MESSAGES[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'

const num = (s: string) => {
  const n = Number(String(s).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

/**
 * ฟอร์มเอกสาร — ใช้ทั้งตอนสร้างและตอนแก้
 *
 * 🔴 ยอดที่เห็นบนฟอร์มคำนวณด้วย `docTotals()` ตัวเดียวกับที่ฐานข้อมูลใช้
 * (สูตรเดียวกัน ขับด้วยตารางเคสเดียวกันใน `verify-doc-math`) — ตัวเลขที่
 * พรีวิวไว้จึงตรงกับที่บันทึกจริงเสมอ ไม่ใช่ "ประมาณการหน้าจอ"
 * · แต่ยอดที่ **บันทึก** มาจากฐานข้อมูลเท่านั้น ฟอร์มไม่ส่งยอดรวมไปเลย
 */
export function DocForm({
  mode,
  kind,
  docId,
  initial,
  sites,
  customers,
}: {
  mode: 'create' | 'edit'
  kind: DocKind
  docId?: string
  initial: DocFormInitial
  sites: Option[]
  customers: CustomerOption[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [f, setF] = useState(initial)

  const set = <K extends keyof DocFormInitial>(k: K, v: DocFormInitial[K]) =>
    setF((prev) => ({ ...prev, [k]: v }))

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setF((prev) => ({
      ...prev,
      lines: prev.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    }))

  const totals = docTotals(
    f.lines.map((l) => ({ qty: num(l.qty), unitPrice: num(l.unitPrice) })),
    f.vatMode,
    f.vatRate,
  )
  const hint = whtHint(totals.subtotal, totals.total)

  /**
   * เก็บลูกค้าที่พิมพ์ไว้ในใบนี้เข้าทะเบียน เพื่อให้ใบหน้าเลือกได้เลย
   *
   * มาจากชีต "ลูกค้า" ในไฟล์เดิมของเจ้าของที่ใช้ VLOOKUP เติมที่อยู่ —
   * ที่อยู่เทศบาลยาวสามบรรทัด พิมพ์ใหม่ทุกใบคือที่ที่พิมพ์ผิดได้ทุกใบ
   * · ไม่บันทึกให้อัตโนมัติตอนกดบันทึกเอกสาร เพราะงานขายครั้งเดียวจบก็มี
   *   และทะเบียนที่โตเองจะเต็มไปด้วยชื่อที่ไม่มีใครใช้ซ้ำ
   */
  async function saveCustomer() {
    if (savingCustomer) return
    const name = f.customerName.trim()
    if (!name) {
      toast.error(MESSAGES.NAME_REQUIRED)
      return
    }
    setSavingCustomer(true)
    try {
      const r = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          taxId: f.customerTaxId,
          branch: f.customerBranch,
          address: f.customerAddress,
          phone: f.customerPhone,
        }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        // ชื่อซ้ำ = คนเดิม · ผูกใบนี้กับรายเดิมให้เลย ดีกว่าบอกว่าทำไม่ได้เฉย ๆ
        if (b.error === 'CUSTOMER_DUPLICATE' && b.id) {
          set('customerId', b.id)
          toast.success('มีรายนี้ในทะเบียนอยู่แล้ว — ผูกใบนี้กับรายเดิมให้แล้ว')
          return
        }
        toast.error(fail(b.error))
        return
      }
      set('customerId', b.customer.id)
      toast.success('เก็บเข้าทะเบียนลูกค้าแล้ว')
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setSavingCustomer(false)
    }
  }

  async function submit() {
    if (busy) return
    setBusy(true)
    setError('')
    const payload = {
      kind,
      customerId: f.customerId || null,
      customerName: f.customerName,
      customerTaxId: f.customerTaxId,
      customerBranch: f.customerBranch,
      customerAddress: f.customerAddress,
      customerPhone: f.customerPhone,
      siteId: f.siteId || null,
      docDate: f.docDate,
      validUntil: kind === 'quotation' ? f.validUntil || null : null,
      vatMode: f.vatMode,
      vatRate: f.vatRate,
      note: f.note,
      lines: f.lines.map((l) => ({
        description: l.description,
        qty: num(l.qty),
        unit: l.unit,
        unitPrice: num(l.unitPrice),
      })),
    }
    try {
      const r = await fetch(mode === 'create' ? '/api/documents' : `/api/documents/${docId}`, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        const msg = fail(b.error)
        setError(msg)
        toast.error(msg)
        return
      }
      toast.success(mode === 'create' ? 'บันทึกร่างแล้ว' : 'บันทึกแล้ว')
      router.push(`/documents/${mode === 'create' ? b.id : docId}`)
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 pb-28">
      {/* ── ลูกค้า ─────────────────────────────────────────────────── */}
      <section className="panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">ลูกค้า</h2>

        {customers.length > 0 && (
          <div className="mb-3">
            <label htmlFor="doc-customer" className="label-base">เลือกจากทะเบียนลูกค้า</label>
            <select
              id="doc-customer"
              value={f.customerId}
              onChange={(e) => {
                const c = customers.find((x) => x.id === e.target.value)
                setF((prev) => ({
                  ...prev,
                  customerId: e.target.value,
                  // เติมให้ แต่ยัง **แก้ทับได้** — ที่อยู่บนกระดาษเป็นของใบนี้
                  ...(c
                    ? {
                        customerName: c.name,
                        customerTaxId: c.tax_id ?? '',
                        customerBranch: c.branch ?? '',
                        customerAddress: c.address ?? '',
                        customerPhone: c.phone ?? '',
                      }
                    : {}),
                }))
              }}
              className="input-base"
            >
              <option value="">— พิมพ์เอง —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="doc-name" className="label-base">ชื่อลูกค้า</label>
            <input
              id="doc-name"
              value={f.customerName}
              onChange={(e) => set('customerName', e.target.value)}
              className="input-base"
              autoFocus={mode === 'create'}
            />
          </div>
          <div>
            <label htmlFor="doc-tax" className="label-base">เลขประจำตัวผู้เสียภาษี</label>
            <input
              id="doc-tax"
              value={f.customerTaxId}
              onChange={(e) => set('customerTaxId', e.target.value)}
              inputMode="numeric"
              className="input-base tnum"
            />
          </div>
          <div>
            <label htmlFor="doc-branch" className="label-base">สำนักงานใหญ่ / สาขา</label>
            <input
              id="doc-branch"
              value={f.customerBranch}
              onChange={(e) => set('customerBranch', e.target.value)}
              placeholder="สำนักงานใหญ่"
              className="input-base"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="doc-address" className="label-base">ที่อยู่</label>
            <textarea
              id="doc-address"
              value={f.customerAddress}
              onChange={(e) => set('customerAddress', e.target.value)}
              rows={2}
              className="input-base"
            />
          </div>
          <div>
            <label htmlFor="doc-phone" className="label-base">โทรศัพท์</label>
            <input
              id="doc-phone"
              value={f.customerPhone}
              onChange={(e) => set('customerPhone', e.target.value)}
              className="input-base"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
          <button
            type="button"
            onClick={saveCustomer}
            disabled={savingCustomer}
            className="btn-secondary disabled:opacity-60"
          >
            {savingCustomer ? <Loader2 className="size-4 animate-spin" /> : <BookUser className="size-4" />}
            เก็บเข้าทะเบียนลูกค้า
          </button>
          <span className="text-xs text-muted-token">
            เก็บไว้แล้วใบหน้าเลือกจากรายการด้านบนได้เลย ไม่ต้องพิมพ์ที่อยู่ใหม่
          </span>
        </div>
      </section>

      {/* ── หัวเอกสาร ──────────────────────────────────────────────── */}
      <section className="panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">รายละเอียดเอกสาร</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="doc-date" className="label-base">วันที่เอกสาร</label>
            {/* `<input type="date">` รับ-ส่งเป็น ค.ศ. เสมอ ห้ามแปลงเป็น พ.ศ. ก่อนส่ง */}
            <input
              id="doc-date"
              type="date"
              value={f.docDate}
              onChange={(e) => set('docDate', e.target.value)}
              className="input-base tnum"
            />
          </div>
          {kind === 'quotation' && (
            <div>
              <label htmlFor="doc-valid" className="label-base">ยืนราคาถึง</label>
              <input
                id="doc-valid"
                type="date"
                value={f.validUntil}
                min={f.docDate}
                onChange={(e) => set('validUntil', e.target.value)}
                className="input-base tnum"
              />
            </div>
          )}
          <div className="sm:col-span-2">
            <label htmlFor="doc-site" className="label-base">โครงการ</label>
            <select
              id="doc-site"
              value={f.siteId}
              onChange={(e) => set('siteId', e.target.value)}
              className="input-base"
            >
              <option value="">ไม่ผูกโครงการ</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-token">
              ผูกแล้วเอกสารจะไปโผล่ในหน้าโครงการด้วย · งานที่ยังไม่รับก็ปล่อยว่างได้
            </p>
          </div>
        </div>
      </section>

      {/* ── รายการ ─────────────────────────────────────────────────── */}
      <section className="panel p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">รายการ</h2>
          <span className="text-xs text-muted-token">{f.lines.length}/{MAX_LINES}</span>
        </div>

        <div className="mb-3">
          <label htmlFor="doc-vat" className="label-base">ภาษีมูลค่าเพิ่ม</label>
          <select
            id="doc-vat"
            value={f.vatMode}
            onChange={(e) => set('vatMode', e.target.value as VatMode)}
            className="input-base"
          >
            {VAT_MODES.map((m) => (
              <option key={m} value={m}>{VAT_MODE_LABEL[m]}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-token">
            {f.vatMode === 'inclusive'
              ? 'ราคาที่กรอกคือยอดที่ตกลงกับลูกค้า — ระบบถอด VAT ออกให้ ยอดรวมจะตรงกับที่ตกลงเป๊ะ'
              : f.vatMode === 'exclusive'
                ? 'ราคาที่กรอกยังไม่รวม VAT — ระบบบวก 7% เพิ่มให้'
                : 'ไม่คิด VAT ในเอกสารใบนี้'}
          </p>
        </div>

        {/* บนมือถือแต่ละบรรทัดเป็นการ์ด — ตารางแนวนอนบนจอ 390px อ่านไม่ได้ */}
        <ul className="space-y-3">
          {f.lines.map((l, i) => (
            <li key={i} className="rounded-md border border-line-soft p-3">
              <div className="mb-2 flex items-start gap-2">
                <span className="mt-2 shrink-0 text-xs tnum text-muted-token">{i + 1}.</span>
                <textarea
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                  placeholder="รายละเอียดงาน"
                  rows={2}
                  className="input-base flex-1"
                  aria-label={`รายละเอียดบรรทัดที่ ${i + 1}`}
                />
                <button
                  type="button"
                  onClick={() => setF((p) => ({ ...p, lines: p.lines.filter((_, x) => x !== i) }))}
                  disabled={f.lines.length <= 1}
                  aria-label={`ลบบรรทัดที่ ${i + 1}`}
                  className="mt-1 shrink-0 text-urgent transition-opacity hover:opacity-70 disabled:opacity-30"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="label-base text-xs" htmlFor={`qty-${i}`}>จำนวน</label>
                  <input
                    id={`qty-${i}`}
                    value={l.qty}
                    onChange={(e) => setLine(i, { qty: e.target.value })}
                    inputMode="decimal"
                    className="input-base tnum"
                  />
                </div>
                <div>
                  <label className="label-base text-xs" htmlFor={`unit-${i}`}>หน่วย</label>
                  <input
                    id={`unit-${i}`}
                    value={l.unit}
                    onChange={(e) => setLine(i, { unit: e.target.value })}
                    placeholder="งาน"
                    className="input-base"
                  />
                </div>
                <div>
                  <label className="label-base text-xs" htmlFor={`price-${i}`}>
                    {f.vatMode === 'inclusive' ? 'ราคา (รวม VAT)' : 'ราคา/หน่วย'}
                  </label>
                  <input
                    id={`price-${i}`}
                    value={l.unitPrice}
                    onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                    inputMode="decimal"
                    className="input-base tnum"
                  />
                </div>
              </div>
              <p className="mt-1.5 text-right text-xs tnum text-muted-token">
                ก่อน VAT {fmtBaht(totals.lineTotals[i] ?? 0)}
              </p>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() =>
            setF((p) =>
              p.lines.length >= MAX_LINES
                ? p
                : { ...p, lines: [...p.lines, { description: '', qty: '1', unit: '', unitPrice: '' }] },
            )
          }
          disabled={f.lines.length >= MAX_LINES}
          className="btn-secondary mt-3 w-full disabled:opacity-50"
        >
          <Plus className="size-4" />
          เพิ่มรายการ
        </button>

        <div className="mt-3">
          <label htmlFor="doc-note" className="label-base">หมายเหตุ (พิมพ์บนกระดาษ)</label>
          <textarea
            id="doc-note"
            value={f.note}
            onChange={(e) => set('note', e.target.value)}
            rows={2}
            className="input-base"
          />
        </div>
      </section>

      {/* ── แถบยอดรวมติดขอบล่าง — มือถือต้องเห็นยอดตลอดเวลาที่พิมพ์ ──── */}
      <div className="fixed inset-x-0 bottom-[var(--bottom-nav-h,0px)] z-30 border-t border-line bg-surface/95 px-3.5 py-2.5 backdrop-blur md:px-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <dl className="min-w-0 text-xs">
            <div className="flex gap-2">
              <dt className="text-muted-token">ก่อน VAT</dt>
              <dd className="tnum text-ink-2">{fmtBaht(totals.subtotal)}</dd>
              <dt className="text-muted-token">VAT</dt>
              <dd className="tnum text-ink-2">{fmtBaht(totals.vat)}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-token">ยอดสุทธิ</dt>
              <dd className="tnum text-base font-bold text-ink">{fmtBaht(totals.total)}</dd>
            </div>
            {totals.total > 0 && (
              <p className="mt-0.5 text-[11px] text-muted-token">
                ถ้าเป็นงานราชการ จะถูกหัก ณ ที่จ่าย {fmtBaht(hint.wht)} → เงินเข้าราว {fmtBaht(hint.netReceived)}
              </p>
            )}
          </dl>
          <button
            type="button"
            onClick={submit}
            disabled={busy || f.customerName.trim() === ''}
            className="btn-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {mode === 'create' ? `บันทึกร่าง${DOC_KIND_SHORT[kind]}` : 'บันทึก'}
          </button>
        </div>
        {error && <p className="mx-auto mt-1 max-w-3xl text-sm text-urgent">{error}</p>}
      </div>
    </div>
  )
}
