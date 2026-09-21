#!/usr/bin/env node
/**
 * verify-payroll-ui.mjs — ปิดแถว P5-API-* และ P5-UI-01..06 ใน docs/test-plan/P5.md
 *
 * 🔴 แถวที่ยืนยันการปฏิเสธต้องยืนยัน **สถานะของข้อมูลหลังจากนั้น** ด้วย
 * · แถวที่อ่านตัวเลขต้องอ่านจากธาตุที่เป็นเจ้าของค่า (`data-balance-for`)
 * ไม่ใช่ regex กวาดทั้งหน้า
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
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const req = (method, path, body, cookie) =>
  fetch(`${BASE}${path}`, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const jarOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
const visible = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    // 🔴 React คั่น text node ที่อยู่ติดกันด้วย `<!-- -->` — ข้อความอย่าง
    // "หักแล้ว ฿550 · เหลือ ฿350" ออกมาเป็น "หักแล้ว ฿550<!-- --> · เหลือ <!-- -->฿350"
    // ตัวตรวจที่เทียบข้อความต่อเนื่องจะแดงทั้งที่หน้าจอถูกต้องทุกตัวอักษร
    .replace(/<!--[\s\S]*?-->/g, '')
const page = async (path, cookie) =>
  visible(await (await fetch(`${BASE}${path}`, { headers: { cookie } })).text())

/** ยอดคงเหลือของคนหนึ่งคน อ่านจากบล็อกที่เป็นเจ้าของค่า */
const balanceOnPage = (html, empId) => {
  const i = html.indexOf(`data-balance-for="${empId}"`)
  if (i < 0) return null
  const m = /฿([\d,]+)/.exec(html.slice(i, i + 400))
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
const countOf = async (table, filter = '') => {
  const r = await fetch(`${BASE.replace(/.*/, env.NEXT_PUBLIC_SUPABASE_URL)}/rest/v1/${table}?select=id${filter}`, {
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  })
  return Number(/\/(\d+)$/.exec(r.headers.get('content-range') ?? '')?.[1] ?? -1)
}

console.log('\n── P5 · หน้าค่าแรงและรอบจ่าย ────────────────────────────────')

const ownerJar = jarOf(await req('POST', '/api/auth/login', {
  email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }))
const supJar = jarOf(await req('POST', '/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN }))
if (!ownerJar || !supJar) throw new Error('ล็อกอินไม่สำเร็จ — dev server รันอยู่ไหม')

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

const MARK = 'ทดสอบหน้าค่าแรง'
let siteId = null
let empId = null
let runId = null
/** ฉาก "เบิกเกินแล้วหักบางส่วน" (P5-UI-09 / P5-UI-11) — คนละคนกับฉากหลัก
 *  เพราะกฎคนละข้อต้องใช้คนละตัวตั้ง ไม่งั้นสถานะของฉากหนึ่งไปทำอีกฉากล้ม */
let overEmpId = null
let overRunId = null
/** id ของ attendance ที่ fixture ชุดนี้สร้างเอง — เก็บไว้เพื่อตามลบ audit_log
 *  ของตัวเองได้ตรงตัว โดยไม่ต้องเดาจาก "แถวที่กลายเป็นกำพร้า" ซึ่งเป็นของลูกค้าด้วย */
const fixtureAttendanceIds = []
/** ทุก id ที่สคริปต์นี้สร้างขึ้นเอง — รวมของที่สร้าง-ลบภายในบล็อกเดียว
 *  (เช่นคนงาน "ไม่มีค่าแรง" ของ P5-API-07) ซึ่งลบแถวข้อมูลไปแล้วแต่ audit ยังอยู่ */
const fixtureIds = []

try {
  ;[{ id: siteId }] = (await sql(
    `insert into public.sites(name, status) values ('${MARK} โครงการ', 'active') returning id`)).rows
  ;[{ id: empId }] = (await sql(
    `insert into public.employees(full_name, job_title) values ('${MARK} สมพงษ์', 'ช่างไม้') returning id`)).rows
  await sql(`insert into public.employee_wages(employee_id, wage_type, daily_rate)
             values ('${empId}', 'daily', 550)`)
  for (let i = 1; i <= 6; i++) {
    const { rows } = await sql(`insert into public.attendance(work_date, site_id, employee_id, work_units)
               values ('${day(-i)}', '${siteId}', '${empId}', 1) returning id`)
    if (rows?.[0]?.id) fixtureAttendanceIds.push(rows[0].id)
  }

  // ── P5-UI-01 · หน้าแสดงค้างจ่ายรายคน ──────────────────────────────
  {
    const html = await page('/payroll', ownerJar)
    check('P5-UI-01 หน้า /payroll แสดงชื่อ ค่าแรงสะสม เบิกไปแล้ว และคงเหลือ ของแต่ละคน',
      html.includes(`${MARK} สมพงษ์`) && html.includes('฿3,300')
      && balanceOnPage(html, empId) === 3300,
      `คงเหลือบนจอ ฿${balanceOnPage(html, empId)}`)
  }

  // ── P5-UI-02 · หัวหน้าโครงการเข้าไม่ได้ ──────────────────────────────
  {
    const r = await fetch(`${BASE}/payroll`, { headers: { cookie: supJar }, redirect: 'manual' })
    const loc = r.headers.get('location') ?? ''
    // ฝั่งบวก: หน้าที่เขาเข้าได้ยังเข้าได้อยู่
    const att = await page('/attendance', supJar)
    check('P5-UI-02 หัวหน้าโครงการเปิด /payroll → ถูก redirect ออก · /attendance ยังเข้าได้',
      r.status === 307 && !loc.includes('/payroll') && att.includes('คนเข้าโครงการ'),
      `${r.status} → ${loc || '(ไม่มี location)'}`)
  }

  // ── P5-API-01 (แก้ตาม R14) · หัวหน้าโครงการยื่นคำขอได้ แต่ต้องผูกโครงการ ──
  // 🔴 แถวนี้เคยยืนยันว่า "หัวหน้าโครงการบันทึกเบิกไม่ได้ → 403" · คำสั่งเจ้าของ
  // 21 ก.ย. 2569 เปิดให้เขา **ยื่นคำขอ** ได้ สิ่งที่ยังต้องยืนยันจึงกลายเป็น
  // ขอบเขตของเขา: ใบที่ไม่ผูกโครงการเป็นของเจ้าของเท่านั้น (เหมือนรายจ่ายส่วนกลาง)
  {
    const before = await countOf('advances')
    const r = await req('POST', '/api/advances', {
      employeeId: empId, amount: '500', advanceDate: today }, supJar)
    const b = await r.json().catch(() => ({}))
    const after = await countOf('advances')
    check('P5-API-01 หัวหน้าโครงการยิง POST /api/advances โดยไม่ผูกโครงการ → 400 SITE_REQUIRED · ไม่มีแถวใหม่',
      r.status === 400 && b.error === 'SITE_REQUIRED' && after === before,
      `${r.status} ${b.error} · ${before}→${after}`)
  }

  // ── R14-API-03 · โครงการที่ไม่ได้ดูแล → RLS ปฏิเสธ ───────────────────
  // fixture ของสคริปต์นี้ไม่ได้ตั้งหัวหน้าโครงการให้ `siteId` เลย มันจึงเป็น
  // "โครงการของคนอื่น" ในสายตาของ supJar พอดี
  {
    const before = await countOf('advances')
    const r = await req('POST', '/api/advances', {
      employeeId: empId, amount: '500', advanceDate: today, siteId }, supJar)
    const b = await r.json().catch(() => ({}))
    const after = await countOf('advances')
    check('R14-API-03 หัวหน้าโครงการยื่นคำขอให้โครงการที่ไม่ได้ดูแล → 403 · ไม่มีแถวใหม่',
      r.status === 403 && b.error === 'FORBIDDEN' && after === before,
      `${r.status} ${b.error} · ${before}→${after}`)
  }

  // ── P5-API-03 + P5-UI-05 · เบิกสำเร็จ ─────────────────────────────
  {
    const before = balanceOnPage(await page('/payroll', ownerJar), empId)
    const r = await req('POST', '/api/advances', {
      employeeId: empId, amount: '1000', advanceDate: today, siteId }, ownerJar)
    const after = balanceOnPage(await page('/payroll', ownerJar), empId)
    check('P5-API-03 บันทึกเบิก ฿1,000 → 201 · advances +1', r.status === 201, `${r.status}`)
    check('P5-UI-05 ยอดคงเหลือบนหน้าจอลดลงเท่ากับที่เบิกพอดี (฿3,300 → ฿2,300)',
      before === 3300 && after === 2300, `฿${before} → ฿${after}`)
  }

  // ── P5-UI-07 · แถวจ่ายเงินต้องไม่ดูเหมือนรายจ่าย ──────────────────
  // 🔴 กับดักข้อ 1 ของโปรเจ็คนี้ในเวอร์ชันหน้าจอ — ถ้าใบเบิกแสดงเป็นตัวเลขแดง
  // เหมือนรายจ่าย คนอ่านจะบวกมันเข้ากับต้นทุนในหัวเอง แล้วได้สองเท่า
  {
    const html = await page('/payroll', ownerJar)
    const hasBadge = html.includes('จ่ายเงิน · ไม่นับซ้ำเป็นต้นทุน')
    // ฝั่งลบ: ต้องไม่ใช้โทนสีของรายจ่ายกับแถวนี้
    const i = html.indexOf('จ่ายเงิน · ไม่นับซ้ำเป็นต้นทุน')
    const chunk = i < 0 ? '' : html.slice(Math.max(0, i - 300), i + 300)
    check('P5-UI-07 ใบเบิกแสดงเป็นป้ายสีเทา "จ่ายเงิน · ไม่นับซ้ำเป็นต้นทุน" ไม่ใช่ตัวเลขแดงเหมือนรายจ่าย',
      hasBadge && !/text-expense|text-urgent">฿/.test(chunk),
      hasBadge ? 'มีป้ายและไม่ใช้โทนรายจ่าย' : 'ไม่พบป้าย')
  }

  // ── P5-API-02 · เบิกเกินได้ แต่คำตอบต้องพกคำเตือนกลับไป ───────────
  // (เขียนใหม่ 20 ก.ย. 2569 — เดิมยืนยันว่า 409 ADVANCE_OVER_CEILING
  //  เจ้าของสั่งให้เบิกเกินได้ ข้อกำหนดจึงเปลี่ยน ไม่ใช่ตัวตรวจเสีย)
  {
    const before = await countOf('advances')
    const r = await req('POST', '/api/advances', {
      employeeId: empId, amount: '5000', advanceDate: today }, ownerJar)
    const b = await r.json().catch(() => ({}))
    const after = await countOf('advances')
    check('P5-API-02 เบิกเกินค่าแรงค้างจ่าย → 201 · overdrawn:true · balance ติดลบ · advances +1',
      r.status === 201 && b.overdrawn === true && Number(b.balance) < 0 && after === before + 1,
      `${r.status} · overdrawn=${b.overdrawn} balance=${b.balance} · ${before}→${after}`)
    // ยอดที่เตือนต้องเป็นตัวเลขจริง: ค้างจ่าย ฿2,300 − เบิก ฿5,000 = −฿2,700
    check('P5-API-02b ยอดคงเหลือที่คืนมาเป็นตัวเลขจริง ไม่ใช่ธงเปล่า ๆ',
      Number(b.balance) === -2700, `balance=${b.balance}`)
    await sql(`delete from public.advances where employee_id = '${empId}' and amount = 5000`)
  }

  // ── P5-API-09 + P5-API-10 · วันที่เลือกเองได้ แต่อนาคตไม่ได้ ──────
  {
    const back = new Date(`${today}T00:00:00Z`)
    back.setUTCDate(back.getUTCDate() - 3)
    const backDate = back.toISOString().slice(0, 10)
    const fwd = new Date(`${today}T00:00:00Z`)
    fwd.setUTCDate(fwd.getUTCDate() + 1)

    const ok = await req('POST', '/api/advances', {
      employeeId: empId, amount: '70', advanceDate: backDate }, ownerJar)
    const saved = (await sql(
      `select advance_date::text from public.advances
        where employee_id = '${empId}' and amount = 70`)).rows[0]?.advance_date ?? null
    const future = await req('POST', '/api/advances', {
      employeeId: empId, amount: '70', advanceDate: fwd.toISOString().slice(0, 10) }, ownerJar)
    const fb = await future.json().catch(() => ({}))

    check('P5-API-09 ลงเบิกย้อนหลัง → 201 และเก็บวันที่ส่งมา ไม่ใช่วันนี้',
      ok.status === 201 && saved === backDate && saved !== today,
      `เก็บ ${saved} (ส่ง ${backDate} · วันนี้ ${today})`)
    check('P5-API-10 ลงเบิกวันในอนาคต → 400 DATE_FUTURE',
      future.status === 400 && fb.error === 'DATE_FUTURE', `${future.status} ${fb.error}`)
    await sql(`delete from public.advances where employee_id = '${empId}' and amount = 70`)
  }

  // ── P5-API-07 · จ่ายให้คนที่ไม่มีค่าแรงค้าง ───────────────────────
  {
    const [other] = (await sql(
      `insert into public.employees(full_name, is_active) values ('${MARK} ไม่มีค่าแรง', true) returning id`)).rows
    fixtureIds.push(other.id)
    const runsBefore = await countOf('payroll_runs')
    const r = await req('POST', '/api/payroll/pay', { employeeId: other.id }, ownerJar)
    const b = await r.json().catch(() => ({}))
    const runsAfter = await countOf('payroll_runs')
    check('P5-API-07 จ่ายค่าแรงให้คนที่ไม่มียอดค้าง → 409 NOTHING_TO_PAY · ไม่มีรอบใหม่ค้างไว้',
      r.status === 409 && b.error === 'NOTHING_TO_PAY' && runsAfter === runsBefore,
      `${r.status} ${b.error} · รอบ ${runsBefore}→${runsAfter}`)
    await sql(`delete from public.employees where id = '${other.id}'`)
  }

  // ── P5-API-05 + P5-API-06 + P5-UI-06 · จ่ายค่าแรงด้วยปุ่มเดียว ─────
  {
    const r = await req('POST', '/api/payroll/pay', { employeeId: empId }, ownerJar)
    const b = await r.json().catch(() => ({}))
    const html = await page('/payroll', ownerJar)
    const [row] = (await sql(
      `select id, status, closed_by, total_paid, employee_id from public.payroll_runs
       where employee_id = '${empId}' order by created_at desc limit 1`)).rows
    runId = row?.id ?? null
    check('P5-API-05 จ่ายค่าแรงรายคน → สร้างรอบของ**คนคนเดียว** ที่ปิดแล้วทันที (ไม่มีสถานะ open ค้าง)',
      r.status === 200 && row?.status === 'closed' && row?.employee_id === empId
      && Boolean(row?.closed_by),
      `${r.status} · status=${row?.status} · employee_id ตรง=${row?.employee_id === empId}`)
    check('P5-API-06 ยอดที่คืนมา: ค่าแรง ฿3,300 − เบิก ฿1,000 = จ่ายจริง ฿2,300',
      Number(b.accrued) === 3300 && Number(b.deducted) === 1000 && Number(b.paid) === 2300,
      `ค่าแรง ${b.accrued} − เบิก ${b.deducted} = ${b.paid}`)
    check('P5-UI-06 หน้าจอมี ประวัติการจ่ายค่าแรง พร้อมยอด และ**ไม่มีคำว่า รอบจ่าย** ให้ผู้ใช้เห็นแล้ว',
      html.includes('ประวัติการจ่ายค่าแรง') && html.includes('฿2,300')
      && html.includes('฿3,300') && !html.includes('เปิดรอบ') && !html.includes('ปิดรอบ'),
      `ประวัติ=${html.includes('ประวัติการจ่ายค่าแรง')} · เหลือคำว่ารอบ=${/เปิดรอบ|ปิดรอบ/.test(html)}`)
  }
  // ── P5-UI-09 · คนที่คงเหลือติดลบต้องอ่านออกตั้งแต่ในลิสต์ ─────────
  // 🔴 อ่านจาก **บล็อกที่เป็นเจ้าของค่า** (`data-balance-for`) ไม่ใช่ regex
  // กวาดทั้งหน้า — หน้านี้มีคำว่า "เบิก" อยู่หลายที่ ถ้ากวาดทั้งหน้าจะเขียว
  // ได้แม้ป้ายของคนคนนี้ไม่เคยเปลี่ยนเลย
  {
    const [over] = (await sql(
      `insert into public.employees(full_name, is_active)
       values ('${MARK} เบิกเกิน', true) returning id`)).rows
    overEmpId = over.id
    await req('POST', '/api/advances', {
      employeeId: overEmpId, amount: '900', advanceDate: today }, ownerJar)
    const html = await page('/payroll', ownerJar)
    const i = html.indexOf(`data-balance-for="${overEmpId}"`)
    const block = i < 0 ? '' : html.slice(i, i + 400)
    check('P5-UI-09 คนที่คงเหลือติดลบ → ป้ายเป็น "เบิกเกิน" สี urgent พร้อมเครื่องหมายลบ',
      /เบิกเกิน/.test(block) && /text-urgent/.test(block) && /−\s*฿900/.test(block)
      && !/คงเหลือ/.test(block),
      block ? block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : 'ไม่พบบล็อกของคนนี้')
  }

  // ── P5-UI-11 · ใบเบิกที่ถูกหักบางส่วนโชว์ยอดที่เหลือแทนปุ่มลบ ──────
  // 🔴 ต้อง **สร้างอินพุตขึ้นมาก่อน** — สถานะ "หักบางส่วน" เกิดได้ทางเดียวคือ
  // เบิกเกินแล้วจ่ายค่าแรง · ถ้าไม่สร้าง แถวนี้จะผ่านด้วยหน้าว่าง ๆ ซึ่งไม่ได้พิสูจน์อะไร
  {
    await sql(`insert into public.employee_wages(employee_id, wage_type, daily_rate)
               values ('${overEmpId}', 'daily', 550)`)
    const att = await sql(`insert into public.attendance(work_date, site_id, employee_id, work_units)
               values ('${today}', '${siteId}', '${overEmpId}', 1) returning id`)
    if (att.rows?.[0]?.id) fixtureAttendanceIds.push(att.rows[0].id)
    const paid = await req('POST', '/api/payroll/pay', { employeeId: overEmpId }, ownerJar)
    const [run] = (await sql(
      `select id from public.payroll_runs where employee_id = '${overEmpId}' limit 1`)).rows
    overRunId = run?.id ?? null

    const [adv] = (await sql(
      `select amount::text, deducted_amount::text, payroll_run_id
         from public.advances where employee_id = '${overEmpId}'`)).rows
    const html = await page('/payroll', ownerJar)

    check('P5-UI-11 เบิก ฿900 บนค่าแรง ฿550 → หน้าจอโชว์ "หักแล้ว ฿550 · เหลือ ฿350" แทนปุ่มลบ',
      paid.status === 200
      && Number(adv?.deducted_amount) === 550 && adv?.payroll_run_id === null
      && /หักแล้ว ฿550 · เหลือ ฿350/.test(html)
      && !/aria-label="ลบใบเบิก ฿900/.test(html),
      `จ่าย ${paid.status} · หักแล้ว ${adv?.deducted_amount}/${adv?.amount} · พบชิป=${/หักแล้ว ฿550 · เหลือ ฿350/.test(html)}`)
  }

  // ── P5-API-04 · ลบใบเบิกที่ถูกหักไปแล้วไม่ได้ ─────────────────────
  {
    const [adv] = (await sql(
      `select id from public.advances where employee_id = '${empId}' limit 1`)).rows
    const r = await req('DELETE', `/api/advances/${adv.id}`, undefined, ownerJar)
    const b = await r.json().catch(() => ({}))
    const still = await countOf('advances', `&id=eq.${adv.id}`)
    check('P5-API-04 ลบใบเบิกที่ถูกหักในรอบที่ปิดแล้ว → 409 PAYROLL_CLOSED · แถวยังอยู่',
      r.status === 409 && b.error === 'PAYROLL_CLOSED' && still === 1,
      `${r.status} ${b.error} · เหลือ ${still} แถว`)
  }

  // ── P5-API-08 · ทุก endpoint ตอนไม่ล็อกอิน ────────────────────────
  {
    const calls = [
      ['POST', '/api/advances', { employeeId: empId, amount: '1', advanceDate: today }],
      ['DELETE', '/api/advances/00000000-0000-4000-8000-000000000000', undefined],
      ['POST', '/api/payroll/pay', { employeeId: empId }],
    ]
    const codes = []
    for (const [m, path, body] of calls) {
      const r = await req(m, path, body)
      const ct = r.headers.get('content-type') ?? ''
      codes.push(r.status === 401 && ct.startsWith('application/json') ? '401' : `${r.status}`)
    }
    check('P5-API-08 ทุก endpoint ของเฟสนี้ตอนไม่ล็อกอิน → 401 JSON (ไม่ใช่ 307 ไป /login)',
      codes.every((c) => c === '401'), codes.join(' '))
  }

  // ── P5-DB-21 · ทุกคอลัมน์มีคนเขียน (ครบทั้ง 22 แล้ว) ──────────────
  {
    const stripSql = (t) => t.replace(/--.*/g, '')
    const stripTs = (t) =>
      t.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^'\r\n]*'/g, "''")
    const src = [
      ['supabase/migrations/20260831010000_p5_advances_payroll.sql', stripSql],
      ['src/app/api/advances/route.ts', stripTs],
      ['supabase/migrations/20260904050000_pay_employee_wage.sql', stripSql],
    ].map(([f, fn]) => fn(readFileSync(f, 'utf8'))).join('\n\n')

    const cols = [
      'employee_id', 'amount', 'advance_date', 'pay_method', 'site_id', 'payroll_run_id', 'note',
      'period_start', 'period_end', 'status', 'total_accrued', 'total_advance_deducted',
      'total_paid', 'closed_at', 'closed_by',
      'run_id', 'days', 'accrued', 'advance_deducted', 'net_paid',
    ]
    const missing = cols.filter(
      (c) =>
        !new RegExp(`${c}\\s*:(?!=)`).test(src) &&
        !new RegExp(`insert into[^(]*\\([^)]*\\b${c}\\b`, 's').test(src) &&
        !new RegExp(`\\b${c}\\s*=\\s*\\S`).test(src),
    )
    check('P5-DB-21 ทุกคอลัมน์ของสามตารางมี RPC หรือ payload ที่เขียนจริง',
      missing.length === 0,
      missing.length ? `ไม่มีใครเขียน: ${missing.join(', ')}` : `${cols.length}/${cols.length}`)
  }
} finally {
  if (empId) {
    // 🔴 `advances_guard_delete` (20 ก.ย. 2569) กันลบใบเบิกที่ถูกหักคืนไปแล้ว
    // ซึ่งรวมถึงใบที่สคริปต์นี้จ่ายไปเองระหว่างตรวจ · ไม่ปลดธงก่อน = ลบใบเบิกไม่ได้
    // → ลบคนงานไม่ได้ (FK restrict) → **ทิ้งคนงานทดสอบไว้ในฐานของลูกค้า**
    // โดยที่สคริปต์ยังพิมพ์ว่า "ลบข้อมูลทดสอบแล้ว" (เจอของจริงค้าง 20 ก.ย. 2569)
    await sql(`update public.advances set deducted_amount = 0, payroll_run_id = null
               where employee_id = '${empId}'`)
    await sql(`delete from public.advances where employee_id = '${empId}'`)
  }
  if (overEmpId) {
    await sql(`update public.advances set deducted_amount = 0, payroll_run_id = null
               where employee_id = '${overEmpId}'`)
    await sql(`delete from public.advances where employee_id = '${overEmpId}'`)
  }
  // 🔴 ต้องลบ **ทุกรอบที่ปิดแล้ว** ก่อนแตะ `attendance` — `guard_attendance_closed`
  // ปฏิเสธการลบวันที่อยู่ในรอบที่ปิดแล้ว และ `delete ... where site_id = …`
  // เป็นคำสั่งเดียวที่คลุมทุกคน · มีวันของใครสักคนที่จ่ายเงินไปแล้วปนอยู่แถวเดียว
  // ทั้งคำสั่งก็ล้ม แล้ว **ไม่มีอะไรถูกลบเลย** รวมถึงของคนอื่นที่ลบได้อยู่แล้ว
  // (เจอจริง 21 ก.ย. 2569 — คนงานทดสอบค้างอยู่ในฐานลูกค้าพร้อม attendance 6 แถว)
  for (const id of [runId, overRunId].filter(Boolean)) {
    await sql(`delete from public.payroll_lines where run_id = '${id}'`)
    await sql(`delete from public.payroll_runs where id = '${id}'`)
  }
  if (siteId) {
    await sql(`delete from public.attendance where site_id = '${siteId}'`)
    await sql(`delete from public.site_supervisors where site_id = '${siteId}'`)
    await sql(`delete from public.site_finance where site_id = '${siteId}'`)
    await sql(`delete from public.sites where id = '${siteId}'`)
  }
  for (const id of [empId, overEmpId].filter(Boolean)) {
    await sql(`delete from public.attendance where employee_id = '${id}'`)
    await sql(`delete from public.employee_wages where employee_id = '${id}'`)
    await sql(`delete from public.employees where id = '${id}'`)
  }
  await sql(`delete from public.payroll_runs where period_start = '2001-01-01'`)

  // 🔴 ลบ **ร่องรอยใน audit_log ของ fixture ตัวเองด้วย** (คำสั่งเจ้าของ 20 ก.ย. 2569)
  // แถวข้อมูลถูกลบคืนแล้ว แต่ audit_log เก็บ before/after ไว้ทุกครั้ง — ไม่ตามลบ
  // ประวัติของลูกค้าจะมีชื่อ "ทดสอบหน้าค่าแรง สมพงษ์" ปนอยู่ตลอดไป
  // · ลบเฉพาะแถวที่อ้าง id ของ fixture ชุดนี้เท่านั้น ไม่แตะช่วงเวลา ไม่แตะของจริง
  for (const id of [...fixtureIds, empId, overEmpId, siteId, runId, overRunId].filter(Boolean)) {
    await sql(`delete from public.audit_log
                where row_id::text = '${id}'
                   or before::text like '%${id}%'
                   or after::text  like '%${id}%'`)
  }
  // attendance_wages ไม่มีคอลัมน์ id · audit เก็บ `row_id` เป็น null — ต้องตามเก็บ
  // จาก `attendance_id` ในเพย์โหลด
  //
  // 🔴 ห้ามใช้เงื่อนไข "attendance_id ไม่มีอยู่แล้ว" (orphan) เป็นตัวชี้ว่าเป็นของทดสอบ
  // เด็ดขาด — ลูกค้าลบวันทำงานเองเป็นเรื่องปกติ แถวพวกนั้นก็กลายเป็น orphan เหมือนกัน
  // ครั้งแรกที่เขียนแบบนั้น **ลบประวัติจริงของลูกค้าไป 66 แถว** (21 ก.ย. 2569)
  // · ต้องลบตาม id ที่สคริปต์นี้สร้างเองเท่านั้น ซึ่งเก็บไว้ตั้งแต่ก่อนลบข้อมูล
  if (fixtureAttendanceIds.length) {
    const list = fixtureAttendanceIds.map((id) => `'${id}'`).join(', ')
    await sql(`delete from public.audit_log
                where table_name = 'attendance_wages'
                  and coalesce(after->>'attendance_id', before->>'attendance_id') in (${list})`)
  }

  // ยืนยันว่าคืนจริง — `delete` คือคำขอ ส่วน "เหลือ 0 แถว" คือคำตอบ
  const left = (await sql(
    `select count(*)::int n from public.employees where full_name like '${MARK}%'`)).rows[0]
  console.log(
    Number(left?.n ?? -1) === 0
      ? '  (ลบข้อมูลทดสอบแล้ว)'
      : `  ⚠️ ลบข้อมูลทดสอบไม่ครบ — เหลือคนงาน ${left?.n} แถว ต้องตามลบก่อนรันตัวอื่น`)
}

// ── P5-UI-03 · สถานะว่าง ────────────────────────────────────────────
{
  const [{ n }] = (await sql(
    'select count(*)::int n from public.attendance')).rows
  if (Number(n) > 0) {
    check('P5-UI-03 ไม่มีใครค้างจ่าย → ข้อความบอกตรง ๆ ไม่ใช่ตารางเปล่า', 'skip',
      `ฐานข้อมูลมีการลงชื่อจริง ${n} แถว — ตัดสินไม่ได้ในรอบนี้`)
  } else {
    const html = await page('/payroll', ownerJar)
    check('P5-UI-03 ไม่มีใครค้างจ่าย → ข้อความบอกตรง ๆ ไม่ใช่ตารางเปล่า',
      html.includes('ยังไม่มีค่าแรงค้างจ่าย') || html.includes('ยังไม่มีใครมียอดค้างจ่าย'),
      'สถานะว่างมีข้อความจริง')
  }
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok === true).length
const skip = results.filter((r) => r.ok === 'skip').length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass - skip} · undecided ${skip}`)
process.exit(pass + skip === results.length ? 0 : 1)
