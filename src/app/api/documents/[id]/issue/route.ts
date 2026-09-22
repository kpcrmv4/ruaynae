import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { bahtText } from '@/lib/baht-text'
import { isUuid } from '@/lib/transactions'
import { sellerSnapshot } from '@/lib/doc-server'

export const runtime = 'nodejs'

/**
 * POST /api/documents/[id]/issue — ออกเลขที่เอกสาร
 *
 * 🔴 **ทั้งชุดอยู่ในฟังก์ชันเดียวของฐานข้อมูล** (`issue_document`) ซึ่ง
 * `select … for update` แถวเอกสารก่อนอ่านสถานะ · เดิม route นี้อ่านสถานะ →
 * ขอเลข → เขียน เป็นสามจังหวะ แล้ว double-click ทำให้คำขอที่สองขอเลขไป
 * อีกใบก่อนจะรู้ว่าสายเกินแล้ว — **เลขที่ถูกจ่ายทิ้งหายไปเงียบ ๆ** และคนกด
 * เห็น 500 ไม่ใช่ 409 · ตอนนี้คำขอที่สองเด้งออกก่อนถึงบรรทัดขอเลข
 *
 * · ยังไม่ได้ตั้งเลขล่าสุด = ออกไม่ได้ ตอบ `DOC_COUNTER_NOT_SET` ให้หน้าจอ
 *   ชี้ไปหน้าตั้งค่าได้
 * · ตรงนี้คือจังหวะที่ **สำเนาผู้ขายถูกแช่แข็ง** ลงในแถวเอกสาร
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const sb = await getSupabaseServer()
  const seller = await sellerSnapshot()

  const { data: docNo, error } = await sb.rpc('issue_document', {
    p_id: id,
    p_seller: seller,
  })

  if (error || !docNo) {
    const msg = error?.message ?? ''
    // ข้อความของ guard ถูกแปลงเป็นรหัสที่หน้าจอมีประโยคไทยรออยู่แล้ว
    for (const [needle, code, status] of [
      ['DOC_NOT_FOUND', 'NOT_FOUND', 404],
      ['DOC_ALREADY_ISSUED', 'DOC_ALREADY_ISSUED', 409],
      ['DOC_LINES_EMPTY', 'DOC_LINES_EMPTY', 422],
      ['DOC_COUNTER_NOT_SET', 'DOC_COUNTER_NOT_SET', 409],
      ['FORBIDDEN', 'FORBIDDEN', 403],
    ] as const) {
      if (msg.includes(needle)) return NextResponse.json({ error: code }, { status })
    }
    console.error('[documents] ออกเลขไม่สำเร็จ', msg)
    return NextResponse.json({ error: 'ISSUE_FAILED' }, { status: 500 })
  }

  // ข้อความภาษาไทยของยอด — อ่านยอดที่ฐานข้อมูลคิดให้ ไม่ใช่ที่ฟอร์มส่งมา
  // แยกคำสั่งได้เพราะ `issued` ไม่ใช่สถานะที่ล็อก และไม่ได้แตะ `doc_no`
  const { data: after } = await sb.from('documents').select('total').eq('id', id).maybeSingle()
  const { error: wErr } = await sb
    .from('documents')
    .update({ amount_words: bahtText(Number(after?.total ?? 0)) })
    .eq('id', id)
  if (wErr) console.error('[documents] เขียนข้อความจำนวนเงินไม่สำเร็จ', wErr.message)

  return NextResponse.json({ ok: true, doc_no: docNo })
}
