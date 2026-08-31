import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { hashKey, isValidKey } from '@/lib/mcp/keys-core'

/**
 * คีย์ MCP ฝั่งเซิร์ฟเวอร์ — ผูกสูตรใน `keys-core.ts` เข้ากับ pepper จาก env
 *
 * 🔴 ห้ามมีค่า fallback ของ pepper เด็ดขาด — pepper ที่มีค่าเริ่มต้นแปลว่า
 * ทุก deployment ที่ลืมตั้ง env ใช้ค่าเดียวกัน ซึ่งเท่ากับไม่มี pepper เลย
 * ล้มตอนโหลดโมดูลดีกว่าปลอดภัยแบบหลอก ๆ ตอนรัน (แบบเดียวกับ pin.ts)
 */
const PEPPER = process.env.MCP_KEY_PEPPER
if (!PEPPER) throw new Error('MCP_KEY_PEPPER is not configured')

export const RATE_PER_MINUTE = 60
export const RATE_PER_DAY = 1000

export type McpAuth = { keyId: string; actorId: string }

/**
 * ให้ route ที่ออกคีย์ hash ได้โดยไม่ต้องรู้จัก pepper เอง
 * pepper อ่านที่เดียวในไฟล์นี้ — ทุกที่ที่อ่าน `process.env.MCP_KEY_PEPPER` เพิ่ม
 * คือที่ที่ลืมเช็คว่ามีค่าได้อีกที่หนึ่ง
 */
export const hashKeyWithPepper = (key: string): string => hashKey(PEPPER, key)

/**
 * หาเจ้าของคีย์ — คืน `null` ถ้าคีย์ผิด ถูกเพิกถอน หรือคนออกคีย์ถูกปิดบัญชี
 *
 * ⚠️ คนเรียกต้องแปลง `null` เป็น **401 ที่ไม่มี `WWW-Authenticate`** เสมอ
 */
export async function resolveKey(raw: string | null): Promise<McpAuth | null> {
  if (!isValidKey(raw)) return null

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('mcp_keys')
    .select('id, created_by, revoked_at, profiles!inner(is_active, role)')
    // `!` ปลอดภัยเพราะเช็ค `if (!PEPPER) throw` ไว้แล้วตอนโหลดโมดูล — TS ไม่ตาม
    // narrowing เข้าไปใน `function` declaration ที่ถูก hoist (ต่างจาก arrow function)
    .eq('key_hash', hashKey(PEPPER!, raw))
    .is('revoked_at', null)
    .maybeSingle()

  if (error) {
    console.error('[mcp] อ่าน mcp_keys ไม่ได้', error.message)
    return null
  }
  if (!data) return null

  // เผื่อไว้อีกชั้น — `mcp_assume_owner()` ก็เช็คเรื่องนี้ในฐานข้อมูลอีกที
  // การป้องกันที่พึ่งฝั่งเดียวคือการป้องกันที่หายไปพร้อมกับฝั่งนั้น
  const prof = data.profiles as unknown as { is_active: boolean; role: string }
  if (!prof?.is_active || prof.role !== 'owner') return null

  // ไม่ await — เวลาที่ใช้ล่าสุดพลาดไปหนึ่งครั้งไม่คุ้มกับการหน่วงทุกคำขอ
  void admin
    .from('mcp_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(({ error: e }) => {
      if (e) console.error('[mcp] อัปเดต last_used_at ไม่ได้', e.message)
    })

  return { keyId: data.id, actorId: data.created_by }
}

/**
 * นับใน **ฐานข้อมูล** ไม่ใช่ Map ในหน่วยความจำ — Vercel รันหลาย instance
 * และแต่ละตัวจำคนละเรื่อง (เหตุผลเดียวกับ `lib/auth/rate-limit.ts`)
 *
 * เพดานนี้กัน **โมเดลที่วนลูปเรียก tool** ไม่ใช่กันคนร้าย — คนร้ายโดนกันด้วยคีย์
 */
export async function isRateLimited(keyId: string): Promise<boolean> {
  const admin = getSupabaseAdmin()
  const now = Date.now()

  for (const [since, max] of [
    [new Date(now - 60_000).toISOString(), RATE_PER_MINUTE],
    [new Date(now - 86_400_000).toISOString(), RATE_PER_DAY],
  ] as const) {
    const { count, error } = await admin
      .from('mcp_call_log')
      .select('id', { count: 'exact', head: true })
      .eq('key_id', keyId)
      .gte('at', since)

    // error ที่ไม่ถูกเช็ค = limiter ที่เงียบและไม่กันอะไรเลย
    if (error) {
      console.error('[mcp] อ่าน mcp_call_log ไม่ได้', error.message)
      continue
    }
    if ((count ?? 0) >= max) return true
  }
  return false
}

/**
 * บันทึกทุกการเรียก ทั้งสำเร็จและไม่สำเร็จ
 *
 * ⚠️ `error` รับได้เฉพาะ **รหัสสั้น ๆ** ห้ามใส่พารามิเตอร์ของ tool ลงไป
 * คำค้นของเจ้าของอาจมีชื่อลูกค้า และตารางนี้ลบไม่ได้
 */
export async function logCall(
  keyId: string,
  tool: string,
  ok: boolean,
  ms: number,
  error?: string,
): Promise<void> {
  const { error: e } = await getSupabaseAdmin()
    .from('mcp_call_log')
    .insert({ key_id: keyId, tool, ok, ms, error: error?.slice(0, 80) ?? null })
  if (e) console.error('[mcp] บันทึก mcp_call_log ไม่ได้', e.message)
}
