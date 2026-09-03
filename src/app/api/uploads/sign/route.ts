import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { objectKey, presignPut } from '@/lib/r2'
import { isUuid } from '@/lib/transactions'
import { IMAGE_UPLOAD_TYPES, UPLOAD_MAX_BYTES } from '@/lib/constants'

export const runtime = 'nodejs'

/**
 * ชนิดไฟล์ที่รับ → นามสกุลที่จะใช้ตั้งชื่อ
 * มาจาก `constants.ts` ที่เดียวกับที่หน้าจอใช้ตรวจก่อนบีบรูป — ถ้าสองฝั่ง
 * ไม่ตรงกัน ผู้ใช้จะเลือกไฟล์ได้แล้วมาตายตอนขอลิงก์ โดยไม่รู้ว่าเพราะอะไร
 */
const ALLOWED: Record<string, string> = IMAGE_UPLOAD_TYPES

/** ลิงก์อัปโหลดมีอายุเท่านี้ · หมดอายุแล้วไฟล์กำพร้าจะถูกกวาด */
const INTENT_TTL_MINUTES = 30

/**
 * POST /api/uploads/sign — ขอลิงก์อัปโหลดตรงเข้า R2
 *
 * เบราว์เซอร์ PUT ไปที่ลิงก์นี้เอง ไบต์ไม่ผ่าน Vercel เลย
 * 🔴 R2 ไม่มี RLS — สิทธิ์ทั้งหมดตัดสินที่นี่ที่เดียว
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUserOrNull()
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  let purpose = ''
  let contentType = ''
  let rawSite: unknown = null
  let byteSize = 0
  try {
    const body = await req.json()
    purpose = String(body?.purpose ?? '')
    contentType = String(body?.contentType ?? '')
    rawSite = body?.siteId ?? null
    byteSize = Number(body?.byteSize ?? 0)
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const ext = ALLOWED[contentType]
  if (!ext) return NextResponse.json({ error: 'UNSUPPORTED_TYPE' }, { status: 415 })
  if (byteSize > UPLOAD_MAX_BYTES) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE' }, { status: 413 })
  }

  // ── โลโก้บริษัท ────────────────────────────────────────────────────
  if (purpose === 'logo') {
    if (user.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    const key = objectKey('branding', ext)
    return NextResponse.json({ key, url: await presignPut(key, contentType), contentType })
  }

  if (purpose !== 'slip') {
    return NextResponse.json({ error: 'UNSUPPORTED_PURPOSE' }, { status: 400 })
  }

  // ── สลิปของรายการเงิน ──────────────────────────────────────────────
  const siteId = rawSite === null || rawSite === undefined || rawSite === '' ? null : String(rawSite)
  if (siteId !== null && !isUuid(siteId)) {
    return NextResponse.json({ error: 'SITE_INVALID' }, { status: 400 })
  }

  const sb = await getSupabaseServer()

  if (user.role !== 'owner') {
    // 🔴 หัวหน้าโครงการแนบสลิปได้เฉพาะโครงการที่ดูแลอยู่ตอนนี้
    // เช็คด้วยการอ่านแถวโครงการผ่าน RLS — ถ้ามองไม่เห็น แปลว่าไม่มีสิทธิ์
    // ไม่ต้องเขียนเงื่อนไขซ้ำที่นี่ให้มีโอกาสเพี้ยนจาก policy
    if (siteId === null) return NextResponse.json({ error: 'SITE_REQUIRED' }, { status: 403 })
    const { data: site, error } = await sb
      .from('sites').select('id').eq('id', siteId).maybeSingle()
    if (error) {
      console.error('[uploads] อ่านโครงการไม่ได้', error.message)
      return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
    }
    if (!site) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const key = objectKey('slips', ext)
  const thumbKey = objectKey('slips/thumb', ext)
  const expiresAt = new Date(Date.now() + INTENT_TTL_MINUTES * 60_000).toISOString()

  // 🔴 บันทึก "ความตั้งใจ" ก่อนคืนลิงก์ — ไฟล์ที่อัปแล้วไม่ได้ถูกใช้
  // จะถูกกวาดทิ้งจากแถวนี้ · ถ้าไม่มีตารางนี้ ไฟล์จะค้างใน bucket ตลอดไป
  // โดยไม่มีแถวไหนชี้ถึงและไม่มี error ที่ไหนเลย
  const { data: intent, error: iErr } = await sb
    .from('upload_intents')
    .insert({
      object_key: key,
      thumb_key: thumbKey,
      created_by: user.id,
      site_id: siteId,
      expires_at: expiresAt,
    })
    .select('id')
    .maybeSingle()
  if (iErr || !intent) {
    console.error('[uploads] บันทึก upload_intents ไม่ได้', iErr?.message ?? 'โดน 0 แถว')
    return NextResponse.json({ error: 'INTENT_FAILED' }, { status: 500 })
  }

  const [url, thumbUrl] = await Promise.all([
    presignPut(key, contentType),
    presignPut(thumbKey, contentType),
  ])

  return NextResponse.json({ key, thumbKey, url, thumbUrl, contentType, expiresAt })
}
