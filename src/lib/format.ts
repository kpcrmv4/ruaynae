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

const moneyFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 })

/** `2026-03-01` → `1 มี.ค. 2569` */
export const fmtDate = (iso: string | null | undefined): string =>
  iso ? dateFmt.format(new Date(`${iso}T00:00:00Z`)) : '—'

export const fmtDateLong = (iso: string | null | undefined): string =>
  iso ? dateLongFmt.format(new Date(`${iso}T00:00:00Z`)) : '—'

/** `1250000` → `1,250,000` — ไม่ใส่ ฿ เพราะบางที่วางไว้เป็นหน่วยแยก */
export const fmtMoney = (n: number | null | undefined): string => moneyFmt.format(n ?? 0)

export const fmtBaht = (n: number | null | undefined): string => `฿${fmtMoney(n)}`

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
