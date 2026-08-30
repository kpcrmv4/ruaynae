import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { parseAmount, parseDate, MAX_NAME } from '@/lib/sites'

export const runtime = 'nodejs'

/** unique_violation — งวดเลขนี้ของไซต์นี้มีอยู่แล้ว */
const UNIQUE_VIOLATION = '23505'

/**
 * POST /api/sites/[id]/milestones — เพิ่มงวดเงินตามแผน
 *
 * แผนงวดเป็นของ **ไม่บังคับ** · เจ้าของที่ไม่อยากวางแผนล่วงหน้าก็บันทึกรายรับ
 * ได้ตามปกติ แล้วระบบนับงวดให้เองตอน P2 · ที่มีไว้เพราะงานรับเหมาส่วนใหญ่
 * ตกลงงวดกันไว้ในสัญญาตั้งแต่แรก และการเห็นว่า "งวด 2 ถึงกำหนดแล้วยังไม่เก็บ"
 * มีค่ากว่าการรู้ยอดรวมที่เก็บได้
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id: siteId } = await ctx.params
  const sb = await getSupabaseServer()

  const { data: site, error: sErr } = await sb
    .from('sites').select('id').eq('id', siteId).maybeSingle()
  if (sErr) {
    console.error('[sites] อ่านไซต์ไม่ได้', sErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!site) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  let name = ''
  let rawSeq: unknown = null
  let rawAmount: unknown = null
  let rawDate: unknown = null
  try {
    const b = await req.json()
    name = String(b?.name ?? '').trim().slice(0, MAX_NAME)
    rawSeq = b?.seq ?? null
    rawAmount = b?.plannedAmount ?? null
    rawDate = b?.plannedDate ?? null
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  if (!name) return NextResponse.json({ error: 'NAME_REQUIRED' }, { status: 400 })

  const amount = parseAmount(rawAmount)
  if (!amount.ok) return NextResponse.json({ error: amount.error }, { status: 400 })
  const date = parseDate(rawDate)
  if (!date.ok) return NextResponse.json({ error: date.error }, { status: 400 })

  let seq: number
  if (rawSeq === null || rawSeq === '' || rawSeq === undefined) {
    // ไม่ระบุ = ต่อท้ายงวดสุดท้าย · ผู้ใช้ส่วนใหญ่เพิ่มงวดเรียงกันอยู่แล้ว
    // การบังคับให้กรอกเลขงวดเองคือการให้คนทำงานแทนฐานข้อมูล
    const { data: last, error: lErr } = await sb
      .from('site_milestones')
      .select('seq')
      .eq('site_id', siteId)
      .order('seq', { ascending: false })
      .range(0, 0)
    if (lErr) {
      console.error('[sites] อ่านงวดล่าสุดไม่ได้', lErr.message)
      return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
    }
    seq = (last?.[0]?.seq ?? 0) + 1
  } else {
    seq = Number(rawSeq)
    if (!Number.isInteger(seq) || seq < 1 || seq > 999) {
      return NextResponse.json({ error: 'SEQ_INVALID' }, { status: 400 })
    }
  }

  const { data, error } = await sb
    .from('site_milestones')
    .insert({
      site_id: siteId,
      seq,
      name,
      planned_amount: amount.value,
      planned_date: date.value,
    })
    .select('id, seq')
    .maybeSingle()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return NextResponse.json({ error: 'SEQ_TAKEN' }, { status: 409 })
    }
    console.error('[sites] เพิ่มงวดไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true, milestone: data }, { status: 201 })
}

/** DELETE /api/sites/[id]/milestones?milestone=<uuid> */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id: siteId } = await ctx.params
  const milestoneId = new URL(req.url).searchParams.get('milestone')?.trim() ?? ''
  if (!milestoneId) return NextResponse.json({ error: 'MILESTONE_REQUIRED' }, { status: 400 })

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('site_milestones')
    .delete()
    .eq('id', milestoneId)
    .eq('site_id', siteId)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[sites] ลบงวดไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
