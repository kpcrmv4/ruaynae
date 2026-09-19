import type { IncomeKind, PayMethod, TxnKind, TxnStatus } from '@/lib/transactions'

/** ค่าของแถวเท่าที่กล่องแก้ไขต้องใช้ — ส่งมาจาก Server Component ของแต่ละหน้า */
export type EditableTxn = {
  id: string
  kind: TxnKind
  status: TxnStatus
  createdBy: string | null
  siteId: string | null
  /** ชื่อโครงการของแถวนี้ — เผื่อโครงการปิดงานไปแล้วจนไม่อยู่ในลิสต์ให้เลือก */
  siteName: string | null
  categoryId: string
  /** ชื่อหมวดของแถวนี้ — เผื่อหมวดถูกปิดใช้งานไปแล้ว */
  categoryName: string | null
  amount: number
  txnDate: string
  payMethod: PayMethod
  incomeKind: IncomeKind | null
  installmentNo: number | null
  note: string | null
  attachments: { id: string }[]
}

/**
 * แถวรายการตามรูปที่ฐานข้อมูลคืนมา — ใช้เป็นขาเข้าของ `toEditableTxn`
 * (`TxnRowData` ของ `txn-row.tsx` เข้ารูปนี้อยู่แล้วโดยโครงสร้าง)
 */
type TxnRowLike = {
  id: string
  kind: TxnKind
  status: TxnStatus
  created_by: string | null
  site_id: string | null
  sites: { name: string } | null
  category_id: string
  categories: { name: string } | null
  amount: number
  txn_date: string
  pay_method: PayMethod
  income_kind: IncomeKind | null
  installment_no: number | null
  note: string | null
  attachments: { id: string }[]
}

/**
 * แถวจากฐานข้อมูล → ค่าที่กล่องแก้ไขใช้
 *
 * 🔴 อยู่ที่เดียว ไม่ใช่ก๊อปไว้ทุกที่ที่มีปุ่มแก้ไข — วันที่เพิ่มช่องใหม่
 * ในกล่องแก้ไข ที่ที่ลืมแก้จะส่งค่าว่างเข้าไปเงียบ ๆ แล้วการกดบันทึกจะล้าง
 * ค่าเดิมของช่องนั้นทิ้งโดยไม่มีใครรู้
 */
export const toEditableTxn = (t: TxnRowLike): EditableTxn => ({
  id: t.id,
  kind: t.kind,
  status: t.status,
  createdBy: t.created_by,
  siteId: t.site_id,
  siteName: t.sites?.name ?? null,
  categoryId: t.category_id,
  categoryName: t.categories?.name ?? null,
  amount: Number(t.amount),
  txnDate: t.txn_date,
  payMethod: t.pay_method,
  incomeKind: t.income_kind,
  installmentNo: t.installment_no,
  note: t.note,
  attachments: t.attachments,
})
