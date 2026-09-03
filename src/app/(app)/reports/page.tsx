import Link from 'next/link'
import {
  BarChart3,
  Banknote,
  CalendarRange,
  Coins,
  HandCoins,
  TrendingDown,
  UsersRound,
  Wallet,
} from 'lucide-react'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { fmtBaht, fmtDate } from '@/lib/format'
import { parsePeriod, periodOptions, pctChange, type ReportMode } from '@/lib/reports'
import { Metric, MetricBar } from '@/components/ui/metric'
import { EmptyState } from '@/components/ui/states'
import { DataError } from '@/components/ui/data-error'
import { FlowChart } from '@/components/reports/flow-chart'
import { BarList, type BarItem } from '@/components/reports/bar-list'

export const metadata = { title: 'รายงาน' }

/** กี่แถวต่อรายการย่อย — ที่เหลือดูต่อได้ที่หน้าของมันเอง */
const TOP_N = 8

type Search = { p?: string; site?: string }

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const period = parsePeriod(sp.p)
  const sb = await getSupabaseServer()

  const { data: sites, error: sErr } = await sb
    .from('sites')
    .select('id, name')
    .order('name', { ascending: true })
    .range(0, PAGE_SIZE - 1)

  // โครงการที่กรองต้องมีอยู่จริงและมองเห็นได้ — ไม่เชื่อค่าจาก URL
  const siteId = (sites ?? []).some((s) => s.id === sp.site) ? sp.site! : null
  // RPC รับ `p_site` เป็น optional — `null` กับ `undefined` คนละชนิดในชั้นชนิดข้อมูล
  // แต่ความหมายเดียวกันคือ "ทั้งบริษัท" (ฝั่ง SQL เช็ค `p_site is null`)
  const siteArg = siteId ?? undefined

  // 🔴 ทุกยอดรวมคำนวณในฐานข้อมูล (RPC) ไม่ใช่ดึงแถวมาบวกใน JS —
  // รายงานทั้งปีมีได้หลายพันแถว และ PostgREST ตัดที่ 1,000 เงียบ ๆ (§7)
  const [
    { data: nowRows, error: aErr },
    { data: prevRows, error: bErr },
    { data: series, error: cErr },
    { data: byCategory, error: dErr },
    { data: bySite, error: eErr },
    { data: laborRows, error: fErr },
    { data: topWorkers, error: gErr },
  ] = await Promise.all([
    sb.rpc('report_summary', { p_from: period.from, p_to: period.to, p_site: siteArg }),
    sb.rpc('report_summary', { p_from: period.prev.from, p_to: period.prev.to, p_site: siteArg }),
    sb
      .rpc('report_series', {
        p_from: period.from,
        p_to: period.to,
        p_grain: period.grain,
        p_site: siteArg,
      })
      .order('bucket', { ascending: true })
      .range(0, 400),
    sb
      .rpc('report_by_category', { p_from: period.from, p_to: period.to, p_site: siteArg })
      .order('total', { ascending: false })
      .range(0, 49),
    // กรองโครงการอยู่แล้วก็ไม่ต้องมีตารางแยกโครงการ — มันจะเหลือแถวเดียวเสมอ
    siteId
      ? Promise.resolve({ data: [], error: null })
      : sb
          .rpc('report_by_site', { p_from: period.from, p_to: period.to })
          .order('profit', { ascending: false })
          .range(0, 49),
    sb.rpc('report_labor', { p_from: period.from, p_to: period.to, p_site: siteArg }),
    sb
      .rpc('report_top_workers', { p_from: period.from, p_to: period.to, p_site: siteArg })
      .order('wage_total', { ascending: false })
      .range(0, TOP_N - 1),
  ])

  const loadError = sErr ?? aErr ?? bErr ?? cErr ?? dErr ?? eErr ?? fErr ?? gErr
  if (loadError) {
    console.error('[reports] โหลดรายงานไม่ได้', loadError.message)
    return <DataError message="โหลดรายงานไม่สำเร็จ" />
  }

  const now = nowRows?.[0]
  const before = prevRows?.[0]
  const labor = laborRows?.[0]

  const income = Number(now?.income_approved ?? 0)
  const expense = Number(now?.expense_approved ?? 0)
  const wage = Number(now?.wage_cost ?? 0)
  const cost = Number(now?.cost_total ?? 0)
  const profit = Number(now?.profit ?? 0)
  const pendingIncome = Number(now?.income_pending ?? 0)
  const pendingExpense = Number(now?.expense_pending ?? 0)

  const dIncome = pctChange(income, Number(before?.income_approved ?? 0))
  const dCost = pctChange(cost, Number(before?.cost_total ?? 0))
  const dProfit = pctChange(profit, Number(before?.profit ?? 0))

  const points = (series ?? []).map((r) => ({
    bucket: r.bucket,
    income: Number(r.income),
    expense: Number(r.expense),
    wage: Number(r.wage),
  }))

  const cats = byCategory ?? []
  const expenseCats: BarItem[] = cats
    .filter((c) => c.kind === 'expense')
    .map((c) => ({
      key: c.category_id ?? 'wage',
      label: c.name,
      value: Number(c.total),
      hint: `${c.item_count} รายการ`,
    }))
  const incomeCats: BarItem[] = cats
    .filter((c) => c.kind === 'income')
    .map((c) => ({
      key: c.category_id ?? 'income',
      label: c.name,
      value: Number(c.total),
      hint: `${c.item_count} รายการ`,
    }))

  const workers: BarItem[] = (topWorkers ?? []).map((w) => ({
    key: w.employee_id,
    label: w.full_name,
    value: Number(w.wage_total),
    hint: `${Number(w.work_units)} วันแรง`,
  }))

  const cashOut = Number(labor?.advance_paid ?? 0) + Number(labor?.payroll_paid ?? 0)
  const hasAnything =
    income > 0 || cost > 0 || pendingIncome > 0 || pendingExpense > 0 || cashOut > 0

  const link = (next: { p?: string; site?: string | null }) => {
    const q = new URLSearchParams()
    q.set('p', next.p ?? period.key)
    const s = next.site === undefined ? siteId : next.site
    if (s) q.set('site', s)
    return `/reports?${q}`
  }

  const siteName = siteId ? (sites ?? []).find((s) => s.id === siteId)?.name : null

  return (
    <>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-ink">รายงาน</h1>
        <p className="mt-0.5 text-sm text-muted-token">
          {period.label} · {siteName ?? 'ทั้งบริษัท'} · เทียบกับ {period.prev.label}
        </p>
      </div>

      <PeriodPicker period={period} siteId={siteId} sites={sites ?? []} link={link} />

      {!hasAnything ? (
        <EmptyState
          icon={BarChart3}
          message={`ยังไม่มีรายการใน${period.label}${siteName ? ` ของ${siteName}` : ''} — เลือกช่วงอื่น หรือเริ่มบันทึกรายรับรายจ่ายเข้าไป`}
          action={
            <Link href="/entry" className="btn-primary">
              บันทึกรายการ
            </Link>
          }
        />
      ) : (
        <>
          <MetricBar cols={3}>
            <Metric
              label="รายรับ"
              value={fmtBaht(income)}
              icon={Coins}
              tone="done"
              hint={changeHint(dIncome, period.prev.label)}
            />
            <Metric
              label="ต้นทุนที่เกิดขึ้น"
              value={fmtBaht(cost)}
              icon={TrendingDown}
              hint={changeHint(dCost, period.prev.label)}
            />
            <Metric
              label="กำไรขั้นต้น"
              value={fmtBaht(profit)}
              icon={Wallet}
              tone={profit < 0 ? 'urgent' : 'default'}
              hint={changeHint(dProfit, period.prev.label)}
            />
          </MetricBar>

          <section className="panel mb-4">
            <div className="panel-head">
              เงินเข้า–เงินออก{period.grain === 'day' ? 'รายวัน' : 'รายเดือน'}
              <span className="ml-auto text-xs font-normal tnum text-muted-token">
                {fmtDate(period.from)} – {fmtDate(period.to)}
              </span>
            </div>
            <div className="p-3.5 md:p-4">
              <FlowChart points={points} grain={period.grain} />
            </div>
          </section>

          {(pendingIncome > 0 || pendingExpense > 0) && (
            <p className="mb-4 rounded-lg border border-status-progress-ring bg-status-progress-bg px-4 py-2.5 text-sm text-status-progress">
              ตัวเลขทั้งหน้านี้นับเฉพาะรายการที่<b>อนุมัติแล้ว</b> — ช่วงนี้ยังมีที่รออนุมัติอีก{' '}
              <span className="tnum font-semibold">
                {fmtBaht(pendingExpense + pendingIncome)}
              </span>{' '}
              <Link href="/approvals" className="font-semibold underline underline-offset-2">
                ไปตรวจ
              </Link>
            </p>
          )}

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <section className="panel">
              <div className="panel-head">
                ต้นทุนแยกหมวด
                <span className="ml-auto text-xs font-normal tnum text-muted-token">
                  รวม {fmtBaht(cost)}
                </span>
              </div>
              {expenseCats.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-token">
                  ยังไม่มีรายจ่ายที่อนุมัติในช่วงนี้
                </p>
              ) : (
                <>
                  <BarList items={expenseCats} tone="expense" total={cost} />
                  {/* ที่มาของยอดรวมสองก้อน — ลิสต์ข้างบนบวกกันได้เท่านี้พอดี
                      ถ้าวันหนึ่งไม่เท่า แปลว่ามีต้นทุนที่ไม่ได้ถูกจัดหมวด */}
                  <p className="border-t border-line-soft px-4 py-2.5 text-xs tnum text-muted-token">
                    รายจ่ายที่อนุมัติ {fmtBaht(expense)} + ค่าแรงจากการลงชื่อ {fmtBaht(wage)}
                  </p>
                </>
              )}
            </section>

            <section className="panel">
              <div className="panel-head">
                รายรับแยกหมวด
                <span className="ml-auto text-xs font-normal tnum text-muted-token">
                  รวม {fmtBaht(income)}
                </span>
              </div>
              {incomeCats.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-token">
                  ยังไม่มีรายรับที่อนุมัติในช่วงนี้
                </p>
              ) : (
                <BarList items={incomeCats} tone="income" total={income} />
              )}
            </section>
          </div>

          {!siteId && (bySite ?? []).length > 0 && (
            <section className="panel mb-4">
              <div className="panel-head">
                แยกตามโครงการ
                <span className="ml-auto text-xs font-normal tnum text-muted-token">
                  {(bySite ?? []).length} รายการ
                </span>
              </div>
              <ul className="divide-y divide-line-soft">
                {(bySite ?? []).map((s) => (
                  <li key={s.site_id ?? 'central'} className="px-3.5 py-3 md:px-4">
                    <div className="flex items-baseline gap-3">
                      {s.site_id ? (
                        <Link
                          href={`/sites/${s.site_id}`}
                          className="min-w-0 flex-1 truncate text-sm font-semibold text-ink hover:text-brand"
                        >
                          {s.name}
                        </Link>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                          {s.name}
                        </span>
                      )}
                      <span
                        className={`shrink-0 text-sm font-bold tnum ${
                          Number(s.profit) < 0 ? 'text-urgent' : 'text-ink'
                        }`}
                      >
                        {fmtBaht(Number(s.profit))}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-4 text-xs tnum text-muted-token">
                      <span>
                        เข้า <span className="font-medium text-income">{fmtBaht(Number(s.income))}</span>
                      </span>
                      <span>
                        ออก{' '}
                        <span className="font-medium text-expense">
                          {fmtBaht(Number(s.cost_total))}
                        </span>
                      </span>
                      {Number(s.wage) > 0 && <span>ค่าแรง {fmtBaht(Number(s.wage))}</span>}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="border-t border-line-soft px-4 py-2.5 text-xs text-muted-token">
                ยอดขวาสุดคือ <b>รายรับ − ต้นทุน</b> ของช่วงนี้เท่านั้น ไม่ใช่กำไรทั้งโครงการ
              </p>
            </section>
          )}

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <section className="panel">
              <div className="panel-head">คนและค่าแรง</div>
              <div className="grid grid-cols-2 divide-x divide-y divide-line-soft">
                <Cell label="วันแรงรวม" value={`${Number(labor?.work_units ?? 0)} วัน`} />
                <Cell label="คนที่มาทำงาน" value={`${Number(labor?.worker_count ?? 0)} คน`} />
                <Cell label="ค่าแรงที่เกิดขึ้น" value={fmtBaht(Number(labor?.wage_total ?? 0))} />
                <Cell label="ในนั้นเป็น OT" value={fmtBaht(Number(labor?.ot_total ?? 0))} />
              </div>
              {workers.length > 0 && (
                <>
                  <div className="border-t border-line px-4 py-2 text-xs font-semibold text-ink-2">
                    ค่าแรงสูงสุดในช่วงนี้
                  </div>
                  <BarList items={workers} tone="brand" />
                </>
              )}
            </section>

            <section className="panel">
              <div className="panel-head">เงินสดออกฝั่งค่าแรง</div>
              <div className="grid grid-cols-2 divide-x divide-line-soft">
                <Cell
                  label="เบิกล่วงหน้า"
                  value={fmtBaht(Number(labor?.advance_paid ?? 0))}
                  icon={HandCoins}
                />
                <Cell
                  label="ปิดรอบจ่ายแล้ว"
                  value={fmtBaht(Number(labor?.payroll_paid ?? 0))}
                  icon={Banknote}
                />
              </div>
              {/* 🔴 กฎที่พังง่ายที่สุดของทั้งระบบ (DESIGN.md §5.4) — ต้องเขียนไว้
                  ตรงที่ตัวเลขอยู่ ไม่ใช่ไปอยู่ในเอกสารที่ไม่มีใครเปิด */}
              <p className="border-t border-line-soft px-4 py-3 text-xs leading-5 text-muted-token">
                สองยอดนี้คือ <b>เงินสดที่จ่ายออกไป</b> ไม่ใช่ต้นทุน — ต้นทุนค่าแรงเกิดตั้งแต่ตอนติ๊ก
                คนเข้าโครงการแล้ว (นับอยู่ใน &ldquo;ค่าแรงที่เกิดขึ้น&rdquo;) การนับซ้ำอีกรอบจะทำให้ต้นทุนเป็นสองเท่า
              </p>
              <div className="grid grid-cols-2 divide-x divide-y divide-line-soft border-t border-line">
                <Cell label="จ่ายด้วยเงินสด" value={fmtBaht(Number(now?.expense_cash ?? 0))} />
                <Cell label="จ่ายด้วยการโอน" value={fmtBaht(Number(now?.expense_transfer ?? 0))} />
              </div>
            </section>
          </div>
        </>
      )}
    </>
  )
}

function changeHint(pct: number | null, prevLabel: string) {
  if (pct === null) return `ไม่มีข้อมูล${prevLabel}ให้เทียบ`
  if (pct === 0) return `เท่ากับ${prevLabel}`
  return `${pct > 0 ? '+' : ''}${pct}% จาก${prevLabel}`
}

function Cell({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon?: typeof Coins
}) {
  return (
    <div className="min-w-0 px-3.5 py-3 md:px-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-token">
        {Icon && <Icon className="size-3.5 shrink-0" strokeWidth={2} />}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 truncate text-lg font-bold tnum text-ink">{value}</div>
    </div>
  )
}

/**
 * ตัวเลือกช่วงเวลาและโครงการ
 *
 * ไม่มี state ฝั่ง client เลย — โหมดเป็นลิงก์ ส่วนช่วงกับโครงการเป็นฟอร์ม GET
 * แบบเดียวกับ `ListToolbar` · ผลลัพธ์คือหน้ารายงานที่ **แชร์ลิงก์ได้**
 * และกดย้อนกลับได้ถูกต้องโดยไม่ต้องเขียนอะไรเพิ่ม
 */
function PeriodPicker({
  period,
  siteId,
  sites,
  link,
}: {
  period: ReturnType<typeof parsePeriod>
  siteId: string | null
  sites: { id: string; name: string }[]
  link: (next: { p?: string; site?: string | null }) => string
}) {
  const modes: { key: ReportMode; label: string; target: string }[] = [
    { key: 'month', label: 'รายเดือน', target: periodOptions('month')[0].value },
    { key: 'year', label: 'รายปี', target: periodOptions('year')[0].value },
  ]

  return (
    <div className="mb-4 flex flex-col gap-2.5 md:flex-row md:items-end md:justify-between">
      <div className="flex gap-1.5">
        {modes.map((m) => {
          const active = period.mode === m.key
          return (
            <Link
              key={m.key}
              href={link({ p: active ? period.key : m.target })}
              aria-current={active ? 'true' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-sm border px-3 py-2 text-sm font-medium transition-colors duration-100 ${
                active
                  ? 'border-ink bg-ink text-canvas'
                  : 'border-line-strong bg-surface text-ink-2 hover:border-ink-2 hover:text-ink'
              }`}
            >
              <CalendarRange className="size-4" />
              {m.label}
            </Link>
          )
        })}
      </div>

      <form action="/reports" method="get" className="flex flex-wrap gap-2">
        <select
          name="p"
          defaultValue={period.key}
          aria-label="ช่วงเวลา"
          className="input-base w-auto min-w-36 flex-1 py-2"
        >
          {periodOptions(period.mode).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          name="site"
          defaultValue={siteId ?? ''}
          aria-label="โครงการ"
          className="input-base w-auto min-w-36 flex-1 py-2"
        >
          <option value="">ทั้งบริษัท</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-secondary shrink-0 px-4 py-2">
          <UsersRound className="size-4 lg:hidden" />
          ดูรายงาน
        </button>
      </form>
    </div>
  )
}
