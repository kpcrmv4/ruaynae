import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/database.types'

/**
 * client สำหรับ Server Component และ route handler ที่ "อ่านอย่างเดียว"
 *
 * ⚠️ ห้ามใช้ตัวนี้ใน route ที่ทำการ sign-in — setAll ของมันเขียนผ่าน cookies()
 * ของ next/headers ซึ่งไม่ได้แนบ Set-Cookie ลง NextResponse.json() อย่างน่าเชื่อถือ
 * ผลคือ route ตอบ 200 แต่เบราว์เซอร์ไม่เคยได้คุกกี้ session เลย
 * route ที่สร้าง session ต้องผูกคุกกี้กับ response object เอง (ดู api/auth/*)
 */
export async function getSupabaseServer() {
  const cookieStore = await cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // ถูกเรียกระหว่างเรนเดอร์ Server Component ซึ่งเขียนคุกกี้ไม่ได้
            // ไม่เป็นไร — proxy.ts รีเฟรช session ให้อยู่แล้วในทุก request
          }
        },
      },
    },
  )
}
