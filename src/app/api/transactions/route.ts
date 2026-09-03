import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { todayInBangkok } from '@/lib/format'
import { attachSlips, parseSlips } from '@/lib/attachments'
import { parseTxnFields } from '@/lib/transactions'

export const runtime = 'nodejs'

/** unique_violation — ยิงซ้ำด้วย client_ref เดิม */
const UNIQUE_VIOLATION = '23505'

/*
 * ไม่มี GET โดยตั้งใจ — `/ledger` และ `/entry` เป็น Server Component
 * อ่านฐานข้อมูลตรงผ่าน RLS อยู่แล้ว (เหตุผลเดียวกับ /api/settings/users)
 */

/** POST /api/transactions — บันทึกรายรับหรือรายจ่าย */
export async function POST(req: NextRequest) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const parsed = parseTxnFields(body, todayInBangkok())
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const slipsParsed = parseSlips((body as Record<string, unknown>)?.attachments)
  if (!slipsParsed.ok) return NextResponse.json({ error: slipsParsed.error }, { status: 400 })
  const slips = slipsParsed.slips

  const isOwner = me.role === 'owner'

  // ตอบ 403 พร้อมเหตุผลก่อนถึงฐานข้อมูล — trigger กันซ้ำอยู่แล้ว แต่ error
  // ของ Postgres อ่านไม่รู้เรื่องสำหรับผู้ใช้ และกลายเป็น 500 ถ้าไม่ดักไว้
  if (!isOwner) {
    if (parsed.fields.kind === 'income') {
      return NextResponse.json({ error: 'INCOME_FORBIDDEN' }, { status: 403 })
    }
    if (parsed.fields.site_id === null) {
      return NextResponse.json({ error: 'SITE_REQUIRED' }, { status: 403 })
    }
  }

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('transactions')
    .insert({
      ...parsed.fields,
      // 🔴 สถานะตัดสินฝั่งเซิร์ฟเวอร์จาก role เท่านั้น — ค่าที่ client ส่งมา
      // ถูกทิ้งไปตั้งแต่ `parseTxnFields` แล้ว (ไม่มีฟิลด์ status ในนั้น)
      // เจ้าของคีย์เอง = อนุมัติทันที · หัวหน้าโครงการคีย์ = เข้าคิวรออนุมัติ
      status: isOwner ? 'approved' : 'pending',
    })
    .select('id, status')
    .maybeSingle()

  if (error) {
    // ยิงซ้ำด้วย client_ref เดิม = การกดสองครั้ง ไม่ใช่ความผิดพลาดของผู้ใช้
    // ตอบเหมือนสำเร็จโดยคืนแถวเดิม แทนที่จะขึ้น error ที่คนอ่านไม่เข้าใจ
    if (error.code === UNIQUE_VIOLATION && parsed.fields.client_ref) {
      const { data: existing } = await sb
        .from('transactions')
        .select('id, status')
        .eq('client_ref', parsed.fields.client_ref)
        .maybeSingle()
      if (existing) {
        return NextResponse.json({ ok: true, transaction: existing, duplicate: true })
      }
    }
    const msg = error.message ?? ''
    for (const code of ['INCOME_FORBIDDEN', 'SITE_REQUIRED', 'APPROVE_FORBIDDEN', 'CATEGORY_KIND_MISMATCH']) {
      if (msg.includes(code)) return NextResponse.json({ error: code }, { status: 403 })
    }
    if (error.code === '42501') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    console.error('[transactions] บันทึกไม่สำเร็จ', msg)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })

  if (slips.length > 0) {
    const attached = await attachSlips(sb, data.id, slips)
    if (attached.error) {
      // แถวรายการถูกสร้างไปแล้ว — ไม่ย้อนกลับ เพราะตัวเลขเงินสำคัญกว่ารูป
      // แต่ต้องบอกให้ชัดว่าสลิปไม่ติด ไม่ใช่เงียบแล้วผู้ใช้เชื่อว่าแนบแล้ว
      return NextResponse.json(
        { ok: true, transaction: data, attachError: attached.error },
        { status: 201 },
      )
    }
  }

  return NextResponse.json({ ok: true, transaction: data }, { status: 201 })
}
