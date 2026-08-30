import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Next.js 16 เปลี่ยนชื่อ middleware.ts เป็น proxy.ts และ export ชื่อ `proxy`
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  /**
   * 🔴 sw.js กับ manifest.webmanifest ต้องถูกยกเว้น
   *
   * ถ้าไม่ยกเว้น gate จะ 307 มันไปหน้า login สำหรับคนที่ยังไม่ล็อกอิน
   * สเปกห้าม service worker ถูกเสิร์ฟผ่าน redirect → register() reject →
   * เบราว์เซอร์ไม่นับว่าแอปติดตั้งได้ → beforeinstallprompt ไม่เคยยิง
   * และ push subscription ตายตามไปทั้งหมด
   *
   * อาการโหดตรงที่มัน **พังเฉพาะคนที่ยังไม่ล็อกอิน** ซึ่งคือทุกคนที่เพิ่งเข้าเว็บ
   * ส่วนตอน dev เราล็อกอินอยู่ตลอดเลยไม่มีวันเห็น · build เขียว console สะอาด
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|icons/|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)',
  ],
}
