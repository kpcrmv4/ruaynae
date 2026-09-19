#!/usr/bin/env node
/**
 * verify-recurring.mjs — ค่าใช้จ่ายรายเดือนที่ระบบลงให้เอง (R9)
 *
 * กฎที่ตัวนี้เฝ้า:
 *   1. ตั้งกฎแล้ว **ลงย้อนหลังทันที** ตั้งแต่เดือนที่เลือกถึงเดือนปัจจุบัน
 *   2. เดือนที่ยังไม่ถึงวันจ่าย **ต้องไม่ลง** — ยอดล่วงหน้าคือยอดที่ยังไม่เกิด
 *   3. กดซ้ำไม่เกิดรายการซ้ำ (unique recurring_id + period_month)
 *   4. วันที่ 31 ในเดือน 30 วัน = วันสุดท้ายของเดือน ไม่ใช่ข้ามเดือน
 *   5. ผูกกฎกับ **คนรายวัน** ไม่ได้ — ค่าแรงเขาเกิดตอนติ๊กเข้าโครงการแล้ว
 *      ตั้งซ้ำ = ต้นทุนสองเท่า (§17 ข้อ 1)
 *
 * 🔴 สคริปต์นี้เขียนลงฐานข้อมูลจริง — แตะเฉพาะแถวที่ตัวเองสร้าง (ขึ้นต้นด้วย
 * MARK) และคืนสภาพในบล็อก finally เสมอ · ห้ามลบแบบเหมารวมเด็ดขาด (§17 ข้อ 9)
 *
 * ใช้: node scripts/verify-recurring.mjs [http://localhost:3200]
 */
import { readFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:3200'
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)

const sql = async (q) => {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: q }),
    },
  )
  const t = await r.text()
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t.slice(0, 300)}`)
  return JSON.parse(t)
}

const jarOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') || null
const req = (method, path, body, cookie) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual',
  })

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

const MARK = 'ZZ ทดสอบรายเดือน'
let ruleId = null
let dailyEmp = null

console.log('\n── R9 · ค่าใช้จ่ายรายเดือน ──────────────────────────────────')

const ownerJar = jarOf(
  await req('POST', '/api/auth/login', {
    email: env.SEED_OWNER_EMAIL,
    password: env.SEED_OWNER_PASSWORD,
  }),
)
if (!ownerJar) throw new Error('ล็อกอินเจ้าของไม่สำเร็จ — dev server รันอยู่ไหม')

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())
/** เดือนก่อนหน้า n เดือน เป็น YYYY-MM */
const monthBack = (n) => {
  const [y, m] = today.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7)
}

try {
  const [cat] = await sql(
    `select id from public.categories where kind = 'expense' and is_active order by sort_order limit 1`)

  // ── R9-REC-01 · ตั้งกฎแล้วลงย้อนหลังทันที ─────────────────────────
  {
    const r = await req('POST', '/api/settings/recurring', {
      name: `${MARK} ค่าเช่า`,
      amount: '5000',
      categoryId: cat.id,
      siteId: null,
      dayOfMonth: 31, // ตั้งใจใช้ 31 เพื่อตรวจเดือนที่มี 30 วัน
      startMonth: monthBack(3),
      payMethod: 'transfer',
    }, ownerJar)
    const b = await r.json().catch(() => ({}))
    ruleId = b.id ?? null
    const rows = await sql(
      `select txn_date, period_month, amount, status, site_id
       from public.transactions where recurring_id = '${ruleId}' order by period_month`)
    check('R9-REC-01 ตั้งกฎ → 201 และลงย้อนหลังให้ทันทีตั้งแต่เดือนที่เลือก',
      r.status === 201 && rows.length === Number(b.created) && rows.length >= 3,
      `${r.status} · สร้าง ${b.created} เดือน · พบ ${rows.length} แถว`)
    check('R9-REC-02 รายการที่ระบบลงเป็น "อนุมัติแล้ว" และเป็นค่าใช้จ่ายส่วนกลาง',
      rows.every((x) => x.status === 'approved' && x.site_id === null),
      rows.map((x) => x.status).join(','))
    check('R9-REC-03 วันที่ 31 ในเดือนที่มี 30 วัน → ลงวันสุดท้ายของเดือน ไม่ใช่ข้ามเดือน',
      rows.every((x) => x.txn_date.slice(0, 7) === x.period_month.slice(0, 7)),
      rows.map((x) => x.txn_date).join(' '))
  }

  // ── R9-REC-04 · เดือนที่ยังไม่ถึงวันจ่ายต้องไม่ลง ─────────────────
  {
    const rows = await sql(
      `select txn_date from public.transactions where recurring_id = '${ruleId}'
       and txn_date > '${today}'`)
    check('R9-REC-04 ไม่ลงรายการของวันที่ยังมาไม่ถึง (ยอดล่วงหน้าคือยอดที่ยังไม่เกิด)',
      rows.length === 0, `พบ ${rows.length} แถวในอนาคต`)
  }

  // ── R9-REC-05 · กดซ้ำไม่เกิดรายการซ้ำ ─────────────────────────────
  {
    const before = (await sql(
      `select count(*)::int as n from public.transactions where recurring_id = '${ruleId}'`))[0].n
    const r = await req('PATCH', `/api/settings/recurring/${ruleId}`, { run: true }, ownerJar)
    const b = await r.json().catch(() => ({}))
    const after = (await sql(
      `select count(*)::int as n from public.transactions where recurring_id = '${ruleId}'`))[0].n
    check('R9-REC-05 กด "ลงรายการ" ซ้ำ → ไม่มีรายการซ้ำเพิ่ม',
      r.status === 200 && Number(b.created) === 0 && after === before,
      `${r.status} · สร้างเพิ่ม ${b.created} · ${before}→${after}`)
  }

  // ── R9-REC-06 · ลบกฎที่ลงรายการไปแล้วไม่ได้ ───────────────────────
  {
    const r = await req('DELETE', `/api/settings/recurring/${ruleId}`, undefined, ownerJar)
    const b = await r.json().catch(() => ({}))
    const still = (await sql(
      `select count(*)::int as n from public.recurring_expenses where id = '${ruleId}'`))[0].n
    check('R9-REC-06 ลบกฎที่เคยลงรายการแล้ว → 409 IN_USE · กฎยังอยู่',
      r.status === 409 && b.error === 'IN_USE' && still === 1,
      `${r.status} ${b.error}`)
  }

  // ── R9-REC-07 · ผูกกับคนรายวันไม่ได้ ─────────────────────────────
  {
    dailyEmp = (await sql(
      `insert into public.employees(full_name, is_active) values ('${MARK} คนรายวัน', true) returning id`))[0].id
    await sql(
      `insert into public.employee_wages(employee_id, wage_type, daily_rate)
       values ('${dailyEmp}', 'daily', 500)`)
    const r = await req('POST', '/api/settings/recurring', {
      name: `${MARK} เงินเดือนผิดประเภท`,
      amount: '9000',
      categoryId: cat.id,
      employeeId: dailyEmp,
      dayOfMonth: 1,
      startMonth: monthBack(1),
    }, ownerJar)
    const b = await r.json().catch(() => ({}))
    const made = (await sql(
      `select count(*)::int as n from public.recurring_expenses where employee_id = '${dailyEmp}'`))[0].n
    check('R9-REC-07 ตั้งเงินเดือนให้คนรายวัน → 400 EMPLOYEE_NOT_MONTHLY · ไม่มีกฎเกิดขึ้น (กันต้นทุนสองเท่า)',
      r.status === 400 && b.error === 'EMPLOYEE_NOT_MONTHLY' && made === 0,
      `${r.status} ${b.error} · กฎ ${made} ข้อ`)
  }

  // ── R9-REC-08 · endpoint ตอนไม่ล็อกอิน ───────────────────────────
  {
    const calls = [
      ['POST', '/api/settings/recurring', { name: 'x', amount: '1' }],
      ['PATCH', `/api/settings/recurring/${ruleId}`, { run: true }],
      ['DELETE', `/api/settings/recurring/${ruleId}`, undefined],
    ]
    const codes = []
    for (const [m, path, body] of calls) {
      const r = await req(m, path, body)
      const ct = r.headers.get('content-type') ?? ''
      codes.push(r.status === 401 && ct.startsWith('application/json') ? '401' : `${r.status}`)
    }
    check('R9-REC-08 ทุก endpoint ตอนไม่ล็อกอิน → 401 JSON (ไม่ใช่ 307 ไปหน้า login)',
      codes.every((c) => c === '401'), codes.join(' '))
  }
} catch (e) {
  console.error('💥', String(e).slice(0, 600))
  fail++
} finally {
  // คืนสภาพ — ลบเฉพาะแถวที่สคริปต์นี้สร้าง
  if (ruleId) {
    await sql(`delete from public.transactions where recurring_id = '${ruleId}'`).catch(() => {})
    await sql(`delete from public.recurring_expenses where id = '${ruleId}'`).catch(() => {})
  }
  await sql(`delete from public.recurring_expenses where name like '${MARK}%'`).catch(() => {})
  if (dailyEmp) {
    await sql(`delete from public.employee_wages where employee_id = '${dailyEmp}'`).catch(() => {})
    await sql(`delete from public.employees where id = '${dailyEmp}'`).catch(() => {})
  }
  const left = await sql(
    `select (select count(*)::int from public.recurring_expenses where name like '${MARK}%') as rules,
            (select count(*)::int from public.employees where full_name like '${MARK}%') as emps`)
    .catch(() => [{}])
  console.log(`\nผ่าน ${pass} · ตก ${fail} · แถวทดสอบที่ค้าง ${JSON.stringify(left[0])}`)
  process.exit(fail ? 1 : 0)
}
