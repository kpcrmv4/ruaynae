import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { todayInBangkok } from '@/lib/format'
import { isUuid } from '@/lib/transactions'
import { MAX_NAME_RECURRING, monthToDate } from '@/lib/recurring'
import type { Database } from '@/lib/database.types'

export const runtime = 'nodejs'

/**
 * PATCH /api/settings/recurring/[id] — แก้กฎ · `run: true` = ลงเดือนที่ถึงกำหนดแล้ว
 *
 * ⚠️ แก้ยอดแล้ว**ไม่ย้อนไปแก้เดือนที่ลงไปแล้ว** — เดือนเก่าคือสิ่งที่จ่ายไปจริง
 * ตามยอดตอนนั้น การไล่แก้ย้อนหลังให้เองจะทำให้บัญชีเดือนที่ปิดไปแล้วขยับเอง
 * โดยไม่มีใครสั่ง · อยากแก้เดือนเก่าให้ไปแก้รายการนั้นตรง ๆ ที่ /ledger
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  const sb = await getSupabaseServer()

  let b: Record<string, unknown>
  try {
    b = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  // ลงเดือนที่ถึงกำหนดแล้วแต่ยังไม่มีรายการ — ปุ่มเดียว กดซ้ำได้
  if (b.run === true) {
    const { data, error } = await sb.rpc('run_recurring_expense', {
      p_rule: id,
      p_through: todayInBangkok(),
    })
    if (error) {
      if (/FORBIDDEN/.test(error.message ?? '')) {
        return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
      }
      console.error('[recurring] ลงรายการไม่สำเร็จ', error.message)
      return NextResponse.json({ error: 'RUN_FAILED' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, created: Number(data ?? 0) })
  }

  const patch: Database['public']['Tables']['recurring_expenses']['Update'] = {}

  if (typeof b.name === 'string') {
    const name = b.name.trim().slice(0, MAX_NAME_RECURRING)
    if (!name) return NextResponse.json({ error: 'NAME_REQUIRED' }, { status: 400 })
    patch.name = name
  }
  if (b.amount !== undefined) {
    const amount = Number(String(b.amount).replace(/,/g, ''))
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'AMOUNT_INVALID' }, { status: 400 })
    }
    patch.amount = amount
  }
  if (b.dayOfMonth !== undefined) {
    const day = Number(b.dayOfMonth)
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return NextResponse.json({ error: 'DAY_INVALID' }, { status: 400 })
    }
    patch.day_of_month = day
  }
  if (b.siteId !== undefined) patch.site_id = isUuid(b.siteId) ? b.siteId : null
  if (isUuid(b.categoryId)) patch.category_id = b.categoryId
  if (typeof b.isActive === 'boolean') patch.is_active = b.isActive
  if (b.payMethod === 'cash' || b.payMethod === 'transfer') patch.pay_method = b.payMethod
  if (b.endMonth !== undefined) {
    if (b.endMonth === null || b.endMonth === '') patch.end_month = null
    else {
      const end = monthToDate(String(b.endMonth))
      if (!end) return NextResponse.json({ error: 'MONTH_INVALID' }, { status: 400 })
      patch.end_month = end
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'NOTHING_TO_UPDATE' }, { status: 400 })
  }

  const { data, error } = await sb
    .from('recurring_expenses')
    .update(patch)
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) {
    if (/recurring_month_order/.test(error.message ?? '')) {
      return NextResponse.json({ error: 'MONTH_RANGE_INVALID' }, { status: 400 })
    }
    console.error('[recurring] แก้กฎไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  // RLS ที่ปฏิเสธ update ไม่คืน error — โดน 0 แถวแล้วตอบว่าสำเร็จ
  if (!data) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({ ok: true })
}

/**
 * DELETE /api/settings/recurring/[id] — ลบกฎที่ยังไม่เคยลงรายการไหนเลย
 *
 * 🔴 กฎที่เคยลงรายการไปแล้วลบไม่ได้ — `transactions.recurring_id` เป็น
 * `on delete set null` รายการเก่าจะไม่หาย แต่จะกลายเป็นรายการที่ไม่มีใคร
 * อธิบายได้ว่ามาจากไหน · ให้ปิดใช้งานแทน แล้วเดือนถัดไปจะไม่ลงเพิ่ม
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  const sb = await getSupabaseServer()

  const { count, error: cErr } = await sb
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('recurring_id', id)
  if (cErr) {
    console.error('[recurring] นับรายการที่ลงไว้ไม่ได้', cErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if ((count ?? 0) > 0) return NextResponse.json({ error: 'IN_USE' }, { status: 409 })

  const { data, error } = await sb
    .from('recurring_expenses')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[recurring] ลบกฎไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
