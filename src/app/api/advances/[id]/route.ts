import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { todayInBangkok } from '@/lib/format'
import { MAX_NOTE } from '@/lib/transactions'
import { advanceGuardCode, canEditAdvance, parseAdvanceFields } from '@/lib/advances'
import type { Database } from '@/lib/database.types'

export const runtime = 'nodejs'

type Update = Database['public']['Tables']['advances']['Update']

/**
 * PATCH /api/advances/[id]
 *
 * ทำสองอย่างคนละสิทธิ์กัน (โครงเดียวกับ `/api/transactions/[id]`):
 *  - `action: 'approve' | 'reject'` — **เจ้าของเท่านั้น** · ตีกลับต้องมีเหตุผล
 *  - แก้เนื้อคำขอ — เจ้าของ (ทุกแถวที่ยังไม่ถูกหัก) หรือคนที่ยื่นเองตอนยัง
 *    ไม่อนุมัติ · คำขอที่ถูกตีกลับแล้วเจ้าตัวแก้ = **ส่งใหม่** guard trigger
 *    ดันสถานะกลับเป็น `pending` ให้เอง ฝั่งนี้จึงไม่ต้องรู้เรื่องนั้นเลย
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  const { id } = await ctx.params
  const sb = await getSupabaseServer()

  // อ่านก่อนเพื่อแยก "ไม่มีใบนี้" ออกจาก "มีแต่แตะไม่ได้" — update ที่โดน
  // RLS ตัดเหลือ 0 แถวตอบเหมือนกันทั้งสองกรณี
  const { data: existing, error: rErr } = await sb
    .from('advances')
    .select('id, status, created_by, site_id, deducted_amount, payroll_run_id')
    .eq('id', id)
    .maybeSingle()
  if (rErr) {
    console.error('[advances] อ่านใบเบิกไม่ได้', rErr.message)
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
  const patch: Update = {}

  if (action === 'approve' || action === 'reject') {
    if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    // อนุมัติแล้ว = เงินออกไปแล้ว · ถอนคืนทางนี้ไม่ได้ ต้องลบใบทิ้งถ้ายังไม่ถูกหัก
    if (existing.status === 'approved') {
      return NextResponse.json({ error: 'ALREADY_APPROVED' }, { status: 409 })
    }
    if (action === 'reject') {
      const reason = String(body.reason ?? '').trim().slice(0, MAX_NOTE)
      // ตีกลับโดยไม่บอกเหตุผลคือการส่งงานกลับไปโดยไม่บอกว่าต้องแก้อะไร
      // (check constraint บังคับอยู่แล้ว · ตอบ 400 ดีกว่าปล่อยเป็น 500)
      if (!reason) return NextResponse.json({ error: 'REASON_REQUIRED' }, { status: 400 })
      patch.status = 'rejected'
      patch.rejected_reason = reason
    } else {
      patch.status = 'approved'
      patch.rejected_reason = null
    }
  } else {
    // แก้เนื้อคำขอ — เช็คซ้ำที่นี่เพื่อให้ได้ 403 พร้อมเหตุผล แทน update
    // ที่โดน RLS ตัดเหลือ 0 แถวแล้วอ่านไม่ออกว่าเพราะอะไร
    if (!canEditAdvance(existing, me)) {
      return NextResponse.json({ error: 'EDIT_FORBIDDEN' }, { status: 403 })
    }
    const parsed = parseAdvanceFields(body, todayInBangkok(), {
      requireSite: me.role !== 'owner',
    })
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    Object.assign(patch, parsed.fields)
    // 🔴 สถานะไม่อยู่ใน patch โดยตั้งใจ — ใครเปลี่ยนสถานะได้เป็นเรื่องของ
    // guard trigger ที่เดียว ไม่ใช่ของ client ที่ส่ง JSON อะไรมาก็ได้
  }

  const { data, error } = await sb
    .from('advances')
    .update(patch)
    .eq('id', id)
    .select('id, status, amount')
    .maybeSingle()

  if (error) {
    const code = advanceGuardCode(error.message ?? '')
    if (code) {
      return NextResponse.json({ error: code }, { status: code === 'PAYROLL_CLOSED' ? 409 : 403 })
    }
    console.error('[advances] แก้ไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  // 🔴 RLS ที่ปฏิเสธ update ไม่คืน error — โดน 0 แถวแล้วตอบว่าสำเร็จ
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true, advance: data })
}

/**
 * DELETE /api/advances/[id] — ลบใบเบิก/คำขอที่ยังไม่ถูกหักในรอบไหน
 *
 * เจ้าของลบได้ทุกใบที่ยังไม่ถูกหัก · หัวหน้าโครงการลบได้เฉพาะคำขอของตัวเอง
 * ที่ยังไม่อนุมัติ (รวมที่ถูกตีกลับ ซึ่งเจ้าตัวเป็นคนเดียวที่รู้ว่าจะแก้ส่งใหม่
 * หรือทิ้งไปเลย) · แถวที่ถูกลบยังอยู่ครบใน `audit_log`
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  const { id } = await ctx.params
  const sb = await getSupabaseServer()

  const { data: existing, error: rErr } = await sb
    .from('advances')
    .select('id, status, created_by, payroll_run_id, deducted_amount')
    .eq('id', id)
    .maybeSingle()
  if (rErr) {
    console.error('[advances] อ่านใบเบิกไม่ได้', rErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  // 🔴 ใบหนึ่งใบถูกหักคืน **บางส่วน** ได้ — ใบแบบนั้น `payroll_run_id` ยังว่าง
  // แต่เงินถูกหักไปแล้วบางส่วน ลบทิ้งคือการทำให้ยอดของรอบที่ปิดไปแล้วไม่มีใบ
  // รองรับ (ตัวจริงกันที่ `advances_guard_delete`)
  if (existing.payroll_run_id || Number(existing.deducted_amount ?? 0) > 0) {
    return NextResponse.json({ error: 'PAYROLL_CLOSED' }, { status: 409 })
  }
  if (!canEditAdvance(existing, me)) {
    return NextResponse.json({ error: 'EDIT_FORBIDDEN' }, { status: 403 })
  }

  const { data, error } = await sb
    .from('advances').delete().eq('id', id).select('id').maybeSingle()

  if (error) {
    if (/PAYROLL_CLOSED/.test(error.message ?? '')) {
      return NextResponse.json({ error: 'PAYROLL_CLOSED' }, { status: 409 })
    }
    console.error('[advances] ลบไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true })
}
