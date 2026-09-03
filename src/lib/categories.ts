export { isTxnKind, TXN_KIND_LABEL, TXN_KINDS, type TxnKind } from '@/lib/transactions'

/** ชื่อหมวดสั้นกว่าชื่อโครงการ — มันต้องอ่านออกในชิปแคบ ๆ บนมือถือ */
export const MAX_NAME_CATEGORY = 60

/**
 * ปิดหมวดแทนการลบเสมอ
 *
 * 🔴 ลบหมวดที่มีรายการอ้างอยู่ = ประวัติพัง · FK เป็น `on delete restrict`
 * อยู่แล้ว ฐานข้อมูลจึงปฏิเสธให้ แต่ผู้ใช้จะเจอ error ที่อ่านไม่รู้เรื่อง
 * จึงไม่มีปุ่มลบเลย มีแต่ปุ่มปิด — หมวดที่ปิดแล้วหายจากฟอร์มบันทึก
 * แต่รายการเก่ายังแสดงชื่อหมวดได้ตามปกติ
 */
export const CATEGORY_ERRORS: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่แก้หมวดได้',
  NAME_REQUIRED: 'กรุณากรอกชื่อหมวด',
  NAME_TAKEN: 'มีหมวดชื่อนี้ในชนิดเดียวกันอยู่แล้ว',
  KIND_INVALID: 'ชนิดของหมวดไม่ถูกต้อง',
  SORT_ORDER_INVALID: 'ลำดับต้องเป็นจำนวนเต็ม 1–999',
  MATERIAL_EXPENSE_ONLY: 'หมวดรายรับตั้งเป็นค่าวัสดุไม่ได้',
  NOT_FOUND: 'ไม่พบหมวดนี้',
  NOTHING_TO_UPDATE: 'ไม่มีอะไรให้บันทึก',
}
export const categoryError = (code?: string) =>
  CATEGORY_ERRORS[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'
