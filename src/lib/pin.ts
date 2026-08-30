import 'server-only'

import * as core from '@/lib/pin-core'

/**
 * PIN ฝั่งเซิร์ฟเวอร์ — ผูกสูตรใน `pin-core.ts` เข้ากับ `PIN_PEPPER` จาก env
 * และกันไม่ให้หลุดไปฝั่ง client ด้วย `server-only`
 */
const PEPPER = process.env.PIN_PEPPER

/**
 * 🔴 ห้ามมีค่า fallback เด็ดขาด
 * pepper ที่มีค่าเริ่มต้นแปลว่าทุก deployment ที่ลืมตั้ง env ใช้ค่าเดียวกัน
 * ซึ่งเท่ากับไม่มี pepper เลย — ล้มตอนโหลดโมดูลดีกว่าปลอดภัยแบบหลอก ๆ ตอนรัน
 */
if (!PEPPER) throw new Error('PIN_PEPPER is not configured')

export const { isValidPin, syntheticEmail } = core
export const PIN_LENGTH = core.PIN_LENGTH

export const hashPin = (pin: string) => core.hashPin(PEPPER, pin)
export const derivePassword = (pin: string) => core.derivePassword(PEPPER, pin)
