import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isTxnKind, MAX_NAME_CATEGORY } from '@/lib/categories'

export const runtime = 'nodejs'

const UNIQUE_VIOLATION = '23505'

/** POST /api/settings/categories — เพิ่มหมวด (เจ้าของเท่านั้น) */
export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  let name = ''
  let kind: unknown = null
  let sortOrder: unknown = null
  try {
    const b = await req.json()
    name = String(b?.name ?? '').trim().slice(0, MAX_NAME_CATEGORY)
    kind = b?.kind
    sortOrder = b?.sortOrder ?? b?.sort_order
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  if (!name) return NextResponse.json({ error: 'NAME_REQUIRED' }, { status: 400 })
  if (!isTxnKind(kind)) return NextResponse.json({ error: 'KIND_INVALID' }, { status: 400 })

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
    .from('categories')
    .insert({ name, kind, sort_order: order })
    .select('id, name, kind, sort_order')
    .maybeSingle()

  if (error) {
    // ชื่อซ้ำในชนิดเดียวกัน — สองหมวดชื่อเหมือนกันทำให้รายงานอ่านไม่รู้เรื่อง
    if (error.code === UNIQUE_VIOLATION) {
      return NextResponse.json({ error: 'NAME_TAKEN' }, { status: 409 })
    }
    console.error('[categories] เพิ่มหมวดไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true, category: data }, { status: 201 })
}
