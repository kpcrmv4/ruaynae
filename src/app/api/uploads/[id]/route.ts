import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { presignGet } from '@/lib/r2'

export const runtime = 'nodejs'

/**
 * GET /api/uploads/[id] — เปิดสลิป
 *
 * ตอบ **302 ไปยัง presigned GET อายุสั้น** ไม่ใช่สตรีมไบต์ผ่านเซิร์ฟเวอร์เรา
 * — รูปจึงไม่กินแบนด์วิดท์ของ Vercel และเบราว์เซอร์แคชให้เองได้
 *
 * 🔴 R2 ไม่มี RLS · สิทธิ์ตัดสินที่นี่ที่เดียว — และตัดสินด้วยการ **อ่านแถว
 * ผ่าน RLS** ไม่ใช่เขียนเงื่อนไขซ้ำ ถ้า policy ของ `transactions` เปลี่ยนวันหน้า
 * ตรงนี้จะเปลี่ยนตามเองโดยไม่มีใครต้องจำว่ามีที่นี่อีกที่หนึ่ง
 *
 * `?thumb=1` ขอรูปย่อ — หน้ารายการโหลดรูปเล็กสิบกว่ารูปต่อหน้าจอ
 * ถ้าดึงรูปเต็มจะกินเน็ตของคนที่อยู่หน้างานโดยไม่จำเป็น
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  const { id } = await ctx.params
  const wantThumb = new URL(req.url).searchParams.get('thumb') === '1'

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('attachments')
    .select('object_key, thumb_key, transaction_id, transactions!inner(id)')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[uploads] อ่านสลิปไม่ได้', error.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  // มองไม่เห็นแถว = ไม่มีสิทธิ์ หรือไม่มีไฟล์นี้ · ตอบ 403 เหมือนกันทั้งสองกรณี
  // เพื่อไม่ให้ใครใช้ status แยกว่า id นี้มีอยู่จริงไหม
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const key = wantThumb ? data.thumb_key : data.object_key
  return NextResponse.redirect(await presignGet(key), 302)
}
