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

console.log('\n── P4 · หน้าคนงาน · R7 · ลบคนงาน ────────────────────────────')

const ownerJar = jarOf(await req('POST', '/api/auth/login', {
  email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }))
const supJar = jarOf(await req('POST', '/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN }))
if (!ownerJar || !supJar) throw new Error('ล็อกอินไม่สำเร็จ — dev server รันอยู่ไหม')

const MARK = 'ทดสอบแท็บคนงาน'
const made = []

try {
  // ── P4-API-01 · หัวหน้าโครงการเพิ่มคนงานไม่ได้ ───────────────────────
  {
    const before = (await sql('select count(*)::int n from public.employees')).rows[0].n
    const r = await req('POST', '/api/employees', {
      fullName: `${MARK} ไม่ควรถูกสร้าง`, wageType: 'daily', dailyRate: '500',
    }, supJar)
    const b = await r.json().catch(() => ({}))
    const after = (await sql('select count(*)::int n from public.employees')).rows[0].n
    check('P4-API-01 หัวหน้าโครงการยิง POST /api/employees → 403 FORBIDDEN · ไม่มีแถวใหม่',
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

  // ── P4-UI-01 · หน้าคนงานแสดงข้อมูลครบ ─────────────────────────────
  {
    const html = await page('/settings/users?tab=workers', ownerJar)
    const want = [`${MARK} สมชาย`, 'ช่างปูน', 'รายวัน', '฿600']
    const missing = want.filter((w) => !html.includes(w))
    check('P4-UI-01 หน้าคนงานแสดงชื่อ ตำแหน่ง ประเภทค่าแรง และเรต ครบ',
      missing.length === 0, missing.length ? `ขาด: ${missing.join(', ')}` : `${want.length}/${want.length}`)
  }

  // ── P4-UI-01b · สองรายการแยกกันจริง ─────────────────────────────────
  // 🔴 ฝั่งบวกและฝั่งลบคู่กัน — รายการที่แสดงทุกอย่างเสมอคือรายการที่ไม่ได้กรองอะไรเลย
  {
    const users = await page('/settings/users', ownerJar)
    const workers = await page('/settings/users?tab=workers', ownerJar)
    // แถบแท็บถูกเอาออกแล้ว (เจ้าของขอให้คนงานเป็นปุ่มของตัวเองบนหน้าตั้งค่า)
    // → ต้องยังข้ามไปมาได้ ไม่งั้นการดูทั้งสองรายการกลายเป็นเดินย้อนกลับทุกครั้ง
    const crossLinked = /href="\/settings\/users\?tab=workers"/.test(users)
      && /href="\/settings\/users"/.test(workers)
    check('P4-UI-01b หน้าผู้ใช้ระบบไม่แสดงคนงาน และหน้าคนงานไม่แสดงรายชื่อผู้ใช้ระบบ · ข้ามไปมาได้',
      !users.includes(`${MARK} สมชาย`) && workers.includes(`${MARK} สมชาย`)
      && users.includes('เพิ่มผู้ใช้') && workers.includes('เพิ่มคนงาน')
      && crossLinked,
      `users มีคนงาน=${users.includes(`${MARK} สมชาย`)} · workers มีคนงาน=${workers.includes(`${MARK} สมชาย`)} · ลิงก์ข้าม=${crossLinked}`)
  }

  // ── P4-UI-01c · คนงานมีปุ่มของตัวเองบนหน้าตั้งค่า ─────────────────
  // 🔴 ฝั่งลบสำคัญพอ ๆ กับฝั่งบวก — ปุ่มที่หัวหน้าโครงการเห็นแล้วกดไปเจอ redirect
  // คือปุ่มที่โกหก (§15: role ที่อนุญาตต้องตรงกับที่ปุ่มนั้นอยู่)
  {
    const ownerSettings = await page('/settings', ownerJar)
    const supSettings = await page('/settings', supJar)
    const linkRe = /href="\/settings\/users\?tab=workers"/
    // ต้องอยู่ **หลัง** ปุ่มผู้ใช้ระบบ ตามที่เจ้าของสั่ง — เทียบตำแหน่งในหน้า
    const posUsers = ownerSettings.indexOf('href="/settings/users"')
    const posWorkers = ownerSettings.search(linkRe)
    check('P4-UI-01c หน้าตั้งค่ามีปุ่ม "คนงาน" ต่อจาก "ผู้ใช้ระบบ" · หัวหน้าโครงการไม่เห็นปุ่มนี้',
      posUsers >= 0 && posWorkers > posUsers && ownerSettings.includes('คนงาน')
        && !linkRe.test(supSettings),
      `เจ้าของ: ผู้ใช้ระบบ@${posUsers} · คนงาน@${posWorkers} · หัวหน้าโครงการเห็นปุ่ม=${linkRe.test(supSettings)}`)
  }

  // ── R7 · ลบคนงาน ─────────────────────────────────────────────────
  // 🔴 ทุกแถวเช็ค **สถานะข้อมูลหลังจากนั้น** ไม่ใช่แค่รหัสสถานะ · 403 ที่มาพร้อม
  // แถวที่ถูกลบไปแล้วคือการปฏิเสธที่มาช้าไปหนึ่งก้าว
  {
    // คนที่ไม่มีประวัติอะไรเลย → ลบได้จริง
    const r0 = await req('POST', '/api/employees', {
      fullName: `${MARK} ลบได้`, wageType: 'daily', dailyRate: '500',
    }, ownerJar)
    const b0 = await r0.json().catch(() => ({}))
    const id = b0.employee?.id ?? b0.id
    if (id) made.push(id)
    const del = await req('DELETE', `/api/employees/${id}`, undefined, ownerJar)
    const gone = (await sql(`select count(*)::int n from public.employees where id = '${id}'`)).rows[0].n
    check('R7-API-01 เจ้าของลบคนงานที่ไม่มีประวัติ → 200 · แถวหายจริง',
      del.status === 200 && Number(gone) === 0, `${del.status} · เหลือ ${gone} แถว`)
  }
  {
    // คนที่ลงชื่อเข้าโครงการไว้ (ยังไม่ปิดรอบ) → ลบได้ และประวัติหายตามไปด้วย
    const r0 = await req('POST', '/api/employees', {
      fullName: `${MARK} มีประวัติ`, wageType: 'daily', dailyRate: '400',
    }, ownerJar)
    const id = (await r0.json().catch(() => ({}))).employee?.id
    if (id) made.push(id)
    const site = (await sql(`select id from public.sites order by created_at limit 1`)).rows[0]?.id
    await sql(`
      insert into public.attendance (site_id, employee_id, work_date, work_units)
      values ('${site}', '${id}', (now() at time zone 'Asia/Bangkok')::date, 1)`)
    const info = (await sql(`
      select unpaid_wage::text, work_days::text from public.employees_delete_info()
      where employee_id = '${id}'`)).rows[0]
    const del = await req('DELETE', `/api/employees/${id}`, undefined, ownerJar)
    const body = await del.json().catch(() => ({}))
    const left = (await sql(`
      select (select count(*) from public.employees where id = '${id}')
           + (select count(*) from public.attendance where employee_id = '${id}') as n`)).rows[0].n
    check('R7-API-02 ลบคนที่ยังค้างจ่ายค่าแรง → สำเร็จ · คืนยอดที่หายไป · ประวัติลงชื่อถูกลบตาม',
      del.status === 200 && Number(body.deleted?.unpaid_wage) > 0 && Number(left) === 0,
      `${del.status} · ค้างจ่ายก่อนลบ ${info?.unpaid_wage ?? '—'} · เหลือ ${left} แถว`)
  }
  {
    // ⚠️ แถวนี้ต้องมีคนที่อยู่ในรอบจ่ายที่ปิดแล้วจริง — ถ้าฐานยังไม่มี ให้ข้าม
    // แทนที่จะเขียวลอย ๆ · `0 === 0` ที่ไม่มีวันแดงแย่กว่าไม่มีแถวนี้เลย
    const paid = (await sql(`
      select pl.employee_id::text as id from public.payroll_lines pl limit 1`)).rows[0]
    if (!paid) {
      console.log('  ⚠️  R7-API-03 ข้าม — ยังไม่มีใครอยู่ในรอบจ่ายที่ปิดแล้วในฐานนี้')
    } else {
      const del = await req('DELETE', `/api/employees/${paid.id}`, undefined, ownerJar)
      const b = await del.json().catch(() => ({}))
      const still = (await sql(
        `select count(*)::int n from public.employees where id = '${paid.id}'`)).rows[0].n
      check('R7-API-03 ลบคนที่อยู่ในรอบจ่ายที่ปิดแล้ว → 409 EMPLOYEE_IN_PAYROLL · แถวยังอยู่ครบ',
        del.status === 409 && b.error === 'EMPLOYEE_IN_PAYROLL' && Number(still) === 1,
        `${del.status} ${b.error} · เหลือ ${still} แถว`)
    }
  }
  {
    const r0 = await req('POST', '/api/employees', {
      fullName: `${MARK} หัวหน้าโครงการลบไม่ได้`, wageType: 'daily', dailyRate: '500',
    }, ownerJar)
    const id = (await r0.json().catch(() => ({}))).employee?.id
    if (id) made.push(id)
    const del = await req('DELETE', `/api/employees/${id}`, undefined, supJar)
    const still = (await sql(`select count(*)::int n from public.employees where id = '${id}'`)).rows[0].n
    check('R7-API-04 หัวหน้าโครงการยิง DELETE → 403 · แถวยังอยู่',
      del.status === 403 && Number(still) === 1, `${del.status} · เหลือ ${still} แถว`)
  }
  {
    const rows = (await sql(`
      select count(*)::int n from public.employees_delete_info()`)).rows[0].n
    check('R7-DB-05 employees_delete_info() เรียกด้วยสิทธิ์ที่ไม่ใช่เจ้าของ (service ไม่มี auth.uid) → 0 แถว',
      Number(rows) === 0, `${rows} แถว`)
  }

  // ── P4-UI-02 · หัวหน้าโครงการเข้าไม่ได้ ──────────────────────────────
  {
    const r = await fetch(`${BASE}/settings/users?tab=workers`, {
      headers: { cookie: supJar }, redirect: 'manual' })
    const loc = r.headers.get('location') ?? ''
    // ฝั่งบวก: หน้าที่เขาเข้าได้ยังเข้าได้อยู่
    const settings = await page('/settings', supJar)
    check('P4-UI-02 หัวหน้าโครงการเปิดหน้าคนงาน → ถูก redirect ออก · /settings ยังเข้าได้',
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
