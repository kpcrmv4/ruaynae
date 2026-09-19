import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { parseSiteFields } from '@/lib/sites'

export const runtime = 'nodejs'

/**
 * PATCH /api/sites/[id] — แก้ข้อมูลโครงการ (เจ้าของเท่านั้น)
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
  // "ไม่มีโครงการนี้" กับ "มีแต่เขียนไม่ได้" ซึ่งต้องตอบคนละรหัส
  const { data: existing, error: rErr } = await sb
    .from('sites')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (rErr) {
    console.error('[sites] อ่านโครงการก่อนแก้ไม่ได้', rErr.message)
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
    console.error('[sites] แก้โครงการไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  // 🔴 RLS ที่ปฏิเสธ update ไม่คืน error — มันโดน 0 แถวแล้วตอบว่าสำเร็จ
  // ถ้าไม่เช็คตรงนี้ หน้าจอจะขึ้น "บันทึกแล้ว" ทั้งที่ไม่มีอะไรถูกเขียน
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  // ค่างานอยู่คนละตาราง — เขียนเสมอ (ไม่ใช่เฉพาะตอน > 0) เพราะการแก้ค่างาน
  // กลับเป็น 0 คือการลบค่าที่เคยตั้งไว้ ซึ่งต้องบันทึกได้เหมือนกัน
  // หลักประกันสัญญา (R11) เขียนพร้อมกันในแถวเดียว · วันได้คืน/รายรับที่ผูกไว้
  // ไม่อยู่ในชุดนี้ — แก้ผ่านปุ่ม "ได้รับคืนแล้ว" เท่านั้น
  const { data: fin, error: fErr } = await sb
    .from('site_finance')
    .update({ contract_amount: parsed.contractAmount, ...parsed.bond })
    .eq('site_id', id)
    .select('site_id')
    .maybeSingle()
  if (fErr || !fin) {
    console.error('[sites] บันทึกค่างานไม่สำเร็จ', fErr?.message ?? 'โดน 0 แถว')
    return NextResponse.json({ error: 'CONTRACT_SAVE_FAILED' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, site: data })
}
