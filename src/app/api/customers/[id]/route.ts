import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { MAX_CUSTOMER_NAME } from '@/lib/documents'
import { isUuid } from '@/lib/transactions'
import type { Database } from '@/lib/database.types'

export const runtime = 'nodejs'

/** PATCH /api/customers/[id] — แก้ข้อมูลลูกค้าในทะเบียน */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const patch: Database['public']['Tables']['customers']['Update'] = {}
  if (body.name !== undefined) {
    const name = String(body.name ?? '').trim().slice(0, MAX_CUSTOMER_NAME)
    if (!name) return NextResponse.json({ error: 'NAME_REQUIRED' }, { status: 422 })
    patch.name = name
  }
  // ช่องที่ไม่ได้ส่งมา ต้องไม่ถูกแตะ
  for (const [key, col] of [
    ['taxId', 'tax_id'], ['branch', 'branch'], ['address', 'address'],
    ['phone', 'phone'], ['email', 'email'],
  ] as const) {
    if (body[key] !== undefined) patch[col] = String(body[key] ?? '').trim() || null
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('customers').update(patch).eq('id', id).select('id').maybeSingle()
  if (error) {
    console.error('[customers] แก้ไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({ ok: true })
}

/**
 * DELETE /api/customers/[id] — ลบออกจากทะเบียน
 *
 * 🔴 เอกสารที่เคยออกให้ลูกค้ารายนี้ **ไม่หายและไม่เปลี่ยน** — ชื่อกับที่อยู่
 * ถูกถ่ายสำเนาลงในแถวเอกสารตั้งแต่ตอนออก (`on delete set null` แค่ตัดลิงก์)
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('customers').delete().eq('id', id).select('id').maybeSingle()
  if (error) {
    console.error('[customers] ลบไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
