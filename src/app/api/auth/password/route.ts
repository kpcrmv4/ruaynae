import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { clearFailures, clientIp, isBlocked, recordAttempt } from '@/lib/auth/rate-limit'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/** สั้นกว่านี้ Supabase ปฏิเสธเอง แต่เราต้องปฏิเสธก่อนเพื่อให้ข้อความเป็นภาษาไทย */
const MIN_LENGTH = 8

/**
 * POST /api/auth/password — เจ้าของเปลี่ยนรหัสผ่านของตัวเอง
 *
 * 🔴 **มีเซสชันไม่ได้แปลว่ารู้รหัสผ่าน** — `updateUser({ password })` สำเร็จ
 * ด้วยเซสชันอย่างเดียว · ถ้าไม่ถามรหัสปัจจุบัน ใครก็ตามที่หยิบเครื่องที่เปิด
 * ค้างไว้ (หรือเข้ามาทางปุ่มเข้าใช้แบบเดโม่ ซึ่งไม่เคยเห็นรหัสผ่านเลย)
 * เปลี่ยนรหัสแล้วล็อกเจ้าของจริงออกจากระบบได้ทันที
 *
 * ตรวจรหัสปัจจุบันด้วยการ **ล็อกอินใหม่ผ่าน client ชั่วคราวที่ไม่เก็บเซสชัน**
 * ไม่ใช่เทียบแฮชในเบราว์เซอร์ และไม่ใช่เชื่อว่าคนที่ถือคุกกี้คือเจ้าของ
 *
 * 🔴 rate-limit ด้วยตารางเดียวกับหน้าล็อกอิน — ถ้าไม่จำกัด ฟอร์มนี้จะกลายเป็น
 * เครื่องมือเดารหัสผ่านที่ไม่มีการนับครั้งผิด ทั้งที่หน้าล็อกอินมีอยู่แล้ว
 */
export async function POST(req: NextRequest) {
  const me = await getCurrentUser().catch(() => null)
  if (!me) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  // บัญชีที่ล็อกอินด้วย PIN ไม่มีรหัสผ่านให้เปลี่ยน — เจ้าของเป็นคนตั้ง PIN ให้ใหม่
  if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  let currentPassword = ''
  let newPassword = ''
  try {
    const body = await req.json()
    currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : ''
    newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  if (!currentPassword) {
    return NextResponse.json({ error: 'CURRENT_PASSWORD_REQUIRED' }, { status: 400 })
  }
  if (newPassword.length < MIN_LENGTH) {
    return NextResponse.json({ error: 'PASSWORD_TOO_SHORT' }, { status: 400 })
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: 'PASSWORD_UNCHANGED' }, { status: 400 })
  }

  const sb = await getSupabaseServer()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  const email = userData?.user?.email ?? ''
  if (userErr || !email) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const ip = clientIp(req)
  if (await isBlocked(ip, email, 'password')) {
    return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 })
  }

  // client ชั่วคราว — ห้ามใช้ตัวที่ผูกกับคุกกี้ ไม่งั้นการล็อกอินตรงนี้
  // จะไปเขียนทับเซสชันของคำขอนี้เอง
  const probe = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { error: signInErr } = await probe.auth.signInWithPassword({
    email,
    password: currentPassword,
  })
  if (signInErr) {
    await recordAttempt(ip, email, 'password', false)
    return NextResponse.json({ error: 'INVALID_CREDENTIALS' }, { status: 401 })
  }

  const { error: updErr } = await sb.auth.updateUser({ password: newPassword })
  if (updErr) {
    console.error('[password] เปลี่ยนรหัสไม่สำเร็จ', updErr.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }

  await clearFailures(email, 'password')
  return NextResponse.json({ ok: true })
}
