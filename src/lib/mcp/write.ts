import 'server-only'

import { todayInBangkok } from '@/lib/format'
import { asUuid, clampLimit, parseIsoDate, pickEnum } from '@/lib/mcp/args-core'
import { callMcpRpc, type ExecResult } from '@/lib/mcp/rpc'
import { parseAmount } from '@/lib/sites'
import {
  isIncomeKind, isPayMethod, parseTxnFields, txnError,
  MAX_NOTE, PAY_METHODS, TXN_KINDS,
} from '@/lib/transactions'

/**
 * เครื่องมือฝั่ง **เขียน** ของตัวเชื่อม MCP
 *
 * 🔴 ตัวตรวจพารามิเตอร์ต้องเป็น **ตัวเดียวกับที่ฟอร์มในแอปใช้** (`parseTxnFields`)
 * ไม่ใช่ชุดที่เขียนใหม่ให้คล้าย ๆ · กฎอย่าง "รายรับต้องมีประเภท" หรือ "ห้ามลง
 * วันในอนาคต" ที่ลอกมาไว้สองที่ จะเพี้ยนจากกันวันแรกที่มีคนแก้ข้างเดียว แล้ว
 * ช่องทาง AI จะกลายเป็นประตูหลังที่ยัดข้อมูลผิดกติกาเข้าฐานได้โดยไม่มีใครรู้
 *
 * 🔴 การยืนยันเกิดขึ้น **ในแชท** — คำอธิบายเครื่องมือ (tools.ts) สั่งให้โมเดล
 * สรุปให้เจ้าของอ่านแล้วถามก่อนเรียกทุกครั้ง · ฝั่งเซิร์ฟเวอร์บังคับข้อนี้ไม่ได้
 * สิ่งที่บังคับได้คือ **กันการบันทึกซ้ำ** (`client_ref`) และกันค่าที่ผิดกติกา
 * ซึ่งทำครบทั้งสองอย่างแล้วที่นี่และในฐานข้อมูล
 */

/** ลงชื่อคนเข้าโครงการทีเดียวได้กี่คน — โครงการใหญ่สุดที่เจอจริงยังไม่ถึงครึ่งนี้ */
const MAX_ENTRIES = 60

type Args = Record<string, unknown>

const fail = (message: string): ExecResult => ({ ok: false, message })

/** คีย์ที่ "ไม่ได้ส่งมา" กับ "ส่งมาเป็น null" ต่างกัน — null ของ site_id = ส่วนกลาง */
const has = (args: Args, key: string) => Object.prototype.hasOwnProperty.call(args, key)

const trimNote = (v: unknown): string | null => {
  const s = String(v ?? '').trim().slice(0, MAX_NOTE)
  return s === '' ? null : s
}

/**
 * แปลง args ของ `update_transaction` เป็น patch ที่มีเฉพาะคีย์ที่ส่งมาจริง
 *
 * ⚠️ คืน error เป็นรหัสของ `TXN_MESSAGES` เพื่อให้ข้อความตรงกับที่ฟอร์มในแอปบอก
 */
function buildPatch(args: Args, today: string): { ok: true; patch: Args } | { ok: false; code: string } {
  const patch: Args = {}

  if (has(args, 'amount')) {
    const a = parseAmount(args.amount)
    if (!a.ok || a.value <= 0) return { ok: false, code: 'AMOUNT_INVALID' }
    patch.amount = a.value
  }
  if (has(args, 'txn_date')) {
    const d = parseIsoDate(args.txn_date)
    if (!d) return { ok: false, code: 'DATE_INVALID' }
    if (d > today) return { ok: false, code: 'DATE_FUTURE' }
    patch.txn_date = d
  }
  if (has(args, 'category_id')) {
    const c = asUuid(args.category_id)
    if (!c) return { ok: false, code: 'CATEGORY_REQUIRED' }
    patch.category_id = c
  }
  // ส่ง null มาโดยตั้งใจ = ย้ายไปเป็นค่าใช้จ่ายส่วนกลาง ไม่ใช่ "ลืมกรอก"
  if (has(args, 'site_id')) {
    const raw = args.site_id
    if (raw === null || raw === '') patch.site_id = null
    else {
      const s = asUuid(raw)
      if (!s) return { ok: false, code: 'SITE_INVALID' }
      patch.site_id = s
    }
  }
  if (has(args, 'pay_method')) {
    if (!isPayMethod(args.pay_method)) return { ok: false, code: 'PAY_METHOD_INVALID' }
    patch.pay_method = args.pay_method
  }
  if (has(args, 'note')) patch.note = trimNote(args.note)
  if (has(args, 'income_kind')) {
    if (args.income_kind !== null && !isIncomeKind(args.income_kind)) {
      return { ok: false, code: 'INCOME_KIND_REQUIRED' }
    }
    patch.income_kind = args.income_kind
  }
  if (has(args, 'installment_no')) {
    const n = Number(args.installment_no)
    if (!Number.isInteger(n) || n < 1 || n > 999) return { ok: false, code: 'INSTALLMENT_INVALID' }
    patch.installment_no = n
  }

  if (Object.keys(patch).length === 0) return { ok: false, code: 'NOTHING_TO_UPDATE' }
  return { ok: true, patch }
}

type Entry = { employee_id: string; work_units: number; ot_amount: number }

/** ⚠️ `work_units` มีได้แค่ครึ่งวันหรือเต็มวัน — ค่าอื่นคือโมเดลเดาหน่วยเอง */
function parseEntries(raw: unknown): { ok: true; entries: Entry[] } | { ok: false; message: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, message: 'ต้องระบุ entries เป็นรายชื่อคนอย่างน้อยหนึ่งคน' }
  }
  if (raw.length > MAX_ENTRIES) {
    return { ok: false, message: `ลงชื่อได้ครั้งละไม่เกิน ${MAX_ENTRIES} คน` }
  }

  const entries: Entry[] = []
  for (const item of raw) {
    const o = (item ?? {}) as Args
    const id = asUuid(o.employee_id)
    if (!id) {
      return { ok: false, message: 'ทุกคนต้องมี employee_id ที่ได้จาก list_employees' }
    }
    const units = o.work_units === undefined || o.work_units === null ? 1 : Number(o.work_units)
    if (units !== 0.5 && units !== 1) {
      return { ok: false, message: 'work_units ใส่ได้แค่ 1 (เต็มวัน) หรือ 0.5 (ครึ่งวัน)' }
    }
    const ot = o.ot_amount === undefined || o.ot_amount === null ? 0 : Number(o.ot_amount)
    if (!Number.isFinite(ot) || ot < 0 || ot > 999_999) {
      return { ok: false, message: 'ot_amount ต้องเป็นจำนวนเงินตั้งแต่ 0 ขึ้นไป' }
    }
    // คนเดิมซ้ำในชุดเดียวกัน = โมเดลนับซ้ำ · ปล่อยไปฐานข้อมูลจะได้ ALREADY_SIGNED_IN
    // ซึ่งอ่านแล้วเหมือนระบบมีของเดิมอยู่ ทั้งที่ความจริงคือรายการที่ส่งมาผิดเอง
    if (entries.some((e) => e.employee_id === id)) {
      return { ok: false, message: 'มีคนซ้ำกันใน entries — ใส่ชื่อละครั้งเดียว' }
    }
    entries.push({ employee_id: id, work_units: units, ot_amount: Math.round(ot * 100) / 100 })
  }
  return { ok: true, entries }
}

export async function executeWriteTool(
  actorId: string,
  keyId: string,
  tool: string,
  args: Args,
): Promise<ExecResult> {
  const today = todayInBangkok()
  const base = { p_actor: actorId, p_key: keyId }

  switch (tool) {
    case 'record_transaction': {
      // ตัวเดียวกับที่ `/api/transactions` ใช้ — กติกาชุดเดียวทั้งสองทาง
      const parsed = parseTxnFields(args, today)
      if (!parsed.ok) return fail(txnError(parsed.error))
      const f = parsed.fields

      return callMcpRpc('mcp_create_transaction', {
        ...base,
        p_kind: f.kind,
        p_category: f.category_id,
        p_amount: f.amount,
        p_date: f.txn_date,
        p_site: f.site_id,
        p_pay_method: f.pay_method,
        p_income_kind: f.income_kind,
        p_installment_no: f.installment_no,
        p_note: f.note,
        p_client_ref: f.client_ref,
      }, 'บันทึกไม่สำเร็จ กรุณาลองใหม่')
    }

    case 'update_transaction': {
      const id = asUuid(args.transaction_id)
      if (!id) return fail('ต้องระบุ transaction_id — หาได้จาก search_transactions')
      const built = buildPatch(args, today)
      // ⚠️ NOTHING_TO_UPDATE ไม่มีใน TXN_MESSAGES (ฟอร์มในแอปกดปุ่มบันทึกโดยไม่แก้อะไร
      // ไม่ได้อยู่แล้ว) · ปล่อยให้ตกไปที่ข้อความกลางจะบอกโมเดลว่า "ไม่สำเร็จ" ลอย ๆ
      // แล้วมันจะลองใหม่ด้วยพารามิเตอร์ชุดเดิมไปเรื่อย ๆ
      if (!built.ok) {
        return fail(built.code === 'NOTHING_TO_UPDATE'
          ? 'ไม่ได้ส่งฟิลด์ที่จะแก้มาเลย — ระบุอย่างน้อยหนึ่งอย่าง เช่น amount หรือ txn_date'
          : txnError(built.code))
      }
      return callMcpRpc('mcp_update_transaction',
        { ...base, p_id: id, p_patch: built.patch }, 'แก้ไม่สำเร็จ กรุณาลองใหม่')
    }

    case 'delete_transaction': {
      const id = asUuid(args.transaction_id)
      if (!id) return fail('ต้องระบุ transaction_id — หาได้จาก search_transactions')
      return callMcpRpc('mcp_delete_transaction',
        { ...base, p_id: id }, 'ลบไม่สำเร็จ กรุณาลองใหม่')
    }

    case 'record_attendance': {
      const site = asUuid(args.site_id)
      if (!site) return fail('ต้องระบุ site_id — หาได้จาก list_sites')
      const date = args.work_date === undefined ? today : parseIsoDate(args.work_date)
      if (!date) return fail(txnError('DATE_INVALID'))
      if (date > today) return fail('ลงชื่อล่วงหน้าไม่ได้ — ค่าแรงของวันที่ยังไม่มาถึงคือต้นทุนที่ยังไม่เกิด')

      const parsed = parseEntries(args.entries)
      if (!parsed.ok) return fail(parsed.message)

      return callMcpRpc('mcp_record_attendance', {
        ...base, p_site: site, p_date: date, p_entries: parsed.entries,
      }, 'ลงชื่อไม่สำเร็จ กรุณาลองใหม่')
    }

    case 'record_advance': {
      const employee = asUuid(args.employee_id)
      if (!employee) return fail('ต้องระบุ employee_id — หาได้จาก list_employees')
      const amount = parseAmount(args.amount)
      if (!amount.ok || amount.value <= 0) return fail(txnError('AMOUNT_INVALID'))
      const date = args.advance_date === undefined ? today : parseIsoDate(args.advance_date)
      if (!date) return fail(txnError('DATE_INVALID'))
      if (date > today) return fail(txnError('DATE_FUTURE'))

      return callMcpRpc('mcp_create_advance', {
        ...base,
        p_employee: employee,
        p_amount: amount.value,
        p_date: date,
        p_pay_method: pickEnum(args.pay_method, PAY_METHODS) ?? 'cash',
        p_site: asUuid(args.site_id),
        p_note: trimNote(args.note),
      }, 'บันทึกเบิกไม่สำเร็จ กรุณาลองใหม่')
    }

    default:
      return fail(`ไม่มีเครื่องมือชื่อ ${tool}`)
  }
}

/** เครื่องมือค้นหา id ที่ฝั่งเขียนต้องใช้ — อ่านอย่างเดียวแต่เกิดมาเพื่อการเขียน */
export async function executeLookupTool(
  actorId: string,
  tool: string,
  args: Args,
): Promise<ExecResult> {
  if (tool === 'list_categories') {
    return callMcpRpc('mcp_categories', {
      p_actor: actorId,
      p_kind: pickEnum(args.kind, TXN_KINDS),
    }, 'อ่านข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
  }

  return callMcpRpc('mcp_employees', {
    p_actor: actorId,
    p_on: parseIsoDate(args.on_date),
    p_limit: clampLimit(args.limit, 100, 200),
  }, 'อ่านข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
}
