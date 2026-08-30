import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { derivePassword, hashPin, isValidPin } from '@/lib/pin'
import type { Database } from '@/lib/database.types'

export const runtime = 'nodejs'

/** PATCH /api/settings/users/[id] — แก้ชื่อ / role / เปิด-ปิด / ตั้ง PIN ใหม่ */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await ctx.params

  let fullName: string | undefined
  let role: 'owner' | 'site_supervisor' | undefined
  let isActive: boolean | undefined
  let pin: string | undefined
  try {
    const b = await req.json()
    if (typeof b?.fullName === 'string') fullName = b.fullName.trim().slice(0, 120)
    if (b?.role === 'owner' || b?.role === 'site_supervisor') role = b.role
    if (typeof b?.isActive === 'boolean') isActive = b.isActive
    if (typeof b?.pin === 'string') pin = b.pin.trim()
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data: target, error: tErr } = await admin
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', id)
    .maybeSingle()
  if (tErr) {
    console.error('[users] อ่านเป้าหมายไม่ได้', tErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!target) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  // 🔴 ปิดบัญชีตัวเอง = ล็อกตัวเองออกจากระบบถาวร ไม่มีทางกลับเข้ามาแก้
  if (id === me.id && isActive === false) {
    return NextResponse.json({ error: 'SELF_DEACTIVATE_FORBIDDEN' }, { status: 409 })
  }

  // 🔴 เจ้าของคนสุดท้ายห้ามถูกลดขั้นหรือปิด ไม่งั้นจะไม่เหลือใครสร้างผู้ใช้
  // หรืออนุมัติรายจ่ายได้เลย และไม่มีทางแก้จากในแอป
  const losingOwner =
    target.role === 'owner' && ((role && role !== 'owner') || isActive === false)
  if (losingOwner) {
    const { count, error: cErr } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'owner')
      .eq('is_active', true)
    if (cErr) {
      console.error('[users] นับเจ้าของไม่ได้', cErr.message)
      return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
    }
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: 'LAST_OWNER_FORBIDDEN' }, { status: 409 })
    }
  }

  const patch: Database['public']['Tables']['profiles']['Update'] = {}
  if (fullName !== undefined) patch.full_name = fullName
  if (role !== undefined) patch.role = role
  if (isActive !== undefined) patch.is_active = isActive

  if (pin !== undefined) {
    if (!isValidPin(pin)) return NextResponse.json({ error: 'PIN_LENGTH' }, { status: 400 })
    const { data: dup } = await admin
      .from('profiles')
      .select('id')
      .eq('pin_hash', hashPin(pin))
      .neq('id', id)
      .maybeSingle()
    if (dup) return NextResponse.json({ error: 'PIN_TAKEN' }, { status: 409 })
    patch.pin_hash = hashPin(pin)
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'NOTHING_TO_UPDATE' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('profiles')
    .update(patch)
    .eq('id', id)
    .select('id, full_name, role, is_active')
    .maybeSingle()
  if (error || !data) {
    console.error('[users] บันทึกไม่สำเร็จ', error?.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }

  // PIN เก็บอยู่สองที่ — hash ในตาราง และรหัสผ่านของ auth.users
  // ต้องเขียนทั้งสองที่เสมอ พลาดที่เดียวจะได้ PIN ที่ระบบยอมรับแต่ล็อกอินไม่ได้
  if (pin !== undefined) {
    const { error: aErr } = await admin.auth.admin.updateUserById(id, {
      password: derivePassword(pin),
    })
    if (aErr) {
      console.error('[users] อัปเดตรหัสผ่านของบัญชี auth ไม่ได้', aErr.message)
      return NextResponse.json({ error: 'PIN_SYNC_FAILED' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, user: data })
}
