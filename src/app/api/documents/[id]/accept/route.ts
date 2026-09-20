import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'

export const runtime = 'nodejs'

/**
 * POST /api/documents/[id]/accept — ลูกค้าตอบรับใบเสนอราคา
 *
 * ใบเสร็จไม่มีสถานะนี้ — "ตอบรับ" เป็นเรื่องของข้อเสนอ ไม่ใช่ของการรับเงิน
 * · ปุ่มบนหน้าจอไม่แสดงกับใบเสร็จอยู่แล้ว แต่ route ต้องปฏิเสธเองด้วย
 *   เพราะปุ่มที่ซ่อนไม่ใช่การควบคุมสิทธิ์
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const sb = await getSupabaseServer()
  const { data: doc } = await sb
    .from('documents').select('id, kind, status').eq('id', id).maybeSingle()
  if (!doc) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (doc.kind !== 'quotation') {
    return NextResponse.json({ error: 'ACCEPT_QUOTATION_ONLY' }, { status: 422 })
  }
  if (doc.status !== 'issued' && doc.status !== 'sent') {
    return NextResponse.json({ error: 'DOC_STATUS_INVALID' }, { status: 409 })
  }

  const { error } = await sb
    .from('documents')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    console.error('[documents] บันทึกการตอบรับไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
