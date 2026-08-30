import Link from 'next/link'
import { HardHat } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { fmtBaht, fmtDateLong, todayInBangkok } from '@/lib/format'
import { EmptyState } from '@/components/ui/states'
import { AttendanceBoard } from './attendance-client'

export const metadata = { title: 'คนเข้าไซต์' }

type Search = { date?: string; site?: string }

const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) <= 2200

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const [me, sp] = await Promise.all([getCurrentUser(), searchParams])
  const today = todayInBangkok()
  // 🔴 วันในอนาคตถูกดึงกลับมาเป็นวันนี้ — ค่าแรงของวันที่ยังไม่มาถึง
  // คือต้นทุนที่ยังไม่เกิด · API ก็ปฏิเสธอีกชั้น (P4-UI-10)
  const date = isIsoDate(sp.date) && sp.date <= today ? sp.date : today

  const sb = await getSupabaseServer()

  // ไซต์ที่ "คนนี้ดูแลอยู่ **ณ วันที่เลือก**" — ไม่ใช่ ณ วันนี้
  // ย้ายไซต์แล้วต้องยังกลับไปแก้ของเก่าที่ตัวเองบันทึกไว้ได้
  const { data: allSites, error: sErr } = await sb
    .from('sites')
    .select('id, name, status, site_supervisors(profile_id, effective_from, effective_to)')
    .in('status', ['active', 'planning'])
    .order('name', { ascending: true })
    .range(0, PAGE_SIZE - 1)

  const isOwner = me.role === 'owner'
  const sites = (allSites ?? []).filter(
    (s) =>
      isOwner ||
      s.site_supervisors.some(
        (m) =>
          m.profile_id === me.id &&
          m.effective_from <= date &&
          (m.effective_to === null || m.effective_to >= date),
      ),
  )

  const siteId = sites.some((s) => s.id === sp.site) ? sp.site! : sites[0]?.id

  if (sErr) {
    console.error('[attendance] อ่านไซต์ไม่ได้', sErr.message)
    return (
      <div className="rounded-lg border border-urgent-ring bg-urgent-bg p-6 text-center">
        <p className="text-sm text-urgent">โหลดรายชื่อไซต์ไม่สำเร็จ</p>
        <p className="mt-1 text-xs text-urgent">ลองรีเฟรชหน้านี้อีกครั้ง</p>
      </div>
    )
  }

  if (!siteId) {
    return (
      <>
        <Header date={date} />
        <EmptyState
          icon={HardHat}
          message={
            isOwner
              ? 'ยังไม่มีไซต์ที่กำลังทำ — เพิ่มไซต์งานก่อนแล้วค่อยลงชื่อคนเข้าไซต์'
              : `คุณยังไม่ได้ดูแลไซต์ไหนในวันที่ ${fmtDateLong(date)} — ให้เจ้าของมอบหมายไซต์ให้ก่อน`
          }
          action={
            isOwner ? (
              <Link href="/sites" className="btn-primary">เพิ่มไซต์งาน</Link>
            ) : undefined
          }
        />
      </>
    )
  }

  const [{ data: employees, error: eErr }, { data: rows, error: aErr }, { data: dayWage }] =
    await Promise.all([
      sb
        .from('employees')
        .select('id, full_name, job_title, wage_type, daily_rate')
        .eq('is_active', true)
        .order('full_name', { ascending: true })
        .range(0, PAGE_SIZE - 1),
      sb
        .from('attendance')
        .select('id, employee_id, work_units, ot_amount, wage_snapshot, amount, note')
        .eq('site_id', siteId)
        .eq('work_date', date)
        .order('created_at', { ascending: true })
        .range(0, PAGE_SIZE - 1),
      // 🔴 ยอดรวมมาจากฐานข้อมูล ไม่ใช่บวกแถวที่หน้านี้โหลดมา —
      // ไซต์ที่มีคนงานเกินหนึ่งหน้า ยอดจะน้อยกว่าความจริงโดยไม่มี error
      sb.rpc('site_day_wage', { p_site: siteId, p_on: date }),
    ])

  if (eErr || aErr) {
    console.error('[attendance] โหลดข้อมูลไม่ได้', eErr?.message ?? aErr?.message)
    return (
      <div className="rounded-lg border border-urgent-ring bg-urgent-bg p-6 text-center">
        <p className="text-sm text-urgent">โหลดข้อมูลคนเข้าไซต์ไม่สำเร็จ</p>
        <p className="mt-1 text-xs text-urgent">ลองรีเฟรชหน้านี้อีกครั้ง</p>
      </div>
    )
  }

  return (
    <>
      <Header date={date} total={Number(dayWage ?? 0)} />
      <AttendanceBoard
        date={date}
        today={today}
        siteId={siteId}
        sites={sites.map((s) => ({ id: s.id, name: s.name }))}
        employees={employees ?? []}
        // `amount` เป็น generated column — ตัวสร้างชนิดเขียนว่า nullable ทั้งที่
        // ส่วนประกอบทุกตัวเป็น not null · แปลงตรงนี้ครั้งเดียว ไม่ปล่อยให้ทั้งหน้า
        // ต้องเช็ค null ที่เกิดขึ้นไม่ได้จริง
        signedIn={(rows ?? []).map((r) => ({ ...r, amount: Number(r.amount ?? 0) }))}
      />
    </>
  )
}

function Header({ date, total }: { date: string; total?: number }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-ink">คนเข้าไซต์</h1>
        <p className="mt-0.5 text-sm text-muted-token">
          ติ๊กคนที่มาทำงาน — ค่าแรงเข้าต้นทุนไซต์ทันทีโดยไม่ต้องรออนุมัติ
        </p>
      </div>
      {total !== undefined && (
        <div className="shrink-0 rounded-lg border border-line bg-surface px-4 py-2 text-right shadow-e1">
          <div className="text-xs font-medium text-muted-token">ค่าแรงวันนี้</div>
          <div data-day-wage={total} className="text-xl font-bold tnum text-ink">
            {fmtBaht(total)}
          </div>
        </div>
      )}
    </div>
  )
}
