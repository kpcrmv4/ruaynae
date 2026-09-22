import Link from 'next/link'
import { FileText } from 'lucide-react'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { todayInBangkok } from '@/lib/format'
import { asDateParam } from '@/lib/date-range'
import { searchTerms } from '@/lib/search-core'
import {
  DOC_KINDS, DOC_KIND_SHORT, DOC_STATUSES, DOC_STATUS_LABEL,
  isDocKind, isDocStatus,
} from '@/lib/documents'
import { PageHeader } from '@/components/ui/page-header'
import { DataError } from '@/components/ui/data-error'
import { EmptyState } from '@/components/ui/states'
import { ListToolbar, type FilterChip } from '@/components/ui/list-toolbar'
import { NewDocButton } from '@/components/documents/new-doc-button'
import { DocFilters } from '@/components/documents/doc-filters'
import { DocRow } from '@/components/documents/doc-row'

export const metadata = { title: 'เอกสาร' }

type Search = {
  kind?: string; status?: string; q?: string; site?: string
  from?: string; to?: string; after?: string
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const sp = await searchParams
  const kind = isDocKind(sp.kind) ? sp.kind : 'quotation'
  const status = isDocStatus(sp.status) ? sp.status : 'all'
  const q = (sp.q ?? '').slice(0, 60)
  const terms = searchTerms(q)
  const from = asDateParam(sp.from)
  const to = asDateParam(sp.to)
  const today = todayInBangkok()

  const sb = await getSupabaseServer()

  let listQuery = sb
    .from('documents')
    .select('id, kind, doc_no, status, doc_date, customer_name, total, site_id, sites(name)')
    .eq('kind', kind)
  if (status !== 'all') listQuery = listQuery.eq('status', status)
  if (sp.site === 'none') listQuery = listQuery.is('site_id', null)
  else if (sp.site) listQuery = listQuery.eq('site_id', sp.site)
  if (from) listQuery = listQuery.gte('doc_date', from)
  if (to) listQuery = listQuery.lte('doc_date', to)
  // 🔴 escape แล้วค่อยยัดเข้า ilike — คอมมาในช่องค้นหาจะกลายเป็นเงื่อนไขที่สอง (§7)
  for (const t of terms) listQuery = listQuery.ilike('customer_name', `%${t}%`)

  const countFor = async (s: (typeof DOC_STATUSES)[number] | 'all') => {
    let qb = sb.from('documents').select('id', { count: 'exact', head: true }).eq('kind', kind)
    if (s !== 'all') qb = qb.eq('status', s)
    // 🔴 ตัวนับบนชิปต้องอยู่ในขอบเขตเดียวกับลิสต์ — ตัวเลขที่นับทั้งบริษัท
    // ขณะที่ลิสต์กรองเดือนนี้อยู่ คือตัวเลขที่ชวนให้คิดว่าลิสต์แสดงไม่ครบ
    if (sp.site === 'none') qb = qb.is('site_id', null)
    else if (sp.site) qb = qb.eq('site_id', sp.site)
    if (from) qb = qb.gte('doc_date', from)
    if (to) qb = qb.lte('doc_date', to)
    const { count, error } = await qb
    if (error) {
      console.error('[documents] นับจำนวนไม่ได้', error.message)
      return undefined
    }
    return count ?? 0
  }

  const [listResult, sitesResult, counterRows, ...counts] = await Promise.all([
    // keyset ด้วย (doc_date desc, id desc) — offset ลึก ๆ ช้าลงและแถวซ้ำได้ (§7)
    (sp.after
      ? (() => {
          const [d, id] = sp.after.split('|')
          return d && id
            ? listQuery.or(`doc_date.lt.${d},and(doc_date.eq.${d},id.lt.${id})`)
            : listQuery
        })()
      : listQuery)
      .order('doc_date', { ascending: false })
      .order('id', { ascending: false })
      .range(0, PAGE_SIZE),
    sb.from('sites').select('id, name').order('name', { ascending: true }).range(0, PAGE_SIZE - 1),
    sb.from('doc_counters').select('kind').range(0, 9),
    countFor('all'),
    ...DOC_STATUSES.map((s) => countFor(s)),
  ])

  const { data: rows, error } = listResult
  if (error) {
    console.error('[documents] อ่านรายการเอกสารไม่ได้', error.message)
    return <DataError message="โหลดรายการเอกสารไม่สำเร็จ" />
  }

  const all = rows ?? []
  const hasMore = all.length > PAGE_SIZE
  const page = hasMore ? all.slice(0, PAGE_SIZE) : all
  const last = page[page.length - 1]

  const filters: FilterChip[] = [
    { key: 'all', label: 'ทั้งหมด', count: counts[0] },
    ...DOC_STATUSES.map((s, i) => ({ key: s, label: DOC_STATUS_LABEL[s], count: counts[i + 1] })),
  ]

  const keep = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const merged = {
      kind, status: status === 'all' ? undefined : status, q: q || undefined,
      site: sp.site, from: from || undefined, to: to || undefined, ...next,
    }
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v)
    const s = p.toString()
    return s ? `/documents?${s}` : '/documents'
  }

  const counterSet = new Set((counterRows.data ?? []).map((c) => c.kind))
  const isSearching = q !== '' || status !== 'all' || Boolean(sp.site) || Boolean(from || to)

  return (
    <>
      <PageHeader
        title="เอกสาร"
        subtitle="ใบเสนอราคา ใบแจ้งหนี้ และใบเสร็จรับเงิน/ใบกำกับภาษี · ผูกกับโครงการหรือไม่ผูกก็ได้"
        action={<NewDocButton kind={kind} />}
      />

      {/* แท็บชนิดเอกสาร — คนใช้เห็นเป็นคนละเรื่อง แม้เบื้องหลังเป็นตารางเดียว
          · วนจาก `DOC_KINDS` เพื่อให้ชนิดที่เพิ่มวันหน้าได้แท็บของมันเอง
          · เลื่อนแนวนอนได้บนจอแคบ — สามแท็บชื่อไทยยาวเกิน 390px ไปแล้ว */}
      <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1 no-scrollbar sm:flex-wrap sm:overflow-visible sm:pb-0">
        {DOC_KINDS.map((k) => (
          <Link
            key={k}
            /* สลับชนิดแล้วช่วงเวลา/โครงการที่ตั้งไว้ต้องติดไปด้วย — ขอบเขตที่
               หายเงียบ ๆ ตอนกดแท็บคือที่มาของการอ่านตัวเลขผิดช่วง */
            href={keep({ kind: k, status: undefined, after: undefined })}
            className={`shrink-0 whitespace-nowrap rounded-md px-3.5 py-2 text-sm font-semibold transition-colors ${
              kind === k ? 'bg-brand-solid text-white' : 'border border-line bg-surface text-ink-2 hover:border-brand'
            }`}
          >
            {DOC_KIND_SHORT[k]}
          </Link>
        ))}
      </div>

      {!counterSet.has(kind) && (
        <Link
          href="/settings/documents"
          className="mb-3 flex items-center gap-2.5 rounded-lg border border-urgent-ring bg-urgent-bg px-3 py-2.5 transition-colors duration-100 hover:border-urgent"
        >
          <FileText className="size-4.5 shrink-0 text-urgent" strokeWidth={1.8} />
          <span className="min-w-0 text-sm text-urgent">
            ยังไม่ได้ตั้งเลขที่เอกสารของ{DOC_KIND_SHORT[kind]} — ออกเอกสารไม่ได้จนกว่าจะตั้ง · แตะเพื่อไปตั้งค่า
          </span>
        </Link>
      )}

      <DocFilters
        today={today}
        sites={sitesResult.data ?? []}
        siteName={
          (sitesResult.data ?? []).find((s) => s.id === sp.site)?.name ?? null
        }
        current={{ kind, status, q, site: sp.site ?? '', from, to }}
      />

      <ListToolbar
        basePath="/documents"
        q={q}
        filters={filters}
        activeFilter={status}
        placeholder="ค้นหาชื่อลูกค้า…"
        extra={{ kind, ...(sp.site ? { site: sp.site } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }}
      />

      {page.length === 0 ? (
        <EmptyState
          icon={FileText}
          message={
            isSearching
              ? 'ไม่พบเอกสารที่ตรงกับเงื่อนไขนี้ ลองล้างตัวกรองหรือเปลี่ยนคำค้น'
              : `ยังไม่มี${DOC_KIND_SHORT[kind]}ในระบบ — กดปุ่มด้านบนเพื่อออกใบแรก`
          }
          action={<NewDocButton kind={kind} />}
        />
      ) : (
        <div className="panel">
          <ul>
            {page.map((d) => (
              <DocRow key={d.id} doc={{ ...d, siteName: d.sites?.name ?? null }} />
            ))}
          </ul>
        </div>
      )}

      {hasMore && last && (
        <div className="mt-3 text-center">
          <Link href={keep({ after: `${last.doc_date}|${last.id}` })} className="btn-secondary">
            โหลดเพิ่ม
          </Link>
        </div>
      )}

      {sitesResult.error && (
        <p className="mt-2 text-xs text-muted-token">โหลดรายชื่อโครงการไม่สำเร็จ · ตัวกรองโครงการอาจไม่ครบ</p>
      )}
    </>
  )
}
