import Link from 'next/link'
import { Receipt, Warehouse } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { fmtBaht, fmtDate, todayInBangkok } from '@/lib/format'
import { searchTerms } from '@/lib/search-core'
import { TXN_STATUSES, TXN_STATUS_LABEL, isTxnKind, isTxnStatus } from '@/lib/transactions'
import { DataError } from '@/components/ui/data-error'
import { EmptyState } from '@/components/ui/states'
import { ListToolbar, type FilterChip } from '@/components/ui/list-toolbar'
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
  const isOwner = me.role === 'owner'

  const sb = await getSupabaseServer()

  // 🔴 RLS เป็นตัวกรองว่าใครเห็นอะไร ไม่ใช่ where ที่เขียนเอง —
  // หัวหน้าโครงการจึงเห็นเฉพาะรายจ่ายของโครงการที่ดูแลโดยอัตโนมัติ และถ้าวันหน้า
  // policy เปลี่ยน หน้านี้เปลี่ยนตามเองโดยไม่มีใครต้องจำว่ามีที่นี่อีกที่หนึ่ง
  let listQuery = sb
    .from('transactions')
    .select(`
      id, kind, amount, txn_date, pay_method, status, note, income_kind, installment_no, rejected_reason,
      site_id, created_by, category_id, mcp_key_id, sites(name), categories(name),
      attachments(id)
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

  const [listResult, siteFilterName, sitesResult, categoriesResult, ...counts] = await Promise.all([
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

  const filters: FilterChip[] = [
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

  const kindLink = (k: 'all' | 'income' | 'expense') => {
    const p = new URLSearchParams(keep)
    if (k === 'all') p.delete('kind')
    else p.set('kind', k)
    p.delete('after')
    const s = p.toString()
    return s ? `/ledger?${s}` : '/ledger'
  }

  const isFiltered = terms.length > 0 || status !== 'all' || kind !== 'all'
    || Boolean(sp.site) || Boolean(sp.from) || Boolean(sp.to)

  // ลิงก์ถอดตัวกรองโครงการออก โดยเก็บตัวกรองอื่นไว้ทั้งหมด
  const clearSite = new URLSearchParams(keep)
  clearSite.delete('site')
  const clearSiteHref = clearSite.toString() ? `/ledger?${clearSite}` : '/ledger'

  return (
    <TxnEditProvider
      me={{ id: me.id, role: me.role }}
      today={today}
      sites={sitesResult.data ?? []}
      categories={categoriesResult.data ?? []}
    >
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

      {/* เจ้าของเท่านั้นที่มีทั้งสองชนิดให้สลับ — หัวหน้าโครงการเห็นแต่รายจ่าย
          ปุ่มกรองที่มีตัวเลือกเดียวคือปุ่มที่ไม่ทำอะไร */}
      {isOwner && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {([
            ['all', 'ทั้งหมด'],
            ['income', 'รายรับ'],
            ['expense', 'รายจ่าย'],
          ] as const).map(([k, label]) => (
            <Link
              key={k}
              href={kindLink(k)}
              aria-current={kind === k ? 'true' : undefined}
              className={`rounded-sm border px-2.5 py-1.5 text-sm font-medium transition-colors duration-100 ${
                kind === k
                  ? 'border-ink bg-ink text-canvas'
                  : 'border-line-strong bg-surface text-ink-2 hover:border-ink-2 hover:text-ink'
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      )}

      {/* ── ตัวกรองโครงการ / ส่วนกลาง ─────────────────────────────────
          เดิมกรองได้เฉพาะตอนเข้ามาจากปุ่มลัดของหน้าโครงการ · หน้านี้จึงไม่มี
          ทางเลือกขอบเขตเองเลย (เจ้าของแจ้ง 4 ก.ย. 2569) · เป็นฟอร์ม GET
          เหมือนตัวกรองอื่นทั้งแอป — สถานะอยู่บน URL แชร์ลิงก์ได้ */}
      <form action="/ledger" method="get" className="mb-3 flex flex-wrap gap-2">
        {Object.entries(Object.fromEntries(keep)).map(([k, v]) =>
          k === 'site' ? null : <input key={k} type="hidden" name={k} value={v} />,
        )}
        <select
          name="site"
          defaultValue={sp.site ?? ''}
          aria-label="กรองตามโครงการ"
          className="input-base w-auto min-w-52 max-w-full py-2"
        >
          <option value="">ทุกโครงการ + ส่วนกลาง</option>
          {isOwner && <option value="central">เฉพาะส่วนกลาง (ไม่ผูกโครงการ)</option>}
          {(sitesResult.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button type="submit" className="btn-secondary shrink-0 px-4 py-2">
          กรอง
        </button>
      </form>

      <ListToolbar
        basePath="/ledger"
        q={q}
        filters={filters}
        activeFilter={status}
        placeholder="ค้นหาจากรายละเอียด…"
        // ตัวกรองที่ไม่มีปุ่มของตัวเองบนแถบนี้ ต้องติดไปกับชิปและการค้นหาด้วย
        // ไม่งั้นกดชิปสถานะแล้วขอบเขต "เฉพาะโครงการนี้" หายไปเงียบ ๆ
        extra={{
          ...(kind !== 'all' ? { kind } : {}),
          ...(sp.site ? { site: sp.site } : {}),
          ...(sp.from ? { from: sp.from } : {}),
          ...(sp.to ? { to: sp.to } : {}),
        }}
      />

      {/* ── ขอบเขตที่กำลังดูอยู่ — มาจากปุ่มลัดบนหน้าโครงการหรือการ์ดงานวันนี้ ──
          ต้องเห็นว่ากรองอยู่ และต้องออกจากมันได้ในแตะเดียว */}
      {sp.site && (
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-brand-tint-strong bg-brand-tint px-3 py-2">
          <Warehouse className="size-4 shrink-0 text-brand-on-tint" strokeWidth={1.8} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-brand-on-tint">
            เฉพาะ{sp.site === 'central' ? 'รายการส่วนกลาง (ไม่ผูกโครงการ)' : `โครงการ ${siteFilterName ?? 'ที่เลือก'}`}
          </span>
          <Link
            href={clearSiteHref}
            className="shrink-0 rounded-sm px-2 py-0.5 text-sm font-semibold text-brand-on-tint underline underline-offset-2"
          >
            ดูทุกโครงการ
          </Link>
        </div>
      )}

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
                ...g.rows.map((t) => <TxnRow key={t.id} txn={t} />),
              ]
            })}
          </div>

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
    </TxnEditProvider>
  )
}
