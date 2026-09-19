#!/usr/bin/env node
/**
 * import-bonds.mjs — นำเข้าโครงการเก่าพร้อมหลักประกันสัญญาจากสเปรดชีตของเจ้าของ (R11)
 *
 * ไฟล์ตั้งต้น: `docs/import/bonds-2565-2567.csv` (คอลัมน์ตามตารางของเจ้าของ · วันเป็น
 * **พ.ศ.** แบบ d/m/yyyy อย่างที่พิมพ์ในสเปรดชีต · ยอดไม่มีคอมมา)
 *
 * 🔴 แปลง พ.ศ. → ค.ศ. **ที่นี่** ก่อนลงฐานข้อมูล — ฐานข้อมูลเก็บ ค.ศ. เสมอ (CLAUDE.md §15)
 *    ปีที่น้อยกว่า 2400 ถือว่าเป็น ค.ศ. อยู่แล้ว ไม่แปลงซ้ำ
 * 🔴 idempotent: ยึด `contract_no` เป็นคีย์ — รันซ้ำไม่สร้างโครงการซ้ำ แต่**อัปเดต**ค่าหลักประกัน
 *    ให้ตรงกับไฟล์ (ชื่อโครงการไม่ถูกเขียนทับ ถ้าเจ้าของแก้ในแอปไปแล้ว)
 * 🔴 `bond_returned` ในไฟล์: `√` = ได้คืนแล้ว (หนังสือค้ำ ไม่มีเงิน) · ตัวเลข = ยอดเงินสดที่ได้คืน
 *    · ว่าง = ยังไม่ได้คืน → จะโผล่เป็น "รอทวงคืน" ทันทีถ้าครบประกันแล้ว
 *    · วันที่ได้คืนไม่มีในไฟล์ → ใช้วันครบประกัน (warranty_end) เป็นค่าประมาณ และ**ไม่**ลงรายรับ
 *      ย้อนหลังให้ (เงินก้อนนั้นอยู่ในบัญชีก่อนเริ่มใช้ระบบ ลงซ้ำจะทำให้รายรับปีเก่าเพี้ยน)
 * 🔴 ชื่อที่มี "(ตรวจชื่อเต็ม)" คือชื่อที่อ่านจากภาพไม่ครบ — สคริปต์**ปฏิเสธ**จนกว่าจะแก้ในไฟล์
 *
 * ใช้:
 *   node scripts/import-bonds.mjs                       ← แสดงว่าจะทำอะไร (ไม่เขียน)
 *   node scripts/import-bonds.mjs --confirm             ← เขียนจริง
 *   node scripts/import-bonds.mjs path/to/other.csv --confirm
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const confirm = args.includes('--confirm')
const file = args.find((a) => !a.startsWith('--')) ?? 'docs/import/bonds-2565-2567.csv'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)
const REF = env.SUPABASE_PROJECT_REF
const hostRef = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
if (hostRef !== REF) {
  throw new Error(`เป้าหมายไม่ตรงกัน: PROJECT_REF=${REF} แต่ URL ชี้ไป ${hostRef} — หยุดก่อนเขียนผิดฐาน`)
}

const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`SQL ล้มเหลว: ${t.slice(0, 400)}`)
  return JSON.parse(t)
}
const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`)

/** d/m/yyyy (พ.ศ. หรือ ค.ศ.) → YYYY-MM-DD ค.ศ. · ว่าง → null */
function toIsoCE(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (!m) throw new Error(`รูปแบบวันที่ไม่ถูกต้อง: "${s}" (ต้องเป็น d/m/yyyy)`)
  const d = Number(m[1]), mo = Number(m[2])
  let y = Number(m[3])
  if (y >= 2400) y -= 543
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const chk = new Date(`${iso}T00:00:00Z`)
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() + 1 !== mo || chk.getUTCDate() !== d) {
    throw new Error(`วันที่ไม่มีอยู่จริง: "${s}"`)
  }
  return iso
}

/** CSV แบบง่าย — ช่องที่มีคอมมาห่อด้วย "…" ได้ */
function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
  const split = (line) => {
    const out = []
    let cur = ''
    let inQ = false
    for (const ch of line) {
      if (ch === '"') inQ = !inQ
      else if (ch === ',' && !inQ) { out.push(cur); cur = '' }
      else cur += ch
    }
    out.push(cur)
    return out.map((c) => c.trim())
  }
  const head = split(lines[0])
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((c, i) => [head[i], c])))
}

const rows = parseCsv(readFileSync(file, 'utf8'))
const problems = []
const plan = rows.map((r) => {
  if (/ตรวจชื่อเต็ม/.test(r.name)) problems.push(`แถว ${r.no}: ชื่อโครงการยังไม่ครบ — แก้ในไฟล์ก่อน`)
  const kind = r.bond_kind === 'สด' ? 'cash' : r.bond_kind === 'หนังสือค้ำ' ? 'bank_guarantee' : null
  if (!kind) problems.push(`แถว ${r.no}: ชนิดหลักประกันต้องเป็น "สด" หรือ "หนังสือค้ำ" (ได้ "${r.bond_kind}")`)
  const contract = Number(r.contract_amount)
  const bond = r.bond_amount ? Number(r.bond_amount) : kind === 'cash' ? Math.round(contract * 5) / 100 : Math.round(contract * 5) / 100
  const returned = r.bond_returned.trim()
  const returnedAmount = returned === '' ? null : returned === '√' ? bond : Number(returned)
  const handover = toIsoCE(r.handover_date)
  return {
    no: r.no,
    contract_no: r.contract_no,
    contract_date: toIsoCE(r.contract_date),
    name: r.name,
    contract_amount: contract,
    bond_kind: kind,
    bond_amount: bond,
    start_date: toIsoCE(r.start_date),
    end_date: toIsoCE(r.end_date),
    handover_date: handover,
    returned_amount: returnedAmount,
  }
})

console.log(`อ่าน ${plan.length} แถวจาก ${file}`)
for (const p of plan) {
  console.log(
    `  ${String(p.no).padStart(2)}. [${p.contract_no}] ${p.name.slice(0, 40)}${p.name.length > 40 ? '…' : ''}` +
      ` · ค่าจ้าง ${p.contract_amount.toLocaleString('th-TH')} · ประกัน ${p.bond_amount.toLocaleString('th-TH')} (${p.bond_kind})` +
      ` · ส่งมอบ ${p.handover_date} · ${p.returned_amount === null ? 'ยังไม่ได้คืน' : `ได้คืน ${p.returned_amount.toLocaleString('th-TH')}`}`,
  )
}
if (problems.length) {
  console.error('\nยังนำเข้าไม่ได้:')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
if (!confirm) {
  console.log('\n(ยังไม่เขียน — ใส่ --confirm เพื่อนำเข้าจริง)')
  process.exit(0)
}

let created = 0
let updated = 0
for (const p of plan) {
  // หาโครงการเดิมจากเลขที่สัญญา — คีย์ idempotent
  const { rows: found } = await sql(
    `select f.site_id from public.site_finance f where f.contract_no = ${q(p.contract_no)} limit 1`,
  )
  let siteId = found[0]?.site_id
  if (!siteId) {
    const { rows: ins } = await sql(
      `insert into public.sites (name, start_date, end_date, status)
       values (${q(p.name)}, ${q(p.start_date)}, ${q(p.end_date)}, 'done') returning id`,
    )
    siteId = ins[0].id
    created += 1
  } else {
    updated += 1
  }
  // trigger `sites_ensure_finance` สร้างแถว site_finance ให้แล้ว · เขียนทับด้วยค่าจากไฟล์
  // · วันได้คืนไม่มีในไฟล์ → ใช้วันครบประกันเป็นค่าประมาณ (ไม่ลงรายรับย้อนหลัง — ดูหัวไฟล์)
  await sql(
    `update public.site_finance set
       contract_amount = ${p.contract_amount},
       contract_no = ${q(p.contract_no)},
       contract_date = ${q(p.contract_date)},
       bond_kind = ${q(p.bond_kind)}::public.bond_kind,
       bond_amount = ${p.bond_amount},
       handover_date = ${q(p.handover_date)},
       warranty_months = 24,
       bond_returned_amount = ${p.returned_amount === null ? 'null' : p.returned_amount},
       bond_returned_at = ${p.returned_amount === null ? 'null' : `(${q(p.handover_date)}::date + interval '24 months')::date`}
     where site_id = ${q(siteId)}`,
  )
}
console.log(`\nเสร็จ: สร้างใหม่ ${created} · อัปเดต ${updated}`)
const { rows: status } = await sql(
  `select status, count(*)::int as n, coalesce(sum(bond_amount),0)::numeric as amount
   from public.bond_status((now() at time zone 'Asia/Bangkok')::date, 30) group by status order by status`,
)
for (const s of status) console.log(`  ${s.status}: ${s.n} งาน · ฿${Number(s.amount).toLocaleString('th-TH')}`)
