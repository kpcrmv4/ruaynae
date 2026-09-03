import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { parseEmployeeFields, type EmployeeArgs } from '@/lib/employees'
import type { Database } from '@/lib/database.types'

/**
 * 🔴 ตัวสร้างชนิดของ Supabase เขียนพารามิเตอร์ของฟังก์ชันเป็น non-null ทุกตัว
 * ทั้งที่ SQL ประกาศรับ NULL ได้ (เช่น `p_daily` ของคนรายเดือน)
 * แปลงที่นี่ที่เดียวพร้อมเหตุผล ดีกว่าไปใส่ `!` กระจายตามที่เรียก
 */
const rpcArgs = (a: EmployeeArgs) =>
  a as unknown as Database['public']['Functions']['save_employee']['Args']

export const runtime = 'nodejs'

/*
 * ไม่มี GET โดยตั้งใจ — แท็บคนงานเป็น Server Component อ่านฐานข้อมูลตรงได้
 */

/**
 * POST /api/employees — เพิ่มคนงาน (เจ้าของเท่านั้น)
 *
 * 🔴 เขียนผ่าน RPC `save_employee` ไม่ใช่ insert สองตารางเรียงกัน
 * ข้อมูลคนงานกับค่าแรงอยู่คนละตาราง (ค่าแรงเป็นความลับจากหัวหน้าโครงการ)
 * ยิงสอง request แล้ววันหนึ่งอันที่สองจะล้ม เหลือคนงานที่ไม่มีค่าแรง
 * ซึ่ง trigger จะคิดให้เป็น ฿0 ตลอดไปโดยไม่มีใครสังเกต
 */
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

  const parsed = parseEmployeeFields(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('save_employee', rpcArgs(parsed.args))

  if (error) {
    if (/employees_profile_id_key/.test(error.message)) {
      return NextResponse.json({ error: 'PROFILE_TAKEN' }, { status: 409 })
    }
    if (/FORBIDDEN/.test(error.message)) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
    console.error('[employees] เพิ่มคนงานไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, employee: { id: data } }, { status: 201 })
}
