import { NextResponse, type NextRequest } from 'next/server'
import { createResponseClient } from '@/lib/auth/response-client'
import { clearFailures, clientIp, isBlocked, recordAttempt } from '@/lib/auth/rate-limit'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { derivePassword, hashPin, isValidPin } from '@/lib/pin'

export const runtime = 'nodejs'

/**
 * POST /api/auth/pin — หัวหน้าไซต์ล็อกอินด้วย PIN 6 หลัก
 *
 * หน้าล็อกอินมีแต่แป้นตัวเลข ไม่ได้ถามว่าคุณคือใคร ระบบจึงหาเจ้าของ PIN
 * จาก hash ของค่าที่กด · unique index บน pin_hash คือสิ่งที่กันไม่ให้
 * สองคนมี PIN เดียวกันแล้วกดเข้าไปเป็นบัญชีคนอื่น
 *
 * PIN 6 หลักมีแค่ล้านความเป็นไปได้ — rate limit ไม่ใช่ของแถม
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req)

  let pin = ''
  try {
    const body = await req.json()
    pin = typeof body?.pin === 'string' ? body.pin.trim() : ''
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  if (!isValidPin(pin)) return NextResponse.json({ error: 'PIN_LENGTH' }, { status: 400 })

  // ยังไม่รู้ว่าใครจนกว่าจะหาเจอ จึงนับต่อ IP กับ bucket รวม 'pin'
  if (await isBlocked(ip, 'pin', 'pin')) {
    return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 })
  }

  const admin = getSupabaseAdmin()
  const { data: profile, error: pErr } = await admin
    .from('profiles')
    .select('id, role, is_active')
    .eq('pin_hash', hashPin(pin))
    .maybeSingle()

  if (pErr) {
    console.error('[pin] อ่าน profile ไม่ได้', pErr.message)
    return NextResponse.json({ error: 'PROFILE_UNAVAILABLE' }, { status: 500 })
  }

  if (!profile) {
    await recordAttempt(ip, 'pin', 'pin', false)
    return NextResponse.json({ error: 'INVALID_PIN' }, { status: 401 })
  }
  if (!profile.is_active) {
    await recordAttempt(ip, 'pin', 'pin', false)
    return NextResponse.json({ error: 'ACCOUNT_DISABLED' }, { status: 403 })
  }

  // อีเมลสังเคราะห์เป็นรายละเอียดภายใน — อ่านจาก auth.users ไม่ให้ client รู้
  const { data: authUser, error: aErr } = await admin.auth.admin.getUserById(profile.id)
  if (aErr || !authUser.user?.email) {
    console.error('[pin] หาบัญชี auth ไม่เจอ', aErr?.message)
    return NextResponse.json({ error: 'PROFILE_UNAVAILABLE' }, { status: 500 })
  }

  const { client, applyCookies } = createResponseClient(req)
  const { error: sErr } = await client.auth.signInWithPassword({
    email: authUser.user.email,
    password: derivePassword(pin),
  })

  if (sErr) {
    // มาถึงตรงนี้แปลว่า pin_hash ตรงแต่รหัสผ่านที่ derive ไม่ตรง
    // = PIN_PEPPER เปลี่ยนไปหลังจากตั้ง PIN ครั้งล่าสุด
    console.error('[pin] hash ตรงแต่รหัสผ่านไม่ตรง — PIN_PEPPER อาจถูกเปลี่ยน', sErr.message)
    await recordAttempt(ip, 'pin', 'pin', false)
    return NextResponse.json({ error: 'INVALID_PIN' }, { status: 401 })
  }

  await recordAttempt(ip, 'pin', 'pin', true)
  await clearFailures('pin', 'pin')

  // ❗ ไม่คืนอีเมลสังเคราะห์กลับไป — คนใช้ไม่เคยพิมพ์มันและมันรับเมลไม่ได้
  return applyCookies(NextResponse.json({ ok: true, role: profile.role }))
}
