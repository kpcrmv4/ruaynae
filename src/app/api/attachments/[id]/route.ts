import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { deleteObject } from '@/lib/r2'

export const runtime = 'nodejs'

/**
 * DELETE /api/attachments/[id] — เอาสลิปออกจากรายการ
 *
 * เรียกจากปุ่มกากบาทบนรูปในกล่องแก้ไขรายการ
 *
 * 🔴 ลบไฟล์ใน R2 ด้วย **หลังจาก**ลบแถวสำเร็จเท่านั้น — ลบไฟล์ก่อนแล้วแถว
 * ลบไม่ผ่าน จะเหลือแถวที่ชี้ไปยังไฟล์ที่ไม่มีอยู่ ซึ่งกดดูแล้วพังตลอดกาล
 * · กลับกัน ถ้าลบแถวได้แล้วลบไฟล์ไม่ได้ ผลคือไฟล์กำพร้าที่ไม่มีใครเห็น
 * ซึ่งเสียแค่พื้นที่ · เรียงลำดับตามความเสียหายที่ยอมได้
 *
 * ⚠️ ต่างจาก "สลิปเก็บถาวรไม่ลบ" ใน CLAUDE.md §9 — นั่นคือนโยบายของสลิป
 * ที่ผูกกับรายการอยู่ · อันนี้คือรูปที่ผู้ใช้ **สั่งเอาออกเอง** ซึ่งจะไม่มี
 * หน้าไหนแสดงมันอีกเลย เก็บไว้ก็จ่ายค่าพื้นที่ให้ไฟล์ที่ไม่มีทางถูกเปิด
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  const { id } = await ctx.params
  const sb = await getSupabaseServer()

  // อ่านคีย์ไว้ก่อน — หลังลบแถวแล้วไม่มีทางรู้ว่าไฟล์ไหนต้องถูกเก็บกวาด
  const { data: existing, error: rErr } = await sb
    .from('attachments')
    .select('id, object_key, thumb_key')
    .eq('id', id)
    .maybeSingle()
  if (rErr) {
    console.error('[attachments] อ่านสลิปไม่ได้', rErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const { data, error } = await sb
    .from('attachments').delete().eq('id', id).select('id').maybeSingle()
  if (error) {
    console.error('[attachments] ลบสลิปไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 })
  }
  // 🔴 RLS ที่ปฏิเสธ delete ไม่คืน error — โดน 0 แถวแล้วตอบว่าสำเร็จ
  if (!data) return NextResponse.json({ error: 'EDIT_FORBIDDEN' }, { status: 403 })

  // ไฟล์กำพร้าไม่ทำให้ผู้ใช้เห็นอะไรผิด — ล้มเหลวแล้วบอก log พอ ไม่ต้องล้มทั้งคำขอ
  await Promise.all(
    [existing.object_key, existing.thumb_key].map((key) =>
      deleteObject(key).catch((e: unknown) =>
        console.error('[attachments] ลบไฟล์ใน R2 ไม่สำเร็จ', key, e),
      ),
    ),
  )

  return NextResponse.json({ ok: true })
}
