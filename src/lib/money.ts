/**
 * ตัวเลขเงินของไซต์ — คณิตศาสตร์ล้วน ไม่แตะฐานข้อมูล ไม่แตะ React
 *
 * สูตรทั้งหมดมาจาก `DESIGN.md` §5.1:
 *   เก็บเงินแล้ว = Σ รายรับที่ **อนุมัติแล้ว** / ค่างานรวม
 *   ต้นทุน      = Σ รายจ่ายที่ **อนุมัติแล้ว** / ค่างานรวม
 *   กำไรคงเหลือ = ค่างานรวม − ต้นทุนที่เกิดขึ้นแล้ว
 */

/**
 * 🔴 ตัวสร้างชนิดของ Supabase เขียน `returns table` ทุกคอลัมน์เป็น non-null
 * ทั้งที่ RPC คืน `null` จริงเมื่อคนเรียกไม่มีสิทธิ์เห็นตัวเลข
 * ถ้าเชื่อชนิดที่มันสร้างให้ โค้ดจะข้ามการเช็ค null แล้ววาด `฿NaN`
 * ตรงจุดที่สำคัญที่สุด — แปลงผ่านตัวนี้เสมอ อย่าอ่านฟิลด์ดิบ
 */
export const asNullableNumber = (v: number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v)

export type SiteMoney = {
  /** `null` = ไม่มีสิทธิ์เห็น · `0` = ยังไม่ได้ตั้งค่างาน — คนละเรื่องกัน */
  contract: number | null
  income: number | null
  /** รายจ่ายที่อนุมัติแล้ว + ค่าแรงที่เกิดขึ้นแล้ว */
  cost: number
  /** ค่าแรงส่วนเดียว — ไว้บอกที่มาของตัวเลข ไม่ใช่ยอดแยกที่ต้องบวกเพิ่ม */
  wage?: number
}

export type MoneyBars =
  /** คนเรียกไม่มีสิทธิ์เห็นค่างาน/รายรับ → ไม่มีแถบ ไม่มีเปอร์เซ็นต์ ไม่มีกำไร */
  | { kind: 'hidden'; cost: number; wage: number }
  /** มีสิทธิ์เห็น แต่ยังไม่ได้ตั้งค่างาน → บอกตรง ๆ ห้ามหารด้วยศูนย์ */
  | { kind: 'no-contract'; income: number; cost: number; wage: number }
  | {
      kind: 'ok'
      contract: number
      income: number
      cost: number
      /** ส่วนที่มาจากค่าแรง — รวมอยู่ใน `cost` แล้ว ไม่ใช่ยอดที่ต้องบวกเพิ่ม */
      wage: number
      /** เปอร์เซ็นต์จริงที่เอาไปแสดง — เกิน 100 ได้ และต้องเห็นว่าเกิน */
      paidPercent: number
      costPercent: number
      /** ความกว้างของแถบ — ตัดที่ 100 ไม่งั้นแถบล้นออกนอกกรอบ */
      paidWidth: number
      costWidth: number
      profit: number
      /** ต้นทุนโตเร็วกว่าเงินที่เก็บได้ */
      overrun: boolean
    }

const pct = (part: number, whole: number): number => Math.round((part / whole) * 100)
const clamp = (n: number): number => Math.max(0, Math.min(100, n))

export function moneyBars(m: SiteMoney): MoneyBars {
  // ค่างานหรือรายรับเป็น null แม้ค่าเดียว = ไม่มีสิทธิ์เห็นภาพเงินของไซต์นี้
  // (RPC คืน null ทั้งคู่พร้อมกันเสมอ · เช็คทั้งสองเพื่อไม่ให้บั๊กฝั่ง SQL
  //  กลายเป็น NaN บนหน้าจอ)
  const wage = m.wage ?? 0

  if (m.contract === null || m.income === null) {
    return { kind: 'hidden', cost: m.cost, wage }
  }

  // 🔴 ค่างาน 0 คือตัวหารเป็นศูนย์ · ปล่อยผ่านจะได้ `Infinity%` หรือ `NaN%`
  // ซึ่งเรนเดอร์ออกมาเป็นข้อความจริง ๆ บนหน้าจอโดยไม่มี error ที่ไหนเลย
  if (m.contract <= 0) return { kind: 'no-contract', income: m.income, cost: m.cost, wage }

  const paidPercent = pct(m.income, m.contract)
  const costPercent = pct(m.cost, m.contract)

  return {
    kind: 'ok',
    contract: m.contract,
    income: m.income,
    cost: m.cost,
    wage,
    paidPercent,
    costPercent,
    paidWidth: clamp(paidPercent),
    costWidth: clamp(costPercent),
    // กำไรคงเหลือนับจาก **ต้นทุนที่เกิดขึ้นแล้ว** ไม่ใช่เงินที่เก็บได้
    // (DESIGN.md §5.1) — เก็บเงินช้าไม่ได้แปลว่ากำไรหด แปลว่ากระแสเงินสดตึง
    profit: m.contract - m.cost,
    // เทียบเปอร์เซ็นต์ที่ปัดแล้ว = ตรงกับตัวเลขที่คนอ่านเห็นบนหน้าจอ
    // เทียบค่าดิบจะได้ป้ายเตือนขึ้นทั้งที่สองแถวโชว์เปอร์เซ็นต์เท่ากัน
    overrun: costPercent > paidPercent,
  }
}

export const OVERRUN_LABEL = 'ต้นทุนโตเร็วกว่าเงินที่เก็บได้'
