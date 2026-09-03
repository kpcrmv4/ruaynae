import type { Database } from '@/lib/database.types'
import type { BadgeTone } from '@/components/ui/badge'

export type SiteStatus = Database['public']['Enums']['site_status']

export const SITE_STATUSES = [
  'planning',
  'active',
  'paused',
  'done',
  'cancelled',
] as const satisfies readonly SiteStatus[]

/**
 * ป้ายสถานะภาษาไทย — ครบทั้ง 5 ค่าของ enum
 *
 * `Record<SiteStatus, …>` ไม่ใช่ `Record<string, …>` โดยตั้งใจ: วันที่มีใครเพิ่ม
 * ค่าที่ 6 เข้า enum แล้วรัน generate types ใหม่ ไฟล์นี้จะแดงทันที
 * ถ้าใช้ `Record<string, …>` ค่าใหม่จะโผล่บนหน้าจอเป็นภาษาอังกฤษดิบเงียบ ๆ
 */
export const SITE_STATUS_LABEL: Record<SiteStatus, string> = {
  planning: 'เตรียมงาน',
  active: 'กำลังก่อสร้าง',
  paused: 'หยุดชั่วคราว',
  done: 'ส่งมอบแล้ว',
  cancelled: 'ยกเลิก',
}

export const SITE_STATUS_TONE: Record<SiteStatus, BadgeTone> = {
  planning: 'pending',
  active: 'progress',
  paused: 'urgent',
  done: 'done',
  cancelled: 'info',
}

export const isSiteStatus = (v: unknown): v is SiteStatus =>
  typeof v === 'string' && (SITE_STATUSES as readonly string[]).includes(v)

/**
 * 🔴 กับดัก พ.ศ./ค.ศ. — ฐานข้อมูลเก็บ ค.ศ. เสมอ แต่คนไทยคิดเป็น พ.ศ.
 * `2569-01-01` เป็นวันที่ที่ถูกไวยากรณ์ Postgres จึงรับไว้โดยไม่มี error
 * แล้ววันที่จะเพี้ยนไป 543 ปีแบบไม่มีใครรู้ · ปีที่เกินช่วงนี้คือ พ.ศ. แน่นอน
 */
const YEAR_MIN = 1900
const YEAR_MAX = 2200

export type DateCheck =
  | { ok: true; value: string | null }
  | { ok: false; error: 'DATE_INVALID' | 'DATE_BUDDHIST_ERA' }

/** รับเฉพาะ `YYYY-MM-DD` · ค่าว่างแปลว่า "ยังไม่ตั้ง" ไม่ใช่ค่าผิด */
export function parseDate(raw: unknown): DateCheck {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: 'DATE_INVALID' }

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  if (!m) return { ok: false, error: 'DATE_INVALID' }

  const [, y, mo, d] = m
  const year = Number(y)
  if (year > YEAR_MAX) return { ok: false, error: 'DATE_BUDDHIST_ERA' }
  if (year < YEAR_MIN) return { ok: false, error: 'DATE_INVALID' }

  // `new Date('2026-02-31')` ไม่พังแต่เลื่อนไปเป็น 3 มี.ค. เงียบ ๆ
  // จึงต้องเทียบกลับว่าตัวเลขที่ได้ยังเป็นวันเดิม
  const dt = new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(dt.getTime())) return { ok: false, error: 'DATE_INVALID' }
  if (dt.getUTCMonth() + 1 !== Number(mo) || dt.getUTCDate() !== Number(d)) {
    return { ok: false, error: 'DATE_INVALID' }
  }
  return { ok: true, value: raw.trim() }
}

export type AmountCheck = { ok: true; value: number } | { ok: false; error: 'AMOUNT_INVALID' }

/** ค่างานตามสัญญา — 0 ได้ (ยังไม่ตั้ง) ติดลบไม่ได้ */
export function parseAmount(raw: unknown): AmountCheck {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: 0 }
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''))
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'AMOUNT_INVALID' }
  // numeric(14,2) — เกินนี้ Postgres จะ error ตอน insert ซึ่งกลายเป็น 500
  if (n > 999_999_999_999) return { ok: false, error: 'AMOUNT_INVALID' }
  return { ok: true, value: Math.round(n * 100) / 100 }
}

export const MAX_NAME = 120

const DAY_MS = 86_400_000

export type TimeProgress =
  /** ยังไม่ได้ตั้งวันเริ่มหรือวันจบ — ต่างจาก 0% ซึ่งอ่านเหมือน "ตั้งแล้วแต่ยังไม่เริ่ม" */
  | { kind: 'unset' }
  | { kind: 'ok'; percent: number; elapsedDays: number; totalDays: number; daysLeft: number }

/**
 * ความคืบหน้าตามเวลา — วันที่ผ่านไปเทียบกับช่วงงานทั้งหมด
 *
 * นับแบบ **รวมทั้งวันเริ่มและวันจบ** เพราะคนไทยพูดว่า "งาน 1–31 มี.ค. คือ 31 วัน"
 * ไม่ใช่ 30 · ผลต่างของวันที่ล้วน ๆ ได้ 30 ซึ่งจะทำให้ทุกแถบคลาดไปหนึ่งวัน
 *
 * 🔴 `today` ต้องเป็น "วันนี้ตามเวลาไทย" ที่คำนวณมาแล้ว (`todayInBangkok()`)
 * ห้ามให้ฟังก์ชันนี้เรียก `new Date()` เอง — บนเซิร์ฟเวอร์ UTC ตอนสามทุ่มครึ่ง
 * ของไทยจะกลายเป็นพรุ่งนี้ และแถบจะเดินเร็วไปหนึ่งวันทุกคืน
 */
export function timeProgress(
  startDate: string | null,
  endDate: string | null,
  today: string,
): TimeProgress {
  if (!startDate || !endDate) return { kind: 'unset' }

  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  const now = Date.parse(`${today}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(now)) return { kind: 'unset' }

  const totalDays = Math.round((end - start) / DAY_MS) + 1
  if (totalDays <= 0) return { kind: 'unset' }

  const rawElapsed = Math.round((now - start) / DAY_MS) + 1
  // หนีบทั้งสองด้าน: ก่อนเริ่มงานต้องเป็น 0 ไม่ใช่ค่าติดลบ · เลยกำหนดแล้ว
  // ต้องเป็น 100 ไม่ใช่ 140 — แถบที่ยาวเกินกรอบอ่านเหมือนหน้าจอพัง
  const elapsedDays = Math.min(Math.max(rawElapsed, 0), totalDays)
  const percent = Math.round((elapsedDays / totalDays) * 100)

  return {
    kind: 'ok',
    percent,
    elapsedDays,
    totalDays,
    // เลยกำหนดแล้วให้เป็นค่าติดลบ เพื่อให้หน้าจอบอกได้ว่า "เลยมาแล้วกี่วัน"
    daysLeft: Math.round((end - now) / DAY_MS),
  }
}

/**
 * คอลัมน์ของตาราง `sites` เท่านั้น
 *
 * 🔴 `contract_amount` **ไม่อยู่ในนี้** — มันย้ายไปตาราง `site_finance`
 * ที่เจ้าของเท่านั้นอ่านได้ เพราะสิทธิ์ระดับคอลัมน์ของ Postgres ให้กับ role
 * ของฐานข้อมูล แต่เจ้าของกับหัวหน้าโครงการเป็น role `authenticated` เหมือนกัน
 * แยกไม่ได้ · ค่าที่คนละบทบาทเห็นไม่เท่ากันต้องอยู่คนละแถว = คนละตาราง
 */
export type SiteFields = {
  name: string
  client_name: string | null
  client_phone: string | null
  address: string | null
  start_date: string | null
  end_date: string | null
  status: SiteStatus
}

export type SiteParse =
  | { ok: true; fields: SiteFields; contractAmount: number }
  | { ok: false; error: string }

const text = (v: unknown, max = MAX_NAME): string | null => {
  const s = String(v ?? '').trim().slice(0, max)
  return s === '' ? null : s
}

/**
 * ตรวจ payload ของทั้ง POST และ PATCH ด้วยตัวเดียวกัน
 *
 * เขียนแยกสองที่คือวิธีที่กฎหลุดไปข้างหนึ่ง — เคยเห็นบ่อยว่า POST กันค่าติดลบ
 * แต่ PATCH ไม่กัน แล้วคนแก้ค่างานเป็นติดลบผ่านหน้าแก้ไขได้
 */
export function parseSiteFields(b: unknown): SiteParse {
  const o = (b ?? {}) as Record<string, unknown>

  const name = text(o.name)
  if (!name) return { ok: false, error: 'NAME_REQUIRED' }

  const amount = parseAmount(o.contractAmount ?? o.contract_amount)
  if (!amount.ok) return { ok: false, error: amount.error }

  const start = parseDate(o.startDate ?? o.start_date)
  if (!start.ok) return { ok: false, error: start.error }
  const end = parseDate(o.endDate ?? o.end_date)
  if (!end.ok) return { ok: false, error: end.error }

  // ทั้งคู่ว่างได้ แต่ถ้าใส่ทั้งคู่ต้องเรียงถูก — ตรงกับ check constraint ในฐานข้อมูล
  // ตรวจที่นี่ด้วยเพื่อให้ได้ 400 พร้อมเหตุผล แทนที่จะเป็น 500 จาก constraint
  if (start.value && end.value && end.value < start.value) {
    return { ok: false, error: 'DATE_RANGE_INVALID' }
  }

  const rawStatus = o.status
  if (rawStatus !== undefined && rawStatus !== null && !isSiteStatus(rawStatus)) {
    return { ok: false, error: 'STATUS_INVALID' }
  }

  return {
    ok: true,
    fields: {
      name,
      client_name: text(o.clientName ?? o.client_name),
      client_phone: text(o.clientPhone ?? o.client_phone, 32),
      address: text(o.address ?? null, 400),
      start_date: start.value,
      end_date: end.value,
      status: isSiteStatus(rawStatus) ? rawStatus : 'active',
    },
    // เขียนลงคนละตาราง จึงคืนแยกออกมา — ปนกลับเข้า fields เมื่อไหร่
    // `.insert()` จะพังทันทีเพราะ type ของตาราง `sites` ไม่มีคอลัมน์นี้แล้ว
    contractAmount: amount.value,
  }
}
