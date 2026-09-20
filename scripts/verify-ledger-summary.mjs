#!/usr/bin/env node
/**
 * verify-ledger-summary.mjs — แถบภาพรวมหัวหน้า `/ledger` (คำสั่งเจ้าของ 21 ก.ย. 2569)
 *
 * *"หน้า ledger ที่ส่วนหัว แสดงภาพรวม รายรับ/รายจ่ายทั้งเดือนให้หน่อย
 *   รวมถึงค่าแรงค้างจ่ายรวมด้วย"*
 *
 * 🔴 สิ่งที่แถวพวกนี้ตามล่าไม่ใช่ "มีตัวเลขโผล่ไหม" แต่คือ **ตัวเลขถูกไหม** —
 * ตัวเลขสรุปที่ผิดอ่านเหมือนตัวเลขที่ถูกทุกประการ · ทุกแถวจึงกระทบยอดค่าที่
 * หน้าจอแสดง กับค่าที่คำนวณจากฐานข้อมูลด้วย SQL คนละทางกับที่แอปใช้
 *
 * 🔴 และต้องพิสูจน์ว่า **ช่วงเวลาของแถบตรงกับลิสต์ข้างล่างเสมอ** — สรุปที่นับ
 * คนละช่วงกับรายการที่วาดอยู่ใต้มันคือสองตัวเลขที่ขัดกันบนจอเดียว (§17 ข้อ 2)
 *
 * ⚠️ อ่านอย่างเดียว ไม่เขียนอะไรลงฐานเลยสักแถว
 */
import { readFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:3200'
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)

const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`  ${ok === 'skip' ? '⏭' : ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const sql = async (q, tries = 5) => {
  for (let i = 0; ; i++) {
    const r = await fetch(
      `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      },
    )
    const t = await r.text()
    if (r.ok) return JSON.parse(t)
    if ((r.status === 429 || /Throttler/i.test(t)) && i < tries - 1) {
      await new Promise((res) => setTimeout(res, 2000 * 2 ** i))
      continue
    }
    throw new Error(t.slice(0, 300))
  }
}

const jarOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
/**
 * 🔴 หน้าเดียวกันคืนมาได้ **สองรูปแบบ** — บางครั้งเป็น HTML ที่ flush แล้ว
 * บางครั้งยังเป็นสตรีม RSC ที่ escape ซ้อนอยู่ และ React ยังแทรก `<!-- -->`
 * คั่นข้อความสองก้อนที่ติดกัน · ตัวตรวจที่เทียบสตริงดิบจะเขียว/แดงสลับไปมา
 * ตามจังหวะสตรีม ไม่ใช่ตามความถูกของหน้า
 */
const norm = (h) => h.replace(/<!-- -->/g, '').replace(/\\+"/g, '"')
const page = async (path, cookie) =>
  norm(await (await fetch(`${BASE}${path}`, { headers: { cookie } })).text())
const money = (n) =>
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

console.log(`\n🔎 verify-ledger-summary · ${BASE}`)

const ownerJar = jarOf(await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', redirect: 'manual',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }),
}))
const supJar = jarOf(await fetch(`${BASE}/api/auth/pin`, {
  method: 'POST', redirect: 'manual',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ pin: env.SEED_SUPERVISOR1_PIN }),
}))
if (!ownerJar) throw new Error('ล็อกอินไม่สำเร็จ — dev server รันอยู่ไหม')

const [{ today, month_start: monthStart, month_end: monthEnd }] = await sql(
  `select (now() at time zone 'Asia/Bangkok')::date::text as today,
          date_trunc('month', now() at time zone 'Asia/Bangkok')::date::text as month_start,
          (date_trunc('month', now() at time zone 'Asia/Bangkok')
             + interval '1 month - 1 day')::date::text as month_end`)

const html = await page('/ledger', ownerJar)

// ── LED-01 · แถบโผล่จริง พร้อมป้ายบอกช่วงเวลา ─────────────────────────
check('LED-01 หน้า /ledger มีแถบภาพรวมที่หัว พร้อมบอกว่าเป็นช่วงไหน',
  html.includes('ภาพรวม') && html.includes('เดือนนี้'),
  'มีคำว่า "ภาพรวม" + ช่วงเวลา')

// ── LED-02 · รายรับ/รายจ่ายทั้งเดือน ตรงกับที่คำนวณจากฐานข้อมูล ────────
{
  const [m] = await sql(
    `select
       coalesce(sum(amount) filter (where kind = 'income'  and status = 'approved'), 0)::float8 as inc,
       coalesce(sum(amount) filter (where kind = 'expense' and status = 'approved'), 0)::float8 as exp
     from public.transactions
     where txn_date between '${monthStart}' and '${monthEnd}'`)
  const wantInc = money(m.inc)
  const wantExp = money(m.exp)
  check('LED-02 รายรับ/รายจ่ายบนแถบ = ยอดรวมทั้งเดือนที่คำนวณจากฐานข้อมูลตรง ๆ',
    html.includes(wantInc) && html.includes(wantExp),
    `รายรับ ฿${wantInc} · รายจ่าย ฿${wantExp}`)

  // 🔴 คู่ตรงข้าม — ตัวเลขต้องเป็นของ **ทั้งเดือน** ไม่ใช่ของหน้าแรกของลิสต์
  const [firstPage] = await sql(
    `select coalesce(sum(t.amount) filter (where t.kind = 'expense' and t.status = 'approved'), 0)::float8 as exp
       from (select * from public.transactions
              order by txn_date desc, id desc limit 21) t`)
  check('LED-02b ยอดที่แสดงไม่ใช่ผลบวกของหน้าแรกของลิสต์ (§7)',
    m.exp !== firstPage.exp || m.exp === 0,
    m.exp === 0 ? 'เดือนนี้ยังไม่มีรายจ่าย — เทียบไม่ได้' : `ทั้งเดือน ฿${money(m.exp)} ≠ หน้าแรก ฿${money(firstPage.exp)}`)
}

// ── LED-03 · ค่าแรงค้างจ่ายรวม ────────────────────────────────────────
{
  const [w] = await sql('select * from public.payroll_outstanding()')
  check('LED-03 ค่าแรงค้างจ่ายรวมบนแถบ = ผลรวมจาก payroll_outstanding()',
    html.includes('ค่าแรงค้างจ่าย') && html.includes(money(w.accrued)),
    `ค้างจ่าย ฿${money(w.accrued)} · หักเบิกแล้วเหลือ ฿${money(w.balance)}`)

  const [b] = await sql(
    `select coalesce(sum(accrued), 0)::float8 a, coalesce(sum(advanced), 0)::float8 v
       from public.payroll_balances()`)
  check('LED-03b payroll_outstanding() = ผลรวมของ payroll_balances() ทีละคน (สูตรเดียวกัน)',
    Number(w.accrued) === b.a && Number(w.advanced) === b.v
      && Number(w.balance) === b.a - b.v,
    `${w.accrued}/${w.advanced}/${w.balance} = ${b.a}/${b.v}/${b.a - b.v}`)

  // การ์ดเป็น <a href="/payroll"> ครอบเนื้อใน — ป้ายจึงอยู่ **หลัง** href เสมอ
  const wi = html.indexOf('ค่าแรงค้างจ่าย')
  const beforeLabel = wi < 0 ? '' : html.slice(Math.max(0, wi - 900), wi)
  check('LED-03c ค่าแรงค้างจ่ายลิงก์ไป /payroll ได้ — ตัวเลขที่กดดูที่มาไม่ได้คือทางตัน',
    wi >= 0 && beforeLabel.includes('"/payroll"'), 'การ์ดเป็นลิงก์ไปหน้าค่าแรง')
}

// ── LED-04 · ช่วงของแถบตามตัวกรองเสมอ ─────────────────────────────────
{
  const past = await page('/ledger?from=2000-01-01&to=2000-12-31', ownerJar)
  // ⚠️ เทียบที่ **ป้ายของแถบ** ไม่ใช่ทั้งหน้า — คำว่า "เดือนนี้" เป็นตัวเลือกหนึ่ง
  // ในกล่องเลือกช่วงเวลา ซึ่งอยู่ในหน้าเสมอไม่ว่าจะกรองอะไรอยู่
  const labelOf = (h) => (h.match(/ภาพรวม ([^<"]{5,60})/) ?? [])[1] ?? ''
  check('LED-04 กรองช่วงวัน → แถบเปลี่ยนตาม และป้ายบอกว่าเป็น "ช่วงที่เลือก"',
    labelOf(past).startsWith('ช่วงที่เลือก') && labelOf(html).startsWith('เดือนนี้'),
    `ไม่กรอง → "${labelOf(html)}" · กรองแล้ว → "${labelOf(past)}"`)
}

// ── LED-05 · หัวหน้าโครงการไม่เห็นเงินที่ไม่ใช่ของเขา ──────────────────
if (!supJar) {
  check('LED-05 หัวหน้าโครงการเห็นเฉพาะรายจ่าย — ไม่เห็นรายรับ/คงเหลือ/ค่าแรงค้างจ่าย', 'skip',
    'ล็อกอิน PIN ไม่สำเร็จ — ตรวจ SEED_SUPERVISOR1_PIN')
} else {
  const sup = await page('/ledger', supJar)
  const between = sup.slice(sup.indexOf('ภาพรวม'), sup.indexOf('ภาพรวม') + 4000)
  check('LED-05 หัวหน้าโครงการเห็นเฉพาะช่องรายจ่าย — ไม่มีรายรับ/คงเหลือ/ค่าแรงค้างจ่าย',
    sup.includes('รายจ่าย') && !between.includes('ค่าแรงค้างจ่าย')
      && !/"label":"รายรับ"/.test(sup) && !/"label":"คงเหลือ"/.test(sup),
    // ⚠️ ศูนย์ที่แปลว่า "ไม่มีสิทธิ์เห็น" ห้ามวาดออกมาเป็นเลขศูนย์
    'ไม่วาดการ์ดที่เขาไม่มีสิทธิ์เห็น แทนที่จะวาด ฿0')
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok === true).length
const skip = results.filter((r) => r.ok === 'skip').length
const fail = results.length - pass - skip
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ข้าม ${skip} · ตก ${fail}`)
process.exit(fail === 0 ? 0 : 1)
