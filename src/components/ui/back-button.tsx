'use client'

import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

/**
 * ปุ่มย้อนกลับของหัวข้อหน้า (คำสั่งเจ้าของ 20 ก.ย. 2569)
 *
 * จอใหญ่เห็นไอคอน + คำว่า "ย้อนกลับ" · จอเล็กเหลือแต่ไอคอน
 * (`aria-label` ติดไว้เสมอ คนใช้โปรแกรมอ่านหน้าจอจึงได้ยินคำเต็มทั้งสองขนาด)
 *
 * 🔴 `router.back()` เฉย ๆ ไม่ปลอดภัย — คนที่เปิดลิงก์ตรงเข้าหน้านี้ หรือถูก
 * redirect มาจากหน้าล็อกอิน จะไม่มีประวัติในแอปให้ถอย กดแล้ว**หลุดออกจากเว็บ**
 * ไปหน้าก่อนหน้าของเบราว์เซอร์ ซึ่งหน้าตาเหมือนแอปพัง
 * · App Router เก็บลำดับหน้าไว้ที่ `history.state.idx` — เป็น 0 แปลว่านี่คือ
 *   หน้าแรกของแท็บนี้ ไม่มีที่ให้ถอย จึงพาไปหน้าแม่ที่ส่งมาทาง `fallbackHref` แทน
 * · เช็คตอน **กด** ไม่ใช่ตอนเรนเดอร์ จึงไม่มีปัญหา hydration ไม่ตรงกัน
 */
export function BackButton({ fallbackHref = '/' }: { fallbackHref?: string }) {
  const router = useRouter()

  return (
    <button
      type="button"
      aria-label="ย้อนกลับ"
      onClick={() => {
        const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
        if (idx > 0) router.back()
        else router.push(fallbackHref)
      }}
      className="btn-secondary shrink-0"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      <span className="hidden sm:inline">ย้อนกลับ</span>
    </button>
  )
}
