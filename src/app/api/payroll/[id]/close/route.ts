import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * POST /api/payroll/[id]/close — ปิดรอบจ่าย
 *
 * 🔴 งานทั้งหมดอยู่ใน RPC `close_payroll_run` = ทรานแซกชันเดียว
 * แยกเป็นหลายคำสั่งจากที่นี่แล้ววันหนึ่งจะปิดรอบสำเร็จแต่หักเบิกไม่สำเร็จ
 * เหลือเบิกที่ยังไม่ถูกหัก ซึ่งจะถูกหักซ้ำในรอบถัดไป
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await ctx.params
  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('close_payroll_run', { p_run: id })

  if (error) {
    const msg = error.message ?? ''
    if (/NOT_FOUND/.test(msg)) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    }
    if (/ALREADY_CLOSED/.test(msg)) {
      return NextResponse.json({ error: 'ALREADY_CLOSED' }, { status: 409 })
    }
    if (/NOTHING_TO_PAY/.test(msg)) {
      return NextResponse.json({ error: 'NOTHING_TO_PAY' }, { status: 409 })
    }
    if (/FORBIDDEN/.test(msg)) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
    console.error('[payroll] ปิดรอบไม่สำเร็จ', msg)
    return NextResponse.json({ error: 'CLOSE_FAILED' }, { status: 500 })
  }

  const row = data?.[0]
  return NextResponse.json({
    ok: true,
    lines: Number(row?.lines ?? 0),
    accrued: Number(row?.accrued ?? 0),
    deducted: Number(row?.deducted ?? 0),
    paid: Number(row?.paid ?? 0),
  })
}
