import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner, getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { todayInBangkok } from '@/lib/format'
import { parseDate } from '@/lib/sites'
import { isPayMethod, MAX_NOTE } from '@/lib/transactions'

export const runtime = 'nodejs'

/** ชื่อหมวดรายรับที่ migration `contract_bonds` สร้างไว้ — ต้องตรงกันเป๊ะ */
const RETURN_CATEGORY = 'หลักประกันสัญญาคืน'

/**
 * POST /api/sites/[id]/bond-return — บันทึกว่าได้รับหลักประกันสัญญาคืนแล้ว (เจ้าของเท่านั้น)
 *
 * · **เงินสดหักไว้** → ลงเป็น **รายรับของโครงการ** หมวด "หลักประกันสัญญาคืน" ทันที
 *   (เจ้าของตัดสิน 19 ก.ย. 2569) เพราะมันคือเงินเข้ากระเป๋าจริง กำไรโครงการจะได้ครบ
 * · **หนังสือค้ำ** → แค่บันทึกวันที่รับคืน ไม่ใช่เงิน · ไม่มีรายรับ
 *
 * 🔴 สองคำสั่ง (insert รายรับ → update site_finance) ไม่ได้อยู่ใน transaction เดียว
 *    ถ้าคำสั่งที่สองล้ม รายรับจะค้างอยู่โดยหลักประกันยังไม่ถูกทำเครื่องหมาย — จึง
 *    ลบรายรับที่เพิ่งสร้างทิ้งก่อนตอบ error ให้ผู้ใช้ลองใหม่ได้โดยไม่มีรายรับซ้ำ
 * 🔴 ทำซ้ำไม่ได้: บันทึกแล้วตอบ `BOND_ALREADY_RETURNED` — แก้วันที่/ยอดให้ไปแก้ที่รายรับ
 *    (ซึ่งเจ้าของแก้ได้อยู่แล้ว) หรือยกเลิกด้วย DELETE ข้างล่างแล้วบันทึกใหม่
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  const { id } = await ctx.params

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const returnedAt = parseDate(body.returnedAt ?? body.returned_at)
  if (!returnedAt.ok) return NextResponse.json({ error: returnedAt.error }, { status: 400 })
  if (!returnedAt.value) return NextResponse.json({ error: 'RETURN_DATE_REQUIRED' }, { status: 400 })
  if (returnedAt.value > todayInBangkok()) {
    return NextResponse.json({ error: 'DATE_FUTURE' }, { status: 400 })
  }
  const payMethod = body.payMethod ?? body.pay_method ?? 'transfer'
  if (!isPayMethod(payMethod)) return NextResponse.json({ error: 'PAY_METHOD_INVALID' }, { status: 400 })
  const note = String(body.note ?? '').trim().slice(0, MAX_NOTE)

  const sb = await getSupabaseServer()
  const { data: fin, error: fErr } = await sb
    .from('site_finance')
    .select('site_id, bond_kind, bond_amount, bond_returned_at, handover_date, contract_no, sites(name)')
    .eq('site_id', id)
    .maybeSingle()
  if (fErr) {
    console.error('[bond] อ่านหลักประกันไม่ได้', fErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!fin) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (!fin.bond_kind || Number(fin.bond_amount) <= 0) {
    return NextResponse.json({ error: 'BOND_NONE' }, { status: 409 })
  }
  if (fin.bond_returned_at) return NextResponse.json({ error: 'BOND_ALREADY_RETURNED' }, { status: 409 })
  if (!fin.handover_date) return NextResponse.json({ error: 'BOND_NOT_HANDED_OVER' }, { status: 409 })

  // ยอดที่ได้คืน — ค่าเริ่มต้นคือยอดที่ตั้งไว้ · ราชการหักบางส่วนได้ จึงแก้ได้
  const rawAmount = body.amount
  const amount =
    rawAmount === undefined || rawAmount === null || rawAmount === ''
      ? Number(fin.bond_amount)
      : Number(String(rawAmount).replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount <= 0 || amount > 999_999_999_999) {
    return NextResponse.json({ error: 'RETURN_AMOUNT_INVALID' }, { status: 400 })
  }
  const rounded = Math.round(amount * 100) / 100

  let txnId: string | null = null
  if (fin.bond_kind === 'cash') {
    const { data: cat, error: cErr } = await sb
      .from('categories')
      .select('id')
      .eq('kind', 'income')
      .eq('name', RETURN_CATEGORY)
      .eq('is_active', true)
      .maybeSingle()
    if (cErr) {
      console.error('[bond] อ่านหมวดไม่ได้', cErr.message)
      return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
    }
    if (!cat) return NextResponse.json({ error: 'CATEGORY_MISSING' }, { status: 409 })

    const { data: txn, error: tErr } = await sb
      .from('transactions')
      .insert({
        kind: 'income',
        site_id: id,
        category_id: cat.id,
        amount: rounded,
        txn_date: returnedAt.value,
        pay_method: payMethod,
        // เจ้าของคีย์เอง = อนุมัติทันที (กติกาเดียวกับ /api/transactions)
        status: 'approved',
        income_kind: 'other',
        note:
          note ||
          `รับหลักประกันสัญญาคืน${fin.contract_no ? ` · สัญญาเลขที่ ${fin.contract_no}` : ''}`,
        created_by: me.id,
      })
      .select('id')
      .maybeSingle()
    if (tErr || !txn) {
      console.error('[bond] ลงรายรับไม่สำเร็จ', tErr?.message ?? 'โดน 0 แถว')
      return NextResponse.json({ error: 'RETURN_FAILED' }, { status: 500 })
    }
    txnId = txn.id
  }

  const { data: updated, error: uErr } = await sb
    .from('site_finance')
    .update({
      bond_returned_at: returnedAt.value,
      bond_returned_amount: rounded,
      bond_return_txn_id: txnId,
    })
    .eq('site_id', id)
    .select('site_id')
    .maybeSingle()
  if (uErr || !updated) {
    console.error('[bond] บันทึกการรับคืนไม่สำเร็จ', uErr?.message ?? 'โดน 0 แถว')
    // ถอนรายรับที่เพิ่งลง ไม่งั้นกดซ้ำจะได้รายรับสองใบ
    if (txnId) await sb.from('transactions').delete().eq('id', txnId)
    return NextResponse.json({ error: 'RETURN_FAILED' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, returnedAt: returnedAt.value, amount: rounded, transactionId: txnId })
}

/**
 * DELETE /api/sites/[id]/bond-return — ยกเลิกการบันทึกรับคืน (กดผิด)
 *
 * ลบรายรับที่ระบบลงให้ด้วย (ถ้ายังอยู่) แล้วล้างวัน/ยอดที่รับคืน · ประวัติอยู่ใน audit_log
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  const sb = await getSupabaseServer()
  const { data: fin, error: fErr } = await sb
    .from('site_finance')
    .select('site_id, bond_returned_at, bond_return_txn_id')
    .eq('site_id', id)
    .maybeSingle()
  if (fErr) {
    console.error('[bond] อ่านหลักประกันไม่ได้', fErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!fin) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (!fin.bond_returned_at) return NextResponse.json({ error: 'NOTHING_TO_UPDATE' }, { status: 400 })

  const { data: updated, error: uErr } = await sb
    .from('site_finance')
    .update({ bond_returned_at: null, bond_returned_amount: null, bond_return_txn_id: null })
    .eq('site_id', id)
    .select('site_id')
    .maybeSingle()
  if (uErr || !updated) {
    console.error('[bond] ยกเลิกการรับคืนไม่สำเร็จ', uErr?.message ?? 'โดน 0 แถว')
    return NextResponse.json({ error: 'RETURN_FAILED' }, { status: 500 })
  }
  if (fin.bond_return_txn_id) {
    const { error: dErr } = await sb.from('transactions').delete().eq('id', fin.bond_return_txn_id)
    // รายรับอาจถูกลบไปก่อนแล้ว (FK set null) — ไม่ถือเป็นความล้มเหลว แต่ต้องเห็นใน log
    if (dErr) console.error('[bond] ลบรายรับที่ผูกไว้ไม่สำเร็จ', dErr.message)
  }
  return NextResponse.json({ ok: true })
}
