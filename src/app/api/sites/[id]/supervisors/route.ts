import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { parseDate } from '@/lib/sites'

export const runtime = 'nodejs'

/** exclusion_violation — ช่วงเวลาของคนคนเดียวทับกันสองโครงการ */
const EXCLUSION_VIOLATION = '23P01'

/**
 * POST /api/sites/[id]/supervisors — มอบหมายหัวหน้าโครงการ พร้อมช่วงเวลา
 *
 * 🔴 ช่วงเวลาไม่ใช่ของประดับ · ถ้าเก็บแค่ "ใครดูแลโครงการไหน" พอย้ายหัวหน้าโครงการ
 * รายงานย้อนหลังจะเปลี่ยนเจ้าของตามไปด้วยเงียบ ๆ งานที่ทีมเก่าทำจะไปโผล่ใต้ทีมใหม่
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id: siteId } = await ctx.params
  const sb = await getSupabaseServer()

  const { data: site, error: sErr } = await sb
    .from('sites').select('id').eq('id', siteId).maybeSingle()
  if (sErr) {
    console.error('[sites] อ่านโครงการไม่ได้', sErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!site) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  let profileId = ''
  let rawFrom: unknown = null
  let rawTo: unknown = null
  try {
    const b = await req.json()
    profileId = String(b?.profileId ?? '').trim()
    rawFrom = b?.effectiveFrom ?? null
    rawTo = b?.effectiveTo ?? null
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  if (!profileId) return NextResponse.json({ error: 'PROFILE_REQUIRED' }, { status: 400 })

  const from = parseDate(rawFrom)
  if (!from.ok) return NextResponse.json({ error: from.error }, { status: 400 })
  const to = parseDate(rawTo)
  if (!to.ok) return NextResponse.json({ error: to.error }, { status: 400 })
  if (from.value && to.value && to.value < from.value) {
    return NextResponse.json({ error: 'DATE_RANGE_INVALID' }, { status: 400 })
  }

  // คนที่ปิดบัญชีไปแล้วไม่ควรถูกมอบหมายงานใหม่ — เขาล็อกอินเข้ามาทำไม่ได้อยู่ดี
  const { data: profile, error: pErr } = await sb
    .from('profiles').select('id, is_active').eq('id', profileId).maybeSingle()
  if (pErr) {
    console.error('[sites] อ่านผู้ใช้ไม่ได้', pErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!profile) return NextResponse.json({ error: 'PROFILE_NOT_FOUND' }, { status: 404 })
  if (!profile.is_active) return NextResponse.json({ error: 'PROFILE_INACTIVE' }, { status: 409 })

  const { data, error } = await sb
    .from('site_supervisors')
    .insert({
      site_id: siteId,
      profile_id: profileId,
      ...(from.value ? { effective_from: from.value } : {}),
      effective_to: to.value,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === EXCLUSION_VIOLATION) {
      return NextResponse.json({ error: 'OVERLAP' }, { status: 409 })
    }
    console.error('[sites] มอบหมายหัวหน้าโครงการไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true, assignment: data }, { status: 201 })
}

/**
 * DELETE /api/sites/[id]/supervisors?assignment=<uuid>
 *
 * รับ id ทาง query ไม่ใช่ทาง body — `fetch` กับ proxy บางตัวตัด body ของ DELETE ทิ้ง
 * แล้วคำขอจะกลายเป็น "ลบอะไรก็ไม่รู้" ซึ่งเป็นคำขอที่อันตรายที่สุดเท่าที่มีได้
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id: siteId } = await ctx.params
  const assignmentId = new URL(req.url).searchParams.get('assignment')?.trim() ?? ''
  if (!assignmentId) return NextResponse.json({ error: 'ASSIGNMENT_REQUIRED' }, { status: 400 })

  const sb = await getSupabaseServer()
  // ผูกกับ site_id ด้วย — id เดียวโดด ๆ ทำให้ลบแถวของโครงการอื่นได้ถ้าเดา id ถูก
  const { data, error } = await sb
    .from('site_supervisors')
    .delete()
    .eq('id', assignmentId)
    .eq('site_id', siteId)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[sites] ถอนหัวหน้าโครงการไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 })
  }
  // delete ที่โดน 0 แถวไม่ใช่ error — ต้องแยกออกมาเองว่าไม่มีของให้ลบ
  if (!data) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
