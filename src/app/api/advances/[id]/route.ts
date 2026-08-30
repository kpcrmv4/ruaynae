import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * DELETE /api/advances/[id] — ลบใบเบิกที่ยังไม่ถูกหักในรอบไหน
 *
 * ใบที่ถูกหักในรอบที่ปิดแล้วลบไม่ได้ — เงินจ่ายออกไปแล้ว ลบทิ้งคือการ
 * ทำให้ยอดที่จ่ายจริงกับยอดที่ระบบคำนวณไม่ตรงกันตลอดไป
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await ctx.params
  const sb = await getSupabaseServer()

  const { data: existing, error: rErr } = await sb
    .from('advances').select('id, payroll_run_id').eq('id', id).maybeSingle()
  if (rErr) {
    console.error('[advances] อ่านใบเบิกไม่ได้', rErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (existing.payroll_run_id) {
    return NextResponse.json({ error: 'PAYROLL_CLOSED' }, { status: 409 })
  }

  const { data, error } = await sb
    .from('advances').delete().eq('id', id).select('id').maybeSingle()

  if (error) {
    console.error('[advances] ลบไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true })
}
