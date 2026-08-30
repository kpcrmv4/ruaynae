import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { parseSiteFields } from '@/lib/sites'

export const runtime = 'nodejs'

/**
 * PATCH /api/sites/[id] — แก้ข้อมูลไซต์ (เจ้าของเท่านั้น)
 *
 * รับ **ทุกฟิลด์ที่แก้ได้พร้อมกัน** ไม่ใช่ทีละฟิลด์ เพราะฟอร์มแก้ไขเติมค่าเดิม
 * มาให้ครบอยู่แล้ว · ตรวจด้วย `parseSiteFields` ตัวเดียวกับ POST — เขียนกฎแยก
 * สองที่คือวิธีที่กฎหลุดไปข้างหนึ่ง (POST กันค่าติดลบ แต่ PATCH ไม่กัน)
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await ctx.params
  const sb = await getSupabaseServer()

  // เช็คว่ามีอยู่ก่อน — ไม่งั้น update ที่โดน 0 แถวจะแยกไม่ออกระหว่าง
  // "ไม่มีไซต์นี้" กับ "มีแต่เขียนไม่ได้" ซึ่งต้องตอบคนละรหัส
  const { data: existing, error: rErr } = await sb
    .from('sites')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (rErr) {
    console.error('[sites] อ่านไซต์ก่อนแก้ไม่ได้', rErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const parsed = parseSiteFields(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { data, error } = await sb
    .from('sites')
    .update(parsed.fields)
    .eq('id', id)
    .select('id, name, status')
    .maybeSingle()

  if (error) {
    console.error('[sites] แก้ไซต์ไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  // 🔴 RLS ที่ปฏิเสธ update ไม่คืน error — มันโดน 0 แถวแล้วตอบว่าสำเร็จ
  // ถ้าไม่เช็คตรงนี้ หน้าจอจะขึ้น "บันทึกแล้ว" ทั้งที่ไม่มีอะไรถูกเขียน
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true, site: data })
}
