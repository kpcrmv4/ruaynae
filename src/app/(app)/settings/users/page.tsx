import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { UsersClient } from './users-client'
import { EmployeesClient } from './employees-client'

export const metadata = { title: 'ผู้ใช้ระบบและคนงาน' }

/**
 * สองแท็บ หน้าเดียว (CLAUDE.md §12)
 *
 * 🔴 แท็บอยู่ใน URL ไม่ใช่ใน state — แชร์ลิงก์ได้ กดปุ่มย้อนกลับได้
 * และหลังบันทึกแล้ว `router.refresh()` จะกลับมาที่แท็บเดิม ไม่ใช่เด้งกลับแท็บแรก
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
        .select('id, full_name, job_title, wage_type, daily_rate, monthly_salary, default_site_id, is_active, profile_id')
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

  const TABS = [
    { key: 'users', label: 'ผู้ใช้ระบบ', href: '/settings/users', count: profiles?.length ?? 0 },
    { key: 'workers', label: 'คนงาน', href: '/settings/users?tab=workers', count: employees?.length ?? 0 },
  ] as const

  return (
    <div className="space-y-4">
      <nav data-tabs="users" className="flex gap-1.5">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`rounded-sm border px-3 py-1.5 text-sm font-medium transition-colors duration-100 ${
              tab === t.key
                ? 'border-ink bg-ink text-canvas'
                : 'border-line-strong bg-surface text-ink-2 hover:border-ink-2 hover:text-ink'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs tnum opacity-70">{t.count}</span>
          </Link>
        ))}
      </nav>

      {tab === 'users' ? (
        <UsersClient meId={me.id} users={profiles ?? []} />
      ) : (
        <EmployeesClient
          employees={employees ?? []}
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
