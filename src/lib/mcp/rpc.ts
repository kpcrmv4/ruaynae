import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { TXN_MESSAGES } from '@/lib/transactions'

/**
 * ที่เดียวที่ฝั่ง MCP แตะฐานข้อมูล — ทั้งฝั่งอ่าน (`execute.ts`) และฝั่งเขียน (`write.ts`)
 *
 * ⚠️ ความล้มเหลวคืนเป็นข้อความ ไม่ใช่ throw — คนเรียกต้องแปลงเป็น
 * `isError: true` ใน 200 เพื่อให้โมเดลอธิบายให้ผู้ใช้ฟังได้ ไม่ใช่ให้เซสชันตาย
 */
export type ExecResult = { ok: true; data: unknown } | { ok: false; message: string }

/**
 * รหัสจาก guard trigger → ข้อความไทยที่โมเดลเอาไปเล่าต่อได้
 *
 * 🔴 ข้อความดิบของ Postgres ห้ามส่งออกไป — มันมีชื่อ constraint ชื่อคอลัมน์
 * และบางทีมีค่าในแถวติดมาด้วย ซึ่งเป็นรายละเอียดภายในที่ไม่ควรออกไปที่คลาวด์ AI
 * (เหตุผลเดียวกับ §17 ข้อ 13 ที่ห้ามเอา `e.message` ของเบราว์เซอร์ขึ้นจอ)
 *
 * รหัสที่ซ้ำกับฟอร์มในแอปอ่านจาก `TXN_MESSAGES` — ข้อความเดียวกันต้องมาจาก
 * ที่เดียวกัน ไม่งั้นวันหนึ่งคนถาม AI ได้คำตอบหนึ่ง เปิดแอปเห็นอีกอย่างหนึ่ง
 */
const EXTRA_MESSAGES: Record<string, string> = {
  MCP_ACTOR_NOT_OWNER: 'คีย์นี้ไม่มีสิทธิ์แล้ว กรุณาออกคีย์ใหม่จากหน้าเชื่อมต่อ AI',
  MCP_ACTOR_REQUIRED: 'คีย์นี้ใช้ไม่ได้แล้ว กรุณาออกคีย์ใหม่จากหน้าเชื่อมต่อ AI',
  TXN_NOT_FOUND: 'ไม่พบรายการนี้ — อาจถูกลบไปแล้ว ลองค้นด้วย search_transactions อีกครั้ง',
  SITE_NOT_FOUND: 'ไม่พบโครงการนี้ — ใช้ list_sites เพื่อดู site_id ที่ถูกต้อง',
  EMPLOYEE_NOT_FOUND: 'ไม่พบคนงานคนนี้ — ใช้ list_employees เพื่อดู employee_id ที่ถูกต้อง',
  EMPLOYEE_INACTIVE: 'คนงานคนนี้ถูกปิดใช้งานแล้ว',
  ENTRIES_REQUIRED: 'ต้องระบุอย่างน้อยหนึ่งคน',
  WORK_UNITS_EXCEEDED: 'คนนี้ถูกลงชื่อครบวันแล้ว — ดูจาก list_employees ว่าวันนั้นเขาอยู่โครงการไหน',
  ALREADY_SIGNED_IN: 'คนนี้ถูกลงชื่อที่โครงการนี้ในวันนั้นไปแล้ว',
  PAYROLL_CLOSED: 'วันนั้นอยู่ในรอบจ่ายค่าแรงที่ปิดแล้ว แก้ไม่ได้',
}

const codeOf = (msg: string): string | null => {
  const m = /\b([A-Z][A-Z0-9_]{4,})\b/.exec(msg)
  return m ? m[1] : null
}

/**
 * 🔴 เคยมีทางลัด "ส่งข้อความของ trigger ต่อทั้งประโยค" สำหรับ `ADVANCE_OVER_CEILING`
 * ซึ่งเป็นรหัสเดียวที่แนบตัวเลขมาด้วย · ตั้งแต่ 20 ก.ย. 2569 เบิกเกินได้แล้ว
 * รหัสนั้นจึงไม่มีทางเกิดอีก และทางลัดถูกถอดออกไปพร้อมกัน — กลไกที่ไม่มีใคร
 * เดินผ่านคือกลไกที่ไม่มีใครรู้ว่าพังเมื่อไหร่
 */
export function messageForDbError(raw: string, fallback: string): string {
  const code = codeOf(raw)
  if (code) {
    const known = EXTRA_MESSAGES[code] ?? TXN_MESSAGES[code]
    if (known) return known
  }
  // 23503 = FK ไม่มีปลายทาง · โมเดลแต่ง uuid ขึ้นมาเองเป็นเหตุที่พบบ่อยที่สุด
  if (/foreign key constraint|23503/.test(raw)) {
    return 'มี id ที่อ้างถึงไม่มีอยู่จริง — ใช้ list_sites / list_categories / list_employees เพื่อหา id ที่ถูกต้อง'
  }
  return fallback
}

/**
 * เรียกฟังก์ชัน `mcp_*` ด้วย service key
 *
 * 🔴 ฟังก์ชันฝั่งเขียนทุกตัวเริ่มด้วย `mcp_begin_write()` ซึ่งสวมสิทธิ์เจ้าของ
 * ให้ก่อนแตะตาราง · เรียกตารางตรง ๆ ด้วย admin client แทนไม่ได้ เพราะ
 * `auth.uid()` จะเป็น null แล้ว guard trigger จะข้ามการเติม `created_by`
 */
export async function callMcpRpc(
  fn: string,
  params: Record<string, unknown>,
  fallback = 'ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
): Promise<ExecResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ชื่อ RPC เป็นค่าที่คำนวณ
  const { data, error } = await (getSupabaseAdmin().rpc as any)(fn, params)
  if (error) {
    console.error(`[mcp] ${fn} ล้มเหลว`, error.message)
    return { ok: false, message: messageForDbError(error.message ?? '', fallback) }
  }
  return { ok: true, data }
}
