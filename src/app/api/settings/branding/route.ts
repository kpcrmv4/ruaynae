import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { deleteObject } from '@/lib/r2'
import type { Database } from '@/lib/database.types'

export const runtime = 'nodejs'

/** PATCH /api/settings/branding — บันทึกชื่อบริษัทและคีย์โลโก้ */
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUserOrNull()
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  let companyName: string | undefined
  let logoObjectKey: string | null | undefined
  try {
    const body = await req.json()
    if (typeof body?.companyName === 'string') companyName = body.companyName.trim().slice(0, 120)
    if ('logoObjectKey' in (body ?? {})) {
      logoObjectKey = body.logoObjectKey === null ? null : String(body.logoObjectKey)
    }
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  if (companyName === undefined && logoObjectKey === undefined) {
    return NextResponse.json({ error: 'NOTHING_TO_UPDATE' }, { status: 400 })
  }

  const sb = await getSupabaseServer()

  // อ่านคีย์เดิมไว้ก่อน เพื่อลบไฟล์เก่าทิ้งหลังเปลี่ยนสำเร็จ
  const { data: before, error: bErr } = await sb
    .from('branding')
    .select('logo_object_key')
    .maybeSingle()
  if (bErr) {
    console.error('[branding] อ่านค่าเดิมไม่ได้', bErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }

  // ใช้ type ของตารางตรง ๆ ไม่ใช่ Record<string, unknown>
  // ไม่งั้นพิมพ์ชื่อคอลัมน์ผิดแล้วจะรู้ตอน runtime แทนที่จะรู้ตอน compile
  const patch: Database['public']['Tables']['branding']['Update'] = {}
  if (companyName !== undefined) patch.company_name = companyName
  if (logoObjectKey !== undefined) patch.logo_object_key = logoObjectKey

  // 🔴 อ่านผลกลับมาเสมอ — RLS ที่ปฏิเสธจะโดน 0 แถวโดย PostgREST ตอบว่าสำเร็จ
  // เช็คแค่ error จะรายงานว่า "บันทึกแล้ว" ทั้งที่ไม่ได้เขียนอะไรเลย
  const { data, error } = await sb
    .from('branding')
    .update(patch)
    .eq('id', true)
    .select('company_name, logo_object_key')
    .maybeSingle()

  if (error) {
    console.error('[branding] บันทึกไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  // ลบโลโก้เก่าหลังบันทึกสำเร็จเท่านั้น — ลบก่อนแล้วบันทึกพลาด = ไฟล์หายฟรี
  const oldKey = before?.logo_object_key
  if (oldKey && oldKey !== data.logo_object_key) {
    try {
      await deleteObject(oldKey)
    } catch (e) {
      // ไฟล์กำพร้าไม่ใช่เหตุให้คำขอล้มเหลว แต่ต้องเห็นใน log
      console.error('[branding] ลบโลโก้เก่าไม่ได้', oldKey, e instanceof Error ? e.message : e)
    }
  }

  return NextResponse.json({ ok: true, companyName: data.company_name, logoObjectKey: data.logo_object_key })
}
