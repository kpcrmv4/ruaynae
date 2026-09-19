import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isAdjustKind, MAX_ADJUST_AMOUNT, MAX_ADJUST_NAME } from '@/lib/wage-adjustments'

export const runtime = 'nodejs'

const UNIQUE_VIOLATION = '23505'

/** POST /api/settings/wage-adjustments — เพิ่มรายการปรับค่าแรงสำเร็จรูป (เจ้าของเท่านั้น) */
export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  let name = ''
  let kind: unknown = null
  let amount = 0
  let sortOrder: unknown = null
  try {
    const b = await req.json()
    name = String(b?.name ?? '').trim().slice(0, MAX_ADJUST_NAME)
    kind = b?.kind
    amount = Number(b?.amount ?? 0)
    sortOrder = b?.sortOrder ?? b?.sort_order
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  if (!name) return NextResponse.json({ error: 'NAME_REQUIRED' }, { status: 400 })
  if (!isAdjustKind(kind)) return NextResponse.json({ error: 'KIND_INVALID' }, { status: 400 })
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_ADJUST_AMOUNT) {
    return NextResponse.json({ error: 'AMOUNT_INVALID' }, { status: 400 })
  }

  let order = 100
  if (sortOrder !== null && sortOrder !== undefined && sortOrder !== '') {
    const n = Number(sortOrder)
    if (!Number.isInteger(n) || n < 1 || n > 999) {
      return NextResponse.json({ error: 'SORT_ORDER_INVALID' }, { status: 400 })
    }
    order = n
  }

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('wage_adjustment_presets')
    .insert({ name, kind, amount: Math.round(amount * 100) / 100, sort_order: order })
    .select('id, name, kind, amount, sort_order, is_active')
    .maybeSingle()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return NextResponse.json({ error: 'NAME_TAKEN' }, { status: 409 })
    }
    console.error('[wage-adjustments] เพิ่มรายการไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true, preset: data }, { status: 201 })
}
