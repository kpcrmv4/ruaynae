import Link from 'next/link'
import { Receipt, Undo2 } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { fmtBaht, fmtDate, todayInBangkok } from '@/lib/format'
import { searchTerms } from '@/lib/search-core'
import { TXN_STATUSES, TXN_STATUS_LABEL, isTxnKind, isTxnStatus, isUuid } from '@/lib/transactions'
import { DataError } from '@/components/ui/data-error'
import { EmptyState } from '@/components/ui/states'
import { FocusScroll } from '@/components/ledger/focus-scroll'
import { TxnDetailProvider } from '@/components/ledger/txn-detail'
import { LedgerFilters, type StatusChip } from '@/components/ledger/ledger-filters'
import { TxnCreateButton } from '@/components/ledger/txn-create'
import { TxnEditProvider } from '@/components/ledger/txn-edit'
import { TxnRow } from '@/components/ledger/txn-row'

export const metadata = { title: 'รายรับ-รายจ่าย' }


type Search = {
  status?: string
  q?: string
  kind?: string
  site?: string
  from?: string
  to?: string
  /** keyset cursor — `<txn_date>|<id>` ของแถวสุดท้ายที่แสดงไปแล้ว */
  after?: string
  /** รายการที่แจ้งเตือนพามา — ไฮไลท์และเลื่อนไปหาแถวนั้น */
  focus?: string
}

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const [me, sp] = await Promise.all([getCurrentUser(), searchParams])
  const status = isTxnStatus(sp.status) ? sp.status : 'all'
  const kind = isTxnKind(sp.kind) ? sp.kind : 'all'
  const q = (sp.q ?? '').slice(0, 60)
  const terms = searchTerms(q)
  // id ที่ไม่ใช่ uuid = ไม่ไฮไลท์อะไรเลย ไม่ใช่เอาไปเทียบกับทุกแถวทิ้ง ๆ ขว้าง ๆ
  const focus = isUuid(sp.focus) ? sp.focus : undefined
  const isOwner = me.role === 'owner'

  const sb = await getSupabaseServer()

  // 🔴 RLS เป็นตัวกรองว่าใครเห็นอะไร ไม่ใช่ where ที่เขียนเอง —
  // หัวหน้าโครงการจึงเห็นเฉพาะรายจ่ายของโครงการที่ดูแลโดยอัตโนมัติ และถ้าวันหน้า
  // policy เปลี่ยน หน้านี้เปลี่ยนตามเองโดยไม่มีใครต้องจำว่ามีที่นี่อีกที่หนึ่ง
  let listQuery = sb
    .from('transactions')
    .select(`
      id, kind, amount, txn_date, pay_method, status, note, income_kind, installment_no, rejected_reason,
      site_id, created_by, created_at, category_id, mcp_key_id, sites(name), categories(name),
      profiles!transactions_created_by_fkey(full_name), attachments(id)
    `)
  if (status !== 'all') listQuery = listQuery.eq('status', status)
  if (kind !== 'all') listQuery = listQuery.eq('kind', kind)
  if (sp.site === 'central') listQuery = listQuery.is('site_id', null)
  else if (sp.site) listQuery = listQuery.eq('site_id', sp.site)
  if (sp.from) listQuery = listQuery.gte('txn_date', sp.from)
  if (sp.to) listQuery = listQuery.lte('txn_date', sp.to)
  for (const t of terms) listQuery = listQuery.ilike('note', `%${t}%`)

  // 🔴 keyset ไม่ใช่ offset — `.range(1000, 1030)` ช้าลงเรื่อย ๆ ตามความลึก
  // และแถวจะซ้ำ/หายถ้ามีคนบันทึกรายการใหม่ระหว่างที่กำลังเลื่อนดู
  // เรียงด้วย (txn_date desc, id desc) แล้วชี้ตำแหน่งด้วยค่าของแถวสุดท้าย
  if (sp.after) {
    const [afterDate, afterId] = sp.after.split('|')
    if (afterDate && afterId) {
      listQuery = listQuery.or(
        `txn_date.lt.${afterDate},and(txn_date.eq.${afterDate},id.lt.${afterId})`,
      )
    }
  }

  const countFor = async (s: (typeof TXN_STATUSES)[number] | 'all') => {
    let qb = sb.from('transactions').select('id', { count: 'exact', head: true })
    if (s !== 'all') qb = qb.eq('status', s)
    if (kind !== 'all') qb = qb.eq('kind', kind)
    const { count, error } = await qb
    if (error) {
      console.error('[ledger] นับจำนวนไม่ได้', error.message)
      return undefined
    }
    return count ?? 0
  }

  const [listResult, siteFilterName, sitesResult, categoriesResult, rejectedTotal, ...counts] = await Promise.all([
    listQuery
      .order('txn_date', { ascending: false })
      .order('id', { ascending: false })
      .range(0, PAGE_SIZE),
    // ชื่อโครงการที่กำลังกรองอยู่ — ตัวกรองที่มองไม่เห็นคือตัวกรองที่ทำให้คนอ่าน
    // ตัวเลขผิดขอบเขตโดยไม่รู้ตัว · RLS กรองอีกชั้น โครงการที่ไม่มีสิทธิ์เห็นคืนค่าว่าง
    sp.site && sp.site !== 'central'
      ? sb
          .from('sites')
          .select('name')
          .eq('id', sp.site)
          .maybeSingle()
          .then(({ data }) => data?.name ?? null)
      : Promise.resolve(null),
    // ตัวเลือกของกล่องแก้ไข — ชุดเดียวกับที่ `/entry` ใช้ตอนสร้างรายการ
    // 🔴 RLS เป็นคนกรองว่าใครเห็นโครงการไหน · หัวหน้าโครงการจึงย้ายรายการข้ามไป
    // โครงการที่ตัวเองไม่ได้ดูแลไม่ได้ โดยไม่ต้องมีเงื่อนไขตรงนี้รู้เรื่องนั้นเลย
    sb
      .from('sites')
      .select('id, name')
      .in('status', ['planning', 'active', 'paused'])
      .order('name', { ascending: true })
      .range(0, PAGE_SIZE - 1),
    sb
      .from('categories')
      .select('id, name, kind')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .range(0, PAGE_SIZE * 4 - 1),
    // 🔴 ตัวเลขบนเมนู "รายการ" = จำนวนใบที่ถูกตีกลับ **ทั้งหมด** ไม่ผูกกับตัวกรอง
    // ของหน้านี้ (layout เป็นคนนับ) · ถ้าเอาตัวเลขที่ถูกกรองแล้วมาอธิบายป้ายนั้น
    // คนจะเห็นสองเลขไม่ตรงกันบนจอเดียว แล้วเลิกเชื่อทั้งคู่
    sb
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'rejected')
      .then(({ count, error }) => {
        if (error) {
          console.error('[ledger] นับรายการที่ถูกตีกลับไม่ได้', error.message)
          return 0
        }
        return count ?? 0
      }),
    countFor('all'),
    ...TXN_STATUSES.map((s) => countFor(s)),
  ])

  const { data: rows, error } = listResult
  if (sitesResult.error || categoriesResult.error) {
    // ตัวเลือกโหลดไม่ได้ = กล่องแก้ไขจะเปิดมาแล้วไม่มีหมวดให้เลือก
    // ลิสต์ยังอ่านได้ตามปกติ จึงไม่ล้มทั้งหน้า แต่ต้องเห็นใน log
    console.error(
      '[ledger] โหลดตัวเลือกของกล่องแก้ไขไม่ได้',
      sitesResult.error?.message ?? categoriesResult.error?.message,
    )
  }

  if (error) {
    console.error('[ledger] อ่านรายการไม่ได้', error.message)
    return (
      <DataError message="โหลดรายการไม่สำเร็จ" />
    )
  }

  // ดึงเกินมา 1 แถวเพื่อรู้ว่ายังมีหน้าถัดไปไหม โดยไม่ต้องนับทั้งตาราง
  const all = rows ?? []
  const hasMore = all.length > PAGE_SIZE
  const page = hasMore ? all.slice(0, PAGE_SIZE) : all
  const last = page[page.length - 1]

  // ── จัดกลุ่มตามวัน — แถวเรียง txn_date desc อยู่แล้ว ไล่ต่อเนื่องได้เลย ──
  // มือถืออ่านรายการเป็น "วันไหน เกิดอะไร" ไม่ใช่ตารางแบน ๆ ที่วันซ้ำทุกแถว
  const groups: { date: string; rows: typeof page }[] = []
  for (const t of page) {
    const g = groups[groups.length - 1]
    if (g && g.date === t.txn_date) g.rows.push(t)
    else groups.push({ date: t.txn_date, rows: [t] })
  }

  const today = todayInBangkok()
  const y = new Date(`${today}T00:00:00Z`)
  y.setUTCDate(y.getUTCDate() - 1)
  const yesterday = y.toISOString().slice(0, 10)
  const dayLabel = (d: string) =>
    d === today ? `วันนี้ · ${fmtDate(d)}` : d === yesterday ? `เมื่อวาน · ${fmtDate(d)}` : fmtDate(d)

  // ยอดสุทธิของวัน — ไม่รวมรายการตีกลับ (มันไม่เข้ายอดไหนแล้ว)
  const netOf = (dayRows: typeof page) =>
    dayRows.reduce(
      (s, t) => (t.status === 'rejected' ? s : s + (t.kind === 'income' ? 1 : -1) * Number(t.amount)),
      0,
    )
  // กลุ่มที่ถูก pagination ตัดกลาง (หัวหน้าที่ต่อจากหน้าก่อน หรือท้ายที่ยังมีต่อ)
  // ห้ามโชว์ยอด — ยอดครึ่งวันที่ดูเหมือนยอดเต็มวันแย่กว่าไม่มียอด
  const netTrustworthy = (i: number) =>
    !(i === 0 && Boolean(sp.after)) && !(i === groups.length - 1 && hasMore)

  const statuses: StatusChip[] = [
    { key: 'all', label: 'ทั้งหมด', count: counts[0] },
    ...TXN_STATUSES.map((s, i) => ({
      key: s,
      label: TXN_STATUS_LABEL[s],
      count: counts[i + 1],
    })),
  ]

  const keep = new URLSearchParams()
  if (status !== 'all') keep.set('status', status)
  if (kind !== 'all') keep.set('kind', kind)
  if (q) keep.set('q', q)
  if (sp.site) keep.set('site', sp.site)
  if (sp.from) keep.set('from', sp.from)
  if (sp.to) keep.set('to', sp.to)

  const isFiltered = terms.length > 0 || status !== 'all' || kind !== 'all'
    || Boolean(sp.site) || Boolean(sp.from) || Boolean(sp.to)

  // ── ลิงก์ไปดูเฉพาะใบที่ถูกตีกลับ — เก็บตัวกรองอื่นไว้ ตัด cursor ทิ้ง ──
  const rejectedParams = new URLSearchParams(keep)
  rejectedParams.set('status', 'rejected')
  rejectedParams.delete('after')
  const rejectedHref = `/ledger?${rejectedParams}`

  // แถวที่แจ้งเตือนพามาอยู่ในหน้านี้ไหม — ถ้าไม่อยู่ต้องบอกตรง ๆ ว่าทำไมไม่เห็น
  // แทนที่จะปล่อยให้คนไล่หาแถวที่ถูกตัวกรองซ่อนไว้จนเลิกเชื่อว่ามันมีอยู่จริง
  const focusOnPage = Boolean(focus && page.some((t) => t.id === focus))

  // ลิงก์ล้างตัวกรองทั้งหมดแต่ยังชี้ที่ใบเดิม
  const focusOnlyHref = focus ? `/ledger?focus=${focus}` : '/ledger'

  return (
    <TxnEditProvider
      me={{ id: me.id, role: me.role }}
      today={today}
      sites={sitesResult.data ?? []}
      categories={categoriesResult.data ?? []}
    >
     <TxnDetailProvider>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink">รายรับ-รายจ่าย</h1>
          <p className="mt-0.5 text-sm text-muted-token">
            {isOwner ? 'ทุกรายการทั้งบริษัท รวมรายจ่ายส่วนกลาง' : 'รายจ่ายของโครงการที่คุณดูแล'}
          </p>
        </div>
        {/* บันทึกได้จากหน้านี้เลย ไม่ต้องเด้งไป /entry แล้วเดินกลับมาดูว่าลงไหม
            · กล่องใช้ฟอร์มชุดเดียวกับหน้า /entry ทุกช่อง */}
        <TxnCreateButton
          role={me.role}
          today={today}
          sites={sitesResult.data ?? []}
          categories={categoriesResult.data ?? []}
          initialSiteId={sp.site && sp.site !== 'central' ? sp.site : undefined}
        />
      </div>

      {/* ── ตัวเลขบนเมนูมาจากไหน ────────────────────────────────────
          ป้ายแดงบนเมนู "รายการ" นับใบที่ถูกตีกลับ · เข้ามาแล้วไม่มีอะไรบอกว่า
          ใบไหน คือการส่งคนมายืนหน้าลิสต์เปล่า ๆ (เจ้าของแจ้ง 19 ก.ย. 2569)
          กดแล้วกรองเหลือเฉพาะใบเหล่านั้น ซึ่งถูกทำเครื่องหมายไว้ทุกใบด้วย */}
      {rejectedTotal > 0 && status !== 'rejected' && (
        <Link
          href={rejectedHref}
          className="mb-3 flex items-center gap-2.5 rounded-lg border border-urgent-ring bg-urgent-bg px-3 py-2.5 transition-colors duration-100 hover:border-urgent"
        >
          <Undo2 className="size-4.5 shrink-0 text-urgent" strokeWidth={1.8} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-urgent">
              ถูกตีกลับ <span className="tnum">{rejectedTotal}</span> รายการ ต้องแก้แล้วส่งใหม่
            </span>
            <span className="block text-xs text-ink-2">
              นี่คือตัวเลขที่ขึ้นบนเมนู “รายการ”
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-urgent underline underline-offset-2">
            ดูเลย
          </span>
        </Link>
      )}

      {/* ใบที่แจ้งเตือนพามา แต่ตัวกรองปัจจุบันซ่อนมันไว้ */}
      {focus && !focusOnPage && (
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line-strong bg-surface-2 px-3 py-2.5">
          <span className="min-w-0 flex-1 text-sm text-ink-2">
            ไม่พบรายการที่แจ้งเตือนถึงในหน้านี้ — อาจถูกตัวกรองซ่อนไว้ หรืออยู่ในหน้าถัดไป
          </span>
          {isFiltered && (
            <Link
              href={focusOnlyHref}
              className="shrink-0 text-sm font-semibold text-brand underline underline-offset-2"
            >
              ล้างตัวกรองแล้วหาใหม่
            </Link>
          )}
        </div>
      )}

      {/* ── ตัวกรองทั้งหมดอยู่ในส่วนหัวชิ้นเดียว ─────────────────────
          ชนิด · ช่วงเวลา · โครงการ · ค้นหา · แท็บสถานะ — แต่ละชั้นมีรูปร่างของตัวเอง
          และเปลี่ยนแล้วไปทันที (ไม่มีปุ่ม "กรอง") · สถานะอยู่บน URL แชร์ลิงก์ได้
          · โครงการที่กรองอยู่แสดงเป็นค่าในกล่องเลือกเอง ไม่ต้องมีแถบบอกซ้ำอีกชั้น */}
      <LedgerFilters
        today={today}
        sites={sitesResult.data ?? []}
        siteName={siteFilterName}
        isOwner={isOwner}
        current={{
          kind,
          status,
          q,
          site: sp.site ?? '',
          from: sp.from ?? '',
          to: sp.to ?? '',
        }}
        statuses={statuses}
      />

      {page.length === 0 ? (
        <EmptyState
          icon={Receipt}
          message={
            isFiltered
              ? 'ไม่พบรายการที่ตรงกับเงื่อนไขนี้ ลองล้างตัวกรองหรือเปลี่ยนคำค้น'
              : 'ยังไม่มีรายการ — กดปุ่มบันทึกรายจ่ายเพื่อเริ่มบันทึกรายการแรก'
          }
          action={
            !isFiltered ? (
              <Link href="/entry" className="btn-primary">บันทึกรายจ่าย</Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="panel">
            {groups.map((g, gi) => {
              const net = netOf(g.rows)
              return [
                <div
                  key={`h-${g.date}`}
                  className="flex items-baseline gap-2 border-b border-line-soft bg-surface-2 px-3.5 py-1.5 md:px-4"
                >
                  <span className="text-[13px] font-semibold text-ink-2">{dayLabel(g.date)}</span>
                  {netTrustworthy(gi) && (
                    <span
                      className={`ml-auto text-[13px] font-bold tnum ${
                        net > 0 ? 'text-income' : net < 0 ? 'text-expense' : 'text-muted-token'
                      }`}
                    >
                      {net > 0 ? '+' : net < 0 ? '−' : ''}
                      {fmtBaht(Math.abs(net))}
                    </span>
                  )}
                </div>,
                ...g.rows.map((t) => (
                  <TxnRow key={t.id} txn={t} focused={t.id === focus} />
                )),
              ]
            })}
          </div>

          {/* พามาถึงแถวจริง ไม่ใช่แค่ทาสีไว้แล้วให้เลื่อนหาเอง */}
          {focus && focusOnPage && <FocusScroll id={focus} />}

          {hasMore && last && (
            <div className="mt-3 text-center">
              <Link
                href={`/ledger?${new URLSearchParams({
                  ...Object.fromEntries(keep),
                  after: `${last.txn_date}|${last.id}`,
                })}`}
                className="btn-secondary"
              >
                โหลดเพิ่ม
              </Link>
            </div>
          )}
        </>
      )}
     </TxnDetailProvider>
    </TxnEditProvider>
  )
}
