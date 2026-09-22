import { notFound } from 'next/navigation'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { fmtDate } from '@/lib/format'
import { DOC_KIND_LABEL, DOC_KIND_SHORT, SECOND_DATE_LABEL } from '@/lib/documents'
import { PageHeader } from '@/components/ui/page-header'
import { DataError } from '@/components/ui/data-error'
import { PrintButton } from '@/components/documents/print-button'
import type { SellerSnapshot } from '@/lib/doc-server'

export const metadata = { title: 'พิมพ์เอกสาร' }

/** เงินบนกระดาษ — ทศนิยมสองตำแหน่งเสมอ ต่างจากบนหน้าจอที่ตัดเศษทิ้ง */
const money = (n: number) =>
  n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default async function PrintDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const sb = await getSupabaseServer()

  const { data: doc, error } = await sb
    .from('documents')
    .select(`
      id, kind, doc_no, status, doc_date, valid_until, customer_name, customer_tax_id,
      customer_branch, customer_address, customer_phone, vat_mode, vat_rate,
      subtotal, vat_amount, total, amount_words, note, seller, void_reason
    `)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[documents] อ่านเอกสารเพื่อพิมพ์ไม่ได้', error.message)
    return <DataError message="โหลดเอกสารไม่สำเร็จ" />
  }
  if (!doc) notFound()

  const { data: lines } = await sb
    .from('document_lines')
    .select('id, seq, description, qty, unit, unit_price, line_total')
    .eq('document_id', id)
    .order('seq', { ascending: true })
    .range(0, PAGE_SIZE * 2 - 1)

  /**
   * 🔴 ผู้ขายอ่านจาก **สำเนาในแถว** ที่แช่แข็งไว้ตอนออกเอกสาร
   * ไม่ได้ join กลับไปที่ `branding`/`app_settings` — ใบที่ออกไปปีที่แล้ว
   * ต้องพิมพ์ออกมาเหมือนใบที่ลูกค้าถืออยู่ แม้ที่อยู่บริษัทจะเปลี่ยนไปแล้ว
   * · ร่างยังไม่มีสำเนา จึงว่างไว้ (ร่างไม่ควรถูกส่งให้ใครอยู่แล้ว)
   */
  const seller = (doc.seller ?? null) as SellerSnapshot | null

  return (
    <>
      {/* หัวข้อหน้ากับปุ่มย้อนกลับถูกซ่อนตอนพิมพ์ — กระดาษมีหัวของตัวเองอยู่แล้ว */}
      <PageHeader
        className="print-hide"
        title={`พิมพ์${DOC_KIND_SHORT[doc.kind]}`}
        subtitle={doc.doc_no ? `เลขที่ ${doc.doc_no}` : 'ยังเป็นร่าง — ยังไม่มีเลขที่เอกสาร'}
        action={<PrintButton docId={doc.id} canMarkSent={doc.status === 'issued'} />}
        backHref={`/documents/${doc.id}`}
      />

      {!seller && (
        <p className="print-hide mb-3 rounded-lg border border-status-progress-ring bg-status-progress-bg px-3 py-2.5 text-sm text-status-progress">
          ใบนี้ยังเป็น<span className="font-semibold">ร่าง</span> — ยังไม่มีเลขที่เอกสารและยังไม่ได้บันทึก
          ข้อมูลผู้ขายลงในใบ · กด &ldquo;ออกเอกสาร&rdquo; ก่อนพิมพ์ส่งลูกค้า
        </p>
      )}

      {/* ── กระดาษ ─────────────────────────────────────────────────── */}
      <article className="paper mx-auto w-full max-w-[794px] rounded-lg border border-line bg-white p-8 text-black shadow-e1">
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
          <div className="min-w-0">
            <h1 className="text-lg font-bold">{seller?.companyName ?? ''}</h1>
            {seller?.branchLabel && <p className="text-xs">{seller.branchLabel}</p>}
            {seller?.address && <p className="whitespace-pre-line text-xs">{seller.address}</p>}
            <p className="text-xs">
              {seller?.phone ? `โทร ${seller.phone}` : ''}
              {seller?.email ? ` · ${seller.email}` : ''}
            </p>
            {seller?.taxId && <p className="text-xs">เลขประจำตัวผู้เสียภาษี {seller.taxId}</p>}
          </div>
          <div className="shrink-0 text-right">
            <h2 className="text-base font-bold">{DOC_KIND_LABEL[doc.kind]}</h2>
            <table className="ml-auto mt-1 text-xs">
              <tbody>
                <tr>
                  <td className="pr-2 text-right">เลขที่</td>
                  <td className="text-left font-semibold tnum">{doc.doc_no ?? '—'}</td>
                </tr>
                <tr>
                  <td className="pr-2 text-right">วันที่</td>
                  <td className="text-left tnum">{fmtDate(doc.doc_date)}</td>
                </tr>
                {/* วันที่สอง — "ยืนราคาถึง" บนใบเสนอราคา · "กำหนดชำระ" บนใบแจ้งหนี้ */}
                {doc.valid_until && SECOND_DATE_LABEL[doc.kind] && (
                  <tr>
                    <td className="pr-2 text-right">{SECOND_DATE_LABEL[doc.kind]}</td>
                    <td className="text-left tnum">{fmtDate(doc.valid_until)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </header>

        {doc.status === 'void' && (
          <p className="mt-2 text-center text-sm font-bold">** ยกเลิก — {doc.void_reason} **</p>
        )}

        <section className="mt-3 text-xs">
          <p><span className="font-semibold">ลูกค้า:</span> {doc.customer_name}</p>
          {doc.customer_address && (
            <p className="whitespace-pre-line"><span className="font-semibold">ที่อยู่:</span> {doc.customer_address}</p>
          )}
          <p>
            {doc.customer_tax_id ? `เลขประจำตัวผู้เสียภาษี ${doc.customer_tax_id}` : ''}
            {doc.customer_branch ? ` · ${doc.customer_branch}` : ''}
            {doc.customer_phone ? ` · โทร ${doc.customer_phone}` : ''}
          </p>
        </section>

        <table className="mt-3 w-full border-collapse text-xs">
          <thead>
            <tr className="border-y border-black">
              <th className="w-8 py-1 text-center">ลำดับ</th>
              <th className="py-1 text-left">รายการ</th>
              <th className="w-16 py-1 text-right">จำนวน</th>
              <th className="w-24 py-1 text-right">ราคา/หน่วย</th>
              <th className="w-28 py-1 text-right">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((l) => (
              <tr key={l.id} className="border-b border-line">
                <td className="py-1 text-center tnum align-top">{l.seq}</td>
                <td className="whitespace-pre-line py-1 align-top">{l.description}</td>
                <td className="py-1 text-right tnum align-top">
                  {Number(l.qty)} {l.unit ?? ''}
                </td>
                {/* 🔴 ราคา/หน่วยที่พิมพ์คือ **ยอดก่อน VAT** ที่หารกลับแล้ว
                    เพื่อให้คอลัมน์จำนวนเงินบวกได้ยอดรวมก่อนภาษีเป๊ะ */}
                <td className="py-1 text-right tnum align-top">
                  {money(Number(l.qty) > 0 ? Number(l.line_total) / Number(l.qty) : 0)}
                </td>
                <td className="py-1 text-right tnum align-top">{money(Number(l.line_total))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 flex items-start justify-between gap-6 text-xs">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">({doc.amount_words})</p>
            {doc.note && <p className="mt-2 whitespace-pre-line">{doc.note}</p>}
            {seller?.bankAccount && <p className="mt-2 whitespace-pre-line">{seller.bankAccount}</p>}
          </div>
          <table className="w-56 shrink-0 text-xs">
            <tbody>
              <tr>
                <td className="py-0.5 text-right">รวมเป็นเงิน</td>
                <td className="py-0.5 text-right tnum">{money(Number(doc.subtotal))}</td>
              </tr>
              {doc.vat_mode !== 'none' && (
                <tr>
                  <td className="py-0.5 text-right">
                    ภาษีมูลค่าเพิ่ม {Math.round(Number(doc.vat_rate) * 100)}%
                  </td>
                  <td className="py-0.5 text-right tnum">{money(Number(doc.vat_amount))}</td>
                </tr>
              )}
              <tr className="border-t border-black">
                <td className="py-1 text-right font-bold">จำนวนเงินรวมทั้งสิ้น</td>
                <td className="py-1 text-right font-bold tnum">{money(Number(doc.total))}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <footer className="mt-10 grid grid-cols-2 gap-8 text-xs">
          <div className="text-center">
            <p className="border-b border-black pb-8" />
            {/* "ผู้รับเงิน" เขียนได้เฉพาะใบที่เงินเข้าแล้ว — ใบแจ้งหนี้กับ
                ใบเสนอราคายังไม่มีใครรับเงิน การพิมพ์คำนี้ลงไปคือการรับรองเท็จ */}
            <p className="mt-1">
              {doc.kind === 'receipt' ? 'ผู้รับเงิน / ผู้มีอำนาจลงนาม' : 'ผู้มีอำนาจลงนาม'}
            </p>
            {seller?.signatoryName && <p className="mt-0.5">({seller.signatoryName})</p>}
            {seller?.signatoryTitle && <p>{seller.signatoryTitle}</p>}
          </div>
          <div className="text-center">
            <p className="border-b border-black pb-8" />
            <p className="mt-1">{doc.kind === 'invoice' ? 'ผู้รับวางบิล' : 'ผู้รับเอกสาร'}</p>
            <p className="mt-0.5">วันที่ ..........................</p>
          </div>
        </footer>

        {seller?.footer && <p className="mt-4 text-center text-[10px]">{seller.footer}</p>}
      </article>
    </>
  )
}
