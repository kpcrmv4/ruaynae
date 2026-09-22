/**
 * ช่วงวันสำเร็จรูปของหน้ารายการ — ใช้ร่วมกันระหว่าง `/ledger` และ `/documents`
 *
 * 🔴 อยู่ใน `lib` ไม่ใช่ในไฟล์แถบตัวกรอง เพราะหน้าที่ใช้มันเป็น **Server Component**
 * ฟังก์ชันที่ export จากโมดูล `'use client'` เรียกจากเซิร์ฟเวอร์ไม่ได้ และอาการคือ
 * หน้าพังทั้งหน้าให้ผู้ใช้จริงโดยที่ `fetch` ยังได้ 200 (ดู `verify-client-boundary.mjs`)
 *
 * ทุกวันผูก `Asia/Bangkok` ผ่าน `today` ที่ผู้เรียกส่งมา — ไม่มีการอ่านนาฬิกาในนี้
 * และปีเป็น **ค.ศ. เสมอ** · พ.ศ. เป็นเรื่องของชั้นแสดงผลอย่างเดียว (CLAUDE.md §15)
 */
export type RangeKey = 'all' | 'today' | 'month' | 'last' | 'year' | 'custom'

export const RANGE_LABEL: Record<RangeKey, string> = {
  all: 'ทุกช่วงเวลา',
  today: 'วันนี้',
  month: 'เดือนนี้',
  last: 'เดือนที่แล้ว',
  year: 'ปีนี้',
  custom: 'กำหนดช่วงเอง…',
}

/** ช่วงวันของแต่ละตัวเลือก — `''` ทั้งคู่ = ไม่จำกัด (ไม่ส่ง from/to เลย) */
export function rangeDates(key: RangeKey, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastMonth = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }
  // วันสุดท้ายของเดือนก่อน = วันที่ 0 ของเดือนนี้
  const lastEnd = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)

  switch (key) {
    case 'today':
      return { from: today, to: today }
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'last':
      return { from: `${lastMonth.y}-${pad(lastMonth.m)}-01`, to: lastEnd }
    case 'year':
      return { from: `${y}-01-01`, to: today }
    default:
      return { from: '', to: '' }
  }
}

/** ค่าบน URL ตรงกับตัวเลือกสำเร็จรูปตัวไหน — ไม่ตรงเลยคือ "กำหนดเอง" */
export function detectRange(from: string, to: string, today: string): RangeKey {
  if (!from && !to) return 'all'
  for (const k of ['today', 'month', 'last', 'year'] as const) {
    const d = rangeDates(k, today)
    if (d.from === from && d.to === to) return k
  }
  return 'custom'
}

/** รับค่าจาก URL — ต้องเป็น `YYYY-MM-DD` เท่านั้น ที่เหลือทิ้ง */
export const asDateParam = (v: unknown): string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''
