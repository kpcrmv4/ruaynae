/**
 * ตัวเลข → ข้อความเงินภาษาไทย (แทน `BAHTTEXT()` ของ Excel ซึ่งไม่มีใน JavaScript)
 *
 * ไฟล์ของเจ้าของใช้ `CONCATENATE("( ", BAHTTEXT(K33), " )")` บนกระดาษทั้งสองใบ
 * ระบบจึงต้องผลิตข้อความชุดเดียวกันให้ได้ตัวต่อตัว:
 *   122,500        → หนึ่งแสนสองหมื่นสองพันห้าร้อยบาทถ้วน   (RC1136)
 *   580,000        → ห้าแสนแปดหมื่นบาทถ้วน                  (CM011)
 *
 * 🔴 **ปัดสองตำแหน่งก่อนแปลงเสมอ** — ยอดจริงในไฟล์ CM011 คือ
 * `579999.99999999988` (เศษทศนิยมลอยจากการถอดยอดกลับ) ถ้าไม่ปัดก่อน
 * จะได้ "ห้าแสนเจ็ดหมื่นเก้าพัน…" ซึ่งไม่ใช่สิ่งที่พิมพ์อยู่บนกระดาษจริง
 *
 * ฟังก์ชันบริสุทธิ์ · ไม่แตะ React ไม่แตะฐานข้อมูล · ทดสอบด้วย `verify-doc-math`
 */

const DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'] as const
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'] as const

/**
 * อ่านเลขที่น้อยกว่าหนึ่งล้าน
 *
 * กฎไทยที่ต่างจากการอ่านตรง ๆ สามข้อ ซึ่งเป็นที่มาของบั๊กเกือบทั้งหมด:
 * · หลักหน่วยเป็น 1 และมีหลักอื่นอยู่ข้างหน้า → **เอ็ด** (21 = ยี่สิบเอ็ด)
 * · หลักสิบเป็น 2 → **ยี่**สิบ (ไม่ใช่ "สองสิบ")
 * · หลักสิบเป็น 1 → **สิบ** เฉย ๆ (ไม่ใช่ "หนึ่งสิบ")
 */
function readBelowMillion(n: number): string {
  if (n === 0) return ''
  const str = String(n)
  const len = str.length
  let out = ''
  for (let i = 0; i < len; i++) {
    const d = Number(str[i])
    const place = len - i - 1
    if (d === 0) continue
    if (place === 0) out += d === 1 && len > 1 ? 'เอ็ด' : DIGITS[d]
    else if (place === 1) out += d === 1 ? 'สิบ' : d === 2 ? 'ยี่สิบ' : `${DIGITS[d]}สิบ`
    else out += DIGITS[d] + PLACES[place]
  }
  return out
}

/** อ่านจำนวนเต็ม — เกินล้านแบ่งเป็นก้อนแล้วอ่านซ้อนกัน (สิบสองล้านสามแสน…) */
function readInteger(n: number): string {
  if (n === 0) return 'ศูนย์'
  if (n >= 1_000_000) {
    const high = Math.floor(n / 1_000_000)
    const low = n % 1_000_000
    return `${readInteger(high)}ล้าน${low > 0 ? readBelowMillion(low) : ''}`
  }
  return readBelowMillion(n)
}

/**
 * `122500` → `หนึ่งแสนสองหมื่นสองพันห้าร้อยบาทถ้วน`
 *
 * · มีสตางค์ → `…บาท` + สตางค์ + `สตางค์` (ไม่มีคำว่า "ถ้วน")
 * · ศูนย์บาทแต่มีสตางค์ → บอกเฉพาะสตางค์ ไม่ต้องขึ้นต้นด้วย "ศูนย์บาท"
 * · ติดลบ → นำหน้าด้วย "ลบ" (ไม่ควรเกิดบนเอกสาร แต่ต้องไม่คืนค่าประหลาด)
 */
export function bahtText(value: number | null | undefined): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return 'ศูนย์บาทถ้วน'

  const sign = n < 0 ? 'ลบ' : ''
  // ปัดที่สตางค์ก่อนทุกครั้ง — เศษลอยจากการถอดยอดกลับต้องไม่หลุดเข้ามาถึงตรงนี้
  const cents = Math.round(Math.abs(n) * 100)
  const baht = Math.floor(cents / 100)
  const satang = cents % 100

  if (baht === 0 && satang > 0) return `${sign}${readInteger(satang)}สตางค์`
  if (satang === 0) return `${sign}${readInteger(baht)}บาทถ้วน`
  return `${sign}${readInteger(baht)}บาท${readInteger(satang)}สตางค์`
}
