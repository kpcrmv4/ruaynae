import { NextResponse, type NextRequest } from 'next/server'
import { createResponseClient } from '@/lib/auth/response-client'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

/**
 * POST /api/auth/demo — เข้าใช้แบบเดโม่
 *
 * 🔴 opt-in เท่านั้น: ต้องตั้ง ENABLE_DEMO_LOGIN=1 ถึงจะมีอยู่
 * ที่ต้องเป็นขั้วนี้เพราะ "ลืมตั้งค่า" ต้องได้สถานะ **ปิด** เสมอ
 * ถ้าใช้ขั้วตรงข้าม (DISABLE_DEMO_LOGIN) ทุก preview branch ทุก fork
 * ทุก env ที่กู้คืนมาใหม่ จะเปิดประตูสาธารณะเข้าแอปโดยปริยาย
 *
 * ตอบ 404 ไม่ใช่ 403 — 403 เป็นการยืนยันว่า route นี้มีอยู่จริง
 * และห้ามมีฝาแฝด NEXT_PUBLIC_ เพราะปุ่มกับ route จะ drift จากกันได้
 */
export async function POST(req: NextRequest) {
  if (process.env.ENABLE_DEMO_LOGIN !== '1') {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  const email = process.env.SEED_OWNER_EMAIL
  const password = process.env.SEED_OWNER_PASSWORD
  if (!email || !password) {
    console.error('[demo] เปิดสวิตช์ไว้แต่ไม่ได้ตั้ง SEED_OWNER_EMAIL/PASSWORD')
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  const { client, applyCookies } = createResponseClient(req)
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    console.error('[demo] บัญชีเดโม่ล็อกอินไม่ได้', error?.message)
    return NextResponse.json({ error: 'DEMO_UNAVAILABLE' }, { status: 503 })
  }

  const { data: profile, error: pErr } = await getSupabaseAdmin()
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle()
  if (pErr) console.error('[demo] อ่าน profile ไม่ได้', pErr.message)

  return applyCookies(NextResponse.json({ ok: true, role: profile?.role ?? null }))
}
