import 'server-only'

import type { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/**
 * จำกัดจำนวนครั้งที่ล็อกอินผิด
 *
 * นับใน **ฐานข้อมูล** ไม่ใช่ Map ในหน่วยความจำ — Vercel รันหลาย instance
 * และแต่ละตัวจำคนละเรื่อง limiter ที่นับในหน่วยความจำจึงกันอะไรไม่ได้เลย
 * และจะดู "ทำงาน" ตอน dev เพราะมี instance เดียว
 */

/** พลาดได้กี่ครั้งในหน้าต่างนี้ ก่อนโดนบล็อก */
export const MAX_FAILURES = 5
export const WINDOW_MINUTES = 15

export type AttemptKind = 'password' | 'pin'

/**
 * IP ของผู้เรียก — บน Vercel อ่านจาก x-forwarded-for
 * คืน null ได้ถ้าอ่านไม่ได้ · ยังนับต่อ identifier ได้อยู่
 */
export function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return req.headers.get('x-real-ip')
}

/**
 * ถูกบล็อกอยู่ไหม — นับทั้งต่อ IP และต่อ identifier
 * ต่อ IP อย่างเดียวไม่พอ เพราะคนร้ายเปลี่ยน IP ได้
 * ต่อ identifier อย่างเดียวก็ไม่พอ เพราะ PIN login ยังไม่รู้ว่าใครจนกว่าจะถูก
 */
export async function isBlocked(
  ip: string | null,
  identifier: string | null,
  kind: AttemptKind,
): Promise<boolean> {
  const admin = getSupabaseAdmin()
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()

  for (const [col, val] of [
    ['ip', ip],
    ['identifier', identifier],
  ] as const) {
    if (!val) continue
    const { count, error } = await admin
      .from('login_attempts')
      .select('id', { count: 'exact', head: true })
      .eq(col, val)
      .eq('kind', kind)
      .eq('ok', false)
      .gte('at', since)

    // error ที่ไม่ถูกเช็ค = limiter ที่เงียบและไม่กันอะไรเลย
    if (error) {
      console.error('[rate-limit] อ่าน login_attempts ไม่ได้', { col, message: error.message })
      continue
    }
    if ((count ?? 0) >= MAX_FAILURES) return true
  }
  return false
}

/** บันทึกผลทุกครั้ง ทั้งสำเร็จและไม่สำเร็จ — การโจมตีต้อง "มองเห็น" ไม่ใช่เงียบ */
export async function recordAttempt(
  ip: string | null,
  identifier: string | null,
  kind: AttemptKind,
  ok: boolean,
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('login_attempts')
    .insert({ ip, identifier, kind, ok })
  if (error) console.error('[rate-limit] บันทึก login_attempts ไม่ได้', error.message)
}

/** ล้างประวัติที่พลาดของ identifier นี้หลังล็อกอินสำเร็จ */
export async function clearFailures(identifier: string | null, kind: AttemptKind): Promise<void> {
  if (!identifier) return
  const { error } = await getSupabaseAdmin()
    .from('login_attempts')
    .delete()
    .eq('identifier', identifier)
    .eq('kind', kind)
    .eq('ok', false)
  if (error) console.error('[rate-limit] ล้าง login_attempts ไม่ได้', error.message)
}
