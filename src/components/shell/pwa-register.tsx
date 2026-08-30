'use client'

import { useEffect } from 'react'

/**
 * ลงทะเบียน service worker และตั้งตัวเลขบนไอคอนแอป
 *
 * 🔴 ตัวเลขบนไอคอนต้องตั้งจากสองที่: ที่นี่ (ตอนเปิดแอปอยู่) และใน
 * `push` handler ของ service worker (ตอนแอปปิด) · ตั้งที่เดียวแปลว่า
 * เลขไม่ตรงในครึ่งหนึ่งของเวลาที่คนใช้จริง
 *
 * ไม่มี UI — คอมโพเนนต์นี้คืน `null` เสมอ
 */
export function PwaRegister({ unread }: { unread: number }) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    // รอให้หน้าโหลดเสร็จก่อน — ลงทะเบียนตอนกำลังโหลดจะแย่ง bandwidth
    // กับสิ่งที่ผู้ใช้กำลังรอดูอยู่
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((e) => {
        console.error('[pwa] ลงทะเบียน service worker ไม่สำเร็จ', e)
      })
    }
    if (document.readyState === 'complete') register()
    else {
      window.addEventListener('load', register)
      return () => window.removeEventListener('load', register)
    }
  }, [])

  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>
      clearAppBadge?: () => Promise<void>
    }
    if (!nav.setAppBadge) return
    // เบราว์เซอร์ที่ไม่รองรับไม่ใช่ข้อผิดพลาด — เงียบไว้ ไม่ต้องรบกวนคนใช้
    void (unread > 0 ? nav.setAppBadge(unread) : nav.clearAppBadge?.())
  }, [unread])

  return null
}
