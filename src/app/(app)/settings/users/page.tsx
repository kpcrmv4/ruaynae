import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { UsersClient } from './users-client'
import { EmployeesClient } from './employees-client'

const isWorkers = (tab?: string) => tab === 'workers'

/** ชื่อบนแท็บเบราว์เซอร์ต้องบอกว่ากำลังดูรายการไหน ไม่ใช่ชื่อรวมของทั้งสองอย่าง */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  return { title: isWorkers((await searchParams).tab) ? 'คนงาน' : 'ผู้ใช้ระบบ' }
}

/**
 * สองรายการ หนึ่งเส้นทาง — เข้าจากปุ่มคนละปุ่มบนหน้าตั้งค่า
 *
 * เดิมมีแถบแท็บอยู่บนหัวหน้านี้ · เจ้าของขอให้ย้ายคนงานออกไปเป็นปุ่มของตัวเอง
 * บน `/settings` แถบแท็บจึงถูกเอาออก — เหลือสองที่ที่บอกเรื่องเดียวกันคือ
 * สองที่ที่วันหนึ่งจะไม่ตรงกัน · ทางลัดข้ามไปมายังอยู่ในคำอธิบายใต้หัวเรื่อง
 *
 * 🔴 `?tab=workers` ยังใช้ได้เหมือนเดิม — ลิงก์ที่แชร์กันไว้แล้วต้องไม่ตาย
 * และ `router.refresh()` หลังบันทึกต้องกลับมาที่รายการเดิม ไม่ใช่เด้งไปรายการแรก
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const [me, sp] = await Promise.all([getCurrentUser(), searchParams])
  // ซ่อนเมนูอย่างเดียวไม่พอ — คนพิมพ์ URL ตรงได้ ต้องกันที่หน้าเองด้วย
  if (me.role !== 'owner') redirect('/settings')

  const tab = sp.tab === 'workers' ? 'workers' : 'users'
  const sb = await getSupabaseServer()

  // .order() + .range() เสมอ ไม่พึ่งค่าเริ่มต้นของ PostgREST ที่ตัดที่ 1,000 แถวเงียบ ๆ
  const [{ data: profiles, error: pErr }, { data: employees, error: eErr }, { data: sites }] =
    await Promise.all([
      getSupabaseAdmin()
        .from('profiles')
        .select('id, full_name, role, is_active, created_at')
        .order('role', { ascending: true })
        .order('created_at', { ascending: true })
        .range(0, PAGE_SIZE - 1),
      sb
        .from('employees')
        // ค่าแรงอยู่ `employee_wages` ที่เจ้าของอ่านได้คนเดียว — หน้านี้เป็นของ
        // เจ้าของอยู่แล้ว จึง embed มาได้ · หัวหน้าไซต์เข้าหน้านี้ไม่ได้ตั้งแต่แรก
        .select('id, full_name, job_title, default_site_id, is_active, profile_id, employee_wages(wage_type, daily_rate, monthly_salary)')
        // คนที่ยังทำงานอยู่ขึ้นก่อน แล้วเรียงตามชื่อ
        .order('is_active', { ascending: false })
        .order('full_name', { ascending: true })
        .range(0, PAGE_SIZE - 1),
      sb
        .from('sites')
        .select('id, name')
        .order('name', { ascending: true })
        .range(0, PAGE_SIZE - 1),
    ])

  if (pErr || eErr) {
    console.error('[users] อ่านรายชื่อไม่ได้', pErr?.message ?? eErr?.message)
    return (
      <div className="rounded-lg border border-urgent-ring bg-urgent-bg p-6 text-center">
        <p className="text-sm text-urgent">โหลดรายชื่อไม่สำเร็จ</p>
        <p className="mt-1 text-xs text-urgent">ลองรีเฟรชหน้านี้อีกครั้ง</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {tab === 'users' ? (
        <UsersClient meId={me.id} users={profiles ?? []} />
      ) : (
        <EmployeesClient
          employees={(employees ?? []).map((e) => ({
            id: e.id,
            full_name: e.full_name,
            job_title: e.job_title,
            default_site_id: e.default_site_id,
            is_active: e.is_active,
            profile_id: e.profile_id,
            wage_type: e.employee_wages?.wage_type ?? 'daily',
            daily_rate: e.employee_wages?.daily_rate ?? null,
            monthly_salary: e.employee_wages?.monthly_salary ?? null,
          }))}
          sites={sites ?? []}
          // ผูกได้เฉพาะบัญชีที่ยังใช้งานอยู่ — ผูกกับบัญชีที่ปิดไปแล้วคือการสร้าง
          // ความสัมพันธ์ที่ไม่มีวันได้ใช้
          people={(profiles ?? []).filter((p) => p.is_active).map(
            (p) => ({ id: p.id, full_name: p.full_name }),
          )}
        />
      )}
    </div>
  )
}
