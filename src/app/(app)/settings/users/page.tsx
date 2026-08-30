import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { PAGE_SIZE } from '@/lib/constants'
import { UsersClient } from './users-client'

export const metadata = { title: 'ผู้ใช้ระบบ' }

export default async function UsersPage() {
  const me = await getCurrentUser()
  // ซ่อนเมนูอย่างเดียวไม่พอ — คนพิมพ์ URL ตรงได้ ต้องกันที่หน้าเองด้วย
  if (me.role !== 'owner') redirect('/settings')

  // .order() + .range() เสมอ ไม่พึ่งค่าเริ่มต้นของ PostgREST ที่ตัดที่ 1,000 แถวเงียบ ๆ
  const { data, error } = await getSupabaseAdmin()
    .from('profiles')
    .select('id, full_name, role, is_active, created_at')
    .order('role', { ascending: true })
    .order('created_at', { ascending: true })
    .range(0, PAGE_SIZE - 1)

  if (error) {
    console.error('[users] อ่านรายชื่อไม่ได้', error.message)
    return (
      <div className="rounded-lg border border-urgent-ring bg-urgent-bg p-6 text-center">
        <p className="text-sm text-urgent">โหลดรายชื่อผู้ใช้ไม่สำเร็จ</p>
        <p className="mt-1 text-xs text-urgent">ลองรีเฟรชหน้านี้อีกครั้ง</p>
      </div>
    )
  }

  return <UsersClient meId={me.id} users={data ?? []} />
}
