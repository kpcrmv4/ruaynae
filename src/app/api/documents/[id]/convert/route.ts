import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { bahtText } from '@/lib/baht-text'
import { todayInBangkok } from '@/lib/format'
import { CONVERT_TARGETS, hasSecondDate, isDocKind } from '@/lib/documents'
import { isUuid } from '@/lib/transactions'

export const runtime = 'nodejs'

/**
 * POST /api/documents/[id]/convert — สร้างเอกสารใบถัดไปจากใบนี้
 *
 * เส้นทางที่อนุญาต (`CONVERT_TARGETS`):
 *   ใบเสนอราคา → **ใบแจ้งหนี้** หรือ **ใบเสร็จ** · ใบแจ้งหนี้ → **ใบเสร็จ**
 * — ข้ามใบแจ้งหนี้ได้โดยตั้งใจ งานเล็กที่รับเงินสดหน้างานไม่มีใครวางบิลก่อน
 *
 * คัดลอกลูกค้า โครงการ บรรทัด และโหมดภาษีมาทั้งชุด แล้วเปิดเป็น **ร่าง**
 * ของใบใหม่ — เจ้าของแก้ยอดก่อนออกเลขได้ (เก็บเงินจริงมักไม่เท่าที่เสนอ)
 *
 * 🔴 ใบต้นทาง **ไม่ถูกเปลี่ยนสถานะ** — การวางบิลหรือออกใบเสร็จไม่ได้แปลว่า
 * ลูกค้าตอบรับข้อเสนอ · ปุ่ม "ลูกค้าตอบรับแล้ว" เป็นคนละปุ่มโดยตั้งใจ
 *
 * 🔴 กันสร้างซ้ำ **ต่อชนิดปลายทาง** ไม่ใช่ต่อใบต้นทาง — ใบเสนอราคาหนึ่งใบมี
 * ทั้งใบแจ้งหนี้และใบเสร็จของมันได้ตามปกติ สิ่งที่ห้ามคือใบเสร็จสองใบของงานเดียว
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  // ไม่ส่ง `to` มา = ยึดพฤติกรรมเดิมของปุ่มเดียว (ใบเสร็จ) ไม่ให้ของเก่าพัง
  let to: unknown = 'receipt'
  try {
    const body = await req.json().catch(() => ({}))
    if (body && body.to !== undefined) to = body.to
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  if (!isDocKind(to)) {
    return NextResponse.json({ error: 'DOC_KIND_INVALID' }, { status: 422 })
  }

  const sb = await getSupabaseServer()
  const { data: src } = await sb
    .from('documents')
    .select('id, kind, status, site_id, customer_id, customer_name, customer_tax_id, customer_branch, customer_address, customer_phone, vat_mode, vat_rate, note')
    .eq('id', id)
    .maybeSingle()
  if (!src) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  if (!CONVERT_TARGETS[src.kind].includes(to)) {
    return NextResponse.json({ error: 'CONVERT_PATH_INVALID', from: src.kind, to }, { status: 422 })
  }
  if (src.status === 'void') {
    return NextResponse.json({ error: 'DOC_ALREADY_VOID' }, { status: 409 })
  }
  if (src.status === 'draft') {
    return NextResponse.json({ error: 'DOC_NOT_ISSUED' }, { status: 409 })
  }

  const { data: existing } = await sb
    .from('documents')
    .select('id')
    .eq('source_document_id', id)
    .eq('kind', to)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'DOC_ALREADY_CONVERTED', to, id: existing.id }, { status: 409 })
  }

  const { data: lines, error: lErr } = await sb
    .from('document_lines')
    .select('seq, description, qty, unit, unit_price')
    .eq('document_id', id)
    .order('seq', { ascending: true })
    .range(0, 99)
  if (lErr) {
    console.error('[documents] อ่านบรรทัดไม่ได้', lErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!lines || lines.length === 0) {
    return NextResponse.json({ error: 'DOC_LINES_EMPTY' }, { status: 422 })
  }

  const today = todayInBangkok()
  const { data: doc, error } = await sb
    .from('documents')
    .insert({
      kind: to,
      site_id: src.site_id,
      customer_id: src.customer_id,
      customer_name: src.customer_name,
      customer_tax_id: src.customer_tax_id,
      customer_branch: src.customer_branch,
      customer_address: src.customer_address,
      customer_phone: src.customer_phone,
      doc_date: today,
      // วันที่สองของใบต้นทางเป็นคนละความหมายกับของใบใหม่ (ยืนราคา ≠ กำหนดชำระ)
      // จึงไม่คัดลอกมา — เจ้าของกรอกเองตอนแก้ร่าง
      valid_until: null,
      vat_mode: src.vat_mode,
      vat_rate: src.vat_rate,
      note: src.note,
      source_document_id: id,
    })
    .select('id')
    .maybeSingle()

  if (error || !doc) {
    console.error('[documents] สร้างเอกสารต่อเนื่องไม่สำเร็จ', error?.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }

  const { error: iErr } = await sb.from('document_lines').insert(
    lines.map((l) => ({
      document_id: doc.id,
      seq: l.seq,
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      unit_price: l.unit_price,
    })),
  )
  if (iErr) {
    console.error('[documents] คัดลอกบรรทัดไม่สำเร็จ', iErr.message)
    await sb.from('documents').delete().eq('id', doc.id)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }

  const { data: after } = await sb.from('documents').select('total').eq('id', doc.id).maybeSingle()
  await sb.from('documents')
    .update({ amount_words: bahtText(Number(after?.total ?? 0)) })
    .eq('id', doc.id)

  return NextResponse.json(
    { ok: true, id: doc.id, kind: to, status: 'draft', hasSecondDate: hasSecondDate(to) },
    { status: 201 },
  )
}
