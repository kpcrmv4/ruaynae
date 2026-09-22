import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { bahtText } from '@/lib/baht-text'
import { MAX_CUSTOMER_NAME, hasSecondDate, isEditable } from '@/lib/documents'
import { isUuid } from '@/lib/transactions'
import { parseLines, parseVatMode, parseVatRate, replaceLines } from '@/lib/doc-server'
import type { Database } from '@/lib/database.types'

export const runtime = 'nodejs'

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * PATCH /api/documents/[id] — แก้เอกสารที่ยังไม่ได้ส่งให้ลูกค้า
 *
 * 🔴 แก้ได้จนกว่าจะทำเครื่องหมายว่า **ส่งแล้ว** (คำสั่งเจ้าของ 20 ก.ย. 2569)
 * ไม่ใช่ล็อกตั้งแต่ออกเลข — เพราะสิ่งที่ล็อกจริง ๆ คือ "ลูกค้าถือกระดาษอีกใบอยู่"
 * · เลขที่เอกสารไม่เปลี่ยนตามการแก้ · ฐานข้อมูลกันซ้ำอีกชั้นด้วย `guard_document`
 */
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

  const sb = await getSupabaseServer()
  const { data: doc, error: rErr } = await sb
    .from('documents').select('id, kind, status, txn_id').eq('id', id).maybeSingle()
  if (rErr) {
    console.error('[documents] อ่านเอกสารไม่ได้', rErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!doc) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (!isEditable(doc.status, doc.txn_id)) {
    return NextResponse.json({ error: 'DOC_LOCKED' }, { status: 409 })
  }

  const patch: Database['public']['Tables']['documents']['Update'] = {}

  // 🔴 ช่องที่ไม่ได้ส่งมา ต้อง **ไม่ถูกแตะ** — ค่าเริ่มต้นที่กลายเป็น 0/null
  // คือการลบข้อมูลที่หน้าจออื่นเป็นเจ้าของ โดยที่คนกดไม่รู้ตัว
  if (body.customerName !== undefined) {
    const name = String(body.customerName ?? '').trim().slice(0, MAX_CUSTOMER_NAME)
    if (!name) return NextResponse.json({ error: 'DOC_CUSTOMER_REQUIRED' }, { status: 422 })
    patch.customer_name = name
  }
  for (const [key, col] of [
    ['customerTaxId', 'customer_tax_id'], ['customerBranch', 'customer_branch'],
    ['customerAddress', 'customer_address'], ['customerPhone', 'customer_phone'],
  ] as const) {
    if (body[key] !== undefined) patch[col] = String(body[key] ?? '').trim() || null
  }
  if (body.customerId !== undefined) patch.customer_id = isUuid(body.customerId) ? body.customerId : null
  if (body.siteId !== undefined) patch.site_id = isUuid(body.siteId) ? body.siteId : null
  if (body.note !== undefined) patch.note = String(body.note ?? '').trim().slice(0, 500) || null
  if (body.vatMode !== undefined) patch.vat_mode = parseVatMode(body.vatMode)
  if (body.vatRate !== undefined) patch.vat_rate = parseVatRate(body.vatRate)

  if (body.docDate !== undefined) {
    if (!isDate(body.docDate)) return NextResponse.json({ error: 'DATE_INVALID' }, { status: 422 })
    if (Number(body.docDate.slice(0, 4)) > 2200) {
      return NextResponse.json({ error: 'DATE_BUDDHIST_ERA' }, { status: 422 })
    }
    patch.doc_date = body.docDate
  }
  if (body.validUntil !== undefined) {
    patch.valid_until = hasSecondDate(doc.kind) && isDate(body.validUntil) ? body.validUntil : null
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await sb.from('documents').update(patch).eq('id', id)
    if (error) {
      if (/DOC_LOCKED/.test(error.message)) {
        return NextResponse.json({ error: 'DOC_LOCKED' }, { status: 409 })
      }
      console.error('[documents] แก้ไม่สำเร็จ', error.message)
      return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
    }
  }

  if (body.lines !== undefined) {
    const parsed = parseLines(body.lines)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 })
    const lineErr = await replaceLines(id, parsed.lines)
    if (lineErr) {
      if (/DOC_LOCKED/.test(lineErr.message)) {
        return NextResponse.json({ error: 'DOC_LOCKED' }, { status: 409 })
      }
      console.error('[documents] เขียนบรรทัดไม่สำเร็จ', lineErr.message)
      return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
    }
  }

  const { data: after } = await sb
    .from('documents').select('total, subtotal, vat_amount').eq('id', id).maybeSingle()
  await sb.from('documents')
    .update({ amount_words: bahtText(Number(after?.total ?? 0)) })
    .eq('id', id)

  return NextResponse.json({
    ok: true,
    subtotal: Number(after?.subtotal ?? 0),
    vat: Number(after?.vat_amount ?? 0),
    total: Number(after?.total ?? 0),
  })
}

/** DELETE /api/documents/[id] — ลบได้เฉพาะร่าง · ใบที่ออกเลขแล้วให้ยกเลิกแทน */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const sb = await getSupabaseServer()
  const { data: doc } = await sb.from('documents').select('id, status').eq('id', id).maybeSingle()
  if (!doc) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (doc.status !== 'draft') {
    return NextResponse.json({ error: 'DOC_DELETE_ISSUED' }, { status: 409 })
  }

  const { error } = await sb.from('documents').delete().eq('id', id)
  if (error) {
    if (/DOC_DELETE_ISSUED/.test(error.message)) {
      return NextResponse.json({ error: 'DOC_DELETE_ISSUED' }, { status: 409 })
    }
    console.error('[documents] ลบไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
