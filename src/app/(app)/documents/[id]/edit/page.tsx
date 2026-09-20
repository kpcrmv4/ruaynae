import { notFound, redirect } from 'next/navigation'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { DOC_KIND_LABEL, isEditable } from '@/lib/documents'
import { BackButton } from '@/components/ui/back-button'
import { DataError } from '@/components/ui/data-error'
import { DocForm } from '@/components/documents/doc-form'

export const metadata = { title: 'แก้ไขเอกสาร' }

export default async function EditDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const sb = await getSupabaseServer()

  const { data: doc, error } = await sb
    .from('documents')
    .select(`
      id, kind, status, txn_id, customer_id, customer_name, customer_tax_id, customer_branch,
      customer_address, customer_phone, site_id, doc_date, valid_until, vat_mode, vat_rate, note
    `)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[documents] อ่านเอกสารไม่ได้', error.message)
    return <DataError message="โหลดเอกสารไม่สำเร็จ" />
  }
  if (!doc) notFound()
  // ล็อกแล้วไม่ต้องพาคนมายืนหน้าฟอร์มที่กดบันทึกไม่ได้ · route ปฏิเสธเองอีกชั้น
  if (!isEditable(doc.status, doc.txn_id)) redirect(`/documents/${id}`)

  const [{ data: lines }, { data: sites }, { data: customers }] = await Promise.all([
    sb
      .from('document_lines')
      .select('seq, description, qty, unit, unit_price')
      .eq('document_id', id)
      .order('seq', { ascending: true })
      .range(0, PAGE_SIZE * 2 - 1),
    sb
      .from('sites')
      .select('id, name')
      .in('status', ['planning', 'active', 'paused'])
      .order('name', { ascending: true })
      .range(0, PAGE_SIZE - 1),
    sb
      .from('customers')
      .select('id, name, tax_id, branch, address, phone')
      .order('name', { ascending: true })
      .range(0, PAGE_SIZE * 4 - 1),
  ])

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink">แก้ไข{DOC_KIND_LABEL[doc.kind]}</h1>
          <p className="mt-0.5 text-sm text-muted-token">
            เลขที่เอกสารไม่เปลี่ยนตามการแก้ · แก้ได้จนกว่าจะทำเครื่องหมายว่าส่งให้ลูกค้าแล้ว
          </p>
        </div>
        <BackButton fallbackHref={`/documents/${id}`} />
      </div>

      <DocForm
        mode="edit"
        kind={doc.kind}
        docId={doc.id}
        sites={sites ?? []}
        customers={customers ?? []}
        initial={{
          customerId: doc.customer_id ?? '',
          customerName: doc.customer_name,
          customerTaxId: doc.customer_tax_id ?? '',
          customerBranch: doc.customer_branch ?? '',
          customerAddress: doc.customer_address ?? '',
          customerPhone: doc.customer_phone ?? '',
          siteId: doc.site_id ?? '',
          docDate: doc.doc_date,
          validUntil: doc.valid_until ?? '',
          vatMode: doc.vat_mode,
          vatRate: Number(doc.vat_rate),
          note: doc.note ?? '',
          lines: (lines ?? []).map((l) => ({
            description: l.description,
            qty: String(Number(l.qty)),
            unit: l.unit ?? '',
            unitPrice: String(Number(l.unit_price)),
          })),
        }}
      />
    </>
  )
}
