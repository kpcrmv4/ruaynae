#!/usr/bin/env node
/**
 * verify-doc-math.mjs — ปิดแถว `R12-CALC-*` · `R12-BAHT-*` · `R12-NO-02/04/05/06`
 *
 * ⚠️ `R12-NO-08` (ออกเลขพร้อมกันไม่ซ้ำ) อยู่ใน `verify-documents` แทน เพราะ
 * `next_doc_no()` เช็ค `is_owner()` ซึ่งเป็นเท็จเสมอเมื่อเรียกผ่าน management API
 * (ไม่มี session) — ต้องยิงด้วย JWT ของเจ้าของจริงถึงจะตัดสินได้
 *
 * 🔴 สูตรเงินของเอกสารถูกเขียนสองที่ (TS `src/lib/documents.ts` และ SQL
 * `doc_recalc()`) — ไฟล์นี้จึงขับ **ตารางเคสชุดเดียวกัน** เข้าไปทั้งสองฝั่ง
 * แล้วเทียบสามทาง: TS ตรงกับที่ตกลงไว้ไหม · SQL ตรงไหม · TS กับ SQL ตรงกันไหม
 * เขียนเทสต์แยกสองชุดจะเห็นตรงกันเฉพาะเคสที่คนเขียนนึกออกทั้งคู่ ซึ่งคือเซ็ต
 * ที่ไม่มีบั๊กอยู่แล้ว
 *
 * 🔴 จำนวนเคสต้องเท่ากับจำนวนเคสในเอกสารการตัดสินใจ (`docs/test-plan/R12.md`
 * หมวด 2 = 9 เคส) — เคสที่หายไปหนึ่งเคสคือกิ่งที่ไม่เคยถูกรัน
 *
 * ⚠️ ฉากทดสอบสร้างเอกสารจริงลงฐาน แล้วลบคืนพร้อม `audit_log` ของตัวเอง
 * โดยลบตาม **id ที่สร้างเอง** ไม่ใช่เดาจากสภาพข้อมูล (CLAUDE.md §17 ข้อ 24)
 */
import { readFileSync } from 'node:fs'
import { bahtText } from '../src/lib/baht-text.ts'
import { docTotals, parseDocNo, nextDocNoPreview, docNoSeq } from '../src/lib/documents.ts'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)

const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const sql = async (q) => {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    },
  )
  const t = await r.text()
  if (!r.ok) throw new Error(t.slice(0, 300))
  return JSON.parse(t)
}

const MARK = 'ตรวจสูตรเอกสาร'
const made = []

// ── ตารางเคส — ตรงกับ docs/test-plan/R12.md หมวด 2 ทีละแถว ──────────
const CASES = [
  { id: 'R12-CALC-01', label: 'RC1136 ของจริง · inclusive 7% · 1 บรรทัด ฿122,500',
    mode: 'inclusive', rate: 0.07, lines: [{ qty: 1, unitPrice: 122500 }],
    want: { subtotal: 114485.98, vat: 8014.02, total: 122500 } },
  { id: 'R12-CALC-02', label: 'CM011 ของจริง · inclusive 7% · 1 บรรทัด ฿580,000',
    mode: 'inclusive', rate: 0.07, lines: [{ qty: 1, unitPrice: 580000 }],
    want: { subtotal: 542056.07, vat: 37943.93, total: 580000 } },
  { id: 'R12-CALC-03', label: 'exclusive ตัวเดียวกัน — ต้องได้คนละยอดกับ 02 โดยตั้งใจ',
    mode: 'exclusive', rate: 0.07, lines: [{ qty: 1, unitPrice: 542056.07 }],
    want: { subtotal: 542056.07, vat: 37943.92, total: 579999.99 } },
  { id: 'R12-CALC-04', label: 'ไม่คิด VAT ฿100,000',
    mode: 'none', rate: 0.07, lines: [{ qty: 1, unitPrice: 100000 }],
    want: { subtotal: 100000, vat: 0, total: 100000 } },
  { id: 'R12-CALC-05', label: 'หลายบรรทัดลงตัว · inclusive 50,000 + 30,000 + 20,000',
    mode: 'inclusive', rate: 0.07,
    lines: [{ qty: 1, unitPrice: 50000 }, { qty: 1, unitPrice: 30000 }, { qty: 1, unitPrice: 20000 }],
    want: { subtotal: 93457.94, vat: 6542.06, total: 100000 } },
  { id: 'R12-CALC-06', label: '🔴 เศษไม่ลงตัว · inclusive 10+10+10 — Σ บรรทัดชนะ (28.05) ไม่ใช่ round(30÷1.07)=28.04',
    mode: 'inclusive', rate: 0.07,
    lines: [{ qty: 1, unitPrice: 10 }, { qty: 1, unitPrice: 10 }, { qty: 1, unitPrice: 10 }],
    want: { subtotal: 28.05, vat: 1.95, total: 30 } },
  { id: 'R12-CALC-07', label: 'qty ≠ 1 · inclusive 3 × ฿122,500',
    mode: 'inclusive', rate: 0.07, lines: [{ qty: 3, unitPrice: 122500 }],
    want: { subtotal: 343457.94, vat: 24042.06, total: 367500 } },
  { id: 'R12-CALC-08', label: 'ขอบล่าง · inclusive ฿0.01',
    mode: 'inclusive', rate: 0.07, lines: [{ qty: 1, unitPrice: 0.01 }],
    want: { subtotal: 0.01, vat: 0, total: 0.01 } },
  { id: 'R12-CALC-12', label: 'อัตราภาษีเก็บต่อเอกสาร · exclusive 10%',
    mode: 'exclusive', rate: 0.1, lines: [{ qty: 1, unitPrice: 1000 }],
    want: { subtotal: 1000, vat: 100, total: 1100 } },
]

const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const num = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005

console.log('\n── R12 · สูตรเงินของเอกสาร + ตัวอักษรไทย ────────────────────')

try {
  for (const c of CASES) {
    const ts = docTotals(c.lines, c.mode, c.rate)

    // ฝั่งฐานข้อมูล: สร้างเอกสารจริงแล้วให้ trigger คิดเอง
    const [{ id }] = await sql(`
      insert into public.documents (kind, customer_name, doc_date, vat_mode, vat_rate)
      values ('quotation', ${q(`${MARK} ${c.id}`)}, current_date, ${q(c.mode)}, ${c.rate})
      returning id`)
    made.push(id)
    const values = c.lines
      .map((l, i) => `('${id}', ${i + 1}, ${q(`บรรทัด ${i + 1}`)}, ${l.qty}, ${l.unitPrice})`)
      .join(', ')
    await sql(`insert into public.document_lines (document_id, seq, description, qty, unit_price)
               values ${values}`)
    const [db] = await sql(
      `select subtotal::text, vat_amount::text, total::text from public.documents where id = '${id}'`)
    const [lineSum] = await sql(
      `select coalesce(sum(line_total), 0)::text as s from public.document_lines where document_id = '${id}'`)

    const tsOk = num(ts.subtotal, c.want.subtotal) && num(ts.vat, c.want.vat) && num(ts.total, c.want.total)
    const dbOk = num(db.subtotal, c.want.subtotal) && num(db.vat_amount, c.want.vat) && num(db.total, c.want.total)
    // 🔴 ครึ่งที่คนลืมบ่อยที่สุด: บรรทัดบนกระดาษต้องบวกได้ยอดข้างล่างเป๊ะ
    const sumsOk = num(lineSum.s, c.want.subtotal)

    check(`${c.id} ${c.label}`,
      tsOk && dbOk && sumsOk && num(ts.subtotal, db.subtotal) && num(ts.vat, db.vat_amount),
      `TS ${ts.subtotal}/${ts.vat}/${ts.total} · DB ${db.subtotal}/${db.vat_amount}/${db.total} · Σบรรทัด ${lineSum.s}`)
  }

  check('R12-CALC-10 SQL กับ TS ตอบเท่ากันทุกเคส (ขับด้วยตารางเดียวกัน)',
    results.filter((r) => r.label.startsWith('R12-CALC-')).every((r) => r.ok),
    `${CASES.length} เคส`)

  check('R12-CALC-11 จำนวนเคสเท่ากับที่เอกสารการตัดสินใจระบุ (9 เคส)',
    CASES.length === 9, `${CASES.length} เคส`)

  // ── R12-CALC-09 · ยอด 0 / ติดลบ ต้องถูกปฏิเสธที่ฐานข้อมูล ───────────
  {
    const [{ id }] = await sql(`
      insert into public.documents (kind, customer_name, doc_date)
      values ('quotation', ${q(`${MARK} ศูนย์`)}, current_date) returning id`)
    made.push(id)
    let zero = ''
    let negative = ''
    try {
      await sql(`insert into public.document_lines (document_id, seq, description, qty, unit_price)
                 values ('${id}', 1, 'ศูนย์', 0, 100)`)
    } catch (e) { zero = String(e.message) }
    try {
      await sql(`insert into public.document_lines (document_id, seq, description, qty, unit_price)
                 values ('${id}', 2, 'ติดลบ', 1, -100)`)
    } catch (e) { negative = String(e.message) }
    const [{ n }] = await sql(
      `select count(*)::int as n from public.document_lines where document_id = '${id}'`)
    // ต้องถูกปฏิเสธโดย **check constraint ที่ตั้งใจ** ไม่ใช่ error อะไรก็ได้
    check('R12-CALC-09 จำนวน 0 และราคาติดลบถูกปฏิเสธด้วย check ที่ตั้งใจ · ไม่มีบรรทัดถูกเขียน',
      /document_lines_qty_check|qty > 0/.test(zero)
      && /document_lines_unit_price_check|unit_price >= 0/.test(negative)
      && Number(n) === 0,
      `0 → ${zero.slice(0, 40)} · ติดลบ → ${negative.slice(0, 40)} · เหลือ ${n} บรรทัด`)
  }

  // ── ตัวอักษรไทย ───────────────────────────────────────────────────
  const BAHT = [
    ['R12-BAHT-01', 122500, 'หนึ่งแสนสองหมื่นสองพันห้าร้อยบาทถ้วน'],
    ['R12-BAHT-02', 580000, 'ห้าแสนแปดหมื่นบาทถ้วน'],
    ['R12-BAHT-03', 579999.99999999988, 'ห้าแสนแปดหมื่นบาทถ้วน'],
    ['R12-BAHT-04', 21, 'ยี่สิบเอ็ดบาทถ้วน'],
    ['R12-BAHT-05', 11, 'สิบเอ็ดบาทถ้วน'],
    ['R12-BAHT-06', 100.25, 'หนึ่งร้อยบาทยี่สิบห้าสตางค์'],
    ['R12-BAHT-07', 0.5, 'ห้าสิบสตางค์'],
    ['R12-BAHT-08', 0, 'ศูนย์บาทถ้วน'],
    ['R12-BAHT-09', 1000000, 'หนึ่งล้านบาทถ้วน'],
    ['R12-BAHT-10', 1000001, 'หนึ่งล้านหนึ่งบาทถ้วน'],
    ['R12-BAHT-11', 12345678.9, 'สิบสองล้านสามแสนสี่หมื่นห้าพันหกร้อยเจ็ดสิบแปดบาทเก้าสิบสตางค์'],
  ]
  for (const [id, input, want] of BAHT) {
    const got = bahtText(input)
    check(`${id} ${input} → ${want}`, got === want, got === want ? '' : `ได้ "${got}"`)
  }

  // ── เลขที่เอกสาร ──────────────────────────────────────────────────
  {
    const rc = parseDocNo('RC1140')
    const cm = parseDocNo('CM011')
    check('R12-NO-02 กรอก RC1140 → ใบถัดไป RC1141',
      rc !== null && nextDocNoPreview(rc) === 'RC1141', rc ? nextDocNoPreview(rc) : 'แยกไม่ได้')
    check('R12-NO-04 กรอก CM011 (แพดสามหลัก) → CM012 ไม่ใช่ CM0012',
      cm !== null && cm.pad === 3 && nextDocNoPreview(cm) === 'CM012',
      cm ? `pad=${cm.pad} → ${nextDocNoPreview(cm)}` : 'แยกไม่ได้')
    check('R12-NO-05 ค่าที่ไม่ลงท้ายด้วยตัวเลขถูกปฏิเสธ · ค่าที่ถูกต้องยังผ่าน',
      parseDocNo('RC') === null && parseDocNo('') === null && parseDocNo('1141') !== null,
      'RC / ว่าง = null · 1141 = ผ่าน')
    check('R12-NO-06 อ่านส่วนตัวเลขของเลขที่เอกสารได้ (ใช้กันตั้งเลขย้อนหลัง)',
      docNoSeq('RC1141') === 1141 && docNoSeq('CM012') === 12, 'RC1141=1141 · CM012=12')
  }

} finally {
  if (made.length) {
    const list = made.map((id) => `'${id}'`).join(', ')
    // ต้องปลดสถานะก่อน เพราะ guard ห้ามลบเอกสารที่ไม่ใช่ร่าง
    await sql(`update public.documents set status = 'draft', doc_no = null where id in (${list})`)
    await sql(`delete from public.documents where id in (${list})`)
    for (const id of made) {
      await sql(`delete from public.audit_log
                  where row_id::text = '${id}'
                     or before::text like '%${id}%' or after::text like '%${id}%'`)
    }
    const [{ n }] = await sql(
      `select count(*)::int as n from public.documents where customer_name like ${q(`${MARK}%`)}`)
    console.log(Number(n) === 0
      ? '  (ลบเอกสารทดสอบแล้ว)'
      : `  ⚠️ ลบไม่ครบ — เหลือ ${n} ใบ`)
  }
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
