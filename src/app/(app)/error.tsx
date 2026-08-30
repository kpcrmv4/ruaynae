'use client'

import { useEffect } from 'react'
import { ErrorRetry } from '@/components/ui/error-retry'
import { PageHeader } from '@/components/ui/page-header'

/**
 * สถานะ "ผิดพลาด + ปุ่มลองใหม่" ของทุกหน้าใต้ `(app)`
 *
 * วางไว้ที่ระดับกลุ่มเพียงไฟล์เดียว เพราะ error boundary ของ Next ครอบทุก
 * segment ลูกที่ไม่มีของตัวเอง — หน้าไหนอยากได้ข้อความเฉพาะทางค่อยเพิ่มไฟล์
 * ของตัวเองทับ
 *
 * 🔴 `error.tsx` เรนเดอร์ด้วย HTTP **200** — ตัวตรวจที่ดูแต่รหัสสถานะจะรายงาน
 * ว่าหน้านี้ปกติดี ทั้งที่ทุกคนที่เปิดเห็นการ์ดผิดพลาด · แถวตรวจรับต้องจับที่
 * **ข้อความบนหน้า** ไม่ใช่ที่ status code (ดูคอมเมนต์ใน `error-retry.tsx`)
 *
 * 🔴 ห้ามแสดง `error.message` บนหน้าจอ — ข้อความจากฝั่งเซิร์ฟเวอร์อาจมีชื่อ
 * ตาราง เงื่อนไข RLS หรือค่าที่ค้นไม่เจอติดมาด้วย · ผู้ใช้ทำอะไรกับมันไม่ได้
 * อยู่แล้ว ให้ลงคอนโซลของเบราว์เซอร์ไว้ตอนพัฒนาแทน
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.error('[app] render error', error)
    }
  }, [error])

  return (
    <div data-state="error">
      <PageHeader title="เปิดหน้านี้ไม่สำเร็จ" />
      <ErrorRetry
        onRetry={reset}
        message="โหลดข้อมูลหน้านี้ไม่สำเร็จ — อาจเป็นเพราะเน็ตหลุดชั่วคราว"
      />
    </div>
  )
}
