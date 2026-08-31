import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { attachSlips, parseSlips } from '@/lib/attachments'
import { canModifyTxn } from '@/lib/transactions'
import { MAX_ATTACHMENTS } from '@/lib/constants'

export const runtime = 'nodejs'

/**
 * POST /api/transactions/[id]/attachments — แนบสลิปเพิ่มเข้ารายการที่มีอยู่แล้ว
 *
 * เรียกจากปุ่ม "แนบสลิปเพิ่ม" ในกล่องแก้ไขรายการ · ไบต์ยังไม่ผ่านที่นี่
 * เบราว์เซอร์ PUT ตรงเข้า R2 เหมือนตอนสร้าง แล้วส่งแค่คีย์มาผูก
 *
 * 🔴 คนที่บังคับสิทธิ์จริงคือ policy `attachments_insert` (เจ้าของ หรือเจ้าของ
 * รายการที่ยังไม่อนุมัติ) · ที่นี่เช็คซ้ำด้วย `canModifyTxn` เพื่อ**ข้อความ**
 * เท่านั้น — insert ที่โดน RLS ตัดจะเงียบเป็น "แนบไม่สำเร็จ" ซึ่งไม่ได้บอก
 * ผู้ใช้ว่าติดเพราะอะไร
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  const { id } = await ctx.params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const parsed = parseSlips((body as Record<string, unknown>)?.attachments)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (parsed.slips.length === 0) {
    return NextResponse.json({ error: 'ATTACHMENT_INVALID' }, { status: 400 })
  }

  const sb = await getSupabaseServer()

  // อ่านก่อนเพื่อแยก "ไม่มีรายการนี้" ออกจาก "มีแต่แนบไม่ได้" — และเพื่อ
  // นับของเดิม เพราะเพดานเป็นของ **ทั้งรายการ** ไม่ใช่ของครั้งที่กดแนบ
  const { data: existing, error: rErr } = await sb
    .from('transactions')
    .select('id, status, created_by, attachments(id)')
    .eq('id', id)
    .maybeSingle()
  if (rErr) {
    console.error('[attachments] อ่านรายการไม่ได้', rErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  // policy เป็นคนบังคับจริง — เช็คตรงนี้เพื่อให้ผู้ใช้ได้เหตุผลที่อ่านรู้เรื่อง
  // แทนที่จะได้ "แนบไม่สำเร็จ" ลอย ๆ จาก insert ที่โดน RLS ตัดทิ้ง
  if (!canModifyTxn(existing, me)) {
    return NextResponse.json({ error: 'EDIT_FORBIDDEN' }, { status: 403 })
  }

  if (existing.attachments.length + parsed.slips.length > MAX_ATTACHMENTS) {
    return NextResponse.json({ error: 'TOO_MANY_ATTACHMENTS' }, { status: 400 })
  }

  const attached = await attachSlips(sb, id, parsed.slips)
  if (attached.error) {
    const status = attached.error === 'ATTACH_FAILED' ? 500 : 400
    return NextResponse.json({ error: attached.error }, { status })
  }

  return NextResponse.json({ ok: true, attachmentIds: attached.ids ?? [] }, { status: 201 })
}
