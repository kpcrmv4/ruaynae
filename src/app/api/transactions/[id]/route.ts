import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { todayInBangkok } from '@/lib/format'
import { canModifyTxn, parseTxnFields, MAX_NOTE } from '@/lib/transactions'
import type { Database } from '@/lib/database.types'

export const runtime = 'nodejs'

/** รหัสเหตุผลที่ guard trigger โยนออกมา — ส่งต่อให้ client อ่านเป็นภาษาคนได้ */
const GUARD_CODES = [
  'APPROVE_FORBIDDEN', 'AMOUNT_LOCKED', 'APPROVED_IMMUTABLE',
  'CATEGORY_KIND_MISMATCH', 'INCOME_FORBIDDEN', 'SITE_REQUIRED',
]
const guardCode = (msg: string) => GUARD_CODES.find((c) => msg.includes(c))

/**
 * PATCH /api/transactions/[id]
 *
 * ทำสามอย่างคนละสิทธิ์กัน:
 *  - `action: 'approve' | 'reject'` — เจ้าของเท่านั้น
 *  - แก้เนื้อรายการ — เจ้าของ (ทุกแถว) หรือคนที่คีย์เองตอนยังไม่อนุมัติ
 *    · ของที่ถูกตีกลับแล้วเจ้าตัวแก้ = ส่งใหม่ สถานะกลับเป็น `pending` ให้เอง
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  const { id } = await ctx.params
  const sb = await getSupabaseServer()

  // อ่านก่อนเพื่อแยก "ไม่มีรายการนี้" ออกจาก "มีแต่แตะไม่ได้" — update ที่โดน
  // 0 แถวตอบเหมือนกันทั้งสองกรณี ซึ่งทำให้ผู้ใช้ไล่หาปัญหาผิดทาง
  const { data: existing, error: rErr } = await sb
    .from('transactions')
    .select('id, status, kind, site_id, created_by')
    .eq('id', id)
    .maybeSingle()
  if (rErr) {
    console.error('[transactions] อ่านรายการไม่ได้', rErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const action = body.action
  const patch: Database['public']['Tables']['transactions']['Update'] = {}

  if (action === 'approve' || action === 'reject') {
    if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    if (existing.status === 'approved') {
      return NextResponse.json({ error: 'ALREADY_APPROVED' }, { status: 409 })
    }
    if (action === 'reject') {
      const reason = String(body.reason ?? '').trim().slice(0, MAX_NOTE)
      // ตีกลับโดยไม่บอกเหตุผลคือการส่งงานกลับไปโดยไม่บอกว่าต้องแก้อะไร
      // ฐานข้อมูลก็บังคับอยู่ (check constraint) แต่ตอบ 400 ดีกว่าปล่อยเป็น 500
      if (!reason) return NextResponse.json({ error: 'REASON_REQUIRED' }, { status: 400 })
      patch.status = 'rejected'
      patch.rejected_reason = reason
    } else {
      patch.status = 'approved'
      patch.rejected_reason = null
    }
  } else {
    // แก้เนื้อรายการ — ตรวจด้วยตัวเดียวกับตอนสร้าง
    // policy บังคับสิทธิ์จริงอยู่แล้ว · เช็คซ้ำที่นี่เพื่อให้ได้ 403 พร้อม
    // เหตุผล แทน update ที่โดน RLS ตัดเหลือ 0 แถวแล้วอ่านไม่ออกว่าเพราะอะไร
    if (!canModifyTxn(existing, me)) {
      return NextResponse.json({ error: 'EDIT_FORBIDDEN' }, { status: 403 })
    }
    const parsed = parseTxnFields(body, todayInBangkok())
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    Object.assign(patch, parsed.fields)
    // client_ref เป็นของ "ครั้งที่กดบันทึก" ไม่ใช่ของแถว — แก้ทีหลังไม่ต้องแตะ
    delete patch.client_ref
    // 🔴 สถานะไม่อยู่ใน patch โดยตั้งใจ · หัวหน้าไซต์ที่แก้ของที่ถูกตีกลับ
    // จะถูก guard trigger ดันกลับเป็น `pending` ให้เอง (= ส่งใหม่)
    // ฝั่งนี้จึงไม่ต้องรู้เรื่องนั้นเลย และเปลี่ยนสถานะเองไม่ได้ด้วย
  }

  const { data, error } = await sb
    .from('transactions')
    .update(patch)
    .eq('id', id)
    .select('id, status')
    .maybeSingle()

  if (error) {
    const code = guardCode(error.message ?? '')
    if (code) return NextResponse.json({ error: code }, { status: 403 })
    console.error('[transactions] แก้ไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  // 🔴 RLS ที่ปฏิเสธ update ไม่คืน error — โดน 0 แถวแล้วตอบว่าสำเร็จ
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true, transaction: data })
}

/**
 * DELETE /api/transactions/[id] — ลบรายการทิ้ง
 *
 * เจ้าของลบได้ทุกแถว · หัวหน้าไซต์ลบได้เฉพาะของตัวเองที่ยังไม่อนุมัติ
 * แถวที่ถูกลบยังอยู่ครบใน `audit_log` (ค่าเดิมทั้งแถวใน `before`)
 * ซึ่งเจ้าของเปิดดูย้อนหลังได้ที่ /audit
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  const { id } = await ctx.params
  const sb = await getSupabaseServer()

  const { data: existing, error: rErr } = await sb
    .from('transactions').select('id, status, created_by').eq('id', id).maybeSingle()
  if (rErr) {
    console.error('[transactions] อ่านรายการไม่ได้', rErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (!canModifyTxn(existing, me)) {
    return NextResponse.json({ error: 'DELETE_FORBIDDEN' }, { status: 403 })
  }

  const { data, error } = await sb
    .from('transactions').delete().eq('id', id).select('id').maybeSingle()

  if (error) {
    const code = guardCode(error.message ?? '')
    if (code) return NextResponse.json({ error: code }, { status: 403 })
    console.error('[transactions] ลบไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true })
}
