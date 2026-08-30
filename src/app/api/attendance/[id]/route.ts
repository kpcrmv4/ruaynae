import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * DELETE /api/attendance/[id] — ติ๊กออก (ลบแถวลงชื่อ)
 *
 * ลบได้จริง ไม่ใช่ทำเครื่องหมายว่ายกเลิก — การติ๊กผิดคนเป็นเรื่องปกติหน้างาน
 * และแถวที่ยกเลิกแล้วยังค้างอยู่จะทำให้คนอ่านรายงานต้องเดาว่าอันไหนนับ
 * · ประวัติการลบอยู่ใน `audit_log` ครบอยู่แล้ว (P4-DB-20)
 *
 * ⚠️ P5 จะเพิ่ม guard: ลบแถวที่ถูกปิดรอบจ่ายไปแล้วไม่ได้
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  const { id } = await ctx.params
  const sb = await getSupabaseServer()

  // อ่านก่อนเพื่อแยก "ไม่มีแถวนี้" ออกจาก "มีแต่แตะไม่ได้" — delete ที่โดน
  // 0 แถวตอบเหมือนกันทั้งสองกรณี ซึ่งทำให้ผู้ใช้ไล่หาปัญหาผิดทาง
  const { data: existing, error: rErr } = await sb
    .from('attendance').select('id').eq('id', id).maybeSingle()
  if (rErr) {
    console.error('[attendance] อ่านแถวไม่ได้', rErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const { data, error } = await sb
    .from('attendance').delete().eq('id', id).select('id').maybeSingle()

  if (error) {
    console.error('[attendance] ลบไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true })
}
