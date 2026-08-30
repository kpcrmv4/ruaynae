import Link from 'next/link'
import { Receipt } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { fmtBaht, fmtDate } from '@/lib/format'
import {
  INCOME_KIND_LABEL, PAY_METHOD_LABEL, TXN_STATUSES, TXN_STATUS_LABEL, TXN_STATUS_TONE,
  isTxnKind, isTxnStatus,
} from '@/lib/transactions'
import { Badge } from '@/components/ui/badge'
import { DataError } from '@/components/ui/data-error'
import { EmptyState } from '@/components/ui/states'
import { ListToolbar, type FilterChip } from '@/components/ui/list-toolbar'

export const metadata = { title: 'รายรับ-รายจ่าย' }

/**
 * แยกคำค้นเป็นคำ ๆ แล้วค้นแบบ **ต้องเจอทุกคำ**
 *
 * 🔴 ไม่ใช้ `.or()` กับช่องค้นหาเลย — คอมมาเป็นตัวคั่นเงื่อนไขของ PostgREST
 * คนพิมพ์ `ร้านเจริญ, สาขาสอง` จะกลายเป็นสองเงื่อนไขโดยไม่มี error
 * · แปลงคอมมาเป็น **ตัวคั่นคำ** แทน แล้วต่อ `.ilike()` ทีละคำ ซึ่ง PostgREST
 * เอามา AND กันให้เอง · ได้ผลพลอยได้คือค้นข้ามคำได้ ไม่ต้องพิมพ์ติดกันเป๊ะ
 * (ตัดคอมมาเป็นช่องว่างเฉย ๆ ไม่พอ — `%a  b%` ไม่แมตช์ `a, b`)
 *
 * `%` กับ `_` เป็นไวลด์การ์ดของ ilike — ปล่อยผ่านแล้วคนพิมพ์ `%` จะได้ทุกแถว
 */
const searchTerms = (raw: string) =>
  raw
    .slice(0, 60)
    .split(/[\s,]+/)
    .map((t) => t.replace(/[%_()\\]/g, '').trim())
    .filter((t) => t.length > 0)
    .slice(0, 5)

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
  // หัวหน้าไซต์จึงเห็นเฉพาะรายจ่ายของไซต์ที่ดูแลโดยอัตโนมัติ และถ้าวันหน้า
  // policy เปลี่ยน หน้านี้เปลี่ยนตามเองโดยไม่มีใครต้องจำว่ามีที่นี่อีกที่หนึ่ง
  let listQuery = sb
    .from('transactions')
    .select(`
      id, kind, amount, txn_date, pay_method, status, note, income_kind, installment_no, rejected_reason,
      site_id, sites(name), categories(name),
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

  const [listResult, ...counts] = await Promise.all([
    listQuery
      .order('txn_date', { ascending: false })
      .order('id', { ascending: false })
      .range(0, PAGE_SIZE),
    countFor('all'),
    ...TXN_STATUSES.map((s) => countFor(s)),
  ])

  const { data: rows, error } = listResult

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

  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink">รายรับ-รายจ่าย</h1>
        <p className="mt-0.5 text-sm text-muted-token">
          {isOwner ? 'ทุกรายการทั้งบริษัท รวมรายจ่ายส่วนกลาง' : 'รายจ่ายของไซต์ที่คุณดูแล'}
        </p>
      </div>

      {/* เจ้าของเท่านั้นที่มีทั้งสองชนิดให้สลับ — หัวหน้าไซต์เห็นแต่รายจ่าย
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

      <ListToolbar
        basePath="/ledger"
        q={q}
        filters={filters}
        activeFilter={status}
        placeholder="ค้นหาจากรายละเอียด…"
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
            {page.map((t) => (
              <div
                key={t.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 border-b border-line-soft px-3.5 py-3 last:border-b-0 md:px-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-semibold text-ink">
                      {t.categories?.name ?? 'ไม่มีหมวด'}
                    </span>
                    {/* ผูกไซต์ = ชิปขอบทึบ · ส่วนกลาง = ชิปขอบประ (DESIGN §5.2)
                        ต้องแยกออกในแวบเดียวเพราะสองอย่างนี้เข้าคนละยอดรวม */}
                    {t.site_id ? (
                      <span className="chip border border-brand-tint-strong bg-brand-tint text-brand-on-tint ring-0">
                        {t.sites?.name ?? 'ไซต์'}
                      </span>
                    ) : (
                      <span className="chip border border-dashed border-line-strong text-muted-token ring-0">
                        ส่วนกลาง
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-sm text-muted-token">
                    {fmtDate(t.txn_date)} · {PAY_METHOD_LABEL[t.pay_method]}
                    {t.income_kind && ` · ${INCOME_KIND_LABEL[t.income_kind]}`}
                    {t.installment_no && ` ${t.installment_no}`}
                    {t.note && ` · ${t.note}`}
                  </div>
                  {/* 🔴 เหตุผลที่ตีกลับต้องอยู่ตรงนี้ ไม่ใช่อยู่แค่ในกระดิ่ง
                      กระดิ่งถูกกดอ่านแล้วก็หายไป แต่คนที่ต้องแก้จะกลับมาดู
                      ที่รายการ — ป้าย "ตีกลับ" ที่ไม่บอกว่าเพราะอะไร
                      คือการส่งงานคืนโดยไม่บอกว่าต้องแก้อะไร */}
                  {t.status === 'rejected' && t.rejected_reason && (
                    <div className="mt-1 text-sm text-urgent">
                      เหตุผลที่ตีกลับ: {t.rejected_reason}
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-end gap-1">
                  <span
                    className={`text-base font-bold tnum ${
                      t.kind === 'income' ? 'text-income' : 'text-expense'
                    }`}
                  >
                    {t.kind === 'income' ? '+' : '−'}
                    {fmtBaht(t.amount)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {t.attachments.length > 0 && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={`/api/uploads/${t.attachments[0].id}?thumb=1`}
                        alt="สลิป"
                        loading="lazy"
                        className="size-8 rounded-xs border border-line object-cover"
                      />
                    )}
                    <Badge tone={TXN_STATUS_TONE[t.status]} dot>
                      {TXN_STATUS_LABEL[t.status]}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
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
    </>
  )
}
