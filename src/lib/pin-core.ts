import { createHmac } from 'node:crypto'

/**
 * สูตร hash ของ PIN — เขียนที่เดียว ใช้ทั้งฝั่งแอปและสคริปต์ seed
 *
 * ไฟล์นี้ **ไม่มี** `server-only` และ **ไม่อ่าน env** เพราะสคริปต์ node ธรรมดา
 * ต้อง import ได้ · ตัวที่ผูกกับ env และกันไม่ให้หลุดไปฝั่ง client คือ `pin.ts`
 *
 * ถ้าสูตรนี้ถูกคัดลอกไปเขียนซ้ำที่อื่นเมื่อไหร่ วันหนึ่งสองที่จะเพี้ยนจากกัน
 * แล้ว PIN ที่ seed สร้างจะล็อกอินไม่ได้ โดยไม่มี error บอกว่าเพราะอะไร
 */

export const PIN_LENGTH = 6
const PIN_RE = new RegExp(`^\\d{${PIN_LENGTH}}$`)

export function isValidPin(v: unknown): v is string {
  return typeof v === 'string' && PIN_RE.test(v)
}

/**
 * 🔴 สองค่าข้างล่างต้องมาจากคนละ domain เสมอ
 *
 * ถ้าใช้สูตรเดียวกัน ค่าที่เก็บใน `profiles.pin_hash` จะกลายเป็นรหัสผ่านของ
 * `auth.users` ตรง ๆ — ฐานข้อมูลที่รั่วจะเป็นรายการรหัสผ่านพร้อมใช้
 * ผู้โจมตีไม่ต้องเดา PIN สักหลัก
 */
const hmac = (pepper: string, domain: string, pin: string) =>
  createHmac('sha256', pepper).update(`${domain}:${pin}`).digest('hex')

/** ค่าที่เก็บลง `profiles.pin_hash` — มี unique index กัน PIN ซ้ำ */
export const hashPin = (pepper: string, pin: string) => hmac(pepper, 'pin-lookup', pin)

/** รหัสผ่านของ `auth.users` — ไม่ถูกเก็บที่ไหน สร้างใหม่ทุกครั้งที่ต้องใช้ */
export const derivePassword = (pepper: string, pin: string) =>
  'pin_' + hmac(pepper, 'auth-password', pin)

/**
 * อีเมลสังเคราะห์ของบัญชี PIN — `auth.users` บังคับให้มีอีเมล
 * ⚠️ ห้ามแสดงบนหน้าจอ · คนใช้ไม่เคยพิมพ์มันและมันรับเมลไม่ได้
 */
export const syntheticEmail = (code: string) => `staff+${code}@staff.invalid`
