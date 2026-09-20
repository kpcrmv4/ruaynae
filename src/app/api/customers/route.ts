import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { MAX_CUSTOMER_NAME } from '@/lib/documents'

export const runtime = 'nodejs'

const UNIQUE_VIOLATION = '23505'

/**
 * POST /api/customers — เพิ่มลูกค้าเข้าทะเบียน
 *
 * มาจากชีต "ลูกค้า" ในไฟล์ของเจ้าของ ซึ่งใช้ VLOOKUP เติมที่อยู่ให้ตอนออกเอกสาร
 * — ที่อยู่เทศบาลยาวสามบรรทัด พิมพ์ใหม่ทุกใบคือที่ที่พิมพ์ผิดได้ทุกใบ
 */
export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const name = String(body.name ?? '').trim().slice(0, MAX_CUSTOMER_NAME)
  if (!name) return NextResponse.json({ error: 'NAME_REQUIRED' }, { status: 422 })

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('customers')
    .insert({
      name,
      tax_id: String(body.taxId ?? '').trim() || null,
      branch: String(body.branch ?? '').trim().slice(0, 40) || null,
      address: String(body.address ?? '').trim().slice(0, 300) || null,
      phone: String(body.phone ?? '').trim().slice(0, 40) || null,
      email: String(body.email ?? '').trim().slice(0, 120) || null,
    })
    .select('id, name')
    .maybeSingle()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      // ชื่อซ้ำ = คนละคนหรือคนเดิม? ให้หน้าจอเสนอ "ใช้รายเดิม" แทนการสร้างซ้อน
      const { data: existing } = await sb
        .from('customers').select('id, name').ilike('name', name).maybeSingle()
      return NextResponse.json(
        { error: 'CUSTOMER_DUPLICATE', id: existing?.id ?? null },
        { status: 409 },
      )
    }
    console.error('[customers] เพิ่มลูกค้าไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true, customer: data }, { status: 201 })
}
