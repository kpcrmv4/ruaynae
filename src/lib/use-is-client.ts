'use client'

import { useSyncExternalStore } from 'react'

/**
 * เรนเดอร์ถึงเบราว์เซอร์แล้วหรือยัง — ฝั่งเซิร์ฟเวอร์ `false` ฝั่งเบราว์เซอร์ `true`
 *
 * ใช้กับส่วนที่ตอบไม่ได้จนกว่าจะรู้จักเครื่องนี้ (ธีมที่ใช้อยู่ · ติดตั้งแอปแล้วไหม
 * · ปิดคำชวนไปหรือยัง) ซึ่งถ้าเรนเดอร์ตั้งแต่ฝั่งเซิร์ฟเวอร์จะได้ hydration mismatch
 * แล้ว React ทิ้ง DOM ฝั่งเซิร์ฟเวอร์ทั้งก้อน
 *
 * 🔴 ไม่ใช้ `useState(false)` + `useEffect(() => setMounted(true), [])`
 * นั่นคือ setState ตรง ๆ ใน effect ซึ่งเรนเดอร์สองรอบทุกครั้งและ React 19
 * เตือนว่าเป็น cascading render · `useSyncExternalStore` มีช่อง
 * `getServerSnapshot` ให้ตอบค่าฝั่งเซิร์ฟเวอร์แยกอยู่แล้ว ตรงกับปัญหานี้พอดี
 */
const noopSubscribe = () => () => {}

export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  )
}
