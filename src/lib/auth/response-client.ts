import 'server-only'

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { NextRequest, NextResponse } from 'next/server'
import type { Database } from '@/lib/database.types'

type PendingCookie = { name: string; value: string; options: CookieOptions }

/**
 * client สำหรับ route ที่ "สร้างหรือทำลาย session"
 *
 * 🔴 คุกกี้ต้องไปอยู่บน **response ที่ route คืนจริง ๆ**
 * ถ้าเขียนผ่าน `cookies()` ของ next/headers มันจะไม่ได้แนบ Set-Cookie ลง
 * `NextResponse.json()` อย่างน่าเชื่อถือ — ผลคือ route ตอบ 200 ทุกอย่างดูสำเร็จ
 * แต่เบราว์เซอร์ไม่เคยได้คุกกี้ แล้วหน้าถัดไปเด้งกลับ /login แบบหาสาเหตุไม่เจอ
 *
 * แบบเก็บไว้ก่อนแล้วค่อยแปะ (ไม่ผูกกับ response ตั้งแต่แรก) เพราะ route ส่วนใหญ่
 * ยังไม่รู้ตอนเริ่มว่าจะตอบ 200 หรือ 401 — และ body ของ NextResponse
 * แก้ทีหลังไม่ได้ ถ้าผูกไว้ตั้งแต่แรกจะต้องก๊อป header ข้ามไปมาซึ่งพลาดง่าย
 *
 *   const { client, applyCookies } = createResponseClient(req)
 *   const { error } = await client.auth.signInWithPassword(...)
 *   if (error) return NextResponse.json({ error: 'X' }, { status: 401 })  // ไม่แปะคุกกี้
 *   return applyCookies(NextResponse.json({ ok: true }))                  // แปะ
 */
export function createResponseClient(req: NextRequest) {
  const pending: PendingCookie[] = []

  const client = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          pending.push(...(cookiesToSet as PendingCookie[]))
        },
      },
    },
  )

  /** แปะคุกกี้ทั้งหมดที่ Supabase สั่งไว้ ลงบน response ที่จะคืนจริง */
  const applyCookies = <T extends NextResponse>(res: T): T => {
    for (const { name, value, options } of pending) res.cookies.set(name, value, options)
    return res
  }

  return { client, applyCookies, pendingCount: () => pending.length }
}
