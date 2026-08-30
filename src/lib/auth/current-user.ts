import 'server-only'

import { cache } from 'react'
import { redirect } from 'next/navigation'
import { getSupabaseServer } from '@/lib/supabase/server'
import type { Database } from '@/lib/database.types'

export type Role = Database['public']['Enums']['user_role']

export type CurrentUser = {
  id: string
  fullName: string
  role: Role
}

/**
 * โปรไฟล์ของคนที่ล็อกอินอยู่
 *
 * ห่อด้วย `cache()` ของ React — layout กับ page ในคำขอเดียวกันเรียกซ้ำได้
 * โดยยิงฐานข้อมูลรอบเดียว
 *
 * ⚠️ `proxy.ts` กันคนที่ยังไม่ล็อกอินไว้แล้ว แต่ที่นี่ยังต้องเช็คซ้ำ
 * เพราะ gate อาจถูกแก้ matcher วันหน้าแล้วหน้านี้หลุดออกไปโดยไม่มีใครสังเกต
 * — การป้องกันที่พึ่งไฟล์อื่นอย่างเดียวคือการป้องกันที่หายไปพร้อมกับไฟล์นั้น
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const sb = await getSupabaseServer()

  const { data: auth, error: aErr } = await sb.auth.getUser()
  if (aErr || !auth.user) redirect('/login')

  const { data, error } = await sb
    .from('profiles')
    .select('id, full_name, role, is_active')
    .eq('id', auth.user.id)
    .maybeSingle()

  if (error) {
    console.error('[current-user] อ่าน profile ไม่ได้', error.message)
    redirect('/login')
  }
  // ไม่มีแถว profile = บัญชี auth ที่ไม่มีตัวตนในระบบ ต้องไม่ให้ผ่าน
  if (!data || !data.is_active) redirect('/login')

  return { id: data.id, fullName: data.full_name, role: data.role }
})

/**
 * เหมือน `getCurrentUser` แต่คืน `null` แทนการ redirect
 *
 * 🔴 API route ต้องใช้ตัวนี้เสมอ
 * `redirect()` ใน route handler จะกลายเป็น 307 ไปหน้า HTML ซึ่ง `fetch`
 * จะตามไปแล้วได้ 200 ของหน้า login กลับมา — ฝั่ง client เห็นว่า "สำเร็จ"
 * ทั้งที่ไม่มีอะไรเกิดขึ้น · route กลุ่ม /api ต้องตอบ JSON 401 เท่านั้น
 */
export const getCurrentUserOrNull = cache(async (): Promise<CurrentUser | null> => {
  const sb = await getSupabaseServer()

  const { data: auth, error: aErr } = await sb.auth.getUser()
  if (aErr || !auth.user) return null

  const { data, error } = await sb
    .from('profiles')
    .select('id, full_name, role, is_active')
    .eq('id', auth.user.id)
    .maybeSingle()

  if (error) {
    console.error('[current-user] อ่าน profile ไม่ได้', error.message)
    return null
  }
  if (!data || !data.is_active) return null

  return { id: data.id, fullName: data.full_name, role: data.role }
})

export const isOwner = (u: CurrentUser) => u.role === 'owner'
