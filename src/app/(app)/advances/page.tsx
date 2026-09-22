import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { todayInBangkok } from '@/lib/format'
import { DataError } from '@/components/ui/data-error'
import { PageHeader } from '@/components/ui/page-header'
import { AdvanceRequestBoard } from './advances-client'

export const metadata = { title: 'ตั้งเบิกค่าแรง' }

/**
 * หน้าของ **หัวหน้าโครงการ** — ยื่นคำขอเบิกค่าแรงแทนลูกน้อง
 * (คำสั่งเจ้าของ 21 ก.ย. 2569: *"แค่ให้เค้าส่งเสนอมาก่อน บางครั้งผมไม่ได้อยู่หน้างาน"*)
 *
 * 🔴 หน้านี้ **ไม่แสดงยอดค่าแรงหรือยอดคงเหลือของคนงานเลยสักที่** — ค่าแรง
 * เป็นความลับจากหัวหน้าโครงการตั้งแต่ P4.5 · คนที่ต้องเห็นตัวเลขคือเจ้าของ
 * ตอนกดอนุมัติ ซึ่งเห็นอยู่แล้วที่ `/approvals`
 */
export default async function AdvancesPage() {
  const me = await getCurrentUser()
  // เจ้าของมีช่องทางของตัวเองอยู่แล้วที่ /payroll (เบิก = จ่ายเงินทันที)
  // ไม่ใช่การกันสิทธิ์ — เป็นการไม่พาไปหน้าที่ทำงานเดียวกันสองที่
  if (me.role === 'owner') redirect('/payroll')

  const sb = await getSupabaseServer()
  const today = todayInBangkok()

  // 🔴 รายชื่อโครงการมาจาก RLS ไม่ใช่จาก where ที่เขียนเอง — เห็นเฉพาะที่ดูแล
  // อยู่ **ณ วันนี้** · คนที่เพิ่งถูกย้ายออกจะไม่เห็นโครงการเดิมทันที
  const [{ data: sites, error: sErr }, { data: workers, error: wErr }, { data: rows, error: rErr }] =
    await Promise.all([
      sb
        .from('sites')
        .select('id, name')
        .in('status', ['planning', 'active', 'paused'])
        .order('name', { ascending: true })
        .range(0, PAGE_SIZE - 1),
      sb
        .from('employees')
        .select('id, full_name, job_title')
        .eq('is_active', true)
        .order('full_name', { ascending: true })
        .range(0, PAGE_SIZE * 4 - 1),
      // คำขอของฉัน — RLS คืนเฉพาะของตัวเองอยู่แล้ว (`created_by = auth.uid()`)
      // เรียงใหม่ก่อน เพราะสิ่งที่เพิ่งยื่นคือสิ่งที่กำลังรอคำตอบอยู่
      sb
        .from('advances')
        .select(`
          id, amount, advance_date, status, rejected_reason, note,
          site_id, employee_id, deducted_amount, created_at,
          employees(full_name), sites(name)
        `)
        .order('created_at', { ascending: false })
        .range(0, PAGE_SIZE - 1),
    ])

  if (sErr || wErr || rErr) {
    console.error('[advances] โหลดหน้าไม่ได้', sErr?.message ?? wErr?.message ?? rErr?.message)
    return (
      <>
        <PageHeader title="ตั้งเบิกค่าแรง" />
        <DataError message="โหลดหน้าตั้งเบิกไม่สำเร็จ" />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="ตั้งเบิกค่าแรง"
        subtitle="ยื่นคำขอแทนลูกน้อง แล้วเจ้าของเป็นคนอนุมัติว่าให้เบิกหรือไม่ให้"
      />
      <AdvanceRequestBoard
        today={today}
        sites={sites ?? []}
        workers={workers ?? []}
        rows={(rows ?? []).map((r) => ({
          id: r.id,
          amount: Number(r.amount),
          advance_date: r.advance_date,
          status: r.status,
          rejected_reason: r.rejected_reason,
          note: r.note,
          site_id: r.site_id,
          site_name: r.sites?.name ?? null,
          employee_id: r.employee_id,
          employee_name: r.employees?.full_name ?? 'คนงานที่ถูกลบแล้ว',
          deducted_amount: Number(r.deducted_amount ?? 0),
        }))}
      />
    </>
  )
}
