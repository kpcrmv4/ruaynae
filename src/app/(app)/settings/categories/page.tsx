import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { CategoriesClient } from './categories-client'

export const metadata = { title: 'หมวดรายรับ-รายจ่าย' }

export default async function CategoriesPage() {
  const me = await getCurrentUser()
  // ซ่อนเมนูอย่างเดียวไม่พอ — คนพิมพ์ URL ตรงได้ ต้องกันที่หน้าเองด้วย
  if (me.role !== 'owner') redirect('/settings')

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('categories')
    .select('id, name, kind, sort_order, is_active, is_material')
    .order('kind', { ascending: true })
    .order('sort_order', { ascending: true })
    .range(0, PAGE_SIZE * 4 - 1)

  if (error) {
    console.error('[categories] อ่านหมวดไม่ได้', error.message)
    return (
      <div className="rounded-lg border border-urgent-ring bg-urgent-bg p-6 text-center">
        <p className="text-sm text-urgent">โหลดรายการหมวดไม่สำเร็จ</p>
        <p className="mt-1 text-xs text-urgent">ลองรีเฟรชหน้านี้อีกครั้ง</p>
      </div>
    )
  }

  return <CategoriesClient categories={data ?? []} />
}
