import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { todayInBangkok } from '@/lib/format'
import { DOC_KIND_LABEL, emptyDraft, isDocKind } from '@/lib/documents'
import { BackButton } from '@/components/ui/back-button'
import { DocForm } from '@/components/documents/doc-form'

export const metadata = { title: 'สร้างเอกสาร' }

export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; site?: string }>
}) {
  const sp = await searchParams
  const kind = isDocKind(sp.kind) ? sp.kind : 'quotation'

  const sb = await getSupabaseServer()
  const [{ data: sites }, { data: customers }] = await Promise.all([
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
          <h1 className="text-2xl font-bold text-ink">{DOC_KIND_LABEL[kind]}</h1>
          <p className="mt-0.5 text-sm text-muted-token">
            บันทึกเป็นร่างก่อน — เลขที่เอกสารจะออกตอนกดปุ่ม &ldquo;ออกเอกสาร&rdquo;
          </p>
        </div>
        <BackButton fallbackHref="/documents" />
      </div>

      <DocForm
        mode="create"
        kind={kind}
        initial={emptyDraft(todayInBangkok(), sp.site ?? '')}
        sites={sites ?? []}
        customers={customers ?? []}
      />
    </>
  )
}
