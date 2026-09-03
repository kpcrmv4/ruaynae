import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { MAX_NAME_CATEGORY } from '@/lib/categories'
import type { Database } from '@/lib/database.types'

export const runtime = 'nodejs'

const UNIQUE_VIOLATION = '23505'

/**
 * PATCH /api/settings/categories/[id] — เปลี่ยนชื่อ · ลำดับ · เปิด-ปิดหมวด
 *
 * 🔴 ไม่มี DELETE โดยตั้งใจ — ลบหมวดที่มีรายการอ้างอยู่ทำให้ประวัติพัง
 * FK เป็น `on delete restrict` อยู่แล้ว การมีปุ่มลบจึงเป็นปุ่มที่กดแล้ว
 * ล้มเหลวเสมอสำหรับหมวดที่ใช้งานจริง · ปิดหมวดแทน: หายจากฟอร์มบันทึก
 * แต่รายการเก่ายังอ่านชื่อหมวดได้ตามปกติ
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  const sb = await getSupabaseServer()

  const { data: existing, error: rErr } = await sb
    .from('categories').select('id, kind').eq('id', id).maybeSingle()
  if (rErr) {
    console.error('[categories] อ่านหมวดไม่ได้', rErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const patch: Database['public']['Tables']['categories']['Update'] = {}
  try {
    const b = await req.json()
    if (typeof b?.name === 'string') {
      const name = b.name.trim().slice(0, MAX_NAME_CATEGORY)
      if (!name) return NextResponse.json({ error: 'NAME_REQUIRED' }, { status: 400 })
      patch.name = name
    }
    if (typeof b?.isActive === 'boolean') patch.is_active = b.isActive
    // 🔴 "หมวดนี้คือค่าวัสดุ" มีความหมายเฉพาะฝั่งรายจ่าย — ฐานข้อมูลมี check
    // กันไว้อีกชั้น แต่ต้องปฏิเสธที่นี่ด้วย ไม่งั้นผู้ใช้จะเจอ error ดิบของ
    // Postgres ที่อ่านไม่รู้เรื่องแทนประโยคไทยที่เราเขียนไว้
    if (typeof b?.isMaterial === 'boolean') {
      if (b.isMaterial && existing.kind !== 'expense') {
        return NextResponse.json({ error: 'MATERIAL_EXPENSE_ONLY' }, { status: 400 })
      }
      patch.is_material = b.isMaterial
    }
    if (b?.sortOrder !== undefined && b?.sortOrder !== null && b?.sortOrder !== '') {
      const n = Number(b.sortOrder)
      if (!Number.isInteger(n) || n < 1 || n > 999) {
        return NextResponse.json({ error: 'SORT_ORDER_INVALID' }, { status: 400 })
      }
      patch.sort_order = n
    }
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'NOTHING_TO_UPDATE' }, { status: 400 })
  }

  const { data, error } = await sb
    .from('categories')
    .update(patch)
    .eq('id', id)
    .select('id, name, kind, sort_order, is_active, is_material')
    .maybeSingle()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return NextResponse.json({ error: 'NAME_TAKEN' }, { status: 409 })
    }
    console.error('[categories] แก้หมวดไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  // RLS ที่ปฏิเสธ update ไม่คืน error — โดน 0 แถวแล้วตอบว่าสำเร็จ
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true, category: data })
}
