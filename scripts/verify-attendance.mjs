#!/usr/bin/env node
/**
 * verify-attendance.mjs — ปิดแถว P4-CALC-01..06 และ P4-UI-05..10
 *
 * 🔴 ห้ามแถวใดผ่านบน `0 === 0` — ทุกแถวสร้างข้อมูลจริงก่อน แล้วคืนใน finally
 * 🔴 อ่านตัวเลขจากธาตุที่เป็นเจ้าของค่า (`data-day-wage`, การ์ดของไซต์นั้น)
 * ไม่ใช่ regex กวาดทั้งหน้า
 */
import { readFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:3100'
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

const req = (method, path, body, cookie) =>
  fetch(`${BASE}${path}`, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const jarOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '')
const page = async (path, cookie) =>
  visible(await (await fetch(`${BASE}${path}`, { headers: { cookie } })).text())

/** ชิ้นส่วน HTML ของการ์ดไซต์ใบเดียวบนหน้าภาพรวม */
const cardOf = (html, siteId) =>
  html.split('href="/sites/').find((c) => c.startsWith(`${siteId}"`)) ?? null
const dayWage = (html) => {
  const m = /data-day-wage="([\d.]+)"/.exec(html)
  return m ? Number(m[1]) : null
}
/** ต้นทุนจากการ์ด/หน้าไซต์ — อ่านจากป้าย "ต้นทุนที่จ่ายจริง" ที่เป็นเจ้าของค่า */
const costOf = (chunk) => {
  const m = /ต้นทุนที่จ่ายจริง[\s\S]{0,400}?฿([\d,]+)/.exec(chunk ?? '')
  return m ? Number(m[1].replace(/,/g, '')) : null
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
  if (!r.ok) return { error: t, rows: [] }
  return { rows: JSON.parse(t) }
}

console.log('\n── P4 · คนเข้าไซต์ + ต้นทุนค่าแรง ───────────────────────────')

const ownerJar = jarOf(await req('POST', '/api/auth/login', {
  email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }))
const supJar = jarOf(await req('POST', '/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN }))
if (!ownerJar || !supJar) throw new Error('ล็อกอินไม่สำเร็จ — dev server รันอยู่ไหม')

const [sup1] = (await sql(
  `select id from public.profiles where full_name = '${env.SEED_SUPERVISOR1_NAME}'`)).rows
const [expCat] = (await sql(
  "select id from public.categories where kind='expense' order by sort_order limit 1")).rows
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())
const tomorrow = (() => {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
})()

const MARK = 'ทดสอบคนเข้าไซต์'
let siteA = null
let siteB = null
let dailyId = null
let monthlyId = null

try {
  ;[{ id: siteA }] = (await sql(
    `insert into public.sites(name, status, start_date, end_date)
     values ('${MARK} ไซต์ก', 'active', '2000-01-01', '2000-06-30') returning id`)).rows
  ;[{ id: siteB }] = (await sql(
    `insert into public.sites(name, status, start_date, end_date)
     values ('${MARK} ไซต์ข', 'active', '2000-01-01', '2000-06-30') returning id`)).rows
  await sql(`update public.site_finance set contract_amount = 1000000 where site_id in ('${siteA}','${siteB}')`)
  // ดูแลไซต์ ก มาตั้งแต่ปี 2000 — วันย้อนหลังที่ P4-UI-08 ใช้จึงอยู่ในช่วงที่เขาดูแลจริง
  await sql(`insert into public.site_supervisors(site_id, profile_id, effective_from)
             values ('${siteA}','${sup1.id}','2000-01-01')`)

  ;[{ id: dailyId }] = (await sql(
    `insert into public.employees(full_name, job_title, wage_type, daily_rate)
     values ('${MARK} สมชาย', 'ช่างปูน', 'daily', 600) returning id`)).rows
  ;[{ id: monthlyId }] = (await sql(
    `insert into public.employees(full_name, wage_type, monthly_salary)
     values ('${MARK} สมหญิง', 'monthly', 18000) returning id`)).rows

  // รายจ่ายที่อนุมัติแล้วของไซต์ ก — ฐานของ P4-CALC-01
  await sql(`insert into public.transactions
    (kind, site_id, category_id, amount, txn_date, pay_method, status, note)
    values ('expense','${siteA}','${expCat.id}', 300000, '${today}', 'transfer', 'approved',
            '${MARK} ค่าวัสดุ')`)

  // ── P4-UI-05 · หัวหน้าไซต์เห็นเฉพาะไซต์ตัวเอง ─────────────────────
  {
    const html = await page('/attendance', supJar)
    check('P4-UI-05 หัวหน้าไซต์เห็นเฉพาะไซต์ที่ตัวเองดูแล · ไม่เห็นไซต์อื่นในหน้าเดียวกัน',
      html.includes(`${MARK} ไซต์ก`) && !html.includes(`${MARK} ไซต์ข`),
      `เห็นไซต์ก=${html.includes(`${MARK} ไซต์ก`)} · เห็นไซต์ข=${html.includes(`${MARK} ไซต์ข`)}`)
  }

  // ── P4-UI-10 · ลงชื่อล่วงหน้าไม่ได้ ───────────────────────────────
  {
    const before = (await sql('select count(*)::int n from public.attendance')).rows[0].n
    const r = await req('POST', '/api/attendance', {
      siteId: siteA, employeeId: dailyId, workDate: tomorrow }, supJar)
    const b = await r.json().catch(() => ({}))
    const after = (await sql('select count(*)::int n from public.attendance')).rows[0].n
    check('P4-UI-10 ลงชื่อวันในอนาคต → 400 DATE_FUTURE · ไม่มีแถวใหม่',
      r.status === 400 && b.error === 'DATE_FUTURE' && Number(after) === Number(before),
      `${r.status} ${b.error} · ${before}→${after}`)
  }

  // ── P4-UI-06 + P4-CALC-01 · ติ๊กแล้วต้นทุนขึ้นทันที ───────────────
  let attId = null
  {
    const costBefore = costOf(cardOf(await page('/', ownerJar), siteA))
    const r = await req('POST', '/api/attendance', {
      siteId: siteA, employeeId: dailyId, workDate: today, workUnits: 1 }, supJar)
    const b = await r.json().catch(() => ({}))
    attId = b.attendance?.id ?? null
    const costAfter = costOf(cardOf(await page('/', ownerJar), siteA))
    check('P4-UI-06 หัวหน้าไซต์ติ๊กคนเข้าไซต์ → 201 · attendance +1',
      r.status === 201 && Boolean(attId) && Number(b.attendance?.amount) === 600,
      `${r.status} · amount=${b.attendance?.amount}`)
    check('P4-CALC-01 ต้นทุนไซต์ = รายจ่ายอนุมัติ ฿300,000 + ค่าแรง ฿600 = ฿300,600 ทันที ไม่ต้องอนุมัติ',
      costBefore === 300000 && costAfter === 300600,
      `ก่อน ฿${costBefore} → หลัง ฿${costAfter}`)
  }

  // ── P4-CALC-04 · ยอดค่าแรงวันนี้ตรงกับ SQL ────────────────────────
  {
    const html = await page(`/attendance?site=${siteA}&date=${today}`, supJar)
    const [{ n }] = (await sql(
      `select coalesce(sum(amount),0)::float8 n from public.attendance
       where site_id = '${siteA}' and work_date = '${today}'`)).rows
    check('P4-CALC-04 ยอด "ค่าแรงวันนี้" บนหน้าจอ = Σ amount ของวันนั้นในไซต์นั้น ตรงกับ SQL',
      Number(n) > 0 && dayWage(html) === Number(n),
      `จอ ${dayWage(html)} · SQL ${n}`)
  }

  // ── P4-CALC-05 · ค่าแรงไซต์ ก ไม่เข้าไซต์ ข ───────────────────────
  {
    const html = await page('/', ownerJar)
    const costA = costOf(cardOf(html, siteA))
    const costB = costOf(cardOf(html, siteB))
    check('P4-CALC-05 ค่าแรงของไซต์ ก ไม่ถูกนับเข้าไซต์ ข ในหน้าเดียวกัน',
      costA === 300600 && costB === 0, `ก ฿${costA} · ข ฿${costB}`)
  }

  // ── P4-CALC-02 · คนรายเดือนไม่เข้าต้นทุนรายวัน ────────────────────
  {
    const before = costOf(cardOf(await page('/', ownerJar), siteA))
    const r = await req('POST', '/api/attendance', {
      siteId: siteA, employeeId: monthlyId, workDate: today, workUnits: 1 }, supJar)
    const after = costOf(cardOf(await page('/', ownerJar), siteA))
    check('P4-CALC-02 ติ๊กคนรายเดือน → ต้นทุนไซต์ไม่ขยับ (เงินเดือนตัดสิ้นเดือน ไม่ใช่ต้นทุนรายวัน)',
      r.status === 201 && before === after && after === 300600,
      `${r.status} · ก่อน ฿${before} → หลัง ฿${after}`)

    // ฝั่งบวก: OT ของคนรายเดือนเข้าต้นทุน
    await req('DELETE', `/api/attendance/${(await r.json().catch(() => ({}))).attendance?.id ?? ''}`,
      undefined, supJar)
    const r2 = await req('POST', '/api/attendance', {
      siteId: siteA, employeeId: monthlyId, workDate: today, workUnits: 1, otAmount: 250 }, supJar)
    const withOt = costOf(cardOf(await page('/', ownerJar), siteA))
    check('P4-CALC-02b OT ของคนรายเดือน **เข้า**ต้นทุน (฿300,600 → ฿300,850) — เงินเดือนไม่เข้า แต่ OT เข้า',
      r2.status === 201 && withOt === 300850, `฿${withOt}`)
  }

  // ── P4-UI-07 + P4-CALC-03 · ติ๊กออกแล้วต้นทุนลด ───────────────────
  {
    const before = costOf(cardOf(await page('/', ownerJar), siteA))
    const r = await req('DELETE', `/api/attendance/${attId}`, undefined, supJar)
    const after = costOf(cardOf(await page('/', ownerJar), siteA))
    const html = await page(`/attendance?site=${siteA}&date=${today}`, supJar)
    check('P4-UI-07 ติ๊กออก → 200 · ชื่อกลับไปอยู่ฝั่ง "ยังไม่เข้า"',
      r.status === 200 && html.includes('ยังไม่เข้า'), `${r.status}`)
    check('P4-CALC-03 ลบแถวลงชื่อ → ต้นทุนไซต์ลดลงเท่ากับ amount ของแถวนั้นพอดี (฿600)',
      before !== null && after === before - 600, `฿${before} → ฿${after}`)
  }

  // ── P4-UI-08 · เลือกวันย้อนหลัง ───────────────────────────────────
  {
    const past = '2000-03-15'
    const html = await page(`/attendance?site=${siteA}&date=${past}`, supJar)
    const now = await page(`/attendance?site=${siteA}&date=${today}`, supJar)
    check('P4-UI-08 เลือกวันย้อนหลัง → รายการเปลี่ยนตามวัน และวันที่อยู่ใน URL (แชร์ลิงก์ได้)',
      html.includes(`value="${past}"`) && now.includes(`value="${today}"`)
      && dayWage(html) === 0 && (dayWage(now) ?? 0) > 0,
      `วันเก่า ฿${dayWage(html)} · วันนี้ ฿${dayWage(now)}`)
  }

  // ── P4-CALC-06 · หัวหน้าไซต์เห็นค่าแรง ไม่เห็นค่างาน ──────────────
  {
    const html = await page(`/sites/${siteA}`, supJar)
    const leaks = ['เก็บเงินแล้ว', 'กำไรคงเหลือ', 'ค่างานตามสัญญา', '1,000,000']
      .filter((w) => html.includes(w))
    check('P4-CALC-06 หัวหน้าไซต์เห็นต้นทุนไซต์ตัวเอง (รวมค่าแรง) แต่ไม่เห็นค่างาน รายรับ กำไร',
      leaks.length === 0 && html.includes('ต้นทุนไซต์นี้') && html.includes('รวมค่าแรง'),
      leaks.length ? `หลุด: ${leaks.join(', ')}` : 'เห็นต้นทุน + บอกที่มาว่ารวมค่าแรง')
  }
  // ── P4-DB-21 · ทุกคอลัมน์มีคนเขียนจริง ────────────────────────────
  // 🔴 ตัดสตริงและคอมเมนต์ก่อน grep — คอมเมนต์ที่ "อธิบาย" คอลัมน์
  // จะทำให้ตัวตรวจเขียวโดยที่ไม่มีใครเขียนคอลัมน์นั้นเลย
  {
    const strip = (s) =>
      s.replace(/--[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/'[^']*'/g, "''")
    const src = [
      'supabase/migrations/20260830230000_p4_employees_attendance.sql',
      'src/app/api/employees/route.ts',
      'src/app/api/attendance/route.ts',
      'src/lib/employees.ts',
    ].map((f) => strip(readFileSync(f, 'utf8'))).join('\n')

    const cols = [
      'full_name', 'job_title', 'wage_type', 'daily_rate', 'monthly_salary',
      'default_site_id', 'is_active', 'profile_id',
      'work_date', 'site_id', 'employee_id', 'work_units', 'ot_amount', 'wage_snapshot', 'note',
    ]
    // "เขียน" = ปรากฏเป็นคีย์ของ payload (`col:`) หรือถูกกำหนดใน trigger (`new.col :=`)
    const written = cols.filter(
      (c) => new RegExp(`${c}\\s*:(?!=)`).test(src) || src.includes(`new.${c} :=`),
    )
    const missing = cols.filter((c) => !written.includes(c))
    check('P4-DB-21 ทั้ง 15 คอลัมน์ของ employees/attendance มีโค้ดหรือ trigger ที่เขียนจริง',
      missing.length === 0, missing.length ? `ไม่มีใครเขียน: ${missing.join(', ')}` : '15/15')
  }
} finally {
  for (const id of [siteA, siteB]) {
    if (id) {
      await sql(`delete from public.attendance where site_id = '${id}'`)
      await sql(`delete from public.transactions where site_id = '${id}'`)
      await sql(`delete from public.site_supervisors where site_id = '${id}'`)
      await sql(`delete from public.site_finance where site_id = '${id}'`)
      await sql(`delete from public.sites where id = '${id}'`)
    }
  }
  await sql(`delete from public.employees where full_name like '${MARK}%'`)
  console.log('  (ลบข้อมูลทดสอบแล้ว)')
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
