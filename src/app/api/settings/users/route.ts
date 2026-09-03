import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { derivePassword, hashPin, isValidPin, syntheticEmail } from '@/lib/pin'

export const runtime = 'nodejs'

const MIN_PASSWORD = 8

/*
 * ไม่มี GET โดยตั้งใจ — หน้า /settings/users เป็น Server Component
 * อ่านฐานข้อมูลตรงได้เลย · มี GET ไว้ก็จะเป็น endpoint ที่ไม่มีใครเรียก
 * ซึ่งผิดกฎ "ทุก endpoint ต้องมีปุ่มที่เรียกมันจริง" และไม่มีใครทดสอบ
 */

/** POST /api/settings/users — สร้างผู้ใช้ระบบ (เจ้าของเท่านั้น) */
export async function POST(req: NextRequest) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  let fullName = ''
  let role: 'owner' | 'site_supervisor' = 'site_supervisor'
  let email = ''
  let password = ''
  let pin = ''
  try {
    const b = await req.json()
    fullName = String(b?.fullName ?? '').trim().slice(0, 120)
    role = b?.role === 'owner' ? 'owner' : 'site_supervisor'
    email = String(b?.email ?? '').trim().toLowerCase()
    password = String(b?.password ?? '')
    pin = String(b?.pin ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  if (!fullName) return NextResponse.json({ error: 'NAME_REQUIRED' }, { status: 400 })

  const admin = getSupabaseAdmin()

  // เจ้าของล็อกอินด้วยอีเมล · หัวหน้าโครงการล็อกอินด้วย PIN — คนละทางกันคนละเงื่อนไข
  if (role === 'owner') {
    if (!email.includes('@')) return NextResponse.json({ error: 'EMAIL_REQUIRED' }, { status: 400 })
    // ยาวกว่าขั้นต่ำของ Supabase เพราะบัญชีจริงไม่ควรใช้รหัสสั้นเท่าบัญชีทดสอบ
    if (password.length < MIN_PASSWORD) {
      return NextResponse.json({ error: 'PASSWORD_TOO_SHORT' }, { status: 400 })
    }
  } else {
    if (!isValidPin(pin)) return NextResponse.json({ error: 'PIN_LENGTH' }, { status: 400 })

    // เช็คซ้ำก่อนสร้าง auth user เพื่อไม่ให้เหลือบัญชีค้างตอน insert profile พัง
    const { data: dup, error: dErr } = await admin
      .from('profiles')
      .select('id')
      .eq('pin_hash', hashPin(pin))
      .maybeSingle()
    if (dErr) {
      console.error('[users] เช็ค PIN ซ้ำไม่ได้', dErr.message)
      return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
    }
    if (dup) return NextResponse.json({ error: 'PIN_TAKEN' }, { status: 409 })
  }

  const code = crypto.randomUUID().slice(0, 8)
  const authEmail = role === 'owner' ? email : syntheticEmail(code)
  const authPassword = role === 'owner' ? password : derivePassword(pin)

  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: authEmail,
    password: authPassword,
    email_confirm: true,
  })
  if (cErr || !created.user) {
    const msg = cErr?.message ?? ''
    if (/already been registered|already exists/i.test(msg)) {
      return NextResponse.json({ error: 'EMAIL_TAKEN' }, { status: 409 })
    }
    console.error('[users] สร้างบัญชีไม่ได้', msg)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }

  // trigger handle_new_user สร้างแถว profiles ให้แล้วเป็น site_supervisor เสมอ
  // ตรงนี้คือการเติมชื่อ/role/PIN ทับ ซึ่งทำได้เฉพาะ secret key
  const { data: profile, error: pErr } = await admin
    .from('profiles')
    .update({
      full_name: fullName,
      role,
      is_active: true,
      pin_hash: role === 'owner' ? null : hashPin(pin),
    })
    .eq('id', created.user.id)
    .select('id, full_name, role, is_active')
    .maybeSingle()

  if (pErr || !profile) {
    // ย้อนบัญชี auth ที่เพิ่งสร้าง ไม่งั้นเหลือบัญชีล็อกอินได้ที่ไม่มีตัวตนในระบบ
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
    console.error('[users] ตั้งค่า profile ไม่ได้ ย้อนบัญชีแล้ว', pErr?.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, user: profile }, { status: 201 })
}
