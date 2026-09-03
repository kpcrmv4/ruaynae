#!/usr/bin/env node
/**
 * verify-employees.mjs — ปิดแถว P4-DB-* และ P4-SEC-* ใน docs/test-plan/P4.md
 *
 * ยิง PostgREST **ในนามของแต่ละ role จริง ๆ** เพราะ policy และ trigger
 * ทั้งชุดอ่าน `auth.uid()` — คำสั่งที่รันด้วย service role จะได้ `null`
 * แล้วเส้นทางที่อยากทดสอบจะไม่เคยถูกเดินเลย
 *
 * 🔴 ตั้งแต่ P4.5 ค่าแรงอยู่คนละตารางกับข้อมูลคนงาน
 *   employees / attendance              ทุกคนที่เกี่ยวข้องอ่านได้
 *   employee_wages / attendance_wages   เจ้าของเท่านั้น
 * เพราะ RLS ของ Postgres คุมระดับแถว ไม่ใช่ระดับคอลัมน์
 */
import { readFileSync } from 'node:fs'
import { derivePassword, syntheticEmail } from '../src/lib/pin-core.ts'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)
const URL = env.NEXT_PUBLIC_SUPABASE_URL
const PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const SECRET = env.SUPABASE_SECRET_KEY

const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

async function signIn(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: PUB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`sign-in ล้มเหลว ${email}: ${JSON.stringify(j).slice(0, 200)}`)
  return j.access_token
}

async function db(token, path, init = {}) {
  const headers = { apikey: PUB, 'Content-Type': 'application/json', ...init.headers }
  if (token !== 'anon') headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${URL}/rest/v1${path}`, { ...init, headers })
  const text = await r.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: r.status, ok: r.ok, body, raw: text }
}
const asService = (path, init = {}) =>
  db(SECRET, path, { ...init, headers: { apikey: SECRET, ...init.headers } })

/** เรียก RPC ในนามใครสักคน */
const rpc = (token, name, args) =>
  db(token, `/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) })

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

console.log('\n── P4-DB · คนงาน + คนเข้าโครงการ ───────────────────────────────')

const ownerTok = await signIn(env.SEED_OWNER_EMAIL, env.SEED_OWNER_PASSWORD)
const supTok = await signIn(
  syntheticEmail('sup1'),
  derivePassword(env.PIN_PEPPER, env.SEED_SUPERVISOR1_PIN),
)
const [sup1] = (await asService(
  `/profiles?select=id&full_name=eq.${encodeURIComponent(env.SEED_SUPERVISOR1_NAME)}`)).body

const day = (offset) => {
  const d = new Date(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()) + 'T00:00:00Z',
  )
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
const today = day(0)
const yesterday = day(-1)

const MARK = 'ทดสอบ P4'
let siteA = null
let siteB = null
const empIds = []

/** สร้างคนงานผ่าน RPC เดียวกับที่แอปใช้ — สองตารางในทรานแซกชันเดียว */
const save = (token, args) =>
  rpc(token, 'save_employee', {
    p_id: null, p_job_title: null, p_daily: null, p_monthly: null,
    p_default_site: null, p_is_active: true, p_profile: null, ...args,
  })

const wageOf = async (empId) =>
  (await asService(`/employee_wages?select=wage_type,daily_rate,monthly_salary&employee_id=eq.${empId}`)).body?.[0]
const attWageOf = async (attId) =>
  (await asService(`/attendance_wages?select=work_units,wage_snapshot,ot_amount,amount&attendance_id=eq.${attId}`)).body?.[0]

try {
  ;[{ id: siteA }] = (await sql(
    `insert into public.sites(name, status) values ('${MARK} โครงการก', 'active') returning id`)).rows
  ;[{ id: siteB }] = (await sql(
    `insert into public.sites(name, status) values ('${MARK} โครงการข', 'active') returning id`)).rows
  // ดูแลโครงการ ก **ตั้งแต่วันนี้** — เมื่อวานจึงอยู่นอกช่วง (ใช้ที่ P4-DB-16)
  await sql(`insert into public.site_supervisors(site_id, profile_id, effective_from)
             values ('${siteA}','${sup1.id}','${today}')`)

  // ── P4-DB-01 · สร้างคนงานรายวัน ───────────────────────────────────
  let dailyId = null
  {
    const before = (await sql("select count(*)::int n from public.audit_log where table_name='employees'")).rows[0].n
    const r = await save(ownerTok, {
      p_full_name: `${MARK} สมชาย ช่างปูน`, p_job_title: 'ช่างปูน',
      p_wage_type: 'daily', p_daily: 600,
    })
    dailyId = typeof r.body === 'string' ? r.body : null
    if (dailyId) empIds.push(dailyId)
    const w = dailyId ? await wageOf(dailyId) : null
    const after = (await sql("select count(*)::int n from public.audit_log where table_name='employees'")).rows[0].n
    check('P4-DB-01 เจ้าของสร้างคนงานรายวันพร้อมเรต → สำเร็จ · เรตลง employee_wages · audit_log +1',
      r.status === 200 && Number(w?.daily_rate) === 600 && after === Number(before) + 1,
      `${r.status} · rate=${w?.daily_rate} · audit +${after - Number(before)}`)
  }

  // ── P4-DB-02 · รายวันไม่มีเรต ─────────────────────────────────────
  {
    const r = await save(ownerTok, { p_full_name: `${MARK} ไม่มีเรต`, p_wage_type: 'daily' })
    check('P4-DB-02 คนรายวันที่ไม่มีเรต → ถูกปฏิเสธด้วย check constraint',
      r.status >= 400 && /wages_daily_needs_rate/.test(r.raw ?? ''),
      `${r.status} ${(r.body?.message ?? '').slice(0, 50)}`)
  }

  // ── P4-DB-03 · คนรายเดือน ─────────────────────────────────────────
  let monthlyId = null
  {
    const r = await save(ownerTok, {
      p_full_name: `${MARK} สมหญิง โฟร์แมน`, p_wage_type: 'monthly', p_monthly: 18000 })
    monthlyId = typeof r.body === 'string' ? r.body : null
    if (monthlyId) empIds.push(monthlyId)
    const w = monthlyId ? await wageOf(monthlyId) : null
    check('P4-DB-03 คนรายเดือนพร้อมเงินเดือน → สำเร็จ · daily_rate เป็น null',
      r.status === 200 && w?.daily_rate === null && Number(w?.monthly_salary) === 18000,
      `${r.status} · daily=${w?.daily_rate} · monthly=${w?.monthly_salary}`)
  }

  // ── P4-DB-04 · หัวหน้าโครงการสร้างคนงานไม่ได้ ────────────────────────
  {
    const before = (await sql("select count(*)::int n from public.employees")).rows[0].n
    const bad = await save(supTok, {
      p_full_name: `${MARK} คนที่ไม่ควรมี`, p_wage_type: 'daily', p_daily: 500 })
    const after = (await sql("select count(*)::int n from public.employees")).rows[0].n
    // ฝั่งบวก: เจ้าของยังสร้างได้ในคำสั่งถัดไป
    const good = await save(ownerTok, {
      p_full_name: `${MARK} กรรมกร`, p_wage_type: 'daily', p_daily: 450 })
    if (typeof good.body === 'string') empIds.push(good.body)
    check('P4-DB-04 หัวหน้าโครงการสร้างคนงานไม่ได้ (/FORBIDDEN/) · จำนวนเท่าเดิม · เจ้าของยังสร้างได้',
      bad.status >= 400 && /FORBIDDEN/.test(bad.raw ?? '')
      && Number(after) === Number(before) && good.status === 200,
      `${bad.status} · ${before}→${after}`)
  }

  // ── P4-DB-05 · หัวหน้าโครงการเห็นเฉพาะคนที่ยังใช้งาน ─────────────────
  {
    const off = await save(ownerTok, {
      p_full_name: `${MARK} คนที่ลาออกแล้ว`, p_wage_type: 'daily', p_daily: 400, p_is_active: false })
    if (typeof off.body === 'string') empIds.push(off.body)
    const supActive = await db(supTok, '/employees?select=id&is_active=eq.true')
    const supOff = await db(supTok, '/employees?select=id&is_active=eq.false')
    const ownerOff = await db(ownerTok, '/employees?select=id&is_active=eq.false')
    check('P4-DB-05 หัวหน้าโครงการเห็นคนที่ยังใช้งาน > 0 และไม่เห็นคนที่ปิดใช้งาน · เจ้าของเห็นทั้งสองแบบ',
      (supActive.body?.length ?? 0) > 0 && (supOff.body?.length ?? 0) === 0
      && (ownerOff.body?.length ?? 0) > 0,
      `หัวหน้าโครงการ active ${supActive.body?.length} / inactive ${supOff.body?.length} · เจ้าของ inactive ${ownerOff.body?.length}`)
  }

  // ── P4-SEC-01 · หัวหน้าโครงการอ่านเรตค่าแรงไม่ได้เลย ─────────────────
  // 🔴 นี่คือคำสั่งของเจ้าของเมื่อ 31 ส.ค. 2569 · ต้องตรวจทั้ง "อ่านตารางตรง ๆ"
  // และ "เห็นชื่อคนได้อยู่" ในการตรวจเดียวกัน — ไม่งั้น 0 แถวอาจแปลว่า
  // เซสชันตายไปแล้ว ซึ่งผ่านเหมือนกันแต่ไม่ได้พิสูจน์อะไร
  {
    const wages = await db(supTok, '/employee_wages?select=employee_id,daily_rate')
    const names = await db(supTok, '/employees?select=id,full_name&is_active=eq.true')
    const ownerWages = await db(ownerTok, '/employee_wages?select=employee_id,daily_rate')
    check('P4-SEC-01 หัวหน้าโครงการอ่าน employee_wages ได้ 0 แถว แต่ยังเห็นชื่อคนงาน · เจ้าของอ่านได้ > 0',
      (Array.isArray(wages.body) ? wages.body.length : 0) === 0
      && (names.body?.length ?? 0) > 0 && (ownerWages.body?.length ?? 0) > 0,
      `เรต ${Array.isArray(wages.body) ? wages.body.length : '?'} · ชื่อ ${names.body?.length} · เจ้าของ ${ownerWages.body?.length}`)
  }

  // ── P4-SEC-02 · ไม่มีคอลัมน์เงินหลงเหลือใน employees/attendance ────
  {
    const { rows } = await sql(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' and table_name in ('employees','attendance')
         and column_name in ('daily_rate','monthly_salary','wage_type','wage_snapshot','ot_amount','amount')`)
    check('P4-SEC-02 ไม่มีคอลัมน์เงินหลงเหลือในตารางที่หัวหน้าโครงการอ่านได้',
      rows.length === 0,
      rows.length ? rows.map((r) => `${r.table_name}.${r.column_name}`).join(', ') : 'สะอาด')
  }

  // ── P4-DB-22 · profile_id ผูกได้คนเดียว ───────────────────────────
  {
    await sql(`update public.employees set profile_id = '${sup1.id}' where id = '${empIds[0]}'`)
    const r = await sql(
      `update public.employees set profile_id = '${sup1.id}' where id = '${empIds[2]}'`)
    check('P4-DB-22 ผูก profile_id ซ้ำกับคนที่สองไม่ได้ (unique) · คนแรกผูกไว้แล้วจริง',
      Boolean(r.error) && /employees_profile_id_key|duplicate key/.test(r.error ?? ''),
      r.error ? 'unique ทำงาน' : 'ผูกซ้ำได้ — ผิด')
    await sql(`update public.employees set profile_id = null where id = '${empIds[0]}'`)
  }

  // ── P4-DB-07 + P4-DB-09 · ลงชื่อ + เรตมาจากฐานข้อมูล ──────────────
  let attId = null
  {
    const r = await db(supTok, '/attendance', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        work_date: today, site_id: siteA, employee_id: dailyId, work_units: 1 }),
    })
    attId = (Array.isArray(r.body) ? r.body[0] : null)?.id ?? null
    const w = attId ? await attWageOf(attId) : null
    check('P4-DB-07 หัวหน้าโครงการลงชื่อคนเข้าโครงการตัวเองได้ · wage_snapshot = เรตของคนนั้น',
      r.status === 201 && Number(w?.wage_snapshot) === 600 && Number(w?.amount) === 600,
      `${r.status} · snapshot=${w?.wage_snapshot} · amount=${w?.amount}`)

    // 🔴 ค่าที่ client ยัดมาต้องถูกเพิกเฉย — ตอนนี้ยัดไม่ได้เลยเพราะคอลัมน์
    // ไม่ได้อยู่ในตารางที่เขาเขียนได้ · ตรวจว่า insert ที่มีคอลัมน์นั้นถูกปฏิเสธ
    const forged = await db(supTok, '/attendance', {
      method: 'POST',
      body: JSON.stringify({
        work_date: day(-7), site_id: siteA, employee_id: dailyId, wage_snapshot: 99999 }),
    })
    check('P4-DB-09 ยัด wage_snapshot มาใน insert ไม่ได้เลย — คอลัมน์ไม่ได้อยู่ในตารางที่เขาเขียนได้',
      forged.status >= 400, `${forged.status}`)
  }

  // ── P4-SEC-03 · หัวหน้าโครงการอ่านยอดเงินของ attendance ไม่ได้ ───────
  {
    const wages = await db(supTok, '/attendance_wages?select=attendance_id,amount')
    const rows = await db(supTok, `/attendance?select=id,employee_id&site_id=eq.${siteA}`)
    check('P4-SEC-03 หัวหน้าโครงการอ่าน attendance_wages ได้ 0 แถว แต่ยังเห็นว่าใครมาทำงาน',
      (Array.isArray(wages.body) ? wages.body.length : 0) === 0 && (rows.body?.length ?? 0) > 0,
      `ยอดเงิน ${Array.isArray(wages.body) ? wages.body.length : '?'} · รายชื่อ ${rows.body?.length}`)
  }

  // ── P4-DB-08 · โครงการที่ไม่ได้ดูแล ──────────────────────────────────
  {
    const before = (await sql("select count(*)::int n from public.attendance")).rows[0].n
    const bad = await db(supTok, '/attendance', {
      method: 'POST',
      body: JSON.stringify({ work_date: today, site_id: siteB, employee_id: dailyId }),
    })
    const after = (await sql("select count(*)::int n from public.attendance")).rows[0].n
    check('P4-DB-08 หัวหน้าโครงการลงชื่อเข้าโครงการที่ไม่ได้ดูแลไม่ได้ · จำนวนเท่าเดิม',
      bad.status >= 400 && Number(after) === Number(before), `${bad.status} · ${before}→${after}`)
  }

  // ── P4-DB-16 · ขอบเขตผูกกับ work_date ไม่ใช่วันนี้ ────────────────
  {
    const r = await db(supTok, '/attendance', {
      method: 'POST',
      body: JSON.stringify({ work_date: yesterday, site_id: siteA, employee_id: dailyId }),
    })
    check('P4-DB-16 ลงชื่อของวันที่ยังไม่ได้ดูแลโครงการนั้น (เมื่อวาน) ถูกปฏิเสธ · วันนี้ลงได้',
      r.status >= 400 && Boolean(attId), `${r.status}`)
  }

  // ── P4-DB-13 · ลงซ้ำ ──────────────────────────────────────────────
  {
    const r = await db(supTok, '/attendance', {
      method: 'POST',
      body: JSON.stringify({ work_date: today, site_id: siteA, employee_id: dailyId }),
    })
    const [{ n }] = (await sql(
      `select count(*)::int n from public.attendance
       where employee_id = '${dailyId}' and work_date = '${today}' and site_id = '${siteA}'`)).rows
    check('P4-DB-13 ลงชื่อซ้ำ คนเดิม วันเดิม โครงการเดิม → ถูกปฏิเสธ · มีแถวเดียว',
      r.status >= 400 && Number(n) === 1, `${r.status} · ${n} แถว`)
  }

  // ── P4-DB-12 · หนึ่งคนไม่เกินหนึ่งวันต่อวัน ───────────────────────
  {
    const full = await db(ownerTok, '/attendance', {
      method: 'POST',
      body: JSON.stringify({ work_date: today, site_id: siteB, employee_id: dailyId, work_units: 1 }),
    })
    await sql(`delete from public.attendance where employee_id = '${dailyId}' and work_date = '${today}'`)
    const half1 = await db(ownerTok, '/attendance', {
      method: 'POST',
      body: JSON.stringify({ work_date: today, site_id: siteA, employee_id: dailyId, work_units: 0.5 }),
    })
    const half2 = await db(ownerTok, '/attendance', {
      method: 'POST',
      body: JSON.stringify({ work_date: today, site_id: siteB, employee_id: dailyId, work_units: 0.5 }),
    })
    check('P4-DB-12 เต็มวันสองโครงการในวันเดียวถูกปฏิเสธ /WORK_UNITS_EXCEEDED/ · ครึ่ง+ครึ่ง ผ่าน',
      /WORK_UNITS_EXCEEDED/.test(full.raw ?? '') && half1.status === 201 && half2.status === 201,
      `เต็ม+เต็ม ${full.status} · ครึ่ง ${half1.status}/${half2.status}`)
    await sql(`delete from public.attendance where employee_id = '${dailyId}' and work_date = '${today}'`)
  }

  // ── P4-DB-11 · amount เป็น generated column ───────────────────────
  {
    const r = await db(ownerTok, '/attendance', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        work_date: today, site_id: siteA, employee_id: dailyId, work_units: 0.5 }),
    })
    const id = (Array.isArray(r.body) ? r.body[0] : null)?.id
    await db(ownerTok, `/attendance_wages?attendance_id=eq.${id}`, {
      method: 'PATCH', body: JSON.stringify({ ot_amount: 150 }),
    })
    const w = await attWageOf(id)
    const wrote = await db(ownerTok, `/attendance_wages?attendance_id=eq.${id}`, {
      method: 'PATCH', body: JSON.stringify({ amount: 1 }),
    })
    check('P4-DB-11 ครึ่งวัน ฿600 + OT ฿150 → amount = ฿450 · เขียนทับ amount ตรง ๆ ไม่ได้',
      Number(w?.amount) === 450 && wrote.status >= 400,
      `amount=${w?.amount} · เขียนทับ ${wrote.status}`)
  }

  // ── P4-DB-14 · work_units นอกช่วง ─────────────────────────────────
  {
    const bad = []
    for (const u of [0, 0.3, 1.5]) {
      const r = await db(ownerTok, '/attendance', {
        method: 'POST',
        body: JSON.stringify({
          work_date: day(-3), site_id: siteA, employee_id: dailyId, work_units: u }),
      })
      bad.push(r.status)
    }
    check('P4-DB-14 work_units ที่ไม่ใช่ 0.5 หรือ 1 (0 · 0.3 · 1.5) ถูกปฏิเสธทุกค่า',
      bad.every((s) => s >= 400), bad.join(' '))
  }

  // ── P4-DB-15 · คนรายเดือน ─────────────────────────────────────────
  {
    const r = await db(ownerTok, '/attendance', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        work_date: today, site_id: siteA, employee_id: monthlyId, work_units: 1 }),
    })
    const id = (Array.isArray(r.body) ? r.body[0] : null)?.id
    await db(ownerTok, `/attendance_wages?attendance_id=eq.${id}`, {
      method: 'PATCH', body: JSON.stringify({ ot_amount: 200 }),
    })
    const w = await attWageOf(id)
    check('P4-DB-15 คนรายเดือน → wage_snapshot = 0 · amount = เฉพาะ OT (฿200)',
      r.status === 201 && Number(w?.wage_snapshot) === 0 && Number(w?.amount) === 200,
      `snapshot=${w?.wage_snapshot} · amount=${w?.amount}`)
  }

  // ── P4-DB-10 · 🔴 ขึ้นค่าแรงแล้วของเก่าต้องไม่ขยับ ────────────────
  {
    const [old1] = (await sql(
      `select id from public.attendance
       where employee_id = '${dailyId}' and work_date = '${today}' and site_id = '${siteA}'`)).rows
    const before = await attWageOf(old1.id)

    await save(ownerTok, {
      p_id: dailyId, p_full_name: `${MARK} สมชาย ช่างปูน`, p_wage_type: 'daily', p_daily: 900 })

    const after = await attWageOf(old1.id)

    // ── P4-DB-10b · แตะแถวเก่าหลังขึ้นค่าแรงก็ยังต้องไม่ขยับ ────────
    await db(ownerTok, `/attendance?id=eq.${old1.id}`, {
      method: 'PATCH', body: JSON.stringify({ note: 'แก้โน้ตเฉย ๆ' }),
    })
    const afterEdit = await attWageOf(old1.id)

    const fresh = await db(ownerTok, '/attendance', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        work_date: day(-5), site_id: siteA, employee_id: dailyId, work_units: 1 }),
    })
    const freshWage = await attWageOf((Array.isArray(fresh.body) ? fresh.body[0] : null)?.id)

    check('P4-DB-10b แก้โน้ตของแถวเก่าหลังขึ้นค่าแรง → wage_snapshot ยังเป็น ฿600 ไม่ถูกถ่ายใหม่',
      Number(afterEdit?.wage_snapshot) === 600, `หลังแก้โน้ต snapshot=${afterEdit?.wage_snapshot}`)
    check('P4-DB-10 ขึ้นค่าแรงแล้ว attendance ของวันเก่าไม่ขยับ (฿600) · แถวใหม่ใช้เรตใหม่ (฿900)',
      Number(before?.wage_snapshot) === 600 && Number(after?.wage_snapshot) === 600
      && Number(after?.amount) === Number(before?.amount)
      && Number(freshWage?.wage_snapshot) === 900,
      `เก่า ${before?.wage_snapshot}→${after?.wage_snapshot} · ใหม่ ${freshWage?.wage_snapshot}`)
  }

  // ── P4-DB-06 · anon ───────────────────────────────────────────────
  {
    const tables = ['employees', 'attendance', 'employee_wages', 'attendance_wages']
    const counts = []
    for (const t of tables) {
      const r = await db('anon', `/${t}?select=*`)
      counts.push(Array.isArray(r.body) ? r.body.length : -1)
    }
    const oe = await db(ownerTok, '/employees?select=id')
    const oa = await db(ownerTok, '/attendance?select=id')
    check('P4-DB-06 anon อ่านทั้งสี่ตารางได้ 0 แถว · เจ้าของอ่านได้ > 0',
      counts.every((c) => c === 0) && (oe.body?.length ?? 0) > 0 && (oa.body?.length ?? 0) > 0,
      `anon ${counts.join('/')} · owner ${oe.body?.length}/${oa.body?.length}`)
  }

  // ── P4-DB-19 · index ──────────────────────────────────────────────
  {
    const { rows } = await sql(
      "select indexdef from pg_indexes where schemaname='public' and tablename in ('attendance','employees')")
    const defs = rows.map((r) => r.indexdef).join('\n')
    const want = [/\(work_date, site_id\)/i, /\(employee_id, work_date\)/i, /\(site_id\)/i]
    check('P4-DB-19 index ที่ใช้กรองจริงมีครบ: (work_date, site_id) · (employee_id, work_date) · FK',
      want.every((re) => re.test(defs)), `${rows.length} index`)
  }

  // ── P4-DB-20 · audit trigger ──────────────────────────────────────
  {
    const { rows } = await sql(
      `select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where c.relname in ('employees','attendance','employee_wages','attendance_wages')
         and not t.tgisinternal`)
    const names = rows.map((r) => r.tgname)
    const want = ['employees_audit', 'attendance_audit', 'employee_wages_audit', 'attendance_wages_audit']
    check('P4-DB-20 audit trigger ครอบทั้งสี่ตาราง (รวมสองตารางเงินที่แยกออกมา)',
      want.every((w) => names.includes(w)), want.filter((w) => !names.includes(w)).join(', ') || 'ครบ')
  }

  // ── P4-DB-21a · คอลัมน์ที่ trigger ต้องเขียนเอง ───────────────────
  {
    const mig = readFileSync('supabase/migrations/20260831000000_p45_wage_secrecy.sql', 'utf8')
      .replace(/--[^\n]*/g, '')
    check('P4-DB-21a `wage_snapshot` ถูกกำหนดใน trigger จริง (ไม่ใช่ default ที่ client ส่งทับได้)',
      /insert into public\.attendance_wages[\s\S]{0,400}wage_snapshot/.test(mig),
      'trigger sync_attendance_wage เป็นคนเขียน')
  }
} finally {
  await sql(`delete from public.attendance where site_id in ('${siteA}','${siteB}')`)
  if (empIds.length) {
    await sql(`delete from public.employees where id in (${empIds.map((i) => `'${i}'`).join(',')})`)
  }
  await sql(`delete from public.employees where full_name like '${MARK}%'`)
  for (const id of [siteA, siteB]) {
    if (id) {
      await sql(`delete from public.site_supervisors where site_id = '${id}'`)
      await sql(`delete from public.site_finance where site_id = '${id}'`)
      await sql(`delete from public.sites where id = '${id}'`)
    }
  }
  console.log('  (ลบข้อมูลทดสอบแล้ว)')
}

// ── P4-DB-17 · RLS เปิดทุกตาราง ─────────────────────────────────────
{
  const { rows } = await sql(
    "select count(*)::int off from pg_tables where schemaname='public' and not rowsecurity")
  const { rows: all } = await sql(
    "select count(*)::int n from pg_tables where schemaname='public'")
  check('P4-DB-17 ทุกตารางใน public เปิด RLS · ไม่มีตารางไหนหลุด',
    Number(rows[0].off) === 0 && Number(all[0].n) >= 18,
    `ปิดอยู่ ${rows[0].off} จาก ${all[0].n} ตาราง`)
}

// ── P4-DB-18 · advisors ─────────────────────────────────────────────
{
  const get = async (kind) => {
    const r = await fetch(
      `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/advisors/${kind}`,
      { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })
    const j = await r.json()
    return (j.lints ?? []).filter((l) => l.level === 'ERROR').length
  }
  const [sec, perf] = [await get('security'), await get('performance')]
  check('P4-DB-18 advisors ไม่มี ERROR ทั้ง security และ performance',
    sec === 0 && perf === 0, `security ${sec} · performance ${perf}`)
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
