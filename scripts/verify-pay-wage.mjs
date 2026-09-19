#!/usr/bin/env node
/**
 * verify-pay-wage.mjs — ปุ่ม "จ่ายค่าแรง" รายคน (R9)
 *
 * เจ้าของขอให้เลิกใช้ "รอบจ่าย" แล้วจ่ายรายคนด้วยปุ่มเดียว · กลไกเดิมยังอยู่
 * ข้างใต้ (รอบของคนคนเดียวที่ถูกปิดทันที) เพราะมันคือตัวที่กันจ่ายซ้ำ ล็อก
 * ค่าแรงย้อนหลัง และเป็นฐานของเพดานเบิก — ไฟล์นี้คือตัวตรวจว่าทั้งสามข้อยังจริง
 *
 * 🔴 สคริปต์นี้เขียนลงฐานข้อมูลจริง — แตะเฉพาะแถวที่ตัวเองสร้าง (ขึ้นต้นด้วย
 * MARK) และคืนสภาพในบล็อก finally เสมอ · ห้ามลบแบบเหมารวมเด็ดขาด (§17 ข้อ 9)
 *
 * ใช้: node scripts/verify-pay-wage.mjs [http://localhost:3200]
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
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t.slice(0, 400)}\n${q.slice(0, 200)}`)
  return JSON.parse(t)
}

const jarOf = (r) =>
  (r.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ') || null

const req = (method, path, body, cookie) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual',
  })

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

const MARK = 'ZZ ทดสอบจ่ายค่าแรง'
let siteId = null
let empId = null

const ownerJar = jarOf(
  await req('POST', '/api/auth/login', {
    email: env.SEED_OWNER_EMAIL,
    password: env.SEED_OWNER_PASSWORD,
  }),
)
if (!ownerJar) throw new Error('ล็อกอินเจ้าของไม่สำเร็จ')

const day = (o) => {
  const d = new Date(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()) + 'T00:00:00Z',
  )
  d.setUTCDate(d.getUTCDate() + o)
  return d.toISOString().slice(0, 10)
}

try {
  siteId = (await sql(
    `insert into public.sites(name, status) values ('${MARK} โครงการ', 'active') returning id`,
  ))[0]?.id

  const emp = await sql(
    `insert into public.employees(full_name, job_title, is_active)
     values ('${MARK} คนงาน', 'ทดสอบ', true) returning id`)
  empId = emp[0]?.id
  await sql(
    `insert into public.employee_wages(employee_id, wage_type, daily_rate)
     values ('${empId}', 'daily', 500)`)

  // สองวัน วันละ ฿500 = ฿1,000
  for (const d of [day(-4), day(-2)]) {
    await sql(
      `insert into public.attendance(work_date, site_id, employee_id, work_units)
       values ('${d}', '${siteId}', '${empId}', 1)`)
  }

  // ── 1 · ยอดค้างขึ้นถูก ────────────────────────────────────────────
  {
    const rows = await sql(
      `select sum(aw.amount) as accrued
       from public.attendance a join public.attendance_wages aw on aw.attendance_id = a.id
       where a.employee_id = '${empId}'`)
    const r = rows[0]
    check('ค่าแรงที่เกิดขึ้นของคนทดสอบ = ฿1,000', Number(r?.accrued) === 1000, `ได้ ${r?.accrued}`)
  }

  // ── 2 · เบิกล่วงหน้า ฿300 ─────────────────────────────────────────
  {
    const r = await req('POST', '/api/advances', {
      employeeId: empId, amount: '300', advanceDate: day(-1) }, ownerJar)
    check('เบิกล่วงหน้า ฿300 → 201', r.status === 201, `${r.status}`)
  }

  // ── 3 · จ่ายค่าแรงด้วยปุ่มเดียว ────────────────────────────────────
  {
    const r = await req('POST', '/api/payroll/pay', { employeeId: empId }, ownerJar)
    const b = await r.json().catch(() => ({}))
    check('จ่ายค่าแรง → 200 · ค่าแรง ฿1,000 − เบิก ฿300 = จ่ายจริง ฿700',
      r.status === 200 && Number(b.accrued) === 1000 && Number(b.deducted) === 300
      && Number(b.paid) === 700,
      `${r.status} · ${b.accrued} − ${b.deducted} = ${b.paid}`)

    const runs = await sql(
      `select status, employee_id, period_start, period_end, closed_by is not null as has_closer
       from public.payroll_runs where employee_id = '${empId}'`)
    const run = runs[0]
    check('สร้างรอบของคนคนเดียว ปิดแล้วทันที · ช่วง = วันแรกถึงวันสุดท้ายที่ค้าง',
      run?.status === 'closed' && run?.employee_id === empId
      && run?.period_start === day(-4) && run?.period_end === day(-2) && run?.has_closer,
      `${run?.status} · ${run?.period_start}–${run?.period_end}`)
  }

  // ── 4 · กดซ้ำต้องไม่จ่ายซ้ำ ───────────────────────────────────────
  {
    const r = await req('POST', '/api/payroll/pay', { employeeId: empId }, ownerJar)
    const b = await r.json().catch(() => ({}))
    const runs = await sql(
      `select count(*)::int as n from public.payroll_runs where employee_id = '${empId}'`)
    const n = runs[0]?.n
    check('กดจ่ายซ้ำ → 409 NOTHING_TO_PAY · ไม่มีรอบที่สอง',
      r.status === 409 && b.error === 'NOTHING_TO_PAY' && n === 1,
      `${r.status} ${b.error} · รอบ ${n} อัน`)
  }

  // ── 5 · วันที่จ่ายแล้วถูกล็อก ทั้งแก้ ลบ และ **เพิ่มย้อนหลัง** ──────
  {
    const del = await sql(
      `do $$ begin
         delete from public.attendance where employee_id = '${empId}' and work_date = '${day(-4)}';
         raise notice 'DELETED';
       exception when others then raise notice 'BLOCKED:%', sqlerrm; end $$;`)
      .then(() => 'ran').catch((e) => String(e))
    const still = await sql(
      `select count(*)::int as n from public.attendance where employee_id = '${empId}'`)
    const n = still[0]?.n
    check('ลบวันที่จ่ายไปแล้วไม่ได้ — สองแถวยังอยู่ครบ', n === 2, `เหลือ ${n} แถว · ${del}`)

    // วันว่างที่อยู่ **กลาง** ช่วงที่จ่ายไปแล้ว — ยังไม่มีแถว จึงไม่ชนคีย์ซ้ำ
    // ถ้าเพิ่มได้ คนทำงานวันนั้นจะถูกนับว่า "จ่ายแล้ว" ทั้งที่ไม่เคยได้เงิน
    let insertErr = '(ไม่มี error — แถวถูกเพิ่มเข้าไปได้)'
    try {
      await sql(
        `insert into public.attendance(work_date, site_id, employee_id, work_units)
         values ('${day(-3)}', '${siteId}', '${empId}', 1)`)
    } catch (e) {
      insertErr = String(e).slice(0, 160)
    }
    check('เพิ่มวันย้อนหลังเข้าไปในช่วงที่จ่ายแล้วไม่ได้ (กันงานที่ไม่มีวันได้เงิน)',
      /PAYROLL_CLOSED/.test(insertErr), insertErr)
  }

  // ── 6 · ยอดค้างกลับเป็นศูนย์ ──────────────────────────────────────
  {
    const rows = await sql(
      `select coalesce(sum(aw.amount), 0) as unpaid
       from public.attendance a join public.attendance_wages aw on aw.attendance_id = a.id
       where a.employee_id = '${empId}'
         and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)`)
    const u = rows[0]?.unpaid
    check('หลังจ่ายแล้วไม่มีค่าแรงค้างเหลือ', Number(u) === 0, `ค้าง ${u}`)
  }
} catch (e) {
  console.error('💥', String(e).slice(0, 800))
  fail++
} finally {
  // คืนสภาพให้เหมือนตอนที่เจอ — ลบเฉพาะแถวที่สคริปต์นี้สร้าง
  if (empId) {
    await sql(`delete from public.payroll_lines where employee_id = '${empId}'`).catch(() => {})
    await sql(`delete from public.payroll_runs where employee_id = '${empId}'`).catch(() => {})
    await sql(`delete from public.advances where employee_id = '${empId}'`).catch(() => {})
    await sql(`alter table public.attendance disable trigger attendance_guard_closed`).catch(() => {})
    await sql(`delete from public.attendance where employee_id = '${empId}'`).catch(() => {})
    await sql(`alter table public.attendance enable trigger attendance_guard_closed`).catch(() => {})
    await sql(`delete from public.employee_wages where employee_id = '${empId}'`).catch(() => {})
    await sql(`delete from public.employees where id = '${empId}'`).catch(() => {})
  }
  if (siteId) await sql(`delete from public.sites where id = '${siteId}'`).catch(() => {})
  const left = await sql(
    `select count(*)::int as n from public.employees where full_name like '${MARK}%'`).catch(() => null)
  console.log(`\nผ่าน ${pass} · ตก ${fail} · แถวทดสอบที่ค้าง ${
    JSON.stringify(left[0] ?? {})}`)
  process.exit(fail ? 1 : 0)
}
