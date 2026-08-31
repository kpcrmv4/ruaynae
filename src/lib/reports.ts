import { LOCALE, TZ } from '@/lib/constants'
import { todayInBangkok } from '@/lib/format'

/**
 * ช่วงเวลาของหน้ารายงาน
 *
 * 🔴 ทุกอย่างในนี้เป็น **ค.ศ.** ตามที่ฐานข้อมูลเก็บ — พ.ศ. เป็นเรื่องของการแสดงผล
 * เท่านั้น (CLAUDE.md §15) · ป้ายที่คนอ่านสร้างด้วย `Intl` ซึ่งแปลง พ.ศ. ให้เอง
 *
 * 🔴 คำนวณด้วย `Date.UTC` ล้วน ไม่แตะเขตเวลาของเครื่อง — `new Date(y, m, d)`
 * ใช้เขตเวลาเครื่อง ซึ่งบนเซิร์ฟเวอร์ UTC จะเลื่อนวันแรก/วันสุดท้ายของเดือน
 * ไปหนึ่งวันในบางกรณี แล้วยอดรวมของเดือนจะขาด/เกินโดยไม่มี error
 */
export type ReportMode = 'month' | 'year'

export type Period = {
  mode: ReportMode
  /** ค่าที่อยู่บน URL — `2026-08` (เดือน) หรือ `2026` (ปี) */
  key: string
  from: string
  to: string
  /** ความละเอียดของแกนเวลาในกราฟ */
  grain: 'day' | 'month'
  label: string
  /** ช่วงก่อนหน้าไว้เทียบ — เรียก RPC ตัวเดิมซ้ำ ไม่ต้องมีสูตรที่สอง */
  prev: { from: string; to: string; label: string }
}

const monthLabelFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  month: 'long',
  year: 'numeric',
})
const monthShortFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, month: 'short' })
const yearFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, year: 'numeric' })

const iso = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)

/** วันสุดท้ายของเดือน — วันที่ 0 ของเดือนถัดไปคือวันสุดท้ายของเดือนนี้ */
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

const monthLabel = (y: number, m: number) => monthLabelFmt.format(new Date(Date.UTC(y, m - 1, 1)))
const yearLabel = (y: number) => `ปี ${yearFmt.format(new Date(Date.UTC(y, 0, 1)))}`

/** `2026-08` → เดือนสิงหาคม 2026 · `2026` → ทั้งปี · ค่าที่อ่านไม่ออก = เดือนนี้ */
export function parsePeriod(raw: string | undefined, today = todayInBangkok()): Period {
  const [ty, tm] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))]

  const monthMatch = /^(\d{4})-(\d{2})$/.exec(raw ?? '')
  const yearMatch = /^(\d{4})$/.exec(raw ?? '')

  if (yearMatch) {
    const y = Number(yearMatch[1])
    if (y >= 2000 && y <= ty + 1) {
      return {
        mode: 'year',
        key: String(y),
        from: iso(y, 1, 1),
        to: iso(y, 12, 31),
        grain: 'month',
        label: yearLabel(y),
        prev: { from: iso(y - 1, 1, 1), to: iso(y - 1, 12, 31), label: yearLabel(y - 1) },
      }
    }
  }

  let y = ty
  let m = tm
  if (monthMatch) {
    const my = Number(monthMatch[1])
    const mm = Number(monthMatch[2])
    if (my >= 2000 && my <= ty + 1 && mm >= 1 && mm <= 12) {
      y = my
      m = mm
    }
  }

  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  return {
    mode: 'month',
    key: `${y}-${String(m).padStart(2, '0')}`,
    from: iso(y, m, 1),
    to: iso(y, m, lastDay(y, m)),
    grain: 'day',
    label: monthLabel(y, m),
    prev: { from: iso(py, pm, 1), to: iso(py, pm, lastDay(py, pm)), label: monthLabel(py, pm) },
  }
}

/** ตัวเลือกในกล่องเลือกช่วง — ย้อนหลัง 24 เดือน / 5 ปี นับจากวันนี้ */
export function periodOptions(mode: ReportMode, today = todayInBangkok()) {
  const ty = Number(today.slice(0, 4))
  const tm = Number(today.slice(5, 7))
  if (mode === 'year') {
    return Array.from({ length: 5 }, (_, i) => {
      const y = ty - i
      return { value: String(y), label: yearLabel(y) }
    })
  }
  return Array.from({ length: 24 }, (_, i) => {
    const total = ty * 12 + (tm - 1) - i
    const y = Math.floor(total / 12)
    const m = (total % 12) + 1
    return { value: `${y}-${String(m).padStart(2, '0')}`, label: monthLabel(y, m) }
  })
}

/** ป้ายสั้นใต้แท่งกราฟ — วันที่ (เลขวัน) หรือเดือน (ม.ค. ก.พ. …) */
export const bucketLabel = (isoDate: string, grain: 'day' | 'month'): string => {
  const d = new Date(`${isoDate}T00:00:00Z`)
  return grain === 'day' ? String(d.getUTCDate()) : monthShortFmt.format(d)
}

/**
 * เปลี่ยนแปลงกี่ % เทียบช่วงก่อน — `null` เมื่อช่วงก่อนเป็นศูนย์
 *
 * หารด้วยศูนย์แล้วได้ Infinity ซึ่งจะกลายเป็น "∞%" บนหน้าจอ · การไม่มีฐานให้เทียบ
 * ไม่ใช่การโตอนันต์ ต้องบอกว่า "ไม่มีข้อมูลช่วงก่อน" แทน
 */
export const pctChange = (now: number, before: number): number | null =>
  before === 0 ? null : Math.round(((now - before) / Math.abs(before)) * 100)

/**
 * ทุกวันในช่วง (`YYYY-MM-DD` ค.ศ.) — ใช้เป็นคอลัมน์ของตารางการทำงาน
 *
 * เดินด้วย `Date.UTC` ทีละวันเหมือนที่อื่นในไฟล์นี้ ไม่แตะเขตเวลาเครื่อง ·
 * มีเพดานกันลูปหลุดเมื่อมีคนส่งช่วงยาวผิดปกติเข้ามา
 */
export function daysInRange(from: string, to: string, max = 366): string[] {
  const out: string[] = []
  const end = Date.parse(`${to}T00:00:00Z`)
  let cur = Date.parse(`${from}T00:00:00Z`)
  while (cur <= end && out.length < max) {
    out.push(new Date(cur).toISOString().slice(0, 10))
    cur += 86_400_000
  }
  return out
}
