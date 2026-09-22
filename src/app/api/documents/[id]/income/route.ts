import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner, getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'

export const runtime = 'nodejs'

/**
 * POST /api/documents/[id]/income — ผูกใบเสร็จกับรายรับ
 *
 * 🔴 **กับดักข้อ 1 ของโปรเจ็คในรูปแบบใหม่** — ใบเสร็จแปลว่าเงินเข้าแล้ว
 * แต่เจ้าของอาจคีย์รายรับไว้ก่อนออกใบเสร็จ · สร้างให้อัตโนมัติเมื่อไหร่
 * รายรับของงานเดียวจะมีสองแถวทันที แล้ว "เบิกเงินสะสม" ของโครงการเบิ้ล
 * → มีสองทางให้เลือกเสมอ: **ผูกกับรายการที่มีอยู่** หรือ **สร้างใหม่**
 *
 * 🔴 ยอดที่ลงเป็นรายรับคือ **ยอดเต็มตามหน้ากระดาษ** (คำสั่งเจ้าของ 20 ก.ย. 2569)
 * ส่วนที่ราชการหัก ณ ที่จ่าย 1% เป็นภาษีจ่ายล่วงหน้าที่เอาไปเครดิตตอนยื่นสิ้นปี
 * ไม่ใช่รายรับที่หายไป — ลงยอดเงินเข้าจริงแทนจะทำให้เบิกไม่มีวันครบ 100%
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const sb = await getSupabaseServer()
  const { data: doc } = await sb
    .from('documents')
    .select('id, kind, status, site_id, total, doc_no, customer_name, txn_id')
    .eq('id', id)
    .maybeSingle()
  if (!doc) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (doc.kind !== 'receipt') {
    return NextResponse.json({ error: 'INCOME_RECEIPT_ONLY' }, { status: 422 })
  }
  if (doc.txn_id) {
    return NextResponse.json({ error: 'DOC_INCOME_LINKED', txnId: doc.txn_id }, { status: 409 })
  }
  if (doc.status === 'draft') {
    return NextResponse.json({ error: 'DOC_NOT_ISSUED' }, { status: 409 })
  }
  if (doc.status === 'void') {
    return NextResponse.json({ error: 'DOC_ALREADY_VOID' }, { status: 409 })
  }

  // ── ทางที่ 1 · ผูกกับรายรับที่คีย์ไว้แล้ว — ไม่สร้างแถวใหม่ ──────────
  if (isUuid(body.txnId)) {
    const { data: txn } = await sb
      .from('transactions').select('id, kind').eq('id', body.txnId).maybeSingle()
    if (!txn) return NextResponse.json({ error: 'TXN_NOT_FOUND' }, { status: 422 })
    if (txn.kind !== 'income') {
      return NextResponse.json({ error: 'TXN_NOT_INCOME' }, { status: 422 })
    }
    const { data: taken } = await sb
      .from('documents').select('id').eq('txn_id', body.txnId).maybeSingle()
    if (taken) return NextResponse.json({ error: 'TXN_ALREADY_LINKED' }, { status: 409 })

    const { error } = await sb.from('documents').update({ txn_id: body.txnId }).eq('id', id)
    if (error) {
      console.error('[documents] ผูกรายรับไม่สำเร็จ', error.message)
      return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, txnId: body.txnId, created: false })
  }

  // ── ทางที่ 2 · สร้างรายรับใหม่ด้วยยอดเต็มของใบเสร็จ ────────────────
  const categoryId = body.categoryId
  if (!isUuid(categoryId)) {
    return NextResponse.json({ error: 'CATEGORY_REQUIRED' }, { status: 422 })
  }
  const { data: cat } = await sb
    .from('categories').select('id, kind').eq('id', categoryId).maybeSingle()
  if (!cat || cat.kind !== 'income') {
    return NextResponse.json({ error: 'CATEGORY_INVALID' }, { status: 422 })
  }

  const me = await getCurrentUser()
  const { data: txn, error: tErr } = await sb
    .from('transactions')
    .insert({
      kind: 'income',
      site_id: doc.site_id,
      category_id: categoryId,
      amount: doc.total,
      txn_date: String(body.txnDate ?? '').match(/^\d{4}-\d{2}-\d{2}$/)
        ? String(body.txnDate)
        : new Date().toISOString().slice(0, 10),
      pay_method: body.payMethod === 'transfer' ? 'transfer' : 'cash',
      status: 'approved',
      approved_by: me.id,
      approved_at: new Date().toISOString(),
      income_kind: 'other',
      note: `ใบเสร็จ ${doc.doc_no ?? ''} · ${doc.customer_name}`.trim(),
    })
    .select('id')
    .maybeSingle()

  if (tErr || !txn) {
    console.error('[documents] สร้างรายรับไม่สำเร็จ', tErr?.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }

  const { error } = await sb.from('documents').update({ txn_id: txn.id }).eq('id', id)
  if (error) {
    // 🔴 รายรับถูกสร้างไปแล้ว แต่ผูกไม่ติด — ต้องลบทิ้ง ไม่งั้นเหลือรายรับลอย
    // ที่ไม่มีใบเสร็จอ้างถึง แล้วเจ้าของกดปุ่มซ้ำจะได้สองแถว
    await sb.from('transactions').delete().eq('id', txn.id)
    console.error('[documents] ผูกรายรับไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, txnId: txn.id, created: true }, { status: 201 })
}
