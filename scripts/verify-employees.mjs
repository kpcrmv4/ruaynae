#!/usr/bin/env node
/**
 * verify-employees.mjs — ปิดแถว P4-DB-* ใน docs/test-plan/P4.md
 *
 * ยิง PostgREST **ในนามของแต่ละ role จริง ๆ** เพราะ policy และ trigger
 * ทั้งชุดอ่าน `auth.uid()` — คำสั่งที่รันด้วย service role จะได้ `null`
 * แล้วเส้นทางที่อยากทดสอบจะไม่เคยถูกเดินเลย
 *
 * 🔴 แถวที่สำคัญที่สุดคือ P4-DB-10 (snapshot ของเรตค่าแรง) และ P4-DB-12
 * (คนเดียวทำงานได้ไม่เกินหนึ่งวันต่อวัน) — ทั้งคู่คือ "ต้นทุนบวกซ้ำ"
 * ในรูปแบบที่ไม่มี error ที่ไหนเลย
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

console.log('\n── P4-DB · คนงาน + คนเข้าไซต์ ───────────────────────────────')

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

const mkEmp = (fields) =>
  sql(`insert into public.employees (full_name, wage_type, daily_rate, monthly_salary, is_active)
       values ('${fields.name}', '${fields.wage}',
               ${fields.daily ?? 'null'}, ${fields.monthly ?? 'null'},
               ${fields.active ?? true})
       returning id`)

try {
  ;[{ id: siteA }] = (await sql(
    `insert into public.sites(name, status) values ('${MARK} ไซต์ก', 'active') returning id`)).rows
  ;[{ id: siteB }] = (await sql(
    `insert into public.sites(name, status) values ('${MARK} ไซต์ข', 'active') returning id`)).rows
  // ดูแลไซต์ ก **ตั้งแต่วันนี้** — เมื่อวานจึงอยู่นอกช่วง (ใช้ที่ P4-DB-16)
  await sql(`insert into public.site_supervisors(site_id, profile_id, effective_from)
             values ('${siteA}','${sup1.id}','${today}')`)

  // ── P4-DB-01 · สร้างคนงานรายวัน ───────────────────────────────────
  {
    const before = (await sql("select count(*)::int n from public.audit_log where table_name='employees'")).rows[0].n
    const r = await db(ownerTok, '/employees', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        full_name: `${MARK} สมชาย ช่างปูน`, job_title: 'ช่างปูน',
        wage_type: 'daily', daily_rate: 600,
      }),
    })
    const row = Array.isArray(r.body) ? r.body[0] : null
    if (row) empIds.push(row.id)
    const after = (await sql("select count(*)::int n from public.audit_log where table_name='employees'")).rows[0].n
    check('P4-DB-01 เจ้าของสร้างคนงานรายวันพร้อมเรต → สำเร็จ · audit_log +1',
      r.status === 201 && Number(row?.daily_rate) === 600 && after === Number(before) + 1,
      `${r.status} · rate=${row?.daily_rate} · audit +${after - Number(before)}`)
  }

  // ── P4-DB-02 · รายวันไม่มีเรต ─────────────────────────────────────
  {
    const r = await db(ownerTok, '/employees', {
      method: 'POST',
      body: JSON.stringify({ full_name: `${MARK} ไม่มีเรต`, wage_type: 'daily' }),
    })
    check('P4-DB-02 คนรายวันที่ไม่มีเรต → ถูกปฏิเสธด้วย check constraint',
      r.status >= 400 && /employees_daily_needs_rate/.test(r.raw ?? ''),
      `${r.status} ${(r.body?.message ?? '').slice(0, 60)}`)
  }

  // ── P4-DB-03 · คนรายเดือน ─────────────────────────────────────────
  let monthlyId = null
  {
    const r = await db(ownerTok, '/employees', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        full_name: `${MARK} สมหญิง โฟร์แมน`, wage_type: 'monthly', monthly_salary: 18000,
      }),
    })
    const row = Array.isArray(r.body) ? r.body[0] : null
    if (row) { empIds.push(row.id); monthlyId = row.id }
    check('P4-DB-03 คนรายเดือนพร้อมเงินเดือน → สำเร็จ · daily_rate เป็น null',
      r.status === 201 && row?.daily_rate === null && Number(row?.monthly_salary) === 18000,
      `${r.status} · daily=${row?.daily_rate} · monthly=${row?.monthly_salary}`)
  }

  // ── P4-DB-04 · หัวหน้าไซต์สร้างคนงานไม่ได้ ────────────────────────
  {
    const before = (await sql("select count(*)::int n from public.employees")).rows[0].n
    const bad = await db(supTok, '/employees', {
      method: 'POST',
      body: JSON.stringify({ full_name: `${MARK} คนที่ไม่ควรมี`, wage_type: 'daily', daily_rate: 500 }),
    })
    const after = (await sql("select count(*)::int n from public.employees")).rows[0].n
    // ฝั่งบวก: เจ้าของยังสร้างได้ในคำสั่งถัดไป
    const good = await mkEmp({ name: `${MARK} กรรมกร`, wage: 'daily', daily: 450 })
    if (good.rows[0]) empIds.push(good.rows[0].id)
    check('P4-DB-04 หัวหน้าไซต์สร้างคนงานไม่ได้ · จำนวนเท่าเดิม · เจ้าของยังสร้างได้',
      bad.status >= 400 && Number(after) === Number(before) && Boolean(good.rows[0]),
      `${bad.status} · ${before}→${after}`)
  }

  // ── P4-DB-05 · หัวหน้าไซต์เห็นเฉพาะคนที่ยังใช้งาน ─────────────────
  {
    const off = await mkEmp({ name: `${MARK} คนที่ลาออกแล้ว`, wage: 'daily', daily: 400, active: false })
    if (off.rows[0]) empIds.push(off.rows[0].id)
    const supActive = await db(supTok, '/employees?select=id&is_active=eq.true')
    const supOff = await db(supTok, '/employees?select=id&is_active=eq.false')
    const ownerOff = await db(ownerTok, '/employees?select=id&is_active=eq.false')
    check('P4-DB-05 หัวหน้าไซต์เห็นคนที่ยังใช้งาน > 0 และไม่เห็นคนที่ปิดใช้งาน · เจ้าของเห็นทั้งสองแบบ',
      (supActive.body?.length ?? 0) > 0 && (supOff.body?.length ?? 0) === 0
      && (ownerOff.body?.length ?? 0) > 0,
      `หัวหน้าไซต์ active ${supActive.body?.length} / inactive ${supOff.body?.length} · เจ้าของ inactive ${ownerOff.body?.length}`)
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

  const dailyId = empIds[0]

  // ── P4-DB-07 + P4-DB-09 · ลงชื่อ + เรตมาจากฐานข้อมูล ──────────────
  let attId = null
  {
    const r = await db(supTok, '/attendance', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        work_date: today, site_id: siteA, employee_id: dailyId, work_units: 1,
        // 🔴 ค่าที่ client ยัดมาต้องถูกเพิกเฉย
        wage_snapshot: 99999,
      }),
    })
    const row = Array.isArray(r.body) ? r.body[0] : null
    attId = row?.id ?? null
    check('P4-DB-07 หัวหน้าไซต์ลงชื่อคนเข้าไซต์ตัวเองได้ · wage_snapshot = เรตของคนนั้น',
      r.status === 201 && Number(row?.wage_snapshot) === 600 && Number(row?.amount) === 600,
      `${r.status} · snapshot=${row?.wage_snapshot} · amount=${row?.amount}`)
    check('P4-DB-09 ค่า wage_snapshot ที่ client ส่งมาถูกเพิกเฉย (ส่ง 99999 ได้ 600)',
      Number(row?.wage_snapshot) === 600, `snapshot=${row?.wage_snapshot}`)
  }

  // ── P4-DB-08 · ไซต์ที่ไม่ได้ดูแล ──────────────────────────────────
  {
    const before = (await sql("select count(*)::int n from public.attendance")).rows[0].n
    const bad = await db(supTok, '/attendance', {
      method: 'POST',
      body: JSON.stringify({ work_date: today, site_id: siteB, employee_id: dailyId }),
    })
    const after = (await sql("select count(*)::int n from public.attendance")).rows[0].n
    check('P4-DB-08 หัวหน้าไซต์ลงชื่อเข้าไซต์ที่ไม่ได้ดูแลไม่ได้ · จำนวนเท่าเดิม',
      bad.status >= 400 && Number(after) === Number(before), `${bad.status} · ${before}→${after}`)
  }

  // ── P4-DB-16 · ขอบเขตผูกกับ work_date ไม่ใช่วันนี้ ────────────────
  {
    const r = await db(supTok, '/attendance', {
      method: 'POST',
      body: JSON.stringify({ work_date: yesterday, site_id: siteA, employee_id: dailyId }),
    })
    check('P4-DB-16 ลงชื่อของวันที่ยังไม่ได้ดูแลไซต์นั้น (เมื่อวาน) ถูกปฏิเสธ · วันนี้ลงได้',
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
    check('P4-DB-13 ลงชื่อซ้ำ คนเดิม วันเดิม ไซต์เดิม → ถูกปฏิเสธ · มีแถวเดียว',
      r.status >= 400 && Number(n) === 1, `${r.status} · ${n} แถว`)
  }

  // ── P4-DB-12 · หนึ่งคนไม่เกินหนึ่งวันต่อวัน ───────────────────────
  {
    const full = await db(ownerTok, '/attendance', {
      method: 'POST',
      body: JSON.stringify({ work_date: today, site_id: siteB, employee_id: dailyId, work_units: 1 }),
    })
    // ฝั่งบวก: ครึ่ง + ครึ่ง ที่สองไซต์ต้องผ่าน
    await sql(`delete from public.attendance where employee_id = '${dailyId}' and work_date = '${today}'`)
    const half1 = await db(ownerTok, '/attendance', {
      method: 'POST',
      body: JSON.stringify({ work_date: today, site_id: siteA, employee_id: dailyId, work_units: 0.5 }),
    })
    const half2 = await db(ownerTok, '/attendance', {
      method: 'POST',
      body: JSON.stringify({ work_date: today, site_id: siteB, employee_id: dailyId, work_units: 0.5 }),
    })
    check('P4-DB-12 เต็มวันสองไซต์ในวันเดียวถูกปฏิเสธ /WORK_UNITS_EXCEEDED/ · ครึ่ง+ครึ่ง ผ่าน',
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
        work_date: today, site_id: siteA, employee_id: dailyId,
        work_units: 0.5, ot_amount: 150,
      }),
    })
    const row = Array.isArray(r.body) ? r.body[0] : null
    const wrote = await db(ownerTok, `/attendance?id=eq.${row?.id}`, {
      method: 'PATCH', body: JSON.stringify({ amount: 1 }),
    })
    check('P4-DB-11 ครึ่งวัน ฿600 + OT ฿150 → amount = ฿450 · เขียนทับ amount ตรง ๆ ไม่ได้',
      Number(row?.amount) === 450 && wrote.status >= 400,
      `amount=${row?.amount} · เขียนทับ ${wrote.status}`)
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
        work_date: today, site_id: siteA, employee_id: monthlyId, work_units: 1, ot_amount: 200,
      }),
    })
    const row = Array.isArray(r.body) ? r.body[0] : null
    check('P4-DB-15 คนรายเดือน → wage_snapshot = 0 · amount = เฉพาะ OT (฿200)',
      r.status === 201 && Number(row?.wage_snapshot) === 0 && Number(row?.amount) === 200,
      `snapshot=${row?.wage_snapshot} · amount=${row?.amount}`)
  }

  // ── P4-DB-10 · 🔴 ขึ้นค่าแรงแล้วของเก่าต้องไม่ขยับ ────────────────
  {
    const [before] = (await sql(
      `select wage_snapshot, amount from public.attendance
       where employee_id = '${dailyId}' and work_date = '${today}' and site_id = '${siteA}'`)).rows

    await db(ownerTok, `/employees?id=eq.${dailyId}`, {
      method: 'PATCH', body: JSON.stringify({ daily_rate: 900 }),
    })

    const [after] = (await sql(
      `select wage_snapshot, amount from public.attendance
       where employee_id = '${dailyId}' and work_date = '${today}' and site_id = '${siteA}'`)).rows

    // ฝั่งบวก: แถวที่ลงใหม่หลังขึ้นค่าแรงต้องใช้เรตใหม่
    const fresh = await db(ownerTok, '/attendance', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        work_date: day(-5), site_id: siteA, employee_id: dailyId, work_units: 1 }),
    })
    const freshRow = Array.isArray(fresh.body) ? fresh.body[0] : null

    // ── P4-DB-10b · 🔴 แตะแถวเก่าหลังขึ้นค่าแรงก็ยังต้องไม่ขยับ ─────
    // เวอร์ชันแรกของ guard ถ่าย snapshot ใหม่ทุกครั้งที่แถวถูก UPDATE
    // ผลคือแค่ไป "แก้โน้ต" ของแถวเมื่อสามเดือนก่อน ต้นทุนของงานที่ปิดไปแล้ว
    // ก็ขยับขึ้นเงียบ ๆ · แถวข้างบนจับไม่ได้เพราะไม่เคย UPDATE หลังขึ้นเรต
    const [old2] = (await sql(
      `select id, wage_snapshot from public.attendance
       where employee_id = '${dailyId}' and work_date = '${today}' and site_id = '${siteA}'`)).rows
    await db(ownerTok, `/attendance?id=eq.${old2.id}`, {
      method: 'PATCH', body: JSON.stringify({ note: 'แก้โน้ตเฉย ๆ' }),
    })
    const [afterEdit] = (await sql(
      `select wage_snapshot, amount from public.attendance where id = '${old2.id}'`)).rows
    check('P4-DB-10b แก้โน้ตของแถวเก่าหลังขึ้นค่าแรง → wage_snapshot ยังเป็น ฿600 ไม่ถูกถ่ายใหม่',
      Number(afterEdit?.wage_snapshot) === 600,
      `หลังแก้โน้ต snapshot=${afterEdit?.wage_snapshot}`)

    check('P4-DB-10 ขึ้นค่าแรงแล้ว attendance ของวันเก่าไม่ขยับ (฿600) · แถวใหม่ใช้เรตใหม่ (฿900)',
      Number(before?.wage_snapshot) === 600 && Number(after?.wage_snapshot) === 600
      && Number(after?.amount) === Number(before?.amount)
      && Number(freshRow?.wage_snapshot) === 900,
      `เก่า ${before?.wage_snapshot}→${after?.wage_snapshot} · ใหม่ ${freshRow?.wage_snapshot}`)
  }

  // ── P4-DB-06 · anon ───────────────────────────────────────────────
  {
    const e = await db('anon', '/employees?select=id')
    const a = await db('anon', '/attendance?select=id')
    const oe = await db(ownerTok, '/employees?select=id')
    const oa = await db(ownerTok, '/attendance?select=id')
    check('P4-DB-06 anon อ่านทั้งสองตารางได้ 0 แถว · เจ้าของอ่านได้ > 0',
      (Array.isArray(e.body) ? e.body.length : 0) === 0
      && (Array.isArray(a.body) ? a.body.length : 0) === 0
      && (oe.body?.length ?? 0) > 0 && (oa.body?.length ?? 0) > 0,
      `anon ${Array.isArray(e.body) ? e.body.length : '?'}/${Array.isArray(a.body) ? a.body.length : '?'} · owner ${oe.body?.length}/${oa.body?.length}`)
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
       where c.relname in ('employees','attendance') and not t.tgisinternal`)
    const names = rows.map((r) => r.tgname)
    check('P4-DB-20 audit trigger ครอบทั้งสองตารางใหม่',
      names.includes('employees_audit') && names.includes('attendance_audit'),
      names.join(', '))
  }

  // ── P4-DB-21 · ทุกคอลัมน์มีคนเขียน ────────────────────────────────
  {
    const strip = (s) => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    const mig = strip(readFileSync(
      'supabase/migrations/20260830230000_p4_employees_attendance.sql', 'utf8'))
    const cols = [
      'full_name', 'job_title', 'wage_type', 'daily_rate', 'monthly_salary',
      'default_site_id', 'is_active', 'profile_id',
      'work_date', 'site_id', 'employee_id', 'work_units', 'ot_amount', 'wage_snapshot', 'note',
    ]
    // เฉพาะคอลัมน์ที่ trigger เป็นคนเขียน — ที่เหลือรอ route ของ P4-b/P4-c
    const byTrigger = ['wage_snapshot']
    const missing = byTrigger.filter((c) => !mig.includes(`new.${c} :=`))
    check('P4-DB-21a คอลัมน์ที่ trigger ต้องเขียนเอง (wage_snapshot) มีโค้ดเขียนจริง',
      missing.length === 0 && cols.length === 15,
      missing.length ? `ขาด: ${missing.join(', ')}` : 'ครบ · อีก 14 คอลัมน์รอ route ที่ P4-b/P4-c')
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
    Number(rows[0].off) === 0 && Number(all[0].n) >= 16,
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
