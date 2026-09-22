import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { bahtText } from '@/lib/baht-text'
import { MAX_CUSTOMER_NAME, hasSecondDate } from '@/lib/documents'
import { isUuid } from '@/lib/transactions'
import { isDocKindValue, parseLines, parseVatMode, parseVatRate, replaceLines } from '@/lib/doc-server'

export const runtime = 'nodejs'

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * POST /api/documents — สร้าง**ร่าง**เอกสาร (เจ้าของเท่านั้น)
 *
 * 🔴 ร่างยัง **ไม่กินเลขที่เอกสาร** — เลขออกตอนกดปุ่ม "ออกเอกสาร" เท่านั้น
 * ไม่งั้นร่างที่ถูกทิ้งจะกินเลขไปเรื่อย ๆ แล้วเลขบนกระดาษจะกระโดดเป็นช่วง ๆ
 * ซึ่งสรรพากรถามหาได้ว่าใบที่หายไปคือใบไหน
 *
 * ยอดเงินไม่รับจากหน้าจอ — ฐานข้อมูลคิดจากบรรทัดเอง
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

  if (!isDocKindValue(body.kind)) {
    return NextResponse.json({ error: 'DOC_KIND_INVALID' }, { status: 422 })
  }

  const customerName = String(body.customerName ?? '').trim().slice(0, MAX_CUSTOMER_NAME)
  if (!customerName) {
    return NextResponse.json({ error: 'DOC_CUSTOMER_REQUIRED' }, { status: 422 })
  }

  const docDate = body.docDate
  if (!isDate(docDate)) return NextResponse.json({ error: 'DATE_INVALID' }, { status: 422 })
  // ปีเกิน 2200 = กรอก พ.ศ. ลงไป · ฐานข้อมูลรับได้แต่วันเพี้ยน 543 ปี
  if (Number(docDate.slice(0, 4)) > 2200) {
    return NextResponse.json({ error: 'DATE_BUDDHIST_ERA' }, { status: 422 })
  }
  const validUntil = isDate(body.validUntil) ? body.validUntil : null
  if (validUntil && validUntil < docDate) {
    return NextResponse.json({ error: 'VALID_UNTIL_BEFORE_DATE' }, { status: 422 })
  }

  const parsed = parseLines(body.lines)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 })

  const siteId = isUuid(body.siteId) ? body.siteId : null
  const customerId = isUuid(body.customerId) ? body.customerId : null

  const sb = await getSupabaseServer()

  // โครงการที่ไม่มีอยู่จริง ต้องตอบให้ตรงว่าอะไรผิด ไม่ใช่ปล่อยให้ FK เด้งเป็น 500
  if (siteId) {
    const { data: site } = await sb.from('sites').select('id').eq('id', siteId).maybeSingle()
    if (!site) return NextResponse.json({ error: 'SITE_NOT_FOUND' }, { status: 422 })
  }

  const { data: doc, error } = await sb
    .from('documents')
    .insert({
      kind: body.kind,
      site_id: siteId,
      customer_id: customerId,
      customer_name: customerName,
      customer_tax_id: String(body.customerTaxId ?? '').trim() || null,
      customer_branch: String(body.customerBranch ?? '').trim() || null,
      customer_address: String(body.customerAddress ?? '').trim() || null,
      customer_phone: String(body.customerPhone ?? '').trim() || null,
      doc_date: docDate,
      // ใบเสนอราคา = "ยืนราคาถึง" · ใบแจ้งหนี้ = "กำหนดชำระ" · ใบเสร็จไม่มีวันที่สอง
      valid_until: hasSecondDate(body.kind) ? validUntil : null,
      vat_mode: parseVatMode(body.vatMode),
      vat_rate: parseVatRate(body.vatRate),
      note: String(body.note ?? '').trim().slice(0, 500) || null,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[documents] สร้างร่างไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  if (!doc) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const lineErr = await replaceLines(doc.id, parsed.lines)
  if (lineErr) {
    console.error('[documents] เขียนบรรทัดไม่สำเร็จ', lineErr.message)
    await sb.from('documents').delete().eq('id', doc.id)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }

  // ข้อความภาษาไทยของยอดสุทธิ — อ่านยอดที่ **ฐานข้อมูลคิดให้** ไม่ใช่ที่ฟอร์มส่งมา
  const { data: after } = await sb.from('documents').select('total').eq('id', doc.id).maybeSingle()
  await sb.from('documents')
    .update({ amount_words: bahtText(Number(after?.total ?? 0)) })
    .eq('id', doc.id)

  return NextResponse.json({ ok: true, id: doc.id }, { status: 201 })
}
