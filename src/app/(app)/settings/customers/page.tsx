import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { DataError } from '@/components/ui/data-error'
import { CustomersClient } from './customers-client'

export const metadata = { title: 'ทะเบียนลูกค้า' }

/**
 * ทะเบียนลูกค้า — ที่อยู่/เลขผู้เสียภาษีที่ฟอร์มเอกสารดึงไปเติมให้
 *
 * 🔴 แก้ตรงนี้ **ไม่ย้อนไปแก้ใบที่ออกไปแล้ว** — เอกสารถ่ายสำเนาชื่อและที่อยู่
 * ลงในแถวของตัวเองตั้งแต่ตอนสร้าง (เหตุผลเดียวกับ `wage_snapshot`)
 * ที่นี่จึงเป็นทะเบียนสำหรับ**ใบถัดไป** ไม่ใช่ฐานข้อมูลกลางที่ใบเก่าอ้างอิงอยู่
 */
export default async function CustomersSettingsPage() {
  const me = await getCurrentUser()
  // ซ่อนเมนูอย่างเดียวไม่พอ — คนพิมพ์ URL ตรงได้ ต้องกันที่หน้าเองด้วย
  if (me.role !== 'owner') redirect('/settings')

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('customers')
    .select('id, name, tax_id, branch, address, phone, email')
    .order('name', { ascending: true })
    .range(0, PAGE_SIZE * 4 - 1)

  if (error) {
    console.error('[settings/customers] อ่านทะเบียนลูกค้าไม่ได้', error.message)
    return <DataError message="โหลดทะเบียนลูกค้าไม่สำเร็จ" />
  }

  return <CustomersClient rows={data ?? []} />
}
