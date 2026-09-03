/**
 * ค่าใช้จ่ายรายเดือนที่ระบบลงให้เอง — ตรรกะล้วน ไม่แตะฐานข้อมูล ไม่แตะ React
 *
 * 🔴 ห้ามตั้งกฎเงินเดือนให้คนรายวัน — ค่าแรงของเขาเกิดตอนติ๊กเข้าโครงการแล้ว
 * ตั้งซ้ำ = ต้นทุนเป็นสองเท่า · ฐานข้อมูลก็กันไว้อีกชั้น (`guard_recurring`)
 */

export const MAX_NAME_RECURRING = 80

export const RECURRING_ERRORS: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่ตั้งค่าใช้จ่ายรายเดือนได้',
  NAME_REQUIRED: 'กรุณากรอกชื่อรายการ',
  AMOUNT_INVALID: 'จำนวนเงินต้องมากกว่า 0',
  CATEGORY_REQUIRED: 'กรุณาเลือกหมวด',
  DAY_INVALID: 'วันที่ลงต้องอยู่ระหว่าง 1–31',
  MONTH_INVALID: 'รูปแบบเดือนไม่ถูกต้อง',
  MONTH_BUDDHIST_ERA: 'ปีที่กรอกเป็น พ.ศ. — ระบบเก็บเป็น ค.ศ. กรุณาเลือกจากรายการ',
  MONTH_RANGE_INVALID: 'เดือนสิ้นสุดต้องไม่มาก่อนเดือนเริ่ม',
  EMPLOYEE_NOT_MONTHLY:
    'ตั้งเงินเดือนอัตโนมัติได้เฉพาะคนที่รับเป็นรายเดือน — คนรายวันมีค่าแรงจากการลงชื่อเข้าโครงการอยู่แล้ว',
  NOT_FOUND: 'ไม่พบรายการนี้',
  IN_USE: 'ลบไม่ได้เพราะมีรายการที่ระบบลงไว้แล้ว — ปิดใช้งานแทน',
  NOTHING_TO_UPDATE: 'ไม่มีอะไรให้บันทึก',
}
export const recurringError = (code?: string) =>
  RECURRING_ERRORS[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'

/** `YYYY-MM` → `YYYY-MM-01` — ฐานข้อมูลเก็บเดือนเป็นวันที่ 1 เสมอ */
export const monthToDate = (ym: string): string | null =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(ym) ? `${ym}-01` : null

/** `YYYY-MM-01` → `YYYY-MM` สำหรับ `<input type="month">` */
export const dateToMonth = (d: string | null): string => (d ? d.slice(0, 7) : '')

/**
 * รายชื่อเดือนย้อนหลังให้เลือกเป็นจุดเริ่ม
 *
 * ⚠️ ค่าที่ส่งลงฐานข้อมูลเป็น **ค.ศ.** เสมอ — ป้ายที่คนอ่านเป็น พ.ศ.
 * เพราะ `toLocaleDateString('th-TH')` แปลงให้ (CLAUDE.md §15)
 */
export function monthOptions(today: string, back = 24): { value: string; label: string }[] {
  const [y, m] = today.split('-').map(Number)
  const out: { value: string; label: string }[] = []
  for (let i = 0; i < back; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    const value = d.toISOString().slice(0, 7)
    out.push({
      value,
      label: d.toLocaleDateString('th-TH', {
        timeZone: 'UTC',
        month: 'long',
        year: 'numeric',
      }),
    })
  }
  return out
}
