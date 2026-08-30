import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'

export const runtime = 'nodejs'

/**
 * POST /api/notifications/read
 *
 * `{ all: true }`  — ทำเป็นอ่านแล้วทั้งหมดของคนที่ล็อกอินอยู่
 * `{ id: uuid }`   — ทำเป็นอ่านแล้วรายการเดียว
 *
 * 🔴 RLS ปฏิเสธการเขียนโดยไม่คืน error — `update` ที่โดน 0 แถวคือ "สำเร็จ"
 * ในสายตาของ PostgREST · จึงต้อง `.select()` กลับมาดูว่ามีแถวจริง
 * ไม่งั้นการกดอ่านแจ้งเตือนของคนอื่นจะตอบ 200 อย่างมั่นใจโดยไม่มีอะไรเปลี่ยน
 */
export async function POST(req: NextRequest) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const sb = await getSupabaseServer()
  const now = new Date().toISOString()

  if (body.all === true) {
    // `.eq('user_id')` ซ้ำกับ RLS โดยตั้งใจ — ถ้าวันหน้ามีใครแก้ policy ผิด
    // เงื่อนไขตรงนี้ยังกันไม่ให้กดปุ่มเดียวแล้วล้างกระดิ่งของทั้งบริษัท
    const { data, error } = await sb
      .from('notifications')
      .update({ read_at: now })
      .eq('user_id', me.id)
      .is('read_at', null)
      .select('id')

    if (error) {
      console.error('[notifications] ทำเป็นอ่านแล้วทั้งหมดไม่สำเร็จ', error.message)
      return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, updated: data?.length ?? 0 })
  }

  if (!isUuid(body.id)) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const { data, error } = await sb
    .from('notifications')
    .update({ read_at: now })
    .eq('id', body.id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[notifications] ทำเป็นอ่านแล้วไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  // ไม่มีแถว = ไม่มีจริง หรือเป็นของคนอื่น — สองอย่างนี้ตอบเหมือนกันโดยตั้งใจ
  // ตอบต่างกันเมื่อไหร่ก็กลายเป็นเครื่องมือให้เดาว่า id ไหนมีอยู่จริง
  if (!data) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({ ok: true, updated: 1 })
}
