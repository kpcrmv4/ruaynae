#!/usr/bin/env node
/**
 * verify-payroll.mjs — ปิดแถว P5-DB-* ใน docs/test-plan/P5.md
 *
 * 🔴 แถวที่สำคัญที่สุดคือ P5-DB-10 และ P5-DB-11:
 * เบิกล่วงหน้าและปิดรอบจ่ายคือ **เงินสดออก ไม่ใช่ต้นทุน**
 * ต้องวัด `cost_total` ก่อนและหลัง ไม่ใช่ดูว่าเลขสุดท้ายดูสมเหตุสมผล
 *
 * ตัวอย่างจาก DESIGN.md §5.4 ที่สคริปต์นี้เดินตามทีละก้าว:
 *   ทำงาน 6 วัน × ฿550 = ต้นทุน ฿3,300
 *   เบิก ฿1,000  → ต้นทุนไม่ขยับ · เงินสดออก ฿1,000
 *   ปิดรอบ ฿2,300 → ต้นทุนไม่ขยับ · เงินสดออก ฿2,300
 *   รวมต้นทุน ฿3,300 · เงินสดออก ฿3,300 · ค้างจ่าย ฿0
 */
import { readFileSync } from 'node:fs'
import { derivePassword, hashPin } from '../src/lib/pin-core.ts'

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

console.log('\n── P5-DB · เบิกล่วงหน้า + รอบจ่ายค่าแรง ─────────────────────')

const ownerTok = await signIn(env.SEED_OWNER_EMAIL, env.SEED_OWNER_PASSWORD)

/**
 * บัญชีหัวหน้าโครงการของชุดเดโม่ — **อาจไม่มีในฐานที่ใช้งานจริง**
 *
 * 🔴 ล้มแล้วโยนทิ้งทั้งสคริปต์ไม่ได้ เพราะแถวที่เหลืออีกยี่สิบกว่าแถวไม่ได้ใช้บัญชีนี้เลย
 * · และห้าม seed ผู้ใช้เดโม่ลงฐานที่มีข้อมูลจริงเพื่อให้สคริปต์เขียว — นั่นคือ
 *   การสร้างบัญชีล็อกอินค้างไว้บนระบบของลูกค้าเพื่อความสะดวกของตัวตรวจ
 * · แถวที่ต้องใช้บัญชีนี้จึงรายงานว่า **ตัดสินไม่ได้** ไม่ใช่ "ผ่าน" และไม่ใช่ "ตก"
 */
const supTok = await (async () => {
  // หาอีเมลสังเคราะห์ของเจ้าของ PIN ใบนี้จาก `pin_hash` — **ห้ามเดาจากชื่อ
  // ในไฟล์ seed** เพราะฐานที่ใช้งานจริงตั้งชื่อหัวหน้าโครงการเป็นอย่างอื่น
  // แล้ว `syntheticEmail('sup1')` จะไม่มีอยู่จริง (วิธีเดียวกับที่ /api/auth/pin ใช้)
  const hash = hashPin(env.PIN_PEPPER, env.SEED_SUPERVISOR1_PIN ?? '')
  const { rows } = await sql(
    `select u.email from auth.users u
       join public.profiles p on p.id = u.id
      where p.pin_hash = '${hash}' and p.is_active limit 1`)
  const email = rows?.[0]?.email
  if (!email) return null
  return signIn(email, derivePassword(env.PIN_PEPPER, env.SEED_SUPERVISOR1_PIN)).catch(() => null)
})()
const undecided = []
const skip = (label, why) => {
  undecided.push(label)
  console.log(`  ⏭ ${label} — ตัดสินไม่ได้: ${why}`)
}

const day = (offset) => {
  const d = new Date(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()) + 'T00:00:00Z',
  )
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

const MARK = 'ทดสอบรอบจ่าย'
let siteId = null
let empId = null
let runId = null
/** คนที่สองกับรอบของเขา — ใช้เฉพาะฉากยกยอดเบิกเกิน (P5-DB-23/24) */
let emp2Id = null
let run2Id = null
/** id ของ attendance ที่ fixture สร้างเอง — ใช้ตามลบ audit ของตัวเองแบบตรงตัว */
const attIds = []

/** ต้นทุนรวมของโครงการตามที่ RPC คำนวณ — ตัวเลขเดียวกับที่หน้าจอวาด */
const siteCost = async () => {
  const r = await db(ownerTok, `/rpc/site_money`, {
    method: 'POST', body: JSON.stringify({ p_site: siteId }) })
  return Number(r.body?.[0]?.cost_total ?? -1)
}
const balanceOf = async () => {
  const r = await rpc(ownerTok, 'employee_balance', { p_employee: empId })
  const b = r.body?.[0]
  return { accrued: Number(b?.accrued ?? -1), advanced: Number(b?.advanced ?? -1), balance: Number(b?.balance ?? -1) }
}
const countOf = async (table, filter = '') => {
  const r = await fetch(`${URL}/rest/v1/${table}?select=id${filter}`, {
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, Prefer: 'count=exact', Range: '0-0' },
  })
  return Number(/\/(\d+)$/.exec(r.headers.get('content-range') ?? '')?.[1] ?? -1)
}

try {
  ;[{ id: siteId }] = (await sql(
    `insert into public.sites(name, status) values ('${MARK} โครงการ', 'active') returning id`)).rows
  ;[{ id: empId }] = (await sql(
    `insert into public.employees(full_name, job_title) values ('${MARK} สมพงษ์', 'ช่างไม้') returning id`)).rows
  await sql(`insert into public.employee_wages(employee_id, wage_type, daily_rate)
             values ('${empId}', 'daily', 550)`)

  // ทำงาน 6 วัน × ฿550 = ฿3,300 (ตัวอย่างจาก DESIGN.md §5.4)
  for (let i = 1; i <= 6; i++) {
    const r = await sql(`insert into public.attendance(work_date, site_id, employee_id, work_units)
               values ('${day(-i)}', '${siteId}', '${empId}', 1) returning id`)
    if (r.rows?.[0]?.id) attIds.push(r.rows[0].id)
  }

  const costAfterWork = await siteCost()

  // ── P5-DB-01 · เบิกได้ในเพดาน ─────────────────────────────────────
  {
    const before = await countOf('advances')
    const bal = await balanceOf()
    const r = await db(ownerTok, '/advances', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        employee_id: empId, amount: 1000, advance_date: day(0), site_id: siteId, status: 'approved' }),
    })
    const after = await countOf('advances')
    check('P5-DB-01 ค่าแรงค้างจ่าย ฿3,300 · เบิก ฿1,000 → สำเร็จ · advances +1',
      bal.accrued === 3300 && r.status === 201 && after === before + 1,
      `ค้างจ่าย ฿${bal.accrued} · ${r.status} · +${after - before}`)
  }

  // ── P5-DB-11 · 🔴 เบิกแล้วต้นทุนต้องไม่ขยับ ───────────────────────
  {
    const costNow = await siteCost()
    check('P5-DB-11 บันทึกเบิกล่วงหน้าแล้ว ต้นทุนโครงการไม่ขยับสักบาท (เงินสดออก ไม่ใช่ต้นทุน)',
      costAfterWork === 3300 && costNow === 3300,
      `ก่อนเบิก ฿${costAfterWork} → หลังเบิก ฿${costNow}`)
  }

  // ── P5-DB-03 · ยอดคงเหลือหักยอดที่เบิกไปแล้วด้วย ──────────────────
  // (เดิมแถวนี้ยืนยันว่า "เพดานคิดจากยอดที่เบิกไปแล้ว" แล้วปฏิเสธ · เจ้าของสั่ง
  //  20 ก.ย. 2569 ให้เบิกเกินได้ สิ่งที่ต้องยืนยันจึงเปลี่ยนเป็น **ตัวเลขที่เอาไปเตือน**
  //  ต้องถูกต้อง ไม่ใช่การปฏิเสธ)
  {
    const bal = await balanceOf()
    const r = await db(ownerTok, '/advances', {
      method: 'POST',
      body: JSON.stringify({ employee_id: empId, amount: 2500, advance_date: day(0), status: 'approved' }),
    })
    const after = await balanceOf()
    check('P5-DB-03 เบิกอีก ฿2,500 บนคงเหลือ ฿2,300 → ผ่าน · คงเหลือกลายเป็น −฿200 พอดี',
      bal.balance === 2300 && r.status === 201 && after.balance === -200
      && after.advanced === 3500,
      `คงเหลือ ฿${bal.balance} → ฿${after.balance} · ${r.status}`)
    // คืนสภาพ: ลบใบ ฿2,500 ออก เหลือ ฿1,000 ตามตัวอย่างใน DESIGN
    await sql(`delete from public.advances where employee_id = '${empId}' and amount = 2500`)
  }

  // ── P5-DB-02 · เบิกเกินค่าแรงค้างจ่ายได้ · คงเหลือติดลบเท่าที่เกินจริง ──
  {
    const before = await countOf('advances')
    const over = await db(ownerTok, '/advances', {
      method: 'POST',
      body: JSON.stringify({ employee_id: empId, amount: 4000, advance_date: day(0), status: 'approved' }),
    })
    const after = await countOf('advances')
    const bal = await balanceOf()
    check('P5-DB-02 เบิก ฿4,000 บนค่าแรงค้างจ่าย ฿3,300 → 201 · advances +1 · คงเหลือ −฿1,700',
      over.status === 201 && after === before + 1 && bal.balance === -1700,
      `${over.status} · +${after - before} · คงเหลือ ฿${bal.balance}`)
    // คืนสภาพ: ลบใบ ฿4,000 ออก เหลือ ฿1,000 ตามตัวอย่างใน DESIGN
    await sql(`delete from public.advances where employee_id = '${empId}' and amount = 4000`)
    const back = await balanceOf()
    check('P5-DB-02b ลบใบที่เบิกเกินออก → คงเหลือกลับเป็น ฿2,300 (ยอดติดลบไม่ค้างในระบบ)',
      back.balance === 2300, `คงเหลือ ฿${back.balance}`)
  }

  // ── P5-DB-22 · ลงวันย้อนหลังได้ และเก็บวันที่ส่งมาจริง ────────────
  // เจ้าของแจ้ง 20 ก.ย. 2569: *"บางทีมาลงย้อนหลัง มันจะบันทึกเป็นปัจจุบัน"*
  {
    const back = day(-4)
    const r = await db(ownerTok, '/advances', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ employee_id: empId, amount: 120, advance_date: back, status: 'approved' }),
    })
    const saved = r.body?.[0]?.advance_date ?? null
    const future = await db(ownerTok, '/advances', {
      method: 'POST',
      body: JSON.stringify({ employee_id: empId, amount: 120, advance_date: day(1), status: 'approved' }),
    })
    check('P5-DB-22 ลงเบิกย้อนหลัง 4 วัน → เก็บวันที่ส่งมา ไม่ใช่วันนี้ · วันในอนาคตยังถูกปฏิเสธ',
      r.status === 201 && saved === back && saved !== day(0) && future.status >= 400,
      `เก็บ ${saved} (ส่ง ${back}) · อนาคต ${future.status}`)
    await sql(`delete from public.advances where employee_id = '${empId}' and amount = 120`)
  }

  // ── P5-DB-05 · ยอดติดลบหรือศูนย์ ──────────────────────────────────
  {
    const bad = []
    for (const a of [0, -500]) {
      const r = await db(ownerTok, '/advances', {
        method: 'POST',
        body: JSON.stringify({ employee_id: empId, amount: a, advance_date: day(0), status: 'approved' }),
      })
      bad.push(r.status)
    }
    check('P5-DB-05 เบิก ฿0 หรือติดลบ → check constraint ปฏิเสธทั้งคู่',
      bad.every((s) => s >= 400), bad.join(' '))
  }

  // ── P5-DB-06 · หัวหน้าโครงการไม่เห็นและเขียนไม่ได้ ───────────────────
  if (!supTok) {
    skip('P5-DB-06 หัวหน้าโครงการอ่านทั้งสามตารางได้ 0 แถวและเขียนไม่ได้',
      'ฐานนี้ไม่มีบัญชีหัวหน้าโครงการของชุดเดโม่ (SEED_SUPERVISOR1_PIN) — ต้องตรวจด้วยบัญชีจริงในเบราว์เซอร์')
  } else {
    const reads = []
    for (const t of ['advances', 'payroll_runs', 'payroll_lines']) {
      const r = await db(supTok, `/${t}?select=id`)
      reads.push(Array.isArray(r.body) ? r.body.length : -1)
    }
    const write = await db(supTok, '/advances', {
      method: 'POST',
      body: JSON.stringify({ employee_id: empId, amount: 100, advance_date: day(0), status: 'approved' }),
    })
    const ownerSees = (await db(ownerTok, '/advances?select=id')).body?.length ?? 0
    check('P5-DB-06 หัวหน้าโครงการอ่านทั้งสามตารางได้ 0 แถวและเขียนไม่ได้ · เจ้าของอ่านได้ > 0',
      reads.every((n) => n === 0) && write.status >= 400 && ownerSees > 0,
      `อ่าน ${reads.join('/')} · เขียน ${write.status} · เจ้าของ ${ownerSees}`)
  }

  // ── P5-DB-07 · anon ───────────────────────────────────────────────
  {
    const reads = []
    for (const t of ['advances', 'payroll_runs', 'payroll_lines']) {
      const r = await db('anon', `/${t}?select=id`)
      reads.push(Array.isArray(r.body) ? r.body.length : -1)
    }
    check('P5-DB-07 anon อ่านทั้งสามตารางได้ 0 แถว', reads.every((n) => n === 0), reads.join('/'))
  }

  // ── P5-API-05 หลังบ้าน · เปิดรอบจ่าย ──────────────────────────────
  {
    const r = await db(ownerTok, '/payroll_runs', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        period_start: day(-10), period_end: day(0), site_id: siteId }),
    })
    runId = (Array.isArray(r.body) ? r.body[0] : null)?.id ?? null
    check('P5-DB-08a เปิดรอบจ่ายได้ · status เริ่มที่ open',
      r.status === 201 && (Array.isArray(r.body) ? r.body[0] : null)?.status === 'open',
      `${r.status}`)
  }

  // ── P5-DB-08 · รอบซ้อนช่วงเดิม ────────────────────────────────────
  {
    const r = await db(ownerTok, '/payroll_runs', {
      method: 'POST',
      body: JSON.stringify({ period_start: day(-5), period_end: day(-1), site_id: siteId }),
    })
    check('P5-DB-08 เปิดรอบที่ช่วงเวลาซ้อนกับรอบเดิมของโครงการเดิม → ถูกปฏิเสธ',
      r.status >= 400 && /payroll_runs_no_overlap|exclusion/.test(r.raw ?? ''),
      `${r.status}`)
  }

  // ── P5-DB-09 · ปิดรอบ → บรรทัดรายคนถูกต้อง ────────────────────────
  {
    const costBefore = await siteCost()
    const r = await rpc(ownerTok, 'close_payroll_run', { p_run: runId })
    const out = r.body?.[0]
    const [line] = (await sql(
      `select days, accrued, advance_deducted, net_paid
       from public.payroll_lines where run_id = '${runId}'`)).rows
    check('P5-DB-09 ปิดรอบ → บรรทัดรายคน: 6 วัน · ค่าแรง ฿3,300 · หักเบิก ฿1,000 · จ่ายจริง ฿2,300',
      r.status === 200 && Number(line?.days) === 6 && Number(line?.accrued) === 3300
      && Number(line?.advance_deducted) === 1000 && Number(line?.net_paid) === 2300,
      `${line?.days} วัน · ${line?.accrued} − ${line?.advance_deducted} = ${line?.net_paid}`)

    // ── P5-DB-10 · 🔴 ปิดรอบแล้วต้นทุนต้องไม่ขยับ ───────────────────
    const costAfter = await siteCost()
    check('P5-DB-10 ปิดรอบจ่ายแล้ว ต้นทุนโครงการไม่ขยับสักบาท — จ่ายเงินคือล้างหนี้ ไม่ใช่ต้นทุนใหม่',
      costBefore === 3300 && costAfter === 3300,
      `ก่อนปิดรอบ ฿${costBefore} → หลังปิดรอบ ฿${costAfter}`)

    // ── P5-DB-16 · ยอดรวมบนหัวรอบ ───────────────────────────────────
    const [run] = (await sql(
      `select status, total_accrued, total_advance_deducted, total_paid, closed_by
       from public.payroll_runs where id = '${runId}'`)).rows
    check('P5-DB-16 ยอดรวมบนหัวรอบ = ผลรวมของบรรทัดพอดี · status=closed · มี closed_by',
      run?.status === 'closed' && Number(run?.total_accrued) === 3300
      && Number(run?.total_advance_deducted) === 1000 && Number(run?.total_paid) === 2300
      && Boolean(run?.closed_by) && Number(out?.paid) === 2300,
      `${run?.total_accrued} / ${run?.total_advance_deducted} / ${run?.total_paid}`)
  }

  // ── P5-DB-12 · เบิกถูกผูกกับรอบ · ค้างจ่ายกลับเป็น 0 ──────────────
  {
    const [adv] = (await sql(
      `select payroll_run_id from public.advances where employee_id = '${empId}'`)).rows
    const bal = await balanceOf()
    check('P5-DB-12 เบิกที่ถูกหักผูกกับรอบนั้นแล้ว · ค่าแรงค้างจ่ายกลับเป็น ฿0 ไม่ถูกหักซ้ำรอบหน้า',
      adv?.payroll_run_id === runId && bal.accrued === 0 && bal.advanced === 0,
      `run=${adv?.payroll_run_id === runId} · ค้างจ่าย ฿${bal.accrued} · เบิกค้าง ฿${bal.advanced}`)
  }

  // ── P5-DB-15 · ปิดรอบซ้ำ ──────────────────────────────────────────
  {
    const before = await countOf('payroll_lines')
    const r = await rpc(ownerTok, 'close_payroll_run', { p_run: runId })
    const after = await countOf('payroll_lines')
    check('P5-DB-15 ปิดรอบเดิมซ้ำ → /ALREADY_CLOSED/ · payroll_lines ไม่เพิ่ม',
      /ALREADY_CLOSED/.test(r.raw ?? '') && after === before, `${r.status} · ${before}→${after}`)
  }

  // ── P5-DB-13 + P5-DB-14 · แตะข้อมูลของรอบที่ปิดแล้วไม่ได้ ─────────
  {
    const [att] = (await sql(
      `select id from public.attendance where employee_id = '${empId}' and work_date = '${day(-1)}'`)).rows
    const editWage = await db(ownerTok, `/attendance_wages?attendance_id=eq.${att.id}`, {
      method: 'PATCH', body: JSON.stringify({ ot_amount: 500 }),
    })
    const del = await db(ownerTok, `/attendance?id=eq.${att.id}`, { method: 'DELETE' })
    const still = await countOf('attendance', `&id=eq.${att.id}`)
    check('P5-DB-13 แก้ค่าแรงของวันที่อยู่ในรอบที่ปิดแล้ว → /PAYROLL_CLOSED/',
      /PAYROLL_CLOSED/.test(editWage.raw ?? ''), `${editWage.status}`)
    check('P5-DB-14 ลบ attendance ของวันที่อยู่ในรอบที่ปิดแล้ว → ถูกปฏิเสธ · แถวยังอยู่',
      /PAYROLL_CLOSED/.test(del.raw ?? '') && still === 1, `${del.status} · เหลือ ${still} แถว`)
  }

  // ── P5-DB-04 · เบิกหลังปิดรอบเริ่มนับใหม่จาก 0 ────────────────────
  {
    const bal = await balanceOf()
    const r = await db(ownerTok, '/advances', {
      method: 'POST',
      body: JSON.stringify({ employee_id: empId, amount: 100, advance_date: day(0), status: 'approved' }),
    })
    const after = await balanceOf()
    check('P5-DB-04 หลังปิดรอบ ค้างจ่าย ฿0 → เบิก ฿100 ยังทำได้ · คงเหลือเป็น −฿100 (ไม่ใช่ถูกปฏิเสธ)',
      bal.balance === 0 && r.status === 201 && after.balance === -100,
      `฿${bal.balance} → ฿${after.balance} · ${r.status}`)
    await sql(`delete from public.advances where employee_id = '${empId}' and amount = 100`)
  }

  // ── P5-DB-23 · 🔴 เบิกเกินแล้วจ่ายค่าแรง → ส่วนที่หักไม่ครบต้องค้างไว้ ──
  // นี่คือรูที่เปิดพร้อมกับการอนุญาตให้เบิกเกิน: เดิม `close_payroll_run()`
  // ตีตราใบเบิก **ทุกใบ** ว่าหักแล้ว ทั้งที่หักได้แค่เท่าค่าแรงของงวดนั้น
  // → ส่วนที่เกินจะหายไปเฉย ๆ โดยไม่มี error ที่ไหนเลย
  {
    ;[{ id: emp2Id }] = (await sql(
      `insert into public.employees(full_name, job_title) values ('${MARK} ยกยอด', 'กรรมกร') returning id`)).rows
    await sql(`insert into public.employee_wages(employee_id, wage_type, daily_rate)
               values ('${emp2Id}', 'daily', 550)`)
    // ค่าแรง 2 วัน = ฿1,100 · เบิกไป ฿1,800 → เกินอยู่ ฿700
    for (let i = 1; i <= 2; i++) {
      const r = await sql(`insert into public.attendance(work_date, site_id, employee_id, work_units)
                 values ('${day(-20 - i)}', '${siteId}', '${emp2Id}', 1) returning id`)
      if (r.rows?.[0]?.id) attIds.push(r.rows[0].id)
    }
    await db(ownerTok, '/advances', {
      method: 'POST',
      body: JSON.stringify({ employee_id: emp2Id, amount: 1800, advance_date: day(-20), status: 'approved' }),
    })
    const paid = await rpc(ownerTok, 'pay_employee_wage', { p_employee: emp2Id })
    run2Id = paid.body?.[0]?.run_id ?? null

    const line = (await sql(
      `select accrued, advance_deducted, net_paid from public.payroll_lines
        where employee_id = '${emp2Id}'`)).rows[0] ?? {}
    const adv = (await sql(
      `select amount, deducted_amount, payroll_run_id from public.advances
        where employee_id = '${emp2Id}'`)).rows[0] ?? {}
    const bal = (await sql(
      `select balance from public.employee_balance_raw('${emp2Id}')`)).rows[0] ?? {}

    check('P5-DB-23 ค่าแรง ฿1,100 · เบิกไว้ ฿1,800 → จ่ายจริง ฿0 · หักได้ ฿1,100 · ค้างต่อ ฿700',
      Number(line.accrued) === 1100 && Number(line.advance_deducted) === 1100
      && Number(line.net_paid) === 0
      && Number(adv.deducted_amount) === 1100 && adv.payroll_run_id === null
      && Number(bal.balance) === -700,
      `line ${line.accrued}/${line.advance_deducted}/${line.net_paid} · ใบเบิกหักแล้ว ${adv.deducted_amount} · คงเหลือ ${bal.balance}`)
  }

  // ── P5-DB-24 · ใบที่ถูกหักคืนไปแล้วบางส่วน ลบไม่ได้ ───────────────
  {
    const [{ id: partId }] = (await sql(
      `select id from public.advances where employee_id = '${emp2Id}'`)).rows
    const del = await db(ownerTok, `/advances?id=eq.${partId}`, { method: 'DELETE' })
    const still = await countOf('advances', `&id=eq.${partId}`)
    // คู่ตรงข้ามที่ต้องผ่าน: ใบใหม่ที่ยังไม่เคยถูกหักเลย ต้องลบได้ตามปกติ
    const fresh = await db(ownerTok, '/advances', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ employee_id: emp2Id, amount: 50, advance_date: day(0), status: 'approved' }),
    })
    const freshId = fresh.body?.[0]?.id
    const delFresh = await db(ownerTok, `/advances?id=eq.${freshId}`, { method: 'DELETE' })
    check('P5-DB-24 ลบใบที่หักคืนไปแล้วบางส่วน → /PAYROLL_CLOSED/ · แถวยังอยู่ · ใบที่ยังไม่ถูกหักลบได้',
      /PAYROLL_CLOSED/.test(del.raw ?? '') && still === 1
      && fresh.status === 201 && delFresh.status === 204,
      `ลบใบที่หักแล้ว ${del.status} · เหลือ ${still} แถว · ใบใหม่ ${delFresh.status}`)
  }

  // ── P5-DB-19 · index ──────────────────────────────────────────────
  {
    const { rows } = await sql(
      "select indexdef from pg_indexes where schemaname='public' and tablename in ('advances','payroll_runs','payroll_lines')")
    const defs = rows.map((r) => r.indexdef).join('\n')
    const want = [/advances[\s\S]*\(employee_id, advance_date\)/i, /payroll_lines[\s\S]*\(run_id\)/i]
    check('P5-DB-19 index ที่ใช้กรองจริงมีครบ: advances(employee_id, advance_date) · payroll_lines(run_id)',
      want.every((re) => re.test(defs)), `${rows.length} index`)
  }

  // ── P5-DB-20 · audit trigger ──────────────────────────────────────
  {
    const { rows } = await sql(
      `select t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where c.relname in ('advances','payroll_runs','payroll_lines') and not t.tgisinternal`)
    const names = rows.map((r) => r.tgname)
    const want = ['advances_audit', 'payroll_runs_audit', 'payroll_lines_audit']
    check('P5-DB-20 audit trigger ครอบทั้งสามตารางใหม่',
      want.every((w) => names.includes(w)), want.filter((w) => !names.includes(w)).join(', ') || 'ครบ')
  }

  // ── P5-DB-21 · ทุกคอลัมน์มีคนเขียน ────────────────────────────────
  {
    const mig = readFileSync('supabase/migrations/20260831010000_p5_advances_payroll.sql', 'utf8')
      .replace(/--.*/g, '')
    // เฉพาะคอลัมน์ที่ **RPC/trigger** เป็นคนเขียน — ที่เหลือมาจาก payload
    // ของ route ซึ่งยังไม่มีจนกว่าจะถึง P5-b (แถว P5-DB-21 เต็มปิดตอนนั้น)
    const cols = [
      'employee_id', 'site_id', 'payroll_run_id', 'status',
      'total_accrued', 'total_advance_deducted', 'total_paid', 'closed_at', 'closed_by',
      'run_id', 'days', 'accrued', 'advance_deducted', 'net_paid',
    ]
    const missing = cols.filter(
      (c) =>
        !new RegExp(`insert into[^(]*\\([^)]*\\b${c}\\b`, 's').test(mig) &&
        !new RegExp(`\\b${c}\\s*=\\s*\\S`).test(mig),
    )
    check('P5-DB-21a คอลัมน์ที่ RPC ปิดรอบต้องเขียนเอง มีโค้ดเขียนจริงครบ',
      missing.length === 0, missing.length ? `ไม่มีใครเขียน: ${missing.join(', ')}` : `${cols.length}/${cols.length}`)
  }
} finally {
  const people = [empId, emp2Id].filter(Boolean)
  for (const id of people) {
    // 🔴 `advances_guard_delete` กันลบใบที่ถูกหักคืนไปแล้ว (ทั้งใบหรือบางส่วน)
    // ปลดธงของ **แถวทดสอบเท่านั้น** ก่อนลบ — ไม่ใช่ปิด trigger ทั้งระบบ
    // ไม่งั้นสคริปต์นี้จะทิ้งข้อมูลค้างไว้แล้วทำให้ตัวตรวจอื่นแดงยกชุด (§17 ข้อ 9)
    await sql(`update public.advances set deducted_amount = 0, payroll_run_id = null
               where employee_id = '${id}'`)
    await sql(`delete from public.advances where employee_id = '${id}'`)
  }
  for (const id of [runId, run2Id].filter(Boolean)) {
    await sql(`delete from public.payroll_lines where run_id = '${id}'`)
    await sql(`delete from public.payroll_runs where id = '${id}'`)
  }
  if (siteId) {
    // trigger กันลบของรอบที่ปิดแล้ว — ลบรอบก่อน แล้วค่อยลบ attendance
    await sql(`delete from public.attendance where site_id = '${siteId}'`)
    await sql(`delete from public.site_supervisors where site_id = '${siteId}'`)
    await sql(`delete from public.site_finance where site_id = '${siteId}'`)
    await sql(`delete from public.sites where id = '${siteId}'`)
  }
  for (const id of people) await sql(`delete from public.employees where id = '${id}'`)

  // 🔴 ลบร่องรอยใน `audit_log` ของ fixture ชุดนี้ด้วย (คำสั่งเจ้าของ 20 ก.ย. 2569)
  // · ลบตาม **id ที่สคริปต์สร้างเอง** เท่านั้น
  // · ห้ามใช้ "แถวที่กลายเป็นกำพร้า" เป็นตัวชี้ว่าเป็นของทดสอบ — ลูกค้าลบข้อมูล
  //   ของตัวเองเป็นเรื่องปกติ แถวพวกนั้นก็กำพร้าเหมือนกัน (ทำพังมาแล้ว 21 ก.ย. 2569)
  for (const id of [empId, emp2Id, siteId, runId, run2Id].filter(Boolean)) {
    await sql(`delete from public.audit_log
                where row_id::text = '${id}'
                   or before::text like '%${id}%'
                   or after::text  like '%${id}%'`)
  }
  if (attIds.length) {
    await sql(`delete from public.audit_log
                where table_name = 'attendance_wages'
                  and coalesce(after->>'attendance_id', before->>'attendance_id')
                      in (${attIds.map((i) => `'${i}'`).join(', ')})`)
  }

  // ยืนยันว่าคืนจริง — `delete` คือคำขอ ส่วน "เหลือ 0 แถว" คือคำตอบ
  const left = (await sql(
    `select count(*)::int n from public.employees where full_name like '${MARK}%'`)).rows[0]
  console.log(
    Number(left?.n ?? -1) === 0
      ? '  (ลบข้อมูลทดสอบแล้ว)'
      : `  ⚠️ ลบข้อมูลทดสอบไม่ครบ — เหลือคนงาน ${left?.n} แถว ต้องตามลบก่อนรันตัวอื่น`)
}

// ── P5-DB-17 · RLS เปิดทุกตาราง ─────────────────────────────────────
{
  const { rows } = await sql(
    "select count(*)::int off from pg_tables where schemaname='public' and not rowsecurity")
  const { rows: all } = await sql(
    "select count(*)::int n from pg_tables where schemaname='public'")
  check('P5-DB-17 ทุกตารางใน public เปิด RLS · ไม่มีตารางไหนหลุด',
    Number(rows[0].off) === 0 && Number(all[0].n) >= 21,
    `ปิดอยู่ ${rows[0].off} จาก ${all[0].n} ตาราง`)
}

// ── P5-DB-18 · advisors ─────────────────────────────────────────────
{
  const get = async (kind) => {
    const r = await fetch(
      `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/advisors/${kind}`,
      { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })
    const j = await r.json()
    return (j.lints ?? []).filter((l) => l.level === 'ERROR').length
  }
  const [sec, perf] = [await get('security'), await get('performance')]
  check('P5-DB-18 advisors ไม่มี ERROR ทั้ง security และ performance',
    sec === 0 && perf === 0, `security ${sec} · performance ${perf}`)
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
// 🔴 แถวที่ตัดสินไม่ได้ต้องถูกนับและเอ่ยชื่อ ไม่ใช่หายไปจากรายงานจนดูเหมือนตรวจครบ
if (undecided.length) {
  console.log(`  ⏭ ตัดสินไม่ได้ ${undecided.length} แถว (ยังเป็น ☐ ในตารางตรวจรับ):`)
  for (const u of undecided) console.log(`     · ${u}`)
}
process.exit(pass === results.length ? 0 : 1)
