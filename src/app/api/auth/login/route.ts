import { NextResponse, type NextRequest } from 'next/server'
import { createResponseClient } from '@/lib/auth/response-client'
import { clearFailures, clientIp, isBlocked, recordAttempt } from '@/lib/auth/rate-limit'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

/** POST /api/auth/login — เจ้าของล็อกอินด้วยอีเมล + รหัสผ่าน */
export async function POST(req: NextRequest) {
  const ip = clientIp(req)

  let email = ''
  let password = ''
  try {
    const body = await req.json()
    email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    password = typeof body?.password === 'string' ? body.password : ''
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  if (!email || !password) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })

  if (await isBlocked(ip, email, 'password')) {
    return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 })
  }

  const { client, applyCookies } = createResponseClient(req)

  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    await recordAttempt(ip, email, 'password', false)
    // ข้อความเดียวกันทุกกรณีที่ล้มเหลว — ไม่บอกว่าอีเมลนี้มีอยู่จริงหรือไม่
    return NextResponse.json({ error: 'INVALID_CREDENTIALS' }, { status: 401 })
  }

  const { data: profile, error: pErr } = await getSupabaseAdmin()
    .from('profiles')
    .select('role, is_active')
    .eq('id', data.user.id)
    .maybeSingle()

  if (pErr) {
    console.error('[login] อ่าน profile ไม่ได้', pErr.message)
    await client.auth.signOut({ scope: 'local' })
    return NextResponse.json({ error: 'PROFILE_UNAVAILABLE' }, { status: 500 })
  }

  // บัญชีถูกปิดใช้งาน → ต้องไม่แปะคุกกี้ ไม่งั้นเข้าระบบได้ทั้งที่ถูกปิด
  if (!profile?.is_active) {
    await client.auth.signOut({ scope: 'local' })
    await recordAttempt(ip, email, 'password', false)
    return NextResponse.json({ error: 'ACCOUNT_DISABLED' }, { status: 403 })
  }

  await recordAttempt(ip, email, 'password', true)
  await clearFailures(email, 'password')

  return applyCookies(NextResponse.json({ ok: true, role: profile.role }))
}
