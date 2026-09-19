/**
 * ประวัติการแก้ไข — ตัวช่วยแปลงให้คนอ่านออก
 *
 * 🔴 ประวัติที่อ่านไม่ออกคือประวัติที่ไม่มีใครเปิดดู · โชว์ jsonb ทั้งก้อน
 * เท่ากับไม่ได้โชว์อะไรเลย — ต้องบอกว่า **ฟิลด์ไหนเปลี่ยนจากอะไรเป็นอะไร**
 */

export const AUDIT_ACTIONS = ['INSERT', 'UPDATE', 'DELETE'] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** `Record<AuditAction, …>` โดยตั้งใจ — เพิ่มค่าแล้วไฟล์นี้จะพังตอน build */
export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  INSERT: 'เพิ่มใหม่',
  UPDATE: 'แก้ไข',
  DELETE: 'ลบ',
}

export const AUDIT_ACTION_TONE: Record<AuditAction, 'done' | 'info' | 'urgent'> = {
  INSERT: 'done',
  UPDATE: 'info',
  DELETE: 'urgent',
}

export const isAuditAction = (v: unknown): v is AuditAction =>
  typeof v === 'string' && (AUDIT_ACTIONS as readonly string[]).includes(v)

/** ชื่อตารางเป็นภาษาคน — ตารางที่ไม่ได้อยู่ในนี้แสดงชื่อดิบไปก่อน */
export const TABLE_LABEL: Record<string, string> = {
  profiles: 'ผู้ใช้ระบบ',
  branding: 'แบรนด์',
  app_settings: 'ตั้งค่าระบบ',
  sites: 'โครงการ',
  site_finance: 'ค่างานตามสัญญา',
  site_supervisors: 'ผู้ดูแลโครงการ',
  site_milestones: 'แผนงวดเงิน',
  categories: 'หมวดค่าใช้จ่าย',
  transactions: 'รายรับ-รายจ่าย',
  attachments: 'สลิปแนบ',
  upload_intents: 'คำขออัปโหลด',
  notifications: 'แจ้งเตือน',
  employees: 'คนงาน',
  employee_wages: 'ค่าแรงคนงาน',
  attendance: 'คนเข้าโครงการ',
  attendance_wages: 'ยอดค่าแรงรายวัน',
  attendance_adjustments: 'รายการปรับค่าแรง',
  wage_adjustment_presets: 'รายการปรับค่าแรงสำเร็จรูป',
  advances: 'เบิกล่วงหน้า',
  payroll_runs: 'การจ่ายค่าแรง',
  payroll_lines: 'บรรทัดจ่ายรายคน',
  login_attempts: 'ความพยายามล็อกอิน',
}

export const tableLabel = (t: string) => TABLE_LABEL[t] ?? t

/**
 * ฟิลด์ที่ไม่ต้องโชว์ — เปลี่ยนทุกครั้งอยู่แล้วและไม่ได้บอกอะไร
 * `updated_at` เปลี่ยนทุกการแก้ไขตามนิยาม ถ้าโชว์ด้วยจะกลบของจริงหมด
 */
const NOISE = new Set(['updated_at', 'created_at'])

export type FieldChange = { field: string; before: unknown; after: unknown }

/**
 * เทียบ before/after แล้วคืนเฉพาะฟิลด์ที่เปลี่ยนจริง
 *
 * INSERT → ไม่มี before · DELETE → ไม่มี after · ทั้งสองกรณีคืนลิสต์ว่าง
 * เพราะการ "เพิ่มทั้งแถว" กับ "ลบทั้งแถว" ไม่ได้มีฟิลด์ไหนน่าสนใจเป็นพิเศษ
 */
export function changedFields(
  before: unknown,
  after: unknown,
  limit = 6,
): FieldChange[] {
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') {
    return []
  }
  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  const out: FieldChange[] = []
  for (const key of Object.keys(a)) {
    if (NOISE.has(key)) continue
    if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) {
      out.push({ field: key, before: b[key], after: a[key] })
      if (out.length >= limit) break
    }
  }
  return out
}

/** ค่าหนึ่งค่าในรูปที่อ่านออก — `null` ต้องอ่านว่า "ว่าง" ไม่ใช่หายไปเฉย ๆ */
export function fieldValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(ว่าง)'
  if (typeof v === 'boolean') return v ? 'ใช่' : 'ไม่ใช่'
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80)
  return String(v).slice(0, 80)
}
