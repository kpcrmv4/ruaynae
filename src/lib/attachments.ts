import 'server-only'
import type { getSupabaseServer } from '@/lib/supabase/server'
import { headObject } from '@/lib/r2'
import { MAX_ATTACHMENTS } from '@/lib/constants'
import type { Database } from '@/lib/database.types'

export type Slip = { objectKey: string; thumbKey: string }
type Sb = Awaited<ReturnType<typeof getSupabaseServer>>

/**
 * อ่านรายการสลิปจาก payload ของ client
 *
 * อยู่ที่นี่ที่เดียวเพราะมีสอง route ที่รับรูปแบบเดียวกัน — ตอนสร้างรายการ
 * และตอนแนบเพิ่มทีหลังจากปุ่มแก้ไข · แยกกันเขียนแล้ววันหนึ่งจะเหลือที่เดียว
 * ที่ตรวจครบ
 */
export function parseSlips(raw: unknown): { ok: true; slips: Slip[] } | { ok: false; error: string } {
  const list = Array.isArray(raw) ? raw : []
  const slips: Slip[] = list.map((a) => ({
    objectKey: String((a as Record<string, unknown>)?.objectKey ?? ''),
    thumbKey: String((a as Record<string, unknown>)?.thumbKey ?? ''),
  }))
  if (slips.length > MAX_ATTACHMENTS) return { ok: false, error: 'TOO_MANY_ATTACHMENTS' }
  if (slips.some((s) => !s.objectKey || !s.thumbKey)) {
    return { ok: false, error: 'ATTACHMENT_INVALID' }
  }
  return { ok: true, slips }
}

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
export async function attachSlips(
  sb: Sb,
  transactionId: string,
  slips: Slip[],
): Promise<{ error?: string; ids?: string[] }> {
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
      console.error('[attachments] อ่าน upload_intents ไม่ได้', error.message)
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
    console.error('[attachments] แนบสลิปไม่สำเร็จ', aErr?.message ?? 'จำนวนแถวไม่ตรง')
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
    console.error('[attachments] ปิด upload_intents ไม่สำเร็จ', cErr.message)
  }
  // คืน id ให้ผู้เรียก — กล่องแก้ไขต้องเอาไปวาดรูปย่อทันทีโดยไม่ต้องโหลดหน้าใหม่
  return { ids: inserted.map((r) => r.id) }
}
