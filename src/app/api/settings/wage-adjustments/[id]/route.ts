import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isAdjustKind, MAX_ADJUST_AMOUNT, MAX_ADJUST_NAME } from '@/lib/wage-adjustments'
import type { Database } from '@/lib/database.types'

export const runtime = 'nodejs'

const UNIQUE_VIOLATION = '23505'

/**
 * PATCH /api/settings/wage-adjustments/[id] — แก้ชื่อ · ชนิด · ยอดเริ่มต้น · ลำดับ · เปิด-ปิด
 *
 * 🔴 ไม่มี DELETE โดยตั้งใจ — บรรทัดที่ผูกกับการลงชื่อถ่ายสำเนาชื่อไว้แล้ว
 * (`attendance_adjustments.name`) ลบ preset จึงไม่ทำประวัติพัง แต่ปุ่มปิดก็เพียงพอ
 * และปลอดภัยกว่า: รายการที่ปิดหายจากกล่องเลือก ส่วนของเก่ายังอ่านได้ครบ
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  const sb = await getSupabaseServer()

  const { data: existing, error: rErr } = await sb
    .from('wage_adjustment_presets').select('id').eq('id', id).maybeSingle()
  if (rErr) {
    console.error('[wage-adjustments] อ่านรายการไม่ได้', rErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const patch: Database['public']['Tables']['wage_adjustment_presets']['Update'] = {}
  try {
    const b = await req.json()
    if (typeof b?.name === 'string') {
      const name = b.name.trim().slice(0, MAX_ADJUST_NAME)
      if (!name) return NextResponse.json({ error: 'NAME_REQUIRED' }, { status: 400 })
      patch.name = name
    }
    if (b?.kind !== undefined) {
      if (!isAdjustKind(b.kind)) return NextResponse.json({ error: 'KIND_INVALID' }, { status: 400 })
      patch.kind = b.kind
    }
    if (b?.amount !== undefined && b?.amount !== null && b?.amount !== '') {
      const n = Number(b.amount)
      if (!Number.isFinite(n) || n < 0 || n > MAX_ADJUST_AMOUNT) {
        return NextResponse.json({ error: 'AMOUNT_INVALID' }, { status: 400 })
      }
      patch.amount = Math.round(n * 100) / 100
    }
    if (typeof b?.isActive === 'boolean') patch.is_active = b.isActive
    if (b?.sortOrder !== undefined && b?.sortOrder !== null && b?.sortOrder !== '') {
      const n = Number(b.sortOrder)
      if (!Number.isInteger(n) || n < 1 || n > 999) {
        return NextResponse.json({ error: 'SORT_ORDER_INVALID' }, { status: 400 })
      }
      patch.sort_order = n
    }
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'NOTHING_TO_UPDATE' }, { status: 400 })
  }

  const { data, error } = await sb
    .from('wage_adjustment_presets')
    .update(patch)
    .eq('id', id)
    .select('id, name, kind, amount, sort_order, is_active')
    .maybeSingle()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return NextResponse.json({ error: 'NAME_TAKEN' }, { status: 409 })
    }
    console.error('[wage-adjustments] แก้รายการไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true, preset: data })
}
