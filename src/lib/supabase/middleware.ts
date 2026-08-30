import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/lib/database.types'

/** เส้นทางที่เข้าได้โดยไม่ต้องล็อกอิน */
const PUBLIC_PATHS = ['/login', '/manifest.webmanifest', '/sw.js']

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // getClaims() ตรวจ JWT ในเครื่องได้เมื่อโปรเจ็คใช้กุญแจแบบ asymmetric
  // จึงไม่ต้องยิงไป Supabase ทุก request เหมือน getUser()
  // route ที่ต้องมั่นใจว่า session ยังไม่ถูกเพิกถอนค่อยเรียก getUser() เอง
  const { data } = await supabase.auth.getClaims()
  const isSignedIn = Boolean(data?.claims?.sub)

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'))

  // 🔴 ห้าม redirect /api/* ไปหน้า login เด็ดขาด
  // route พวกนี้ตรวจสิทธิ์เองและตอบ JSON · ถ้าโดน 307 ไปหน้า HTML
  // fetch จะตาม redirect ไปแล้วได้ 200 ของหน้า login กลับมา
  // ทำให้ route ล็อกอินจริงไม่เคยถูกเรียก และคุกกี้ไม่เคยถูกตั้ง
  const isApi = path.startsWith('/api')

  if (!isSignedIn && !isPublic && !isApi) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', path)
    return NextResponse.redirect(url)
  }

  // ล็อกอินแล้วแต่ยังอยู่หน้า login → ส่งกลับหน้าแรก
  // ⚠️ ถ้าวันหน้าเพิ่มสถานะพิเศษ (บัญชีถูกปิด, ต้องเปลี่ยนรหัส) ต้องยอมให้
  // หน้า login "อยู่ที่เดิม" พร้อมบอกเหตุผล ไม่งั้นจะวนกันไปมากับ gate ข้างบน
  if (isSignedIn && path === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}
