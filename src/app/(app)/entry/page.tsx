import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { todayInBangkok } from '@/lib/format'
import { EntryForm } from './entry-form'

export const metadata = { title: 'บันทึกรายรับ-รายจ่าย' }

export default async function EntryPage() {
  const me = await getCurrentUser()
  const sb = await getSupabaseServer()

  // 🔴 รายชื่อไซต์มาจาก RLS ไม่ใช่จาก where ที่เขียนเอง — หัวหน้าไซต์จึงเห็น
  // เฉพาะไซต์ที่ดูแล **ณ วันนี้** โดยอัตโนมัติ · คนที่เพิ่งถูกย้ายออกจะไม่เห็น
  // ไซต์เดิมในกล่องเลือกทันที โดยไม่ต้องมีโค้ดตรงนี้รู้เรื่องนั้นเลย
  const [{ data: sites, error: sErr }, { data: categories, error: cErr }] = await Promise.all([
    sb
      .from('sites')
      .select('id, name')
      .in('status', ['planning', 'active', 'paused'])
      .order('name', { ascending: true })
      .range(0, PAGE_SIZE - 1),
    sb
      .from('categories')
      .select('id, name, kind')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .range(0, PAGE_SIZE * 4 - 1),
  ])

  if (sErr || cErr) {
    console.error('[entry] โหลดตัวเลือกไม่ได้', sErr?.message ?? cErr?.message)
    return (
      <div className="rounded-lg border border-urgent-ring bg-urgent-bg p-6 text-center">
        <p className="text-sm text-urgent">โหลดหน้าบันทึกไม่สำเร็จ</p>
        <p className="mt-1 text-xs text-urgent">ลองรีเฟรชหน้านี้อีกครั้ง</p>
      </div>
    )
  }

  return (
    <EntryForm
      role={me.role}
      today={todayInBangkok()}
      sites={sites ?? []}
      categories={categories ?? []}
    />
  )
}
