'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ErrorRetry } from '@/components/ui/error-retry'

/**
 * สถานะผิดพลาดของ **ข้อมูลก้อนหนึ่งในหน้า** ที่เซิร์ฟเวอร์อ่านไม่สำเร็จ
 * แต่ไม่ได้ throw (query คืน `error` มา แล้วหน้าเลือกจะวาดต่อ)
 *
 * ต่างจาก `(app)/error.tsx` ตรงที่ตัวนั้นรับกรณี **ทั้งหน้าพัง** ส่วนตัวนี้ให้
 * หน้าที่ยังวาดหัวเรื่องกับเมนูได้ตามปกติบอกว่าเฉพาะส่วนนี้โหลดไม่ขึ้น
 *
 * 🔴 เดิมทุกหน้าเขียนกล่องแดงที่บอกว่า "ลองรีเฟรชหน้านี้อีกครั้ง" — เป็น
 * **คำสั่งให้ผู้ใช้ไปทำเอง ไม่ใช่ปุ่ม** · CLAUDE.md §15 บังคับว่าสถานะผิดพลาด
 * ต้องมีปุ่มลองใหม่จริง ๆ · ผู้ใช้กลุ่มนี้ใช้มือถือกลางโครงการ การบอกให้ "รีเฟรช"
 * แปลว่าต้องรู้ว่าปุ่มรีเฟรชของเบราว์เซอร์อยู่ตรงไหน ซึ่งไม่ใช่ทุกคนรู้
 */
export function DataError({ message }: { message: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [spinning, setSpinning] = useState(false)

  return (
    <div data-state="error">
      <ErrorRetry
        message={message}
        retryLabel={pending || spinning ? 'กำลังลองใหม่…' : 'ลองใหม่'}
        onRetry={() => {
          setSpinning(true)
          startTransition(() => {
            router.refresh()
            setSpinning(false)
          })
        }}
      />
    </div>
  )
}
