import { parseAmount, MAX_NAME } from '@/lib/sites'
import { isUuid } from '@/lib/transactions'

export const WAGE_TYPES = ['daily', 'monthly'] as const
export type WageType = (typeof WAGE_TYPES)[number]

/** `Record<WageType, …>` โดยตั้งใจ — เพิ่มค่าใน enum แล้วไฟล์นี้จะพังตอน build */
export const WAGE_TYPE_LABEL: Record<WageType, string> = {
  daily: 'รายวัน',
  monthly: 'รายเดือน',
}

export const isWageType = (v: unknown): v is WageType =>
  typeof v === 'string' && (WAGE_TYPES as readonly string[]).includes(v)

/**
 * อาร์กิวเมนต์ของ RPC `save_employee`
 *
 * 🔴 ค่าแรงอยู่คนละตารางกับข้อมูลคนงาน (`employee_wages` เจ้าของอ่านได้คนเดียว)
 * เพราะ RLS ของ Postgres คุมระดับแถว ไม่ใช่ระดับคอลัมน์ · สองตารางต้องเปลี่ยน
 * พร้อมกันหรือไม่เปลี่ยนเลย จึงยิงผ่าน RPC ตัวเดียวที่อยู่ในทรานแซกชันเดียว
 */
export type EmployeeArgs = {
  p_id: string | null
  p_full_name: string
  p_job_title: string | null
  p_wage_type: WageType
  p_daily: number | null
  p_monthly: number | null
  p_default_site: string | null
  p_is_active: boolean
  p_profile: string | null
}

export type EmployeeParse =
  | { ok: true; args: EmployeeArgs }
  | { ok: false; error: string }

/**
 * ตรวจข้อมูลคนงานหนึ่งคน
 *
 * 🔴 คนรายวันต้องมีเรต และคนรายเดือนต้องมีเงินเดือน — ฐานข้อมูลก็บังคับด้วย
 * check constraint อยู่แล้ว แต่ตอบ 400 พร้อมเหตุผลดีกว่าปล่อยให้เป็น 500
 *
 * 🔴 ฟิลด์ของอีกประเภทถูกส่งเป็น `null` — คนที่เคยเป็นรายวันแล้วเปลี่ยนเป็น
 * รายเดือน ถ้าเรตรายวันยังค้างอยู่ วันหนึ่งจะมีคนอ่านมันไปใช้
 */
export function parseEmployeeFields(body: unknown, id: string | null = null): EmployeeParse {
  const o = (body ?? {}) as Record<string, unknown>

  const fullName = String(o.fullName ?? o.full_name ?? '').trim().slice(0, MAX_NAME)
  if (!fullName) return { ok: false, error: 'NAME_REQUIRED' }

  const wageType = o.wageType ?? o.wage_type ?? 'daily'
  if (!isWageType(wageType)) return { ok: false, error: 'WAGE_TYPE_INVALID' }

  const daily = parseAmount(o.dailyRate ?? o.daily_rate)
  if (!daily.ok) return { ok: false, error: 'RATE_INVALID' }
  const monthly = parseAmount(o.monthlySalary ?? o.monthly_salary)
  if (!monthly.ok) return { ok: false, error: 'RATE_INVALID' }

  if (wageType === 'daily' && daily.value <= 0) {
    return { ok: false, error: 'DAILY_RATE_REQUIRED' }
  }
  if (wageType === 'monthly' && monthly.value <= 0) {
    return { ok: false, error: 'MONTHLY_SALARY_REQUIRED' }
  }

  const jobTitle = String(o.jobTitle ?? o.job_title ?? '').trim().slice(0, MAX_NAME)
  const siteId = o.defaultSiteId ?? o.default_site_id
  const profileId = o.profileId ?? o.profile_id

  return {
    ok: true,
    args: {
      p_id: id,
      p_full_name: fullName,
      p_job_title: jobTitle === '' ? null : jobTitle,
      p_wage_type: wageType,
      p_daily: wageType === 'daily' ? daily.value : null,
      p_monthly: wageType === 'monthly' ? monthly.value : null,
      p_default_site: isUuid(siteId) ? siteId : null,
      p_is_active: o.isActive === undefined && o.is_active === undefined
        ? true
        : Boolean(o.isActive ?? o.is_active),
      p_profile: isUuid(profileId) ? profileId : null,
    },
  }
}

export const EMPLOYEE_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่จัดการคนงานได้',
  NAME_REQUIRED: 'กรุณากรอกชื่อคนงาน',
  WAGE_TYPE_INVALID: 'ประเภทค่าแรงไม่ถูกต้อง',
  RATE_INVALID: 'ค่าแรงต้องเป็นตัวเลขที่ไม่ติดลบ',
  DAILY_RATE_REQUIRED: 'คนรายวันต้องใส่ค่าแรงต่อวัน — ไม่ใส่แล้วต้นทุนจะเป็น ฿0 ตลอดไป',
  MONTHLY_SALARY_REQUIRED: 'คนรายเดือนต้องใส่เงินเดือน',
  PROFILE_TAKEN: 'บัญชีผู้ใช้นี้ถูกผูกกับคนงานคนอื่นไปแล้ว',
  NOT_FOUND: 'ไม่พบคนงานคนนี้',
  CREATE_FAILED: 'บันทึกไม่สำเร็จ กรุณาลองใหม่',
  UPDATE_FAILED: 'บันทึกไม่สำเร็จ กรุณาลองใหม่',
  // ── ลบคนงาน (R7) ────────────────────────────────────────────────
  EMPLOYEE_IN_PAYROLL:
    'ลบไม่ได้ — คนนี้อยู่ในรอบจ่ายค่าแรงที่ปิดแล้ว ซึ่งเป็นหลักฐานว่าจ่ายเงินไปเท่าไหร่ · ใช้ "ปิดใช้งาน" แทน',
  EMPLOYEE_HAS_HISTORY:
    'ลบไม่ได้ — คนนี้มีประวัติที่ลบตามไม่ได้ · ใช้ "ปิดใช้งาน" แทน',
  DELETE_FAILED: 'ลบไม่สำเร็จ กรุณาลองใหม่',
}

export const employeeError = (code?: string) =>
  EMPLOYEE_MESSAGES[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'
