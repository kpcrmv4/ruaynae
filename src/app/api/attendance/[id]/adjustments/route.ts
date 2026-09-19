import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { adjustDbCode, adjustNet, parseAdjustLines } from '@/lib/wage-adjustments'

export const runtime = 'nodejs'

/**
 * PUT /api/attendance/[id]/adjustments — แทนที่รายการปรับค่าแรงของการลงชื่อครั้งนี้ทั้งชุด
 *
 * "แทนที่ทั้งชุด" ไม่ใช่ "เพิ่มทีละบรรทัด" — กล่องบนหน้าจอแสดงทั้งชุดแล้วให้กด
 * บันทึกครั้งเดียว · ส่งมาว่างเปล่า = ลบทุกบรรทัด (ยอดสุทธิกลับเป็น 0)
 *
 * 🔴 เจ้าของเท่านั้น — เป็นเงิน (P4.5) · RLS ของ `attendance_adjustments` กันอีกชั้น
 * 🔴 ยอดสุทธิใน `attendance_wages.ot_amount` ถูก trigger คำนวณให้ ไม่เขียนที่นี่
 * 🔴 วันที่จ่ายเงินแล้ว guard ปฏิเสธ (`PAYROLL_CLOSED`) · หักจนค่าแรงวันติดลบ
 *    check ปฏิเสธ (`WAGE_NEGATIVE`) — ทั้งสองส่งเป็นรหัสให้หน้าจอแปล ไม่ใช่ error ดิบ
 *
 * ⚠️ สองคำสั่ง (ลบแล้วใส่) ไม่ได้อยู่ใน transaction เดียว — ถ้าคำสั่งที่สองล้ม
 * ผู้ใช้จะเห็นชุดว่างและ toast บอกให้ตั้งใหม่ ไม่ใช่ชุดครึ่งเดียวที่ดูเหมือนสมบูรณ์
 * เพราะเราใส่ทั้งชุดในคำสั่งเดียว (insert หลายแถวเป็น atomic อยู่แล้ว)
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params

  let raw: unknown
  try {
    const b = (await req.json()) as Record<string, unknown>
    raw = b.adjustments ?? b.lines ?? []
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  const parsed = parseAdjustLines(raw)
  if (!parsed.ok) return NextResponse.json({ error: parsed.code }, { status: 400 })

  const sb = await getSupabaseServer()

  // แยก "ไม่มีแถวนี้" ออกจาก "มีแต่แตะไม่ได้" — ผู้ใช้จะได้ไล่หาปัญหาถูกทาง
  const { data: att, error: rErr } = await sb
    .from('attendance').select('id').eq('id', id).maybeSingle()
  if (rErr) {
    console.error('[attendance/adjustments] อ่านแถวไม่ได้', rErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!att) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const { error: dErr } = await sb
    .from('attendance_adjustments').delete().eq('attendance_id', id)
  if (dErr) {
    const code = adjustDbCode(dErr.message)
    if (code) return NextResponse.json({ error: code }, { status: code === 'FORBIDDEN' ? 403 : 409 })
    console.error('[attendance/adjustments] ลบชุดเดิมไม่สำเร็จ', dErr.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }

  if (parsed.lines.length > 0) {
    const { error: iErr } = await sb.from('attendance_adjustments').insert(
      parsed.lines.map((l) => ({
        attendance_id: id,
        preset_id: l.presetId,
        name: l.name,
        kind: l.kind,
        amount: l.amount,
      })),
    )
    if (iErr) {
      const code = adjustDbCode(iErr.message)
      if (code) return NextResponse.json({ error: code }, { status: code === 'FORBIDDEN' ? 403 : 409 })
      console.error('[attendance/adjustments] บันทึกชุดใหม่ไม่สำเร็จ', iErr.message)
      return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, net: adjustNet(parsed.lines), lines: parsed.lines })
}
