import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarDays, HardHat, Wallet } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { fmtBaht, todayInBangkok } from '@/lib/format'
import { daysInRange, parsePeriod, periodOptions } from '@/lib/reports'
import { Metric, MetricBar } from '@/components/ui/metric'
import { EmptyState } from '@/components/ui/states'
import { asNullableNumber } from '@/lib/money'
import { PayrollBoard } from './payroll-client'
import { SiteHistory } from './site-history'
import { WorkGrid } from './work-grid'

export const metadata = { title: 'ค่าแรงและการจ่าย' }

type Search = { tab?: string; p?: string; view?: string }

export default async function PayrollPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [me, sp] = await Promise.all([getCurrentUser(), searchParams])
  // สามมุมมองสลับกันได้ · สถานะอยู่บน URL เหมือนหน้าอื่นทั้งแอป — แชร์ลิงก์ได้
  const tab = sp.tab === 'grid' ? 'grid' : sp.tab === 'sites' ? 'sites' : 'balances'
  const view = sp.view === 'site' ? 'site' : 'person'
  // ซ่อนเมนูอย่างเดียวไม่พอ — คนพิมพ์ URL ตรงได้ ต้องกันที่หน้าเองด้วย
  // เบิกและรอบจ่ายเป็นเรื่องเงินทั้งหมด · หัวหน้าโครงการไม่เกี่ยว
  if (me.role !== 'owner') redirect('/')

  const sb = await getSupabaseServer()
  const today = todayInBangkok()
  // ตารางการทำงานยึด "เดือน" เสมอ — ค่าเริ่มต้นคือเดือนปัจจุบัน
  const period = parsePeriod(sp.p ?? '', today)
  const month = period.mode === 'month' ? period : parsePeriod(today.slice(0, 7), today)
  const monthDays = daysInRange(month.from, month.to)

  const [{ data: balances, error: bErr }, { data: payments, error: rErr }, { data: sites }, { data: openAdvances }] =
    await Promise.all([
      // 🔴 RPC ตัวเดียวคืนยอดของทุกคน — ไม่ใช่ยิง employee_balance ทีละคน (N+1)
      sb.rpc('payroll_balances'),
      // ประวัติการจ่าย — เฉพาะที่ปิดแล้ว เพราะรอบที่ยังเปิดค้างอยู่ไม่ใช่การจ่าย
      // และไม่มีทางเกิดใหม่แล้ว (ปุ่มจ่ายสร้างแล้วปิดในทรานแซกชันเดียว)
      sb
        .from('payroll_runs')
        .select('id, period_start, period_end, total_accrued, total_advance_deducted, total_paid, employees(full_name)')
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .range(0, PAGE_SIZE - 1),
      sb.from('sites').select('id, name').order('name', { ascending: true }).range(0, PAGE_SIZE - 1),
      sb
        .from('advances')
        .select('id, employee_id, amount, advance_date, employees(full_name)')
        .is('payroll_run_id', null)
        .order('advance_date', { ascending: false })
        .range(0, PAGE_SIZE - 1),
    ])

  // ── ข้อมูลของแท็บ "ทำงานที่ไหนบ้าง" — สรุปในฐานข้อมูล ไม่ใช่ group ใน JS ──
  const { data: workRows, error: wErr } =
    tab === 'sites'
      ? await sb
          .rpc('attendance_by_site', { p_from: month.from, p_to: month.to })
          .range(0, 2000)
      : { data: null, error: null }

  // ── ข้อมูลของแท็บ "ตารางการทำงาน" — ดึงเฉพาะตอนเปิดแท็บนั้นจริง ──────
  // เปิดแท็บยอดค้างอยู่แล้วไม่ต้องจ่ายค่า query ของอีกแท็บหนึ่ง
  const [{ data: gridCells, error: gErr }, { data: gridPeople, error: pErr }] =
    tab === 'grid'
      ? await Promise.all([
          sb
            .rpc('attendance_grid', { p_from: month.from, p_to: month.to })
            .order('work_date', { ascending: true })
            .range(0, 2000),
          sb
            .from('employees')
            .select('id, full_name, job_title, default_site_id, employee_wages(wage_type, daily_rate)')
            .eq('is_active', true)
            .order('full_name', { ascending: true })
            .range(0, PAGE_SIZE - 1),
        ])
      : [
          { data: null, error: null },
          { data: null, error: null },
        ]

  if (bErr || rErr || gErr || pErr || wErr) {
    console.error(
      '[payroll] โหลดข้อมูลไม่ได้',
      bErr?.message ?? rErr?.message ?? gErr?.message ?? pErr?.message ?? wErr?.message,
    )
    return (
      <div className="rounded-lg border border-urgent-ring bg-urgent-bg p-6 text-center">
        <p className="text-sm text-urgent">โหลดข้อมูลค่าแรงไม่สำเร็จ</p>
        <p className="mt-1 text-xs text-urgent">ลองรีเฟรชหน้านี้อีกครั้ง</p>
      </div>
    )
  }

  const rows = (balances ?? []).map((b) => ({
    employee_id: b.employee_id,
    full_name: b.full_name,
    job_title: b.job_title,
    days: Number(b.days),
    accrued: Number(b.accrued),
    advanced: Number(b.advanced),
    balance: Number(b.balance),
  }))

  const totalAccrued = rows.reduce((s, r) => s + r.accrued, 0)
  const totalAdvanced = rows.reduce((s, r) => s + r.advanced, 0)

  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink">ค่าแรงและการจ่าย</h1>
        <p className="mt-0.5 text-sm text-muted-token">
          ค่าแรงเกิดขึ้นตอนติ๊กคนเข้าโครงการ · การเบิกและการจ่ายคือ{' '}
          <span className="font-medium text-ink-2">เงินสดออก ไม่ใช่ต้นทุนใหม่</span>
        </p>
      </div>

      <MetricBar>
        <Metric
          label="ค่าแรงค้างจ่าย"
          value={fmtBaht(totalAccrued)}
          icon={Wallet}
          hint="ยังไม่ได้จ่าย"
        />
        <Metric label="เบิกไปแล้ว" value={fmtBaht(totalAdvanced)} hint="ยังไม่ถูกหัก" />
        <Metric
          label="คงเหลือต้องจ่าย"
          value={fmtBaht(totalAccrued - totalAdvanced)}
          tone={totalAccrued - totalAdvanced > 0 ? 'progress' : 'default'}
          hint="ค่าแรงค้างจ่าย − เบิกไปแล้ว"
        />
        <Metric label="คนที่มียอดค้าง" value={rows.length} unit="คน" />
      </MetricBar>

      {/* ── สองมุมมอง — ยอดค้างจ่ายรายคน / ตารางการทำงานของเดือนที่เลือก ── */}
      <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1.5">
          {(
            [
              { key: 'balances', label: 'ค้างจ่ายรายคน', href: '/payroll' },
              {
                key: 'grid',
                label: 'ตารางการทำงาน',
                href: `/payroll?tab=grid&p=${month.key}`,
              },
              {
                key: 'sites',
                label: 'ทำงานที่ไหนบ้าง',
                href: `/payroll?tab=sites&p=${month.key}`,
              },
            ] as const
          ).map((t) => (
            <Link
              key={t.key}
              href={t.href}
              aria-current={tab === t.key ? 'true' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-sm border px-3 py-2 text-sm font-medium transition-colors duration-100 ${
                tab === t.key
                  ? 'border-ink bg-ink text-canvas'
                  : 'border-line-strong bg-surface text-ink-2 hover:border-ink-2 hover:text-ink'
              }`}
            >
              {t.key === 'grid' ? <CalendarDays className="size-4" />
                : t.key === 'sites' ? <HardHat className="size-4" />
                : <Wallet className="size-4" />}
              {t.label}
            </Link>
          ))}
        </div>

        {/* เลือกเดือน — ค่าเริ่มต้นคือเดือนปัจจุบัน · เป็นฟอร์ม GET ไม่มี state ฝั่ง client */}
        {tab !== 'balances' && (
          <form action="/payroll" method="get" className="flex gap-2">
            <input type="hidden" name="tab" value={tab} />
            {tab === 'sites' && view === 'site' && (
              <input type="hidden" name="view" value="site" />
            )}
            <select
              name="p"
              defaultValue={month.key}
              aria-label="เดือน"
              className="input-base w-auto min-w-40 py-2"
            >
              {periodOptions('month', today).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-secondary shrink-0 px-4 py-2">
              ดู
            </button>
          </form>
        )}
      </div>

      {tab === 'sites' ? (
        <SiteHistory
          view={view}
          monthKey={month.key}
          rows={(workRows ?? []).map((r) => ({
            employee_id: r.employee_id,
            full_name: r.full_name,
            job_title: r.job_title,
            site_id: r.site_id,
            site_name: r.site_name,
            days: Number(r.days),
            amount: asNullableNumber(r.amount),
          }))}
        />
      ) : tab === 'grid' ? (
        (gridPeople ?? []).length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            message="ยังไม่มีคนงานในระบบ — เพิ่มคนงานที่หน้าตั้งค่าก่อน แล้วตารางจะขึ้นที่นี่"
          />
        ) : (
          <WorkGrid
            today={today}
            days={monthDays}
            sites={sites ?? []}
            employees={(gridPeople ?? []).map((e) => ({
              id: e.id,
              full_name: e.full_name,
              job_title: e.job_title,
              default_site_id: e.default_site_id,
              wage_type: e.employee_wages?.wage_type ?? 'daily',
              daily_rate:
                e.employee_wages?.daily_rate === null || e.employee_wages?.daily_rate === undefined
                  ? null
                  : Number(e.employee_wages.daily_rate),
            }))}
            cells={(gridCells ?? []).map((c) => ({
              attendance_id: c.attendance_id,
              employee_id: c.employee_id,
              work_date: c.work_date,
              site_id: c.site_id,
              site_name: c.site_name,
              work_units: Number(c.work_units),
              wage_snapshot: Number(c.wage_snapshot),
              ot_amount: Number(c.ot_amount),
              amount: Number(c.amount),
              paid: c.paid,
            }))}
          />
        )
      ) : rows.length === 0 && (payments ?? []).length === 0 ? (
        <EmptyState
          icon={Wallet}
          message="ยังไม่มีค่าแรงค้างจ่าย — ติ๊กคนเข้าโครงการที่หน้าคนเข้าโครงการก่อน แล้วยอดจะขึ้นที่นี่"
        />
      ) : (
        <PayrollBoard
          today={today}
          rows={rows}
          payments={(payments ?? []).map((r) => ({
            id: r.id,
            period_start: r.period_start,
            period_end: r.period_end,
            employee_name: r.employees?.full_name ?? null,
            total_accrued: Number(r.total_accrued),
            total_advance_deducted: Number(r.total_advance_deducted),
            total_paid: Number(r.total_paid),
          }))}
          advances={(openAdvances ?? []).map((a) => ({
            id: a.id,
            employee_id: a.employee_id,
            amount: Number(a.amount),
            advance_date: a.advance_date,
            full_name: a.employees?.full_name ?? 'ไม่ทราบชื่อ',
          }))}
        />
      )}
    </>
  )
}
