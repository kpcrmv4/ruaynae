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

export type SiteFields = {
  name: string
  client_name: string | null
  client_phone: string | null
  address: string | null
  contract_amount: number
  start_date: string | null
  end_date: string | null
  status: SiteStatus
}

export type SiteParse =
  | { ok: true; fields: SiteFields }
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
      contract_amount: amount.value,
      start_date: start.value,
      end_date: end.value,
      status: isSiteStatus(rawStatus) ? rawStatus : 'active',
    },
  }
}
