import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { todayInBangkok } from '@/lib/format'
import { DataError } from '@/components/ui/data-error'
import { RecurringClient } from './recurring-client'

export const metadata = { title: 'ค่าใช้จ่ายรายเดือน' }

type Search = { employee?: string }

/**
 * ค่าใช้จ่ายที่เกิดทุกเดือน — เงินเดือน ค่าเช่า ค่าอินเทอร์เน็ต
 *
 * `?employee=` มาจากปุ่มบนหน้าคนงาน — ฟอร์มเปิดมาพร้อมชื่อและยอดของคนนั้น
 * เพื่อไม่ให้เจ้าของต้องพิมพ์ซ้ำสิ่งที่ระบบรู้อยู่แล้ว
 */
export default async function RecurringPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const [me, sp] = await Promise.all([getCurrentUser(), searchParams])
  // ซ่อนเมนูอย่างเดียวไม่พอ — คนพิมพ์ URL ตรงได้ ต้องกันที่หน้าเองด้วย
  if (me.role !== 'owner') redirect('/settings')

  const sb = await getSupabaseServer()
  const today = todayInBangkok()

  const [rules, status, categories, sites, staff] = await Promise.all([
    sb
      .from('recurring_expenses')
      .select(
        'id, name, amount, category_id, site_id, employee_id, day_of_month, start_month, end_month, pay_method, is_active, categories(name), sites(name), employees(full_name)',
      )
      .order('is_active', { ascending: false })
      .order('name', { ascending: true })
      .range(0, PAGE_SIZE * 2 - 1),
    sb.rpc('recurring_status', { p_through: today }).range(0, PAGE_SIZE * 2 - 1),
    sb
      .from('categories')
      .select('id, name')
      .eq('kind', 'expense')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .range(0, PAGE_SIZE * 4 - 1),
    sb
      .from('sites')
      .select('id, name')
      .in('status', ['planning', 'active', 'paused'])
      .order('name', { ascending: true })
      .range(0, PAGE_SIZE - 1),
    // 🔴 เฉพาะคนรายเดือน — คนรายวันมีค่าแรงจากการลงชื่อเข้าโครงการอยู่แล้ว
    // ตั้งกฎให้เขาด้วยจะทำให้ต้นทุนเป็นสองเท่า (ฐานข้อมูลก็กันไว้อีกชั้น)
    sb
      .from('employees')
      .select('id, full_name, default_site_id, employee_wages!inner(wage_type, monthly_salary)')
      .eq('is_active', true)
      .eq('employee_wages.wage_type', 'monthly')
      .order('full_name', { ascending: true })
      .range(0, PAGE_SIZE - 1),
  ])

  const loadError = rules.error ?? status.error ?? categories.error ?? sites.error ?? staff.error
  if (loadError) {
    console.error('[recurring] โหลดข้อมูลไม่ได้', loadError.message)
    return <DataError message="โหลดค่าใช้จ่ายรายเดือนไม่สำเร็จ" />
  }

  const statusOf = new Map((status.data ?? []).map((s) => [s.id, s]))

  return (
    <RecurringClient
      today={today}
      preselectEmployee={sp.employee ?? null}
      rules={(rules.data ?? []).map((r) => {
        const st = statusOf.get(r.id)
        return {
          id: r.id,
          name: r.name,
          amount: Number(r.amount),
          category_id: r.category_id,
          category_name: r.categories?.name ?? null,
          site_id: r.site_id,
          site_name: r.sites?.name ?? null,
          employee_name: r.employees?.full_name ?? null,
          day_of_month: r.day_of_month,
          start_month: r.start_month,
          end_month: r.end_month,
          pay_method: r.pay_method,
          is_active: r.is_active,
          posted_months: Number(st?.posted_months ?? 0),
          posted_total: Number(st?.posted_total ?? 0),
          due_months: Number(st?.due_months ?? 0),
        }
      })}
      categories={categories.data ?? []}
      sites={sites.data ?? []}
      staff={(staff.data ?? []).map((e) => ({
        id: e.id,
        full_name: e.full_name,
        default_site_id: e.default_site_id,
        monthly_salary:
          e.employee_wages?.monthly_salary === null ||
          e.employee_wages?.monthly_salary === undefined
            ? null
            : Number(e.employee_wages.monthly_salary),
      }))}
    />
  )
}
