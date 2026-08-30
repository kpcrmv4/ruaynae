import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'

export const runtime = 'nodejs'

const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** POST /api/payroll — เปิดรอบจ่ายค่าแรง (เจ้าของเท่านั้น) */
export async function POST(req: NextRequest) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const start = body.periodStart ?? body.period_start
  const end = body.periodEnd ?? body.period_end
  if (!isIsoDate(start) || !isIsoDate(end)) {
    return NextResponse.json({ error: 'DATE_INVALID' }, { status: 400 })
  }
  // ปีเกิน 2200 = กรอก พ.ศ. ลงไป
  if (Number(start.slice(0, 4)) > 2200 || Number(end.slice(0, 4)) > 2200) {
    return NextResponse.json({ error: 'DATE_BUDDHIST_ERA' }, { status: 400 })
  }
  if (end < start) return NextResponse.json({ error: 'DATE_RANGE_INVALID' }, { status: 400 })

  const siteId = body.siteId ?? body.site_id

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('payroll_runs')
    .insert({
      period_start: start,
      period_end: end,
      site_id: isUuid(siteId) ? siteId : null,
    })
    .select('id, status')
    .maybeSingle()

  if (error) {
    // รอบที่ช่วงเวลาซ้อนกัน = ค่าแรงวันเดียวถูกจ่ายสองรอบ
    if (/payroll_runs_no_overlap|exclusion/i.test(error.message ?? '')) {
      return NextResponse.json({ error: 'PERIOD_OVERLAP' }, { status: 409 })
    }
    if (/row-level security/i.test(error.message ?? '')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
    console.error('[payroll] เปิดรอบไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true, run: data }, { status: 201 })
}
