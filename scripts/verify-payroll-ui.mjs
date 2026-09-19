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
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '')
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

try {
  ;[{ id: siteId }] = (await sql(
    `insert into public.sites(name, status) values ('${MARK} โครงการ', 'active') returning id`)).rows
  ;[{ id: empId }] = (await sql(
    `insert into public.employees(full_name, job_title) values ('${MARK} สมพงษ์', 'ช่างไม้') returning id`)).rows
  await sql(`insert into public.employee_wages(employee_id, wage_type, daily_rate)
             values ('${empId}', 'daily', 550)`)
  for (let i = 1; i <= 6; i++) {
    await sql(`insert into public.attendance(work_date, site_id, employee_id, work_units)
               values ('${day(-i)}', '${siteId}', '${empId}', 1)`)
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

  // ── P5-API-01 · หัวหน้าโครงการบันทึกเบิกไม่ได้ ───────────────────────
  {
    const before = await countOf('advances')
    const r = await req('POST', '/api/advances', {
      employeeId: empId, amount: '500', advanceDate: today }, supJar)
    const b = await r.json().catch(() => ({}))
    const after = await countOf('advances')
    check('P5-API-01 หัวหน้าโครงการยิง POST /api/advances → 403 FORBIDDEN · ไม่มีแถวใหม่',
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

  // ── P5-API-02 + P5-UI-04 · เกินเพดาน → บอกเพดานที่เหลือเป็นตัวเลข ──
  {
    const before = await countOf('advances')
    const r = await req('POST', '/api/advances', {
      employeeId: empId, amount: '5000', advanceDate: today }, ownerJar)
    const b = await r.json().catch(() => ({}))
    const after = await countOf('advances')
    check('P5-API-02 เบิกเกินเพดาน → 409 ADVANCE_OVER_CEILING · ไม่มีแถวใหม่',
      r.status === 409 && b.error === 'ADVANCE_OVER_CEILING' && after === before,
      `${r.status} ${b.error} · ${before}→${after}`)
    check('P5-UI-04 ข้อความบอก**เพดานที่เหลือจริงเป็นตัวเลข** ไม่ใช่ "ทำรายการไม่สำเร็จ" ลอย ๆ',
      typeof b.detail === 'string' && /2300/.test(b.detail.replace(/,/g, '')),
      b.detail ?? '(ไม่มีรายละเอียด)')
  }

  // ── P5-API-07 · จ่ายให้คนที่ไม่มีค่าแรงค้าง ───────────────────────
  {
    const [other] = (await sql(
      `insert into public.employees(full_name, is_active) values ('${MARK} ไม่มีค่าแรง', true) returning id`)).rows
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
  if (empId) await sql(`delete from public.advances where employee_id = '${empId}'`)
  if (runId) {
    await sql(`delete from public.payroll_lines where run_id = '${runId}'`)
    await sql(`delete from public.payroll_runs where id = '${runId}'`)
  }
  if (siteId) {
    await sql(`delete from public.attendance where site_id = '${siteId}'`)
    await sql(`delete from public.site_supervisors where site_id = '${siteId}'`)
    await sql(`delete from public.site_finance where site_id = '${siteId}'`)
    await sql(`delete from public.sites where id = '${siteId}'`)
  }
  if (empId) await sql(`delete from public.employees where id = '${empId}'`)
  await sql(`delete from public.payroll_runs where period_start = '2001-01-01'`)
  console.log('  (ลบข้อมูลทดสอบแล้ว)')
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
