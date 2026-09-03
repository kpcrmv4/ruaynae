#!/usr/bin/env node
/**
 * verify-attendance.mjs — ปิดแถว P4-CALC-01..06 และ P4-UI-05..10
 *
 * 🔴 ห้ามแถวใดผ่านบน `0 === 0` — ทุกแถวสร้างข้อมูลจริงก่อน แล้วคืนใน finally
 * 🔴 อ่านตัวเลขจากธาตุที่เป็นเจ้าของค่า (`data-day-wage`, การ์ดของโครงการนั้น)
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

/** ชิ้นส่วน HTML ของการ์ดโครงการใบเดียวบนหน้าภาพรวม */
const cardOf = (html, siteId) =>
  html.split('href="/sites/').find((c) => c.startsWith(`${siteId}"`)) ?? null
const dayWage = (html) => {
  const m = /data-day-wage="([\d.]+)"/.exec(html)
  return m ? Number(m[1]) : null
}
/** ต้นทุนจากการ์ด/หน้าโครงการ — อ่านจากป้าย "ต้นทุนที่จ่ายจริง" ที่เป็นเจ้าของค่า */
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

console.log('\n── P4 · คนเข้าโครงการ + ต้นทุนค่าแรง ───────────────────────────')

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

const MARK = 'ทดสอบคนเข้าโครงการ'
let siteA = null
let siteB = null
let dailyId = null
let monthlyId = null

try {
  ;[{ id: siteA }] = (await sql(
    `insert into public.sites(name, status, start_date, end_date)
     values ('${MARK} โครงการก', 'active', '2000-01-01', '2000-06-30') returning id`)).rows
  ;[{ id: siteB }] = (await sql(
    `insert into public.sites(name, status, start_date, end_date)
     values ('${MARK} โครงการข', 'active', '2000-01-01', '2000-06-30') returning id`)).rows
  await sql(`update public.site_finance set contract_amount = 1000000 where site_id in ('${siteA}','${siteB}')`)
  // ดูแลโครงการ ก มาตั้งแต่ปี 2000 — วันย้อนหลังที่ P4-UI-08 ใช้จึงอยู่ในช่วงที่เขาดูแลจริง
  await sql(`insert into public.site_supervisors(site_id, profile_id, effective_from)
             values ('${siteA}','${sup1.id}','2000-01-01')`)

  ;[{ id: dailyId }] = (await sql(
    `insert into public.employees(full_name, job_title)
     values ('${MARK} สมชาย', 'ช่างปูน') returning id`)).rows
  await sql(`insert into public.employee_wages(employee_id, wage_type, daily_rate)
             values ('${dailyId}', 'daily', 600)`)
  ;[{ id: monthlyId }] = (await sql(
    `insert into public.employees(full_name) values ('${MARK} สมหญิง') returning id`)).rows
  await sql(`insert into public.employee_wages(employee_id, wage_type, monthly_salary)
             values ('${monthlyId}', 'monthly', 18000)`)

  // รายจ่ายที่อนุมัติแล้วของโครงการ ก — ฐานของ P4-CALC-01
  await sql(`insert into public.transactions
    (kind, site_id, category_id, amount, txn_date, pay_method, status, note)
    values ('expense','${siteA}','${expCat.id}', 300000, '${today}', 'transfer', 'approved',
            '${MARK} ค่าวัสดุ')`)

  // ── P4-UI-05 · หัวหน้าโครงการเห็นเฉพาะโครงการตัวเอง ─────────────────────
  {
    const html = await page('/attendance', supJar)
    check('P4-UI-05 หัวหน้าโครงการเห็นเฉพาะโครงการที่ตัวเองดูแล · ไม่เห็นโครงการอื่นในหน้าเดียวกัน',
      html.includes(`${MARK} โครงการก`) && !html.includes(`${MARK} โครงการข`),
      `เห็นโครงการก=${html.includes(`${MARK} โครงการก`)} · เห็นโครงการข=${html.includes(`${MARK} โครงการข`)}`)
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
    // 🔴 API ไม่คืนยอดเงินกลับมาแล้ว — หัวหน้าโครงการเป็นคนยิง และเขาไม่มีสิทธิ์เห็นเงิน
    // จึงยืนยันที่ **แถวในฐานข้อมูล** แทน ไม่ใช่ที่ response
    const [{ n: made }] = (await sql(
      `select count(*)::int n from public.attendance where id = '${attId ?? '00000000-0000-0000-0000-000000000000'}'`)).rows
    check('P4-UI-06 หัวหน้าโครงการติ๊กคนเข้าโครงการ → 201 · attendance +1 · API ไม่คืนยอดเงินกลับมา',
      r.status === 201 && Boolean(attId) && Number(made) === 1
      && b.attendance?.amount === undefined,
      `${r.status} · แถว ${made} · เงินใน response=${b.attendance?.amount ?? 'ไม่มี'}`)
    check('P4-CALC-01 ต้นทุนโครงการ = รายจ่ายอนุมัติ ฿300,000 + ค่าแรง ฿600 = ฿300,600 ทันที ไม่ต้องอนุมัติ',
      costBefore === 300000 && costAfter === 300600,
      `ก่อน ฿${costBefore} → หลัง ฿${costAfter}`)
  }

  // ── P4-CALC-04 · ยอดค่าแรงวันนี้ตรงกับ SQL (เจ้าของเท่านั้น) ──────
  // 🔴 ตรวจสองฝั่งในบล็อกเดียว: เจ้าของเห็นตัวเลขตรงกับ SQL
  // และหัวหน้าโครงการ**ไม่มีการ์ดนั้นเลย** ไม่ใช่เห็นเป็น ฿0
  {
    const ownerHtml = await page(`/attendance?site=${siteA}&date=${today}`, ownerJar)
    const supHtml = await page(`/attendance?site=${siteA}&date=${today}`, supJar)
    const [{ n }] = (await sql(
      `select coalesce(sum(aw.amount),0)::float8 n
       from public.attendance a join public.attendance_wages aw on aw.attendance_id = a.id
       where a.site_id = '${siteA}' and a.work_date = '${today}'`)).rows
    check('P4-CALC-04 ยอด "ค่าแรงวันนี้" ของเจ้าของ = Σ amount ตรงกับ SQL · หัวหน้าโครงการไม่มีการ์ดนี้',
      Number(n) > 0 && dayWage(ownerHtml) === Number(n) && dayWage(supHtml) === null,
      `เจ้าของ ${dayWage(ownerHtml)} · SQL ${n} · หัวหน้าโครงการ ${dayWage(supHtml) ?? 'ไม่มีการ์ด'}`)
  }

  // ── P4-CALC-05 · ค่าแรงโครงการ ก ไม่เข้าโครงการ ข ───────────────────────
  {
    const html = await page('/', ownerJar)
    const costA = costOf(cardOf(html, siteA))
    const costB = costOf(cardOf(html, siteB))
    check('P4-CALC-05 ค่าแรงของโครงการ ก ไม่ถูกนับเข้าโครงการ ข ในหน้าเดียวกัน',
      costA === 300600 && costB === 0, `ก ฿${costA} · ข ฿${costB}`)
  }

  // ── P4-CALC-02 · คนรายเดือนไม่เข้าต้นทุนรายวัน ────────────────────
  {
    const before = costOf(cardOf(await page('/', ownerJar), siteA))
    const r = await req('POST', '/api/attendance', {
      siteId: siteA, employeeId: monthlyId, workDate: today, workUnits: 1 }, supJar)
    const after = costOf(cardOf(await page('/', ownerJar), siteA))
    check('P4-CALC-02 ติ๊กคนรายเดือน → ต้นทุนโครงการไม่ขยับ (เงินเดือนตัดสิ้นเดือน ไม่ใช่ต้นทุนรายวัน)',
      r.status === 201 && before === after && after === 300600,
      `${r.status} · ก่อน ฿${before} → หลัง ฿${after}`)

    // ฝั่งบวก: OT ของคนรายเดือนเข้าต้นทุน — OT เป็นเงิน เจ้าของเป็นคนกรอก
    await req('DELETE', `/api/attendance/${(await r.json().catch(() => ({}))).attendance?.id ?? ''}`,
      undefined, supJar)
    const r2 = await req('POST', '/api/attendance', {
      siteId: siteA, employeeId: monthlyId, workDate: today, workUnits: 1, otAmount: 250 }, ownerJar)
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
    check('P4-CALC-03 ลบแถวลงชื่อ → ต้นทุนโครงการลดลงเท่ากับ amount ของแถวนั้นพอดี (฿600)',
      before !== null && after === before - 600, `฿${before} → ฿${after}`)
  }

  // ── P4-UI-08 · เลือกวันย้อนหลัง ───────────────────────────────────
  {
    // แถวก่อนหน้าลบของวันนี้ออกไปแล้ว — สร้างใหม่เพื่อให้ "วันนี้ > 0" มีความหมาย
    // ไม่งั้นทั้งสองวันเป็น 0 แล้วแถวนี้จะผ่านบน `0 === 0`
    await req('POST', '/api/attendance', {
      siteId: siteA, employeeId: dailyId, workDate: today, workUnits: 1 }, ownerJar)
    const past = '2000-03-15'
    const html = await page(`/attendance?site=${siteA}&date=${past}`, ownerJar)
    const now = await page(`/attendance?site=${siteA}&date=${today}`, ownerJar)
    check('P4-UI-08 เลือกวันย้อนหลัง → รายการเปลี่ยนตามวัน และวันที่อยู่ใน URL (แชร์ลิงก์ได้)',
      html.includes(`value="${past}"`) && now.includes(`value="${today}"`)
      && dayWage(html) === 0 && (dayWage(now) ?? 0) > 0,
      `วันเก่า ฿${dayWage(html)} · วันนี้ ฿${dayWage(now)}`)
  }

  // ── R8-UI-01 · มุมมองการ์ดเป็นค่าเริ่มต้น และสลับได้ ───────────────
  // 🔴 เช็คว่า **การ์ดถูกเรนเดอร์จริง** ไม่ใช่แค่มีปุ่มสลับอยู่ — ปุ่มที่สลับไป
  // หาอะไรไม่เจอก็ยังเป็นปุ่มที่มีอยู่ · การ์ดของคนที่ยังไม่เข้าต้องมี
  // aria-pressed="false" (ปุ่มเลือก) และปุ่มสลับต้องชี้ไปมุมมองรายชื่อ
  {
    const html = await page(`/attendance?site=${siteA}&date=${today}`, ownerJar)
    check('R8-UI-01 หน้าคนเข้าโครงการเริ่มที่มุมมองการ์ด · มีปุ่มสลับไปมุมมองรายชื่อ',
      html.includes('สลับเป็นมุมมองรายชื่อ') && html.includes('aria-pressed="false"'),
      html.includes('สลับเป็นมุมมองรายชื่อ') ? 'มีปุ่มสลับและการ์ดเลือกได้' : 'ไม่เจอปุ่มสลับ')
  }

  // ── P4-CALC-06 · หัวหน้าโครงการไม่เห็นตัวเลขเงินของโครงการเลย ───────────
  // เจ้าของสั่งไว้ 31 ส.ค. 2569 · ฝั่งบวกคือ "ยังเปิดหน้าโครงการตัวเองได้อยู่"
  // ไม่งั้น 404 ก็ผ่านแถวนี้ได้เหมือนกันโดยไม่ได้พิสูจน์อะไร
  {
    const html = await page(`/sites/${siteA}`, supJar)
    const leaks = ['เก็บเงินแล้ว', 'กำไรคงเหลือ', 'ค่างานตามสัญญา', 'ต้นทุนที่จ่ายจริง',
      'ต้นทุนโครงการนี้', '1,000,000', '300,000']
      .filter((w) => html.includes(w))
    check('P4-CALC-06 หัวหน้าโครงการเปิดหน้าโครงการตัวเองได้ แต่ไม่มีตัวเลขเงินสักตัวบนหน้านั้น',
      leaks.length === 0 && html.includes(`${MARK} โครงการก`) && html.includes('ความคืบหน้า'),
      leaks.length ? `หลุด: ${leaks.join(', ')}` : 'เห็นชื่อโครงการและแถบเวลา · ไม่มีเงิน')
  }
  // ── P4-DB-21 · ทุกคอลัมน์มีคนเขียนจริง ────────────────────────────
  // 🔴 ตัดสตริงและคอมเมนต์ก่อน grep — คอมเมนต์ที่ "อธิบาย" คอลัมน์
  // จะทำให้ตัวตรวจเขียวโดยที่ไม่มีใครเขียนคอลัมน์นั้นเลย
  {
    // 🔴 ตัดคอมเมนต์ก่อน grep — คอมเมนต์ที่ "อธิบาย" คอลัมน์จะทำให้ตัวตรวจเขียว
    // โดยที่ไม่มีใครเขียนคอลัมน์นั้นเลย
    // 🔴 แต่ **ห้ามตัดสตริงใน SQL** — ไฟล์ migration มี `''` และ `$$…$$` เต็มไปหมด
    // การจับคู่ single quote ข้ามทั้งไฟล์จะกลืนคำสั่ง insert ทิ้งไปด้วย
    // (เจอจริงตอน P4.5 — สี่คอลัมน์รายงานว่า "ไม่มีใครเขียน" ทั้งที่เขียนอยู่)
    const stripSql = (t) => t.replace(/--.*/g, '')
    const stripTs = (t) =>
      t.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^'\r\n]*'/g, "''")
    const src = [
      ['supabase/migrations/20260830230000_p4_employees_attendance.sql', stripSql],
      ['supabase/migrations/20260831000000_p45_wage_secrecy.sql', stripSql],
      ['src/app/api/employees/route.ts', stripTs],
      ['src/app/api/attendance/route.ts', stripTs],
      ['src/lib/employees.ts', stripTs],
    ].map(([f, fn]) => fn(readFileSync(f, 'utf8'))).join('\n\n')

    const cols = [
      'full_name', 'job_title', 'wage_type', 'daily_rate', 'monthly_salary',
      'default_site_id', 'is_active', 'profile_id',
      'work_date', 'site_id', 'employee_id', 'work_units', 'ot_amount', 'wage_snapshot', 'note',
    ]
    // "เขียน" = ปรากฏเป็นคีย์ของ payload (`col:`) หรือถูกกำหนดใน trigger (`new.col :=`)
    // "เขียน" = คีย์ของ payload ฝั่ง JS (`col:`) · กำหนดใน trigger (`new.col :=`)
    // · หรืออยู่ในรายการคอลัมน์ของ `insert into … (…)` / `set col = …` ฝั่ง SQL
    const written = cols.filter(
      (c) =>
        new RegExp(`${c}\\s*:(?!=)`).test(src) ||
        src.includes(`new.${c} :=`) ||
        new RegExp(`insert into[^(]*\\([^)]*\\b${c}\\b`, 's').test(src) ||
        new RegExp(`\\b${c}\\s*=\\s*\\S`).test(src),
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
