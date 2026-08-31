#!/usr/bin/env node
/**
 * verify-workers.mjs — ปิดแถว P4-UI-01..03 และ endpoint ของคนงาน
 *
 * 🔴 แถวที่ปฏิเสธต้องยืนยัน **สถานะของข้อมูลหลังจากนั้น** ไม่ใช่แค่รหัสสถานะ
 * 403 ที่มาพร้อมกับแถวที่ถูกสร้างไปแล้วคือการปฏิเสธที่มาช้าไปหนึ่งก้าว
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

console.log('\n── P4 · แท็บคนงาน ───────────────────────────────────────────')

const ownerJar = jarOf(await req('POST', '/api/auth/login', {
  email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }))
const supJar = jarOf(await req('POST', '/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN }))
if (!ownerJar || !supJar) throw new Error('ล็อกอินไม่สำเร็จ — dev server รันอยู่ไหม')

const MARK = 'ทดสอบแท็บคนงาน'
const made = []

try {
  // ── P4-API-01 · หัวหน้าไซต์เพิ่มคนงานไม่ได้ ───────────────────────
  {
    const before = (await sql('select count(*)::int n from public.employees')).rows[0].n
    const r = await req('POST', '/api/employees', {
      fullName: `${MARK} ไม่ควรถูกสร้าง`, wageType: 'daily', dailyRate: '500',
    }, supJar)
    const b = await r.json().catch(() => ({}))
    const after = (await sql('select count(*)::int n from public.employees')).rows[0].n
    check('P4-API-01 หัวหน้าไซต์ยิง POST /api/employees → 403 FORBIDDEN · ไม่มีแถวใหม่',
      r.status === 403 && b.error === 'FORBIDDEN' && Number(after) === Number(before),
      `${r.status} ${b.error} · ${before}→${after}`)
  }

  // ── P4-API-02 · คนรายวันไม่มีเรต → 400 พร้อมเหตุผล ────────────────
  {
    const r = await req('POST', '/api/employees', {
      fullName: `${MARK} ไม่มีเรต`, wageType: 'daily',
    }, ownerJar)
    const b = await r.json().catch(() => ({}))
    check('P4-API-02 คนรายวันไม่ใส่เรต → 400 DAILY_RATE_REQUIRED (ไม่ใช่ 500 จาก constraint)',
      r.status === 400 && b.error === 'DAILY_RATE_REQUIRED', `${r.status} ${b.error}`)
  }

  // ── P4-UI-03 + P4-API-03 · เจ้าของเพิ่มคนงาน ──────────────────────
  let empId = null
  {
    const before = (await sql('select count(*)::int n from public.employees')).rows[0].n
    const r = await req('POST', '/api/employees', {
      fullName: `${MARK} สมชาย`, jobTitle: 'ช่างปูน', wageType: 'daily', dailyRate: '600',
    }, ownerJar)
    const b = await r.json().catch(() => ({}))
    empId = b.employee?.id ?? null
    if (empId) made.push(empId)
    const after = (await sql('select count(*)::int n from public.employees')).rows[0].n
    // ค่าแรงอยู่ `employee_wages` ตั้งแต่ P4.5 — ตารางที่เจ้าของอ่านได้คนเดียว
    const [row] = (await sql(
      `select w.wage_type, w.daily_rate, w.monthly_salary, e.job_title
       from public.employees e
       join public.employee_wages w on w.employee_id = e.id
       where e.id = '${empId}'`)).rows
    check('P4-UI-03 เจ้าของเพิ่มคนงานรายวัน → 201 · employees +1 · เรตและตำแหน่งถูกเก็บจริง',
      r.status === 201 && Number(after) === Number(before) + 1
      && Number(row?.daily_rate) === 600 && row?.job_title === 'ช่างปูน'
      && row?.monthly_salary === null,
      `${r.status} · +${after - Number(before)} · rate=${row?.daily_rate}`)
  }

  // ── P4-API-04 · เปลี่ยนเป็นรายเดือน แล้วเรตรายวันต้องถูกล้าง ──────
  {
    const r = await req('PATCH', `/api/employees/${empId}`, {
      wageType: 'monthly', monthlySalary: '18000',
    }, ownerJar)
    const [row] = (await sql(
      `select wage_type, daily_rate, monthly_salary
       from public.employee_wages where employee_id = '${empId}'`)).rows
    check('P4-API-04 เปลี่ยนเป็นรายเดือน → daily_rate ถูกล้างเป็น null · ไม่เหลือเรตค้างให้ใครอ่านไปใช้',
      r.status === 200 && row?.wage_type === 'monthly' && row?.daily_rate === null
      && Number(row?.monthly_salary) === 18000,
      `${r.status} · daily=${row?.daily_rate} · monthly=${row?.monthly_salary}`)
    // คืนเป็นรายวันเพื่อใช้ในแถวถัดไป
    await req('PATCH', `/api/employees/${empId}`, {
      wageType: 'daily', dailyRate: '600' }, ownerJar)
  }

  // ── P4-API-05 · ปิด/เปิดใช้งาน ────────────────────────────────────
  {
    const off = await req('PATCH', `/api/employees/${empId}`, { isActive: false }, ownerJar)
    const [a] = (await sql(
      `select e.is_active, w.daily_rate from public.employees e
       join public.employee_wages w on w.employee_id = e.id where e.id = '${empId}'`)).rows
    const on = await req('PATCH', `/api/employees/${empId}`, { isActive: true }, ownerJar)
    const [b] = (await sql(
      `select is_active from public.employees where id = '${empId}'`)).rows
    check('P4-API-05 ปิดใช้งานแล้วเปิดใหม่ได้ · ส่งแค่ isActive ไม่ทำให้เรตหาย',
      off.status === 200 && a?.is_active === false && Number(a?.daily_rate) === 600
      && on.status === 200 && b?.is_active === true,
      `ปิด ${off.status}/rate=${a?.daily_rate} · เปิด ${on.status}`)
  }

  // ── P4-API-06 · id ที่ไม่มีจริง ───────────────────────────────────
  {
    const r = await req('PATCH', '/api/employees/00000000-0000-4000-8000-000000000000',
      { isActive: false }, ownerJar)
    const b = await r.json().catch(() => ({}))
    check('P4-API-06 PATCH คนงานที่ไม่มีจริง → 404 NOT_FOUND',
      r.status === 404 && b.error === 'NOT_FOUND', `${r.status} ${b.error}`)
  }

  // ── P4-UI-01 · แท็บคนงานแสดงข้อมูลครบ ─────────────────────────────
  {
    const html = await page('/settings/users?tab=workers', ownerJar)
    const want = [`${MARK} สมชาย`, 'ช่างปูน', 'รายวัน', '฿600']
    const missing = want.filter((w) => !html.includes(w))
    check('P4-UI-01 แท็บคนงานแสดงชื่อ ตำแหน่ง ประเภทค่าแรง และเรต ครบ',
      missing.length === 0, missing.length ? `ขาด: ${missing.join(', ')}` : `${want.length}/${want.length}`)
  }

  // ── P4-UI-01b · สองแท็บแยกกันจริง ─────────────────────────────────
  // 🔴 ฝั่งบวกและฝั่งลบในหน้าเดียวกัน — แท็บที่แสดงทุกอย่างเสมอคือแท็บที่ไม่มีอยู่จริง
  {
    const users = await page('/settings/users', ownerJar)
    const workers = await page('/settings/users?tab=workers', ownerJar)
    check('P4-UI-01b แท็บผู้ใช้ระบบไม่แสดงคนงาน และแท็บคนงานไม่แสดงหัวข้อผู้ใช้ระบบ',
      !users.includes(`${MARK} สมชาย`) && workers.includes(`${MARK} สมชาย`)
      && users.includes('เพิ่มผู้ใช้') && workers.includes('เพิ่มคนงาน'),
      `users มีคนงาน=${users.includes(`${MARK} สมชาย`)} · workers มีคนงาน=${workers.includes(`${MARK} สมชาย`)}`)
  }

  // ── P4-UI-01c · คนงานมีปุ่มของตัวเองบนหน้าตั้งค่า ─────────────────
  // 🔴 ฝั่งลบสำคัญพอ ๆ กับฝั่งบวก — ปุ่มที่หัวหน้าไซต์เห็นแล้วกดไปเจอ redirect
  // คือปุ่มที่โกหก (§15: role ที่อนุญาตต้องตรงกับที่ปุ่มนั้นอยู่)
  {
    const ownerSettings = await page('/settings', ownerJar)
    const supSettings = await page('/settings', supJar)
    const linkRe = /href="\/settings\/users\?tab=workers"/
    // ต้องอยู่ **หลัง** ปุ่มผู้ใช้ระบบ ตามที่เจ้าของสั่ง — เทียบตำแหน่งในหน้า
    const posUsers = ownerSettings.indexOf('href="/settings/users"')
    const posWorkers = ownerSettings.search(linkRe)
    check('P4-UI-01c หน้าตั้งค่ามีปุ่ม "คนงาน" ต่อจาก "ผู้ใช้ระบบ" · หัวหน้าไซต์ไม่เห็นปุ่มนี้',
      posUsers >= 0 && posWorkers > posUsers && ownerSettings.includes('คนงาน')
        && !linkRe.test(supSettings),
      `เจ้าของ: ผู้ใช้ระบบ@${posUsers} · คนงาน@${posWorkers} · หัวหน้าไซต์เห็นปุ่ม=${linkRe.test(supSettings)}`)
  }

  // ── P4-UI-02 · หัวหน้าไซต์เข้าไม่ได้ ──────────────────────────────
  {
    const r = await fetch(`${BASE}/settings/users?tab=workers`, {
      headers: { cookie: supJar }, redirect: 'manual' })
    const loc = r.headers.get('location') ?? ''
    // ฝั่งบวก: หน้าที่เขาเข้าได้ยังเข้าได้อยู่
    const settings = await page('/settings', supJar)
    check('P4-UI-02 หัวหน้าไซต์เปิดแท็บคนงาน → ถูก redirect ออก · /settings ยังเข้าได้',
      r.status === 307 && !loc.includes('/users') && settings.length > 500,
      `${r.status} → ${loc || '(ไม่มี location)'}`)
  }
} finally {
  if (made.length) {
    await sql(`delete from public.employees where id in (${made.map((i) => `'${i}'`).join(',')})`)
  }
  await sql(`delete from public.employees where full_name like '${MARK}%'`)
  console.log('  (ลบข้อมูลทดสอบแล้ว)')
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
