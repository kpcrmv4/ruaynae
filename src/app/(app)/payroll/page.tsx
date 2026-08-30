import { redirect } from 'next/navigation'
import { Wallet } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { fmtBaht, todayInBangkok } from '@/lib/format'
import { Metric, MetricBar } from '@/components/ui/metric'
import { EmptyState } from '@/components/ui/states'
import { PayrollBoard } from './payroll-client'

export const metadata = { title: 'ค่าแรงและรอบจ่าย' }

export default async function PayrollPage() {
  const me = await getCurrentUser()
  // ซ่อนเมนูอย่างเดียวไม่พอ — คนพิมพ์ URL ตรงได้ ต้องกันที่หน้าเองด้วย
  // เบิกและรอบจ่ายเป็นเรื่องเงินทั้งหมด · หัวหน้าไซต์ไม่เกี่ยว
  if (me.role !== 'owner') redirect('/')

  const sb = await getSupabaseServer()
  const today = todayInBangkok()

  const [{ data: balances, error: bErr }, { data: runs, error: rErr }, { data: sites }, { data: openAdvances }] =
    await Promise.all([
      // 🔴 RPC ตัวเดียวคืนยอดของทุกคน — ไม่ใช่ยิง employee_balance ทีละคน (N+1)
      sb.rpc('payroll_balances'),
      sb
        .from('payroll_runs')
        .select('id, period_start, period_end, site_id, status, total_accrued, total_advance_deducted, total_paid, sites(name)')
        .order('period_start', { ascending: false })
        .range(0, PAGE_SIZE - 1),
      sb.from('sites').select('id, name').order('name', { ascending: true }).range(0, PAGE_SIZE - 1),
      sb
        .from('advances')
        .select('id, employee_id, amount, advance_date, employees(full_name)')
        .is('payroll_run_id', null)
        .order('advance_date', { ascending: false })
        .range(0, PAGE_SIZE - 1),
    ])

  if (bErr || rErr) {
    console.error('[payroll] โหลดข้อมูลไม่ได้', bErr?.message ?? rErr?.message)
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
    accrued: Number(b.accrued),
    advanced: Number(b.advanced),
    balance: Number(b.balance),
  }))

  const totalAccrued = rows.reduce((s, r) => s + r.accrued, 0)
  const totalAdvanced = rows.reduce((s, r) => s + r.advanced, 0)

  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink">ค่าแรงและรอบจ่าย</h1>
        <p className="mt-0.5 text-sm text-muted-token">
          ค่าแรงเกิดขึ้นตอนติ๊กคนเข้าไซต์ · การเบิกและปิดรอบคือ{' '}
          <span className="font-medium text-ink-2">เงินสดออก ไม่ใช่ต้นทุนใหม่</span>
        </p>
      </div>

      <MetricBar>
        <Metric
          label="ค่าแรงค้างจ่าย"
          value={fmtBaht(totalAccrued)}
          icon={Wallet}
          hint="ยังไม่ถูกปิดรอบ"
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

      {rows.length === 0 && (runs ?? []).length === 0 ? (
        <EmptyState
          icon={Wallet}
          message="ยังไม่มีค่าแรงค้างจ่าย — ติ๊กคนเข้าไซต์ที่หน้าคนเข้าไซต์ก่อน แล้วยอดจะขึ้นที่นี่"
        />
      ) : (
        <PayrollBoard
          today={today}
          rows={rows}
          runs={(runs ?? []).map((r) => ({
            id: r.id,
            period_start: r.period_start,
            period_end: r.period_end,
            status: r.status,
            site_name: r.sites?.name ?? null,
            total_accrued: Number(r.total_accrued),
            total_advance_deducted: Number(r.total_advance_deducted),
            total_paid: Number(r.total_paid),
          }))}
          sites={sites ?? []}
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
