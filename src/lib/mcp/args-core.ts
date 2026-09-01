/**
 * ตรวจพารามิเตอร์ที่ **โมเดลภาษาเป็นคนกรอก** — ไม่ใช่ฟอร์มที่คนกด
 *
 * โมเดลส่ง `limit: "ทั้งหมด"`, `limit: 100000`, `from: "2569-01-01"` มาได้หมด
 * และมันจะไม่รู้ตัวว่าผิดถ้าเราปล่อยผ่าน · ทุกอย่างต้องถูกบีบให้อยู่ในกรอบ
 * ก่อนแตะฐานข้อมูล ไม่ใช่หวังว่า schema จะกันให้
 */

/** ปีที่อยู่นอกช่วงนี้คือ พ.ศ. แน่นอน (เทียบกับ `parseDate` ใน lib/sites.ts) */
const YEAR_MIN = 1900
const YEAR_MAX = 2200

export function clampLimit(raw: unknown, def: number, max: number): number {
  if (raw === null || raw === undefined || raw === '') return def
  const n = Number(raw)
  if (!Number.isFinite(n)) return def
  return Math.min(Math.max(Math.trunc(n), 1), max)
}

export function clampOffset(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 0
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.min(Math.max(Math.trunc(n), 0), 100_000)
}

/**
 * รับเฉพาะ `YYYY-MM-DD` ที่เป็น ค.ศ. และมีอยู่จริงในปฏิทิน
 *
 * 🔴 `2569-03-15` ถูกไวยากรณ์ของ Postgres ทุกประการ มันจะรับไว้เงียบ ๆ
 * แล้ววันที่เพี้ยนไป 543 ปีโดยไม่มี error ที่ไหนเลย
 * 🔴 `new Date('2026-02-31')` ไม่พังแต่เลื่อนเป็น 3 มี.ค. — ต้องเทียบกลับ
 */
export function parseIsoDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null

  const year = Number(m[1])
  if (year < YEAR_MIN || year > YEAR_MAX) return null

  const dt = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(dt.getTime())) return null
  if (dt.getUTCMonth() + 1 !== Number(m[2]) || dt.getUTCDate() !== Number(m[3])) return null
  return s
}

/** ค่าที่ไม่อยู่ในรายการคืน `null` = "ไม่กรอง" ไม่ใช่ "กรองด้วยค่าที่โมเดลแต่งขึ้น" */
export function pickEnum<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  if (typeof raw !== 'string') return null
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * uuid ที่โมเดลส่งมา — ไม่ผ่านคืน `null`
 *
 * 🔴 โมเดลแต่ง uuid ที่หน้าตาถูกต้องขึ้นมาเองได้ทุกเมื่อ (มันเห็นรูปแบบมาแล้ว
 * เป็นล้านครั้ง) · ตัวตรวจนี้กันได้แค่ "ไม่ใช่ uuid" ส่วน "uuid ที่ไม่มีจริง"
 * ฐานข้อมูลเป็นคนปฏิเสธด้วย FK แล้วเราแปลเป็นข้อความให้โมเดลไปหา id ที่ถูก
 */
export const asUuid = (v: unknown): string | null =>
  typeof v === 'string' && UUID_RE.test(v.trim()) ? v.trim() : null
