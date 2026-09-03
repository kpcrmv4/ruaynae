import Link from 'next/link'
import { HardHat } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { fmtDateLong, todayInBangkok } from '@/lib/format'
import { EmptyState } from '@/components/ui/states'
import { DataError } from '@/components/ui/data-error'
import { AttendanceBoard } from './attendance-client'

export const metadata = { title: 'คนเข้าโครงการ' }

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

  // โครงการที่ "คนนี้ดูแลอยู่ **ณ วันที่เลือก**" — ไม่ใช่ ณ วันนี้
  // ย้ายโครงการแล้วต้องยังกลับไปแก้ของเก่าที่ตัวเองบันทึกไว้ได้
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
    console.error('[attendance] อ่านโครงการไม่ได้', sErr.message)
    return (
      <DataError message="โหลดรายชื่อโครงการไม่สำเร็จ" />
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
              ? 'ยังไม่มีโครงการที่กำลังทำ — เพิ่มโครงการก่อนแล้วค่อยลงชื่อคนเข้าโครงการ'
              : `คุณยังไม่ได้ดูแลโครงการไหนในวันที่ ${fmtDateLong(date)} — ให้เจ้าของมอบหมายโครงการให้ก่อน`
          }
          action={
            isOwner ? (
              <Link href="/sites" className="btn-primary">เพิ่มโครงการ</Link>
            ) : undefined
          }
        />
      </>
    )
  }

  // วันก่อนหน้าของวันที่เลือก — ใช้กับปุ่ม "เหมือนเมื่อวาน" (ชุดคนมักซ้ำกันทั้งสัปดาห์)
  const prev = new Date(`${date}T00:00:00Z`)
  prev.setUTCDate(prev.getUTCDate() - 1)
  const prevDate = prev.toISOString().slice(0, 10)

  const [
    { data: employees, error: eErr },
    { data: rows, error: aErr },
    { data: dayWage },
    { data: prevRows, error: pErr },
    { data: otherSiteRows, error: oErr },
  ] =
    await Promise.all([
      // 🔴 ไม่ดึงค่าแรงมาที่หน้านี้เลย — หัวหน้าโครงการมีหน้าที่บันทึกว่าใครมาทำงาน
      // ไม่ใช่ดูเงิน (เจ้าของสั่งไว้ 31 ส.ค. 2569) · เรตอยู่ `employee_wages`
      // ซึ่ง RLS ไม่ให้เขาอ่านอยู่แล้ว การไม่ขอมาตั้งแต่แรกทำให้หน้าไม่ต้องมี if
      sb
        .from('employees')
        .select('id, full_name, job_title')
        .eq('is_active', true)
        .order('full_name', { ascending: true })
        .range(0, PAGE_SIZE - 1),
      // 🔴 สอง query ที่เขียนสตริง select ไว้ตายตัว ไม่ใช่สตริงที่ต่อจากตัวแปร —
      // ตัวตรวจชนิดของ PostgREST อ่านสตริงตอน compile ถ้าต่อจากตัวแปรมันจะยอมแพ้
      // แล้วทั้ง query กลายเป็น `any` ซึ่งแปลว่าไม่มีใครตรวจให้อีกเลย
      isOwner
        ? sb
            .from('attendance')
            .select('id, employee_id, work_units, note, attendance_wages(amount, ot_amount)')
            .eq('site_id', siteId)
            .eq('work_date', date)
            .order('created_at', { ascending: true })
            .range(0, PAGE_SIZE - 1)
            .then(({ data, error }) => ({
              error,
              data: (data ?? []).map((r) => ({
                id: r.id,
                employee_id: r.employee_id,
                work_units: Number(r.work_units),
                amount: Number(r.attendance_wages?.amount ?? 0),
                otAmount: Number(r.attendance_wages?.ot_amount ?? 0),
              })),
            }))
        : sb
            .from('attendance')
            .select('id, employee_id, work_units, note')
            .eq('site_id', siteId)
            .eq('work_date', date)
            .order('created_at', { ascending: true })
            .range(0, PAGE_SIZE - 1)
            .then(({ data, error }) => ({
              error,
              data: (data ?? []).map((r) => ({
                id: r.id,
                employee_id: r.employee_id,
                work_units: Number(r.work_units),
                // `null` = ไม่มีสิทธิ์เห็น ไม่ใช่ 0 ที่อ่านเหมือน "ทำงานฟรี"
                amount: null,
                otAmount: null,
              })),
            })),
      // 🔴 ยอดรวมมาจากฐานข้อมูล ไม่ใช่บวกแถวที่หน้านี้โหลดมา —
      // โครงการที่มีคนงานเกินหนึ่งหน้า ยอดจะน้อยกว่าความจริงโดยไม่มี error
      // · RPC คืน null ให้คนที่ไม่ใช่เจ้าของ ยอดเงินจึงหายไป ไม่ใช่โชว์ ฿0
      sb.rpc('site_day_wage', { p_site: siteId, p_on: date }),
      sb
        .from('attendance')
        .select('employee_id, work_units')
        .eq('site_id', siteId)
        .eq('work_date', prevDate)
        .order('created_at', { ascending: true })
        .range(0, PAGE_SIZE - 1),
      // 🔴 คนหนึ่งคนทำงานได้ไม่เกิน 1 วันต่อวัน — guard ที่ฐานข้อมูลปฏิเสธการลงชื่อ
      // ที่จะทำให้เกิน · เดิมหน้าจอไม่รู้เรื่องนี้เลย ปุ่ม "เข้าโครงการ" จึงโชว์ให้กด
      // ทั้งที่ยังไงก็ไม่ผ่าน แล้วผู้ใช้เพิ่งรู้ตอนขึ้น error หลังกด
      // · RLS จำกัดให้เอง: หัวหน้าโครงการเห็นเฉพาะโครงการที่ตัวเองดูแล — คนที่ไปอยู่โครงการ
      // ของคนอื่นจะยังกดไม่ผ่านที่ฐานข้อมูลเหมือนเดิม ซึ่งเป็นตาข่ายรองที่ยังอยู่ครบ
      sb
        .from('attendance')
        .select('employee_id, work_units, sites(name)')
        .eq('work_date', date)
        .neq('site_id', siteId)
        .order('employee_id', { ascending: true })
        .range(0, PAGE_SIZE * 2 - 1),
    ])

  if (eErr || aErr || pErr || oErr) {
    console.error(
      '[attendance] โหลดข้อมูลไม่ได้',
      eErr?.message ?? aErr?.message ?? pErr?.message ?? oErr?.message,
    )
    return (
      <DataError message="โหลดข้อมูลคนเข้าโครงการไม่สำเร็จ" />
    )
  }

  // รวมเป็น "วันนี้คนนี้ถูกลงชื่อที่อื่นไปแล้วกี่วัน และที่โครงการไหนบ้าง"
  const bookedElsewhere: Record<string, { units: number; siteNames: string[] }> = {}
  for (const r of otherSiteRows ?? []) {
    const cur = bookedElsewhere[r.employee_id] ?? { units: 0, siteNames: [] }
    cur.units += Number(r.work_units)
    const name = r.sites?.name
    if (name && !cur.siteNames.includes(name)) cur.siteNames.push(name)
    bookedElsewhere[r.employee_id] = cur
  }

  return (
    <>
      <Header date={date} />
      <AttendanceBoard
        date={date}
        today={today}
        siteId={siteId}
        sites={sites.map((s) => ({ id: s.id, name: s.name }))}
        employees={employees ?? []}
        canSeeMoney={isOwner}
        signedIn={rows}
        dayWage={dayWage === null ? undefined : Number(dayWage)}
        yesterdaySignIns={(prevRows ?? []).map((r) => ({
          employee_id: r.employee_id,
          work_units: Number(r.work_units),
        }))}
        bookedElsewhere={bookedElsewhere}
      />
    </>
  )
}

function Header({ date }: { date: string }) {
  return (
    <div className="mb-4">
      <h1 className="text-2xl font-bold text-ink">คนเข้าโครงการ</h1>
      <p className="mt-0.5 text-sm text-muted-token">
        {fmtDateLong(date)} · ติ๊กคนที่มาทำงาน — ค่าแรงเข้าต้นทุนโครงการทันทีโดยไม่ต้องรออนุมัติ
      </p>
    </div>
  )
}
