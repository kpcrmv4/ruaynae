import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'

export const runtime = 'nodejs'

/**
 * POST /api/documents/[id]/void — ยกเลิกเอกสาร
 *
 * 🔴 **เลขที่ถูกยกเลิกจะไม่ถูกนำกลับมาใช้ซ้ำ** และแถวยังอยู่ในระบบ
 * เอกสารภาษีที่หายไปทั้งเลขคือสิ่งที่ตอบไม่ได้ว่าใบนั้นไปไหน
 * · ต้องมีเหตุผลเสมอ — "ยกเลิกเฉย ๆ" อ่านย้อนหลังไม่ได้ว่าเกิดอะไรขึ้น
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  let reason = ''
  try {
    const b = await req.json()
    reason = String(b?.reason ?? '').trim().slice(0, 200)
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  if (!reason) return NextResponse.json({ error: 'VOID_REASON_REQUIRED' }, { status: 422 })

  const sb = await getSupabaseServer()
  const { data: doc } = await sb.from('documents').select('id, status').eq('id', id).maybeSingle()
  if (!doc) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (doc.status === 'void') {
    return NextResponse.json({ error: 'DOC_ALREADY_VOID' }, { status: 409 })
  }
  if (doc.status === 'draft') {
    return NextResponse.json({ error: 'DOC_NOT_ISSUED' }, { status: 409 })
  }

  const { error } = await sb
    .from('documents')
    .update({ status: 'void', voided_at: new Date().toISOString(), void_reason: reason })
    .eq('id', id)
  if (error) {
    console.error('[documents] ยกเลิกไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
