import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { headObject } from '@/lib/r2'
import { todayInBangkok } from '@/lib/format'
import { MAX_ATTACHMENTS } from '@/lib/constants'
import { parseTxnFields } from '@/lib/transactions'
import type { Database } from '@/lib/database.types'

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

  const rawSlips = (body as Record<string, unknown>)?.attachments
  const slips: Slip[] = Array.isArray(rawSlips)
    ? rawSlips.map((a) => ({
        objectKey: String((a as Record<string, unknown>)?.objectKey ?? ''),
        thumbKey: String((a as Record<string, unknown>)?.thumbKey ?? ''),
      }))
    : []
  if (slips.length > MAX_ATTACHMENTS) {
    return NextResponse.json({ error: 'TOO_MANY_ATTACHMENTS' }, { status: 400 })
  }
  if (slips.some((s) => !s.objectKey || !s.thumbKey)) {
    return NextResponse.json({ error: 'ATTACHMENT_INVALID' }, { status: 400 })
  }

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
      // เจ้าของคีย์เอง = อนุมัติทันที · หัวหน้าไซต์คีย์ = เข้าคิวรออนุมัติ
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

type Slip = { objectKey: string; thumbKey: string }

/**
 * ผูกสลิปที่อัปขึ้น R2 แล้วเข้ากับรายการ
 *
 * 🔴 ต้องมีแถว `upload_intents` **ของคนที่กำลังบันทึก** อยู่ก่อน — กันคนอ้าง
 * คีย์ของคนอื่นมาแปะกับรายการตัวเอง · RLS ของ `upload_intents` จำกัดให้เห็น
 * เฉพาะของตัวเองอยู่แล้ว การอ่านไม่เจอจึงแปลว่าไม่ใช่ของเขา
 *
 * 🔴 ถาม R2 ว่าไฟล์มีจริงและใหญ่เท่าไร — ขนาดที่ client บอกมาเป็นคำกล่าวอ้าง
 * ถ้าไม่ถาม จะได้แถวที่ชี้ไปยังไฟล์ที่ไม่เคยถูกอัป = รูปที่กดดูแล้วพังตลอดกาล
 */
async function attachSlips(
  sb: Awaited<ReturnType<typeof getSupabaseServer>>,
  transactionId: string,
  slips: Slip[],
): Promise<{ error?: string }> {
  const rows: Database['public']['Tables']['attachments']['Insert'][] = []
  const intentIds: string[] = []

  for (const slip of slips) {
    const { data: intent, error } = await sb
      .from('upload_intents')
      .select('id, object_key, thumb_key')
      .eq('object_key', slip.objectKey)
      .is('consumed_at', null)
      .maybeSingle()
    if (error) {
      console.error('[transactions] อ่าน upload_intents ไม่ได้', error.message)
      return { error: 'ATTACH_FAILED' }
    }
    if (!intent || intent.thumb_key !== slip.thumbKey) return { error: 'INTENT_NOT_FOUND' }

    const head = await headObject(intent.object_key)
    if (!head) return { error: 'FILE_NOT_UPLOADED' }

    rows.push({
      transaction_id: transactionId,
      object_key: intent.object_key,
      thumb_key: intent.thumb_key,
      byte_size: head.size,
      content_type: head.contentType,
    })
    intentIds.push(intent.id)
  }

  const { data: inserted, error: aErr } = await sb
    .from('attachments').insert(rows).select('id')
  if (aErr || !inserted || inserted.length !== rows.length) {
    console.error('[transactions] แนบสลิปไม่สำเร็จ', aErr?.message ?? 'จำนวนแถวไม่ตรง')
    return { error: 'ATTACH_FAILED' }
  }

  // ปิดความตั้งใจ — ไฟล์เหล่านี้มีเจ้าของแล้ว ตัวกวาดต้องไม่แตะ
  const { error: cErr } = await sb
    .from('upload_intents')
    .update({ consumed_at: new Date().toISOString() })
    .in('id', intentIds)
  if (cErr) {
    // ไม่ใช่ความล้มเหลวของผู้ใช้ แต่ต้องเห็นใน log — ถ้าปิดไม่สำเร็จ
    // ตัวกวาดจะลบไฟล์ที่ใช้งานอยู่ทิ้งเมื่อหมดอายุ
    console.error('[transactions] ปิด upload_intents ไม่สำเร็จ', cErr.message)
  }
  return {}
}
