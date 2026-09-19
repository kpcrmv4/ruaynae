/**
 * รายการปรับค่าแรงรายวัน — OT · เบี้ยเลี้ยง · มาสาย (คำสั่งเจ้าของ 19 ก.ย. 2569)
 *
 * ค่าคงที่และข้อความที่ใช้ร่วมกันระหว่างหน้าตั้งค่า · กล่องปรับค่าแรงในหน้าคนเข้าโครงการ
 * · API ทั้งสองฝั่ง — ตั้งชื่อรหัส error ที่เดียวเพื่อไม่ให้ข้อความไทยกระจายไปคนละไฟล์
 */
export type AdjustKind = 'add' | 'deduct'
export const ADJUST_KINDS = ['add', 'deduct'] as const satisfies readonly AdjustKind[]

export const ADJUST_KIND_LABEL: Record<AdjustKind, string> = {
  add: 'จ่ายเพิ่ม',
  deduct: 'หักออก',
}

export const isAdjustKind = (v: unknown): v is AdjustKind =>
  v === 'add' || v === 'deduct'

/** ชื่อรายการต้องอ่านออกในชิปแคบ ๆ บนการ์ดมือถือ */
export const MAX_ADJUST_NAME = 40
/** เพดานต่อบรรทัด — ตรงกับ check ในฐานข้อมูล */
export const MAX_ADJUST_AMOUNT = 999_999
/** จำนวนบรรทัดต่อการลงชื่อหนึ่งครั้ง — เกินนี้คือกรอกผิดหน้า ไม่ใช่กรณีจริง */
export const MAX_ADJUST_LINES = 12

/** รายการสำเร็จรูปจากหน้าตั้งค่า */
export type AdjustPreset = {
  id: string
  name: string
  kind: AdjustKind
  amount: number
  sort_order: number
  is_active: boolean
}

/** หนึ่งบรรทัดที่ผูกกับการลงชื่อ · `presetId` ว่าง = พิมพ์เอง */
export type AdjustLine = {
  presetId: string | null
  name: string
  kind: AdjustKind
  amount: number
}

/** ยอดสุทธิ (บวก − หัก) ของชุดบรรทัด — สูตรเดียวกับ trigger `sync_attendance_ot` */
export const adjustNet = (lines: readonly AdjustLine[]) =>
  lines.reduce((s, l) => s + (l.kind === 'add' ? l.amount : -l.amount), 0)

/**
 * ตรวจและทำความสะอาดชุดบรรทัดจาก client — ใช้ทั้ง POST /api/attendance และ
 * PUT /api/attendance/[id]/adjustments · คืนรหัส error ตัวแรกที่เจอ หรือชุดที่สะอาดแล้ว
 */
export function parseAdjustLines(
  raw: unknown,
): { ok: true; lines: AdjustLine[] } | { ok: false; code: string } {
  if (raw === undefined || raw === null) return { ok: true, lines: [] }
  if (!Array.isArray(raw)) return { ok: false, code: 'ADJUST_INVALID' }
  if (raw.length > MAX_ADJUST_LINES) return { ok: false, code: 'ADJUST_TOO_MANY' }

  const lines: AdjustLine[] = []
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>
    const name = String(o.name ?? '').trim().slice(0, MAX_ADJUST_NAME)
    if (!name) return { ok: false, code: 'ADJUST_NAME_REQUIRED' }
    if (!isAdjustKind(o.kind)) return { ok: false, code: 'ADJUST_INVALID' }
    const amount = Number(o.amount)
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_ADJUST_AMOUNT) {
      return { ok: false, code: 'ADJUST_AMOUNT_INVALID' }
    }
    const presetId = typeof o.presetId === 'string' && o.presetId ? o.presetId : null
    lines.push({ presetId, name, kind: o.kind, amount: Math.round(amount * 100) / 100 })
  }
  return { ok: true, lines }
}

export const ADJUST_ERRORS: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่ตั้งรายการปรับค่าแรงได้',
  NAME_REQUIRED: 'กรุณากรอกชื่อรายการ',
  NAME_TAKEN: 'มีรายการชื่อนี้อยู่แล้ว',
  KIND_INVALID: 'ต้องเลือกว่าจ่ายเพิ่มหรือหักออก',
  AMOUNT_INVALID: 'ยอดต้องเป็นตัวเลข 0 ขึ้นไป และไม่เกิน 999,999',
  SORT_ORDER_INVALID: 'ลำดับต้องเป็นจำนวนเต็ม 1–999',
  NOT_FOUND: 'ไม่พบรายการนี้',
  NOTHING_TO_UPDATE: 'ไม่มีอะไรให้บันทึก',
  ADJUST_INVALID: 'รูปแบบรายการปรับค่าแรงไม่ถูกต้อง',
  ADJUST_TOO_MANY: `ใส่รายการปรับได้ไม่เกิน ${MAX_ADJUST_LINES} บรรทัดต่อคนต่อวัน`,
  ADJUST_NAME_REQUIRED: 'รายการที่พิมพ์เองต้องมีชื่อ',
  ADJUST_AMOUNT_INVALID: 'ยอดของรายการปรับต้องมากกว่า 0 และไม่เกิน 999,999',
  // จากฐานข้อมูล — หักจนค่าแรงของวันติดลบ / วันที่ปิดรอบจ่ายแล้ว
  WAGE_NEGATIVE: 'หักมากกว่าค่าแรงของวันนี้ไม่ได้ — ค่าแรงสุทธิต้องไม่ติดลบ',
  PAYROLL_CLOSED: 'วันนี้จ่ายค่าแรงไปแล้ว แก้รายการปรับไม่ได้',
  ADJUST_FAILED: 'ลงชื่อแล้ว แต่บันทึกรายการปรับค่าแรงไม่สำเร็จ — เปิดดูคนนี้แล้วตั้งใหม่อีกครั้ง',
}
export const adjustError = (code?: string) =>
  ADJUST_ERRORS[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'

/** แปล error ดิบจาก Postgres เป็นรหัสที่หน้าจออ่านได้ · undefined = ไม่รู้จัก */
export function adjustDbCode(message: string | undefined): string | undefined {
  const m = message ?? ''
  if (m.includes('attendance_wages_amount_nonneg')) return 'WAGE_NEGATIVE'
  if (m.includes('PAYROLL_CLOSED')) return 'PAYROLL_CLOSED'
  if (/row-level security/i.test(m)) return 'FORBIDDEN'
  return undefined
}
