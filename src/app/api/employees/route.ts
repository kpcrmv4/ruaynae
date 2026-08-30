import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { parseEmployeeFields } from '@/lib/employees'

export const runtime = 'nodejs'

/*
 * ไม่มี GET โดยตั้งใจ — แท็บคนงานเป็น Server Component อ่านฐานข้อมูลตรงได้
 * (กฎเดียวกับ /api/settings/users)
 */

/** POST /api/employees — เพิ่มคนงาน (เจ้าของเท่านั้น) */
export async function POST(req: NextRequest) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  // RLS ก็กันอยู่แล้ว — ตอบ 403 ตรงนี้เพื่อให้ได้เหตุผล ไม่ใช่ 0 แถวเงียบ ๆ
  if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const parsed = parseEmployeeFields(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('employees')
    .insert(parsed.fields)
    .select('id')
    .maybeSingle()

  if (error) {
    if (/employees_profile_id_key/.test(error.message)) {
      return NextResponse.json({ error: 'PROFILE_TAKEN' }, { status: 409 })
    }
    console.error('[employees] เพิ่มคนงานไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  // 🔴 RLS ที่ปฏิเสธ insert ไม่คืน error เสมอไป — อ่านแถวกลับมาดูว่ามีจริง
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true, employee: data }, { status: 201 })
}
