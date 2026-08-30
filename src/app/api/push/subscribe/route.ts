import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

type SubBody = {
  endpoint?: unknown
  keys?: { p256dh?: unknown; auth?: unknown }
}

const readSub = (b: SubBody) => {
  const endpoint = typeof b.endpoint === 'string' ? b.endpoint.trim() : ''
  const p256dh = typeof b.keys?.p256dh === 'string' ? b.keys.p256dh : ''
  const auth = typeof b.keys?.auth === 'string' ? b.keys.auth : ''
  if (!endpoint.startsWith('https://') || !p256dh || !auth) return null
  return { endpoint: endpoint.slice(0, 2000), p256dh, auth }
}

/**
 * POST /api/push/subscribe — จำเครื่องนี้ไว้ส่ง push
 *
 * 🔴 `upsert` ตาม `endpoint` ไม่ใช่ insert — เบราว์เซอร์คืน subscription เดิม
 * ทุกครั้งที่เรียก `subscribe()` ซ้ำ · insert ตรง ๆ จะได้ unique violation
 * ทุกครั้งที่คนเปิดแอปใหม่ ซึ่งอ่านเหมือนพัง
 */
export async function POST(req: NextRequest) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  let body: SubBody
  try {
    body = (await req.json()) as SubBody
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  const sub = readSub(body)
  if (!sub) return NextResponse.json({ error: 'SUBSCRIPTION_INVALID' }, { status: 400 })

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('push_subscriptions')
    .upsert(
      { user_id: me.id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      { onConflict: 'endpoint' },
    )
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[push] บันทึก subscription ไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'SAVE_FAILED' }, { status: 500 })
  }
  // RLS ที่ปฏิเสธไม่คืน error เสมอไป — อ่านแถวกลับมาดูว่ามีจริง
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true }, { status: 201 })
}

/** DELETE /api/push/subscribe — เลิกรับ push จากเครื่องนี้ */
export async function DELETE(req: NextRequest) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  let body: SubBody
  try {
    body = (await req.json()) as SubBody
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : ''
  if (!endpoint) return NextResponse.json({ error: 'SUBSCRIPTION_INVALID' }, { status: 400 })

  const sb = await getSupabaseServer()
  const { error } = await sb.from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) {
    console.error('[push] ลบ subscription ไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
