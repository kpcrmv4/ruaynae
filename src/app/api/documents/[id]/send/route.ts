import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'

export const runtime = 'nodejs'

/**
 * POST /api/documents/[id]/send — ทำเครื่องหมายว่า **ส่งให้ลูกค้าแล้ว**
 *
 * 🔴 นี่คือตัวล็อกจริงของเอกสาร ไม่ใช่การออกเลข (คำสั่งเจ้าของ 20 ก.ย. 2569)
 * เพราะสิ่งที่ทำให้แก้ไม่ได้คือ **ลูกค้าถือกระดาษอีกใบอยู่** ไม่ใช่การมีเลข
 * · ติ๊กเอง ไม่ใช่ติ๊กให้อัตโนมัติตอนกดพิมพ์ — คนพิมพ์มาดูเฉย ๆ ก็มี
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const sb = await getSupabaseServer()
  const { data: doc } = await sb.from('documents').select('id, status').eq('id', id).maybeSingle()
  if (!doc) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (doc.status === 'draft') {
    return NextResponse.json({ error: 'DOC_NOT_ISSUED' }, { status: 409 })
  }
  if (doc.status !== 'issued') {
    return NextResponse.json({ error: 'DOC_ALREADY_SENT' }, { status: 409 })
  }

  const { error } = await sb
    .from('documents')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    console.error('[documents] ทำเครื่องหมายส่งแล้วไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
