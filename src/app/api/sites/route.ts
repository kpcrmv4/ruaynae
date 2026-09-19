import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { parseSiteFields } from '@/lib/sites'

export const runtime = 'nodejs'

/*
 * ไม่มี GET โดยตั้งใจ — หน้า /sites เป็น Server Component อ่านฐานข้อมูลตรง
 * (เหตุผลเดียวกับ /api/settings/users · ดู ruling ใน .loop/state.json)
 */

/** POST /api/sites — สร้างโครงการ (เจ้าของเท่านั้น) */
export async function POST(req: NextRequest) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const parsed = parseSiteFields(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // client ที่ผูกกับเซสชัน ไม่ใช่ secret key — RLS จึงเป็นด่านจริง ไม่ใช่ if ข้างบน
  // และ audit_log จะได้ actor เป็นคนที่กดจริง (secret key ทำให้ auth.uid() เป็น null)
  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('sites')
    .insert({ ...parsed.fields, created_by: me.id })
    .select('id, name')
    .maybeSingle()

  if (error) {
    // 42501 = RLS ปฏิเสธ · ไม่ควรเกิดเพราะเช็ค role ไปแล้ว แต่ถ้าเกิดแปลว่า
    // policy กับโค้ดไม่ตรงกัน ต้องตอบ 403 ไม่ใช่ 500
    if (error.code === '42501') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    console.error('[sites] สร้างโครงการไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  // insert ที่ไม่คืนแถวคือการปฏิเสธแบบเงียบ — ห้ามตอบสำเร็จ
  if (!data) return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })

  // ค่างานอยู่คนละตาราง (`site_finance`) ที่เจ้าของเท่านั้นอ่าน/เขียนได้
  // trigger `sites_ensure_finance` สร้างแถวให้แล้วด้วยค่า 0 ตรงนี้จึงเป็น update
  if (parsed.contractAmount > 0 || parsed.bond.bond_kind !== null || parsed.bond.contract_no) {
    const { data: fin, error: fErr } = await sb
      .from('site_finance')
      .update({ contract_amount: parsed.contractAmount, ...parsed.bond })
      .eq('site_id', data.id)
      .select('site_id')
      .maybeSingle()
    // 🔴 update ที่ถูก RLS ปฏิเสธไม่คืน error — มันโดน 0 แถวแล้วบอกว่าสำเร็จ
    // ปล่อยผ่านคือโครงการที่ผู้ใช้กรอกค่างานไว้แต่ระบบบันทึกเป็น 0 โดยไม่มีใครรู้
    if (fErr || !fin) {
      console.error('[sites] บันทึกค่างานไม่สำเร็จ', fErr?.message ?? 'โดน 0 แถว')
      return NextResponse.json({ error: 'CONTRACT_SAVE_FAILED' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, site: data }, { status: 201 })
}
