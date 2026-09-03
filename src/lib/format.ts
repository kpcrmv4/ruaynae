import { LOCALE, TZ } from '@/lib/constants'

/**
 * ตัวจัดรูปแบบทั้งแอปอยู่ที่นี่ที่เดียว
 *
 * 🔴 ทุกตัวผูก `timeZone: TZ` ไว้ตายตัว · Vercel รัน function เป็น UTC
 * ปล่อยว่างแล้วเซิร์ฟเวอร์กับเบราว์เซอร์จะจัดรูปแบบคนละวันตอนหัวค่ำ
 * ซึ่งนอกจากเลขผิดแล้วยังทำให้ hydration ไม่ตรงกันด้วย
 *
 * 🔴 `th-TH` ใช้ปฏิทินพุทธเป็นค่าเริ่มต้น ตัวเลขปีที่ "แสดง" จึงเป็น พ.ศ.
 * แต่ค่าที่ "เก็บ" และที่ `<input type="date">` รับต้องเป็น ค.ศ. เสมอ
 * ห้ามเอาผลลัพธ์ของฟังก์ชันในไฟล์นี้ส่งกลับเข้าฐานข้อมูล
 */

const dateFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const dateLongFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const dateWeekdayFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const moneyFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 })

/** `2026-03-01` → `1 มี.ค. 2569` */
export const fmtDate = (iso: string | null | undefined): string =>
  iso ? dateFmt.format(new Date(`${iso}T00:00:00Z`)) : '—'

export const fmtDateLong = (iso: string | null | undefined): string =>
  iso ? dateLongFmt.format(new Date(`${iso}T00:00:00Z`)) : '—'

/** `2026-08-31` → `วันจันทร์ที่ 31 สิงหาคม 2569` — หัวหน้า "วันนี้" ต้องบอกวันในสัปดาห์
 *  เพราะงานก่อสร้างคิดเป็น จันทร์–เสาร์ ไม่ใช่เลขวันที่ */
export const fmtDateWithWeekday = (iso: string | null | undefined): string =>
  iso ? dateWeekdayFmt.format(new Date(`${iso}T00:00:00Z`)) : '—'

/** `1250000` → `1,250,000` — ไม่ใส่ ฿ เพราะบางที่วางไว้เป็นหน่วยแยก */
export const fmtMoney = (n: number | null | undefined): string => moneyFmt.format(n ?? 0)

export const fmtBaht = (n: number | null | undefined): string => `฿${fmtMoney(n)}`

/**
 * ขนาดไฟล์เป็นข้อความไทย · `1024` → `1 KB` · `0` → `0 ไบต์`
 *
 * 🔴 ไฟล์ที่เล็กกว่า 1 KB ถ้าปัดเป็น KB จะได้ "0 KB" ซึ่งคนอ่านว่า
 * "อัปโหลดไม่สำเร็จ" · ต่ำกว่า 1 KB จึงบอกเป็นไบต์ตรง ๆ
 *
 * ใช้ฐาน 1024 เท่ากับที่ระบบปฏิบัติการและ Cloudflare รายงาน
 */
const SIZE_UNITS = ['ไบต์', 'KB', 'MB', 'GB', 'TB'] as const
export const fmtBytes = (bytes: number | null | undefined): string => {
  const n = Math.max(0, bytes ?? 0)
  if (n < 1024) return `${fmtMoney(n)} ไบต์`
  let value = n
  let unit = 0
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  // ทศนิยมหนึ่งตำแหน่งพอ — "1.2 GB" อ่านง่ายกว่า "1.23456 GB"
  const digits = value < 10 && unit > 1 ? 1 : 0
  return `${value.toLocaleString(LOCALE, { maximumFractionDigits: digits })} ${SIZE_UNITS[unit]}`
}

/**
 * "วันนี้" ตามเวลาไทย ในรูป `YYYY-MM-DD` (ค.ศ.)
 *
 * `new Date().toISOString().slice(0,10)` ผิดตั้งแต่ 7 โมงเช้าของทุกวันบนเซิร์ฟเวอร์ UTC
 * ที่นี่ใช้ `en-CA` เพราะให้รูปแบบ `YYYY-MM-DD` และเป็นปฏิทินสากล ไม่ใช่ พ.ศ.
 */
export const todayInBangkok = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
