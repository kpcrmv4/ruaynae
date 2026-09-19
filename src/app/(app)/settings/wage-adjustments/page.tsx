import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { DataError } from '@/components/ui/data-error'
import { WageAdjustmentsClient } from './wage-adjustments-client'

export const metadata = { title: 'รายการปรับค่าแรง' }

/**
 * รายการปรับค่าแรงสำเร็จรูป — OT · เบี้ยเลี้ยง · มาสาย
 *
 * ตั้งไว้ครั้งเดียว แล้วกล่อง "ปรับค่าแรง" ในหน้าคนเข้าโครงการดึงไปแสดงพร้อม
 * ยอดเริ่มต้น เจ้าของแก้ยอดเป็นครั้ง ๆ ได้ หรือพิมพ์รายการเองก็ได้
 */
export default async function WageAdjustmentsPage() {
  const me = await getCurrentUser()
  // ซ่อนเมนูอย่างเดียวไม่พอ — คนพิมพ์ URL ตรงได้ ต้องกันที่หน้าเองด้วย
  if (me.role !== 'owner') redirect('/settings')

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('wage_adjustment_presets')
    .select('id, name, kind, amount, sort_order, is_active')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .range(0, PAGE_SIZE - 1)

  if (error) {
    console.error('[wage-adjustments] อ่านรายการไม่ได้', error.message)
    return <DataError message="โหลดรายการปรับค่าแรงไม่สำเร็จ" />
  }

  return (
    <WageAdjustmentsClient
      presets={(data ?? []).map((p) => ({ ...p, amount: Number(p.amount) }))}
    />
  )
}
