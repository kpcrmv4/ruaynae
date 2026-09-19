'use client'

import { useEffect } from 'react'

/**
 * เลื่อนไปหาแถวที่ถูกไฮไลท์ (`?focus=<id>`) หลังหน้าโหลดเสร็จ
 *
 * 🔴 ไฮไลท์อย่างเดียวไม่พอเมื่อแถวนั้นอยู่กลางลิสต์ — คนกดจากกระดิ่งจะเห็นแค่
 * ลิสต์หัวหน้าเดิมแล้วคิดว่า "ไม่มีอะไรเปลี่ยน" · ต้องพามาถึงแถวจริง ๆ
 *
 * เป็น island เปล่า ไม่มี UI — แถวยังเป็น Server Component เหมือนเดิม
 */
export function FocusScroll({ id }: { id: string }) {
  useEffect(() => {
    const el = document.getElementById(`txn-${id}`)
    if (!el) return
    // เคารพคนที่ปิดแอนิเมชันไว้ในระบบ — เลื่อนกระตุกทำให้เวียนหัวจริง ๆ
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  }, [id])

  return null
}
