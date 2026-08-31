import { createHmac, randomBytes } from 'node:crypto'

/**
 * คีย์ของตัวเชื่อม MCP — สูตรอยู่ที่เดียว ใช้ทั้งฝั่งแอปและสคริปต์ตรวจ
 *
 * ไฟล์นี้ **ไม่มี** `server-only` และ **ไม่อ่าน env** เพราะสคริปต์ node ธรรมดา
 * ต้อง import ได้ · ตัวที่ผูกกับ env คือ `keys.ts` (แบบเดียวกับ pin-core.ts / pin.ts)
 */

/** จำนวนตัวอักษรหลัง `k_` ที่เก็บไว้โชว์ในตาราง */
export const KEY_PREFIX_LENGTH = 8

/** 32 ไบต์ → base64url ได้ 43 ตัวพอดี ไม่มี padding */
const KEY_RE = /^k_[A-Za-z0-9_-]{43}$/

export const isValidKey = (v: unknown): v is string => typeof v === 'string' && KEY_RE.test(v)

/** `k_` ข้างหน้าไว้ให้คนที่เจอค่านี้ใน log รู้ทันทีว่ามันคืออะไร */
export const generateKey = (): string => `k_${randomBytes(32).toString('base64url')}`

/**
 * 🔴 โดเมน `'mcp-key'` ต้องต่างจาก `'pin-lookup'` และ `'auth-password'` เสมอ
 * ถ้าใช้สูตรเดียวกัน ค่าที่รั่วจากฐานข้อมูลจะกลายเป็นของพร้อมใช้ทันที
 * (เหตุผลเดียวกับที่ `pin-core.ts` แยกโดเมนไว้ — CLAUDE.md §11)
 *
 * deterministic โดยตั้งใจ ไม่ใช่ bcrypt: ต้อง **หาแถวจากคีย์ที่ส่งมา** และต้องมี
 * unique index กันคีย์ซ้ำ · salt สุ่มทุกครั้งทำทั้งสองอย่างไม่ได้
 * ปลอดภัยพอเพราะ pepper อยู่ใน env ไม่ได้อยู่ในฐานข้อมูล และคีย์มี 256 บิต
 */
export const hashKey = (pepper: string, key: string): string =>
  createHmac('sha256', pepper).update(`mcp-key:${key}`).digest('hex')

/** ส่วนที่โชว์ได้ — เปิด 8 ตัวยังเหลือให้เดาอีก 35 ตัว (วิธีเดียวกับที่ GitHub ใช้) */
export const keyPrefix = (key: string): string => key.slice(0, 2 + KEY_PREFIX_LENGTH)
