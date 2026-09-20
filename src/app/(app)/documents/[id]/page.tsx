import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { fmtBaht, fmtDate, fmtDateTime } from '@/lib/format'
import {
  DOC_KIND_LABEL, DOC_STATUS_LABEL, DOC_STATUS_TONE, whtHint,
} from '@/lib/documents'
import { Badge } from '@/components/ui/badge'
import { BackButton } from '@/components/ui/back-button'
import { DataError } from '@/components/ui/data-error'
import { DocActions } from '@/components/documents/doc-actions'

export const metadata = { title: 'รายละเอียดเอกสาร' }

export default async function DocumentDetailPage({
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
      customer_branch, customer_address, customer_phone, vat_mode, vat_rate, subtotal,
      vat_amount, total, amount_words, note, site_id, txn_id, source_document_id,
      issued_at, sent_at, accepted_at, voided_at, void_reason, sites(name)
    `)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[documents] อ่านเอกสารไม่ได้', error.message)
    return <DataError message="โหลดเอกสารไม่สำเร็จ" />
  }
  if (!doc) notFound()

  const [{ data: lines }, { data: categories }] = await Promise.all([
    sb
      .from('document_lines')
      .select('id, seq, description, qty, unit, unit_price, line_total')
      .eq('document_id', id)
      .order('seq', { ascending: true })
      .range(0, PAGE_SIZE * 2 - 1),
    sb
      .from('categories')
      .select('id, name')
      .eq('kind', 'income')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .range(0, PAGE_SIZE - 1),
  ])

  const hint = whtHint(Number(doc.subtotal), Number(doc.total))
  const isReceipt = doc.kind === 'receipt'
  const missingTaxId = isReceipt && !doc.customer_tax_id

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tnum text-ink">{doc.doc_no ?? 'ร่าง'}</h1>
            <Badge tone={DOC_STATUS_TONE[doc.status]} dot>{DOC_STATUS_LABEL[doc.status]}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-token">{DOC_KIND_LABEL[doc.kind]}</p>
        </div>
        <BackButton fallbackHref="/documents" />
      </div>

      {/* แถบเตือนที่ยังแก้ได้ — ตัวล็อกคือ "ส่งแล้ว" ไม่ใช่ "ออกเลขแล้ว" */}
      {doc.status === 'issued' && (
        <p className="mb-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink-2">
          ใบนี้<span className="font-semibold text-ink">ยังแก้ได้</span> เพราะยังไม่ได้ทำเครื่องหมายว่าส่งให้ลูกค้า
          · กดปุ่ม &ldquo;ส่งให้ลูกค้าแล้ว&rdquo; เมื่อส่งไปจริง แล้วยอดจะถูกล็อก
        </p>
      )}

      {doc.status === 'void' && (
        <p className="mb-3 rounded-lg border border-urgent-ring bg-urgent-bg px-3 py-2.5 text-sm text-urgent">
          ยกเลิกเมื่อ {fmtDateTime(doc.voided_at)} · เหตุผล: {doc.void_reason}
        </p>
      )}

      {missingTaxId && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-status-progress-ring bg-status-progress-bg px-3 py-2.5 text-sm text-status-progress">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            ใบกำกับภาษีเต็มรูปควรมี<span className="font-semibold">เลขประจำตัวผู้เสียภาษีของผู้ซื้อ</span>
            และระบุสำนักงานใหญ่/สาขา — ยังออกได้ แต่ควรเติมให้ครบ
          </span>
        </p>
      )}

      <div className="mb-4">
        <DocActions
          id={doc.id}
          kind={doc.kind}
          status={doc.status}
          txnId={doc.txn_id}
          total={Number(doc.total)}
          incomeCategories={categories ?? []}
        />
      </div>

      {/* ── ลูกค้า + วันที่ ─────────────────────────────────────────── */}
      <section className="panel mb-4 p-4">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-token">ลูกค้า</dt>
            <dd className="font-semibold text-ink">{doc.customer_name}</dd>
          </div>
          {doc.customer_tax_id && (
            <div>
              <dt className="text-xs text-muted-token">เลขประจำตัวผู้เสียภาษี</dt>
              <dd className="tnum text-ink-2">
                {doc.customer_tax_id}
                {doc.customer_branch ? ` · ${doc.customer_branch}` : ''}
              </dd>
            </div>
          )}
          {doc.customer_phone && (
            <div>
              <dt className="text-xs text-muted-token">โทรศัพท์</dt>
              <dd className="text-ink-2">{doc.customer_phone}</dd>
            </div>
          )}
          {doc.customer_address && (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-token">ที่อยู่</dt>
              <dd className="whitespace-pre-line text-ink-2">{doc.customer_address}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-muted-token">วันที่เอกสาร</dt>
            <dd className="tnum text-ink-2">{fmtDate(doc.doc_date)}</dd>
          </div>
          {doc.valid_until && (
            <div>
              <dt className="text-xs text-muted-token">ยืนราคาถึง</dt>
              <dd className="tnum text-ink-2">{fmtDate(doc.valid_until)}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-muted-token">โครงการ</dt>
            <dd className="text-ink-2">
              {doc.site_id ? (
                <Link href={`/sites/${doc.site_id}`} className="text-brand hover:underline">
                  {doc.sites?.name ?? 'เปิดโครงการ'}
                </Link>
              ) : (
                'ไม่ผูกโครงการ'
              )}
            </dd>
          </div>
          {doc.source_document_id && (
            <div>
              <dt className="text-xs text-muted-token">สร้างจาก</dt>
              <dd>
                <Link
                  href={`/documents/${doc.source_document_id}`}
                  className="inline-flex items-center gap-1 text-brand hover:underline"
                >
                  ใบเสนอราคาต้นทาง <ExternalLink className="size-3.5" />
                </Link>
              </dd>
            </div>
          )}
          {doc.txn_id && (
            <div>
              <dt className="text-xs text-muted-token">รายรับที่ผูกไว้</dt>
              <dd>
                <Link
                  href={`/ledger?focus=${doc.txn_id}`}
                  className="inline-flex items-center gap-1 text-brand hover:underline"
                >
                  เปิดรายการ <ExternalLink className="size-3.5" />
                </Link>
              </dd>
            </div>
          )}
        </dl>
      </section>

      {/* ── รายการ + ยอด ───────────────────────────────────────────── */}
      <section className="panel p-4">
        <ul className="space-y-2">
          {(lines ?? []).map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-3 border-b border-line-soft pb-2 last:border-b-0">
              <div className="min-w-0">
                <p className="whitespace-pre-line text-sm text-ink">{l.description}</p>
                <p className="text-xs tnum text-muted-token">
                  {Number(l.qty)} {l.unit ?? ''} × {fmtBaht(Number(l.unit_price))}
                  {doc.vat_mode === 'inclusive' ? ' (รวม VAT)' : ''}
                </p>
              </div>
              <span className="shrink-0 tnum text-sm text-ink">{fmtBaht(Number(l.line_total))}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-2">รวมก่อนภาษี</dt>
            <dd className="tnum text-ink">{fmtBaht(Number(doc.subtotal))}</dd>
          </div>
          {doc.vat_mode !== 'none' && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">
                ภาษีมูลค่าเพิ่ม {Math.round(Number(doc.vat_rate) * 100)}%
              </dt>
              <dd className="tnum text-ink">{fmtBaht(Number(doc.vat_amount))}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3 border-t border-line pt-1.5">
            <dt className="font-medium text-ink">ยอดสุทธิ</dt>
            <dd className="tnum text-lg font-bold text-income">{fmtBaht(Number(doc.total))}</dd>
          </div>
          <p className="text-right text-xs text-muted-token">({doc.amount_words})</p>
        </dl>

        {/* 🔴 คำนวณสด ไม่เก็บลงฐาน ไม่ขึ้นกระดาษ (D1) — มีไว้กระทบยอดกับธนาคาร */}
        {isReceipt && Number(doc.total) > 0 && (
          <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-xs text-muted-token">
            งานราชการ/นิติบุคคลจะหัก ณ ที่จ่าย 1% ของ{' '}
            <span className="tnum">{fmtBaht(Number(doc.subtotal))}</span> ={' '}
            <span className="font-semibold tnum text-ink-2">{fmtBaht(hint.wht)}</span>{' '}
            → เงินเข้าจริงราว <span className="font-semibold tnum text-ink-2">{fmtBaht(hint.netReceived)}</span>
            {' '}· ส่วนที่ถูกหักเป็นภาษีจ่ายล่วงหน้า ไม่ใช่รายรับที่หายไป
          </p>
        )}

        {doc.note && (
          <p className="mt-3 whitespace-pre-line rounded-md bg-surface-2 px-3 py-2 text-sm text-ink-2">
            {doc.note}
          </p>
        )}
      </section>
    </>
  )
}
