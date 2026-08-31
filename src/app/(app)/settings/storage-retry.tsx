'use client'

import { RotateCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

/**
 * ปุ่ม "ลองใหม่" ของการ์ดพื้นที่เก็บรูป
 *
 * การ์ดตัวจริงเป็น Server Component ที่ยิงไปถาม R2 ตอนเรนเดอร์ · การลองใหม่
 * จึงคือการให้เซิร์ฟเวอร์เรนเดอร์ส่วนนั้นซ้ำ ไม่ใช่การ retry ฝั่งเบราว์เซอร์
 *
 * `useTransition` มีไว้เพื่อให้ปุ่มถูก disable พร้อมสปินเนอร์ระหว่างรอจริง ๆ
 * (§15: ปุ่มที่กำลังทำงานต้องถูก disable) — `router.refresh()` เฉย ๆ จะกลับมา
 * ทันทีทั้งที่ยังโหลดไม่เสร็จ แล้วผู้ใช้จะกดรัวเพราะดูเหมือนไม่มีอะไรเกิดขึ้น
 */
export function StorageRetry() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      className="btn-secondary mx-auto"
    >
      <RotateCw className={`size-4 ${pending ? 'animate-spin' : ''}`} />
      ลองใหม่
    </button>
  )
}
