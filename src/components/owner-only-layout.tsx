import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'

/**
 * ประตูสำหรับหน้าที่เฉพาะเจ้าของเข้าได้ — **ต้องอยู่ใน `layout.tsx` ไม่ใช่ใน page**
 *
 * 🔴 เหตุผลที่ต้องอยู่ใน layout: segment ที่มี `loading.tsx` จะถูกห่อด้วย
 * Suspense แล้วคำตอบกลายเป็นสตรีมที่ **ตอบ 200 ไปแล้ว** ก่อนที่ page จะได้ทำงาน
 * · `redirect()` ที่อยู่ใน page จึงเปลี่ยนเป็นการเด้งฝั่ง client แทน
 * และหัวข้อความจริง ๆ ที่ยิงออกไปคือ `200 OK` (วัดแล้ว: 4 หน้าเปลี่ยนจาก
 * เด้งจริงเป็น 200 ทันทีที่ใส่ loading.tsx เข้าไป)
 *
 * layout เรนเดอร์ **นอก** Suspense ของ page — เด้งจาก layout จึงยังเป็นการเด้ง
 * จริงตั้งแต่ฝั่งเซิร์ฟเวอร์ · ได้ทั้งโครงร่างตอนโหลดและรหัสสถานะที่ถูกต้อง
 *
 * นี่ไม่ใช่การควบคุมสิทธิ์ — สิทธิ์จริงอยู่ที่ RLS และ guard trigger ·
 * ตรงนี้แค่ไม่พาคนไปยืนอยู่หน้าที่เขาทำอะไรไม่ได้
 */
export async function OwnerOnly({ children, to = '/' }: { children: ReactNode; to?: string }) {
  const me = await getCurrentUser()
  if (me.role !== 'owner') redirect(to)
  return <>{children}</>
}
