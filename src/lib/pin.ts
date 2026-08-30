import 'server-only'

import { createHash } from 'node:crypto'
import { PIN_LENGTH } from '@/lib/constants'

/**
 * PIN 6 หลักของหัวหน้าไซต์
 *
 * PIN ถูกเก็บเป็นข้อความจริงในคอลัมน์ `profiles.pin` โดยมี `revoke select (pin)`
 * กันไม่ให้ anon/authenticated อ่าน — เหลือแค่ service-role ที่อ่านได้
 * เพราะเจ้าของต้อง "ดู" PIN ของลูกน้องที่ลืมได้ ซึ่ง hash ทำไม่ได้
 * ความไม่ซ้ำบังคับด้วย unique index บนคอลัมน์นั้น
 *
 * รหัสผ่านของ auth.users ถูก derive จาก PIN + pepper แบบ deterministic
 * เพื่อให้ล็อกอินผ่าน signInWithPassword ปกติได้ โดยไม่ต้องเก็บรหัสผ่านที่สอง
 */
const PEPPER = process.env.PIN_PEPPER

/**
 * 🔴 ห้ามมีค่า fallback เด็ดขาด
 * pepper ที่มีค่าเริ่มต้นแปลว่าทุก deployment ที่ลืมตั้ง env จะใช้ค่าเดียวกัน
 * ซึ่งเท่ากับไม่มี pepper เลย — ล้มตอน build ดีกว่าปลอดภัยแบบหลอก ๆ ตอนรัน
 */
if (!PEPPER) throw new Error('PIN_PEPPER is not configured')

const PIN_RE = new RegExp(`^\\d{${PIN_LENGTH}}$`)

export function isValidPin(v: unknown): v is string {
  return typeof v === 'string' && PIN_RE.test(v)
}

export function derivePassword(pin: string): string {
  return 'pin_' + createHash('sha256').update(`${PEPPER}:${pin}`).digest('hex')
}

/**
 * อีเมลสังเคราะห์สำหรับบัญชี PIN — auth.users บังคับให้มีอีเมล
 * ⚠️ ห้ามแสดงค่านี้บนหน้าจอเด็ดขาด · คนใช้ไม่เคยพิมพ์มันและมันรับเมลไม่ได้
 * พอโผล่บนหน้าโปรไฟล์จะอ่านว่า "นี่อีเมลฉันเหรอ ผิดหรือเปล่า" ทันที
 * ให้แสดงชื่อคนแทนเสมอ และไม่ต้องมีปุ่มเปลี่ยนอีเมลให้บัญชีแบบนี้
 */
export function syntheticEmail(code: string): string {
  return `staff+${code}@staff.invalid`
}
