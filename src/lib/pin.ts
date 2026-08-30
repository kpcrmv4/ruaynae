import 'server-only'

import { createHmac } from 'node:crypto'
import { PIN_LENGTH } from '@/lib/constants'

/**
 * PIN 6 หลักของหัวหน้าไซต์
 *
 * เก็บเป็น **hash แบบ deterministic** (HMAC + pepper) ไม่ใช่ข้อความจริง
 *   - deterministic เพราะหน้าล็อกอินมีแต่แป้นตัวเลข ไม่ได้ถามว่าคุณคือใคร
 *     ระบบต้องหาเจ้าของ PIN จากค่าที่กดมา → ต้อง lookup ด้วย hash ได้
 *     และต้องมี unique index กัน PIN ซ้ำ (PIN ซ้ำ = กดแล้วเข้าเป็นบัญชีคนอื่น)
 *     bcrypt ที่ salt สุ่มทุกครั้งทำสองอย่างนี้ไม่ได้
 *   - เจ้าของ **ตั้ง PIN ใหม่ได้ แต่ดูของเดิมไม่ได้** ซึ่งเพียงพอ:
 *     คนลืม PIN ก็ตั้งใหม่ให้ ไม่มีเหตุผลต้องอ่านค่าเดิมกลับมา
 *   - ฐานข้อมูลรั่วอย่างเดียวไม่พอจะได้ PIN — ต้องได้ pepper จาก env ด้วย
 *     แต่ **ยังต้องมี rate limit เสมอ** เพราะ 6 หลักมีแค่ล้านความเป็นไปได้
 */
const PEPPER = process.env.PIN_PEPPER

/**
 * 🔴 ห้ามมีค่า fallback เด็ดขาด
 * pepper ที่มีค่าเริ่มต้นแปลว่าทุก deployment ที่ลืมตั้ง env ใช้ค่าเดียวกัน
 * ซึ่งเท่ากับไม่มี pepper เลย — ล้มตอนโหลดโมดูลดีกว่าปลอดภัยแบบหลอก ๆ ตอนรัน
 */
if (!PEPPER) throw new Error('PIN_PEPPER is not configured')

/**
 * 🔴 แยก domain ของสองค่านี้ให้ขาดจากกัน
 *
 * ถ้า hash ที่เก็บในตาราง กับ รหัสผ่านของ auth.users มาจากสูตรเดียวกัน
 * ฐานข้อมูลที่รั่วจะกลายเป็น "รายการรหัสผ่านพร้อมใช้" ทันที
 * ผู้โจมตีไม่ต้องเดา PIN เลย แค่เอาค่าในคอลัมน์ไปล็อกอินตรง ๆ
 * prefix ที่ต่างกันทำให้ค่าที่เก็บใช้เป็นรหัสผ่านไม่ได้
 */
const hmac = (domain: string, pin: string) =>
  createHmac('sha256', PEPPER).update(`${domain}:${pin}`).digest('hex')

const PIN_RE = new RegExp(`^\\d{${PIN_LENGTH}}$`)

export function isValidPin(v: unknown): v is string {
  return typeof v === 'string' && PIN_RE.test(v)
}

/** ค่าที่เก็บลง `profiles.pin_hash` — มี unique index กัน PIN ซ้ำ */
export function hashPin(pin: string): string {
  return hmac('pin-lookup', pin)
}

/** รหัสผ่านของ auth.users — ไม่เคยถูกเก็บที่ไหน สร้างใหม่ทุกครั้งที่ต้องใช้ */
export function derivePassword(pin: string): string {
  return 'pin_' + hmac('auth-password', pin)
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
