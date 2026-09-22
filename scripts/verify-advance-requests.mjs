#!/usr/bin/env node
/**
 * verify-advance-requests.mjs — ปิดแถว R14-* ใน docs/test-plan/R14-advance-requests.md
 *
 * 🔴 สิ่งที่สคริปต์นี้มีไว้ยืนยันคือประโยคเดียว: **คำขอเบิกไม่ใช่เงิน**
 * · แถวที่ยืนยันการปฏิเสธต้องยืนยัน **สถานะของข้อมูลหลังจากนั้น** ด้วยเสมอ
 * · แถวที่มีตัวเลขต้องอ่านตัวเลขจริงทั้งสองฝั่ง ไม่ใช่ถามว่า "ผ่านไหม"
 *
 * ⚠️ ต้องมี dev server รันอยู่ และ `.env.local` ชี้ไปที่ฐานที่ apply migration
 * `20260921180000_r14_advance_requests.sql` แล้ว
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
  if (!r.ok) return { error: t, rows: [] }
  return { rows: JSON.parse(t) }
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
const today = day(0)

console.log('\n── R14 · คำขอเบิกค่าแรงของหัวหน้าโครงการ ─────────────────────')

const ownerJar = jarOf(await req('POST', '/api/auth/login', {
  email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }))
const supJar = jarOf(await req('POST', '/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN }))
if (!ownerJar || !supJar) throw new Error('ล็อกอินไม่สำเร็จ — dev server รันอยู่ไหม')

const MARK = 'ทดสอบคำขอเบิก'
let siteId = null
let empId = null
let runId = null
/** id ทุกใบที่สคริปต์นี้สร้าง — รวมใบที่ "คาดว่าจะถูกปฏิเสธ" แล้วดันผ่าน (§17 ข้อ 28) */
const advanceIds = []
const fixtureAttendanceIds = []

/** อ่านสถานะของใบเบิกกลับจากฐาน — ไม่เชื่อสิ่งที่ route ตอบมาอย่างเดียว */
const advanceRow = async (id) =>
  (await sql(`select status, amount::float8 amount, deducted_amount::float8 deducted_amount,
                     payroll_run_id, rejected_reason, approved_by
                from public.advances where id = '${id}'`)).rows[0] ?? {}

const balanceOf = async () =>
  (await sql(`select accrued::float8 accrued, advanced::float8 advanced, balance::float8 balance
                from public.employee_balance_raw('${empId}')`)).rows[0] ?? {}

/** POST คำขอแล้วจด id ไว้เสมอ ไม่ว่าคำตอบจะเป็นอะไร */
const postAdvance = async (body, jar) => {
  const r = await req('POST', '/api/advances', body, jar)
  const b = await r.json().catch(() => ({}))
  if (b?.advance?.id) advanceIds.push(b.advance.id)
  return { status: r.status, body: b }
}

try {
  // ── fixture: โครงการที่หัวหน้าคนนี้ดูแลจริง + คนงานที่มีค่าแรงค้าง ฿1,000 ──
  ;[{ id: siteId }] = (await sql(
    `insert into public.sites(name, status) values ('${MARK} โครงการ', 'active') returning id`)).rows
  ;[{ id: empId }] = (await sql(
    `insert into public.employees(full_name, job_title) values ('${MARK} สมชาย', 'กรรมกร') returning id`)).rows
  await sql(`insert into public.employee_wages(employee_id, wage_type, daily_rate)
             values ('${empId}', 'daily', 500)`)
  for (let i = 1; i <= 2; i++) {
    const { rows } = await sql(`insert into public.attendance(work_date, site_id, employee_id, work_units)
               values ('${day(-i)}', '${siteId}', '${empId}', 1) returning id`)
    if (rows?.[0]?.id) fixtureAttendanceIds.push(rows[0].id)
  }
  // หัวหน้าโครงการคนที่ 1 ของ seed ดูแลโครงการนี้ตั้งแต่วันนี้
  const supName = (env.SEED_SUPERVISOR1_NAME ?? '').replace(/'/g, "''")
  await sql(`insert into public.site_supervisors(site_id, profile_id, effective_from)
             select '${siteId}', p.id, '${day(-30)}'
             from public.profiles p
             where p.role = 'site_supervisor' and p.full_name = '${supName}'`)
  const [{ n: supRows }] = (await sql(
    `select count(*)::int n from public.site_supervisors where site_id = '${siteId}'`)).rows
  if (Number(supRows) !== 1) {
    throw new Error(`ตั้งหัวหน้าโครงการให้ fixture ไม่สำเร็จ (${supRows} แถว) — ตรวจ SEED_SUPERVISOR1_NAME`)
  }

  // ── R14-API-02 · คำขอต้องผูกโครงการ ────────────────────────────────
  {
    const r = await postAdvance({ employeeId: empId, amount: '300', advanceDate: today }, supJar)
    check('R14-API-02 หัวหน้าโครงการยื่นคำขอโดยไม่เลือกโครงการ → 400 SITE_REQUIRED',
      r.status === 400 && r.body.error === 'SITE_REQUIRED', `${r.status} ${r.body.error}`)
  }

  // ── R14-API-01 + R14-DB-06 · ยื่นคำขอสำเร็จ = pending · ไม่มีตัวเลขค่าแรงหลุด ──
  let pendingId = null
  {
    const r = await postAdvance(
      { employeeId: empId, amount: '800', advanceDate: today, siteId, note: 'ขอเบิกค่ารถ' }, supJar)
    pendingId = r.body?.advance?.id ?? null
    const row = pendingId ? await advanceRow(pendingId) : {}
    check('R14-API-01 หัวหน้าโครงการยื่นคำขอ ฿800 → 201 · แถวเป็น pending · คำตอบไม่มียอดคงเหลือ',
      r.status === 201 && row.status === 'pending' && !('balance' in r.body),
      `${r.status} · status=${row.status} · keys=${Object.keys(r.body).join(',')}`)
  }

  // ── R14-DB-15 · 🔴 คำขอไม่ใช่เงิน ──────────────────────────────────
  {
    const b = await balanceOf()
    check('R14-DB-15 มีคำขอ ฿800 ค้างอยู่ → ค่าแรงค้างจ่าย ฿1,000 · เบิกไปแล้ว ฿0 · คงเหลือ ฿1,000',
      b.accrued === 1000 && b.advanced === 0 && b.balance === 1000,
      `ค้างจ่าย ฿${b.accrued} · เบิกแล้ว ฿${b.advanced} · คงเหลือ ฿${b.balance}`)
  }

  // ── R14-NOTIF-01 · เจ้าของได้รับแจ้งเตือน ──────────────────────────
  {
    const [{ n }] = (await sql(
      `select count(*)::int n from public.notifications
        where kind = 'advance_pending' and body like '%${MARK} สมชาย%'`)).rows
    check('R14-NOTIF-01 ยื่นคำขอแล้วเจ้าของได้แจ้งเตือน advance_pending พร้อมชื่อคนงานและยอด',
      Number(n) >= 1, `${n} ใบ`)
  }

  // ── R14-API-07 · หัวหน้าโครงการอนุมัติเองไม่ได้ ────────────────────
  {
    const r = await req('PATCH', `/api/advances/${pendingId}`, { action: 'approve' }, supJar)
    const b = await r.json().catch(() => ({}))
    const row = await advanceRow(pendingId)
    check('R14-API-07 หัวหน้าโครงการกดอนุมัติเอง → 403 · แถวยังเป็น pending',
      r.status === 403 && b.error === 'FORBIDDEN' && row.status === 'pending',
      `${r.status} ${b.error} · status=${row.status}`)
  }

  // ── R14-API-06 · ตีกลับต้องมีเหตุผล ────────────────────────────────
  {
    const r = await req('PATCH', `/api/advances/${pendingId}`, { action: 'reject' }, ownerJar)
    const b = await r.json().catch(() => ({}))
    const row = await advanceRow(pendingId)
    check('R14-API-06 เจ้าของตีกลับโดยไม่ใส่เหตุผล → 400 REASON_REQUIRED · แถวยังเป็น pending',
      r.status === 400 && b.error === 'REASON_REQUIRED' && row.status === 'pending',
      `${r.status} ${b.error} · status=${row.status}`)
  }

  // ── R14-NOTIF-03 + R14-DB-08 · ตีกลับ แล้วผู้ยื่นแก้ = ส่งใหม่ ──────
  {
    const r = await req('PATCH', `/api/advances/${pendingId}`,
      { action: 'reject', reason: 'เพิ่งเบิกไปเมื่อวาน' }, ownerJar)
    const row = await advanceRow(pendingId)
    const [{ n }] = (await sql(
      `select count(*)::int n from public.notifications
        where kind = 'advance_rejected' and body like '%เพิ่งเบิกไปเมื่อวาน%'`)).rows
    check('R14-NOTIF-03 ตีกลับพร้อมเหตุผล → แถวเป็น rejected · ผู้ยื่นได้แจ้งเตือนที่มีเหตุผลอยู่ในตัวข้อความ',
      r.status === 200 && row.status === 'rejected'
      && row.rejected_reason === 'เพิ่งเบิกไปเมื่อวาน' && Number(n) >= 1,
      `${r.status} · status=${row.status} · แจ้งเตือน ${n} ใบ`)
  }
  {
    const r = await req('PATCH', `/api/advances/${pendingId}`,
      { employeeId: empId, amount: '600', advanceDate: today, siteId, note: 'ลดยอดแล้ว' }, supJar)
    const row = await advanceRow(pendingId)
    check('R14-DB-08 ผู้ยื่นแก้คำขอที่ถูกตีกลับ → ยอดเปลี่ยนเป็น ฿600 · สถานะเด้งกลับ pending · เหตุผลถูกล้าง',
      r.status === 200 && row.status === 'pending' && row.amount === 600
      && row.rejected_reason === null,
      `${r.status} · status=${row.status} · ฿${row.amount} · reason=${row.rejected_reason}`)
  }

  // ── R14-APR-03/04 · อนุมัติแล้วถึงจะเป็นเงิน ───────────────────────
  {
    const before = await balanceOf()
    const r = await req('PATCH', `/api/advances/${pendingId}`, { action: 'approve' }, ownerJar)
    const row = await advanceRow(pendingId)
    const after = await balanceOf()
    check('R14-APR-04 เจ้าของอนุมัติ → status=approved · approved_by ถูกเติมให้ · คงเหลือ ฿1,000 → ฿400',
      r.status === 200 && row.status === 'approved' && row.approved_by
      && before.balance === 1000 && after.balance === 400 && after.advanced === 600,
      `฿${before.balance} → ฿${after.balance} · เบิกแล้ว ฿${after.advanced}`)
  }

  // ── R14-API-08 · อนุมัติซ้ำ ─────────────────────────────────────────
  {
    const r = await req('PATCH', `/api/advances/${pendingId}`, { action: 'approve' }, ownerJar)
    const b = await r.json().catch(() => ({}))
    check('R14-API-08 กดอนุมัติใบเดิมซ้ำ → 409 ALREADY_APPROVED',
      r.status === 409 && b.error === 'ALREADY_APPROVED', `${r.status} ${b.error}`)
  }

  // ── R14-API-10 · ผู้ยื่นแก้ใบที่อนุมัติแล้วไม่ได้ ───────────────────
  {
    const r = await req('PATCH', `/api/advances/${pendingId}`,
      { employeeId: empId, amount: '1', advanceDate: today, siteId }, supJar)
    const row = await advanceRow(pendingId)
    check('R14-API-10 ผู้ยื่นแก้ใบที่อนุมัติแล้ว → 403 · ยอดไม่ขยับ',
      r.status === 403 && row.amount === 600, `${r.status} · ฿${row.amount}`)
  }

  // ── R14-DB-16 · 🔴 จ่ายค่าแรงตอนมีคำขอค้างอยู่ ─────────────────────
  // ค่าแรง ฿1,000 · อนุมัติแล้ว ฿600 · คำขอที่ยังไม่อนุมัติอีก ฿900
  // ต้องหักแค่ ฿600 · จ่ายจริง ฿400 · ใบคำขอต้องไม่ถูกแตะเลย
  {
    const pending2 = await postAdvance(
      { employeeId: empId, amount: '900', advanceDate: today, siteId }, supJar)
    const pending2Id = pending2.body?.advance?.id ?? null
    const paid = await req('POST', '/api/payroll/pay', { employeeId: empId }, ownerJar)
    const pb = await paid.json().catch(() => ({}))
    runId = pb?.run?.id ?? pb?.runId ?? null
    if (!runId) {
      const { rows } = await sql(
        `select id from public.payroll_runs where employee_id = '${empId}' order by created_at desc limit 1`)
      runId = rows?.[0]?.id ?? null
    }
    const line = (await sql(
      `select accrued::float8 accrued, advance_deducted::float8 advance_deducted,
              net_paid::float8 net_paid
         from public.payroll_lines where employee_id = '${empId}'`)).rows[0] ?? {}
    const still = pending2Id ? await advanceRow(pending2Id) : {}
    check('R14-DB-16 ค่าแรง ฿1,000 · อนุมัติแล้ว ฿600 · คำขอค้าง ฿900 → หัก ฿600 · จ่ายจริง ฿400',
      line.accrued === 1000 && line.advance_deducted === 600 && line.net_paid === 400,
      `ค่าแรง ฿${line.accrued} · หัก ฿${line.advance_deducted} · จ่าย ฿${line.net_paid}`)
    check('R14-DB-16b คำขอที่ยังไม่อนุมัติไม่ถูกแตะเลย — ไม่ถูกหัก ไม่ถูกผูกกับรอบจ่าย',
      still.status === 'pending' && still.deducted_amount === 0 && still.payroll_run_id === null,
      `status=${still.status} · หักแล้ว ฿${still.deducted_amount} · run=${still.payroll_run_id}`)

    // ── R14-API-11 · ผู้ยื่นลบคำขอของตัวเองได้ ───────────────────────
    const del = await req('DELETE', `/api/advances/${pending2Id}`, undefined, supJar)
    const gone = (await sql(
      `select count(*)::int n from public.advances where id = '${pending2Id}'`)).rows[0]
    check('R14-API-11 ผู้ยื่นลบคำขอของตัวเองที่ยังไม่อนุมัติ → 200 · แถวหายจริง',
      del.status === 200 && Number(gone.n) === 0, `${del.status} · เหลือ ${gone.n} แถว`)
  }

  // ── R14-API-13 · ใบที่ถูกหักไปแล้ว ลบไม่ได้ ────────────────────────
  {
    const r = await req('DELETE', `/api/advances/${pendingId}`, undefined, ownerJar)
    const b = await r.json().catch(() => ({}))
    const row = await advanceRow(pendingId)
    check('R14-API-13 ลบใบที่ถูกหักตอนจ่ายค่าแรงไปแล้ว → 409 PAYROLL_CLOSED · แถวยังอยู่',
      r.status === 409 && b.error === 'PAYROLL_CLOSED' && row.status === 'approved',
      `${r.status} ${b.error}`)
  }

  // ── R14-DB-13 · ถอนอนุมัติใบที่ถูกหักไปแล้วไม่ได้ ──────────────────
  {
    const r = await sql(
      `update public.advances set status = 'pending' where id = '${pendingId}'`)
    const row = await advanceRow(pendingId)
    check('R14-DB-13 เปลี่ยนสถานะใบที่ถูกหักไปแล้ว → guard ปฏิเสธด้วย PAYROLL_CLOSED · แถวยังเป็น approved',
      /PAYROLL_CLOSED/.test(r.error ?? '') && row.status === 'approved',
      row.status)
  }

  // ── R14-DB-21 · ค่าแรงยังเป็นความลับจากคนที่ไม่ใช่เจ้าของ ──────────
  // ⚠️ ยิงด้วย publishable key เปล่า ๆ = สิทธิ์ `anon` ซึ่งถูก revoke ไว้อยู่แล้ว
  // · ฝั่งหัวหน้าโครงการ (`authenticated` ที่ไม่ใช่เจ้าของ) ต้องตรวจด้วย JWT จริง
  //   ใน `verify-rls.mjs` ซึ่งถือ token ของทั้งสอง role อยู่แล้ว — แถวนี้จึงเป็น
  //   **ด่านล่าง** ไม่ใช่คำตอบทั้งหมดของกฎข้อนี้
  {
    const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/employee_balance`, {
      method: 'POST',
      headers: {
        apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_employee: empId }),
    })
    check('R14-DB-21 เรียก employee_balance โดยไม่มีสิทธิ์เจ้าของ (anon) → ถูกปฏิเสธ ไม่ใช่คืนตัวเลขค่าแรง',
      r.status >= 400, `${r.status}`)
  }
} finally {
  // 🔴 คืนฐานให้เหมือนตอนที่เจอ · ลบตาม **id ที่สคริปต์นี้สร้างเอง** เท่านั้น
  if (empId) {
    // ใบที่ถูกหักคืนไปแล้วลบไม่ได้ (`advances_guard_delete`) — ปลดธงก่อน
    // ไม่งั้นลบใบเบิกไม่ได้ → ลบคนงานไม่ได้ (FK restrict) → คนงานทดสอบค้างในฐานลูกค้า
    await sql(`update public.advances set deducted_amount = 0, payroll_run_id = null
               where employee_id = '${empId}'`)
    await sql(`delete from public.advances where employee_id = '${empId}'`)
  }
  // ต้องลบรอบจ่ายก่อนแตะ attendance — `guard_attendance_closed` ปฏิเสธวันที่จ่ายแล้ว
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
  if (empId) {
    await sql(`delete from public.attendance where employee_id = '${empId}'`)
    await sql(`delete from public.employee_wages where employee_id = '${empId}'`)
    await sql(`delete from public.employees where id = '${empId}'`)
  }
  // แจ้งเตือนที่ trigger สร้างจาก fixture ชุดนี้ — ชี้ด้วยชื่อคนงานของ fixture
  // ไม่ใช่ช่วงเวลา (ช่วงเวลาคลุมของลูกค้าที่เกิดพร้อมกันได้)
  await sql(`delete from public.notifications
              where kind::text like 'advance_%' and body like '%${MARK}%'`)

  for (const id of [...advanceIds, empId, siteId, runId].filter(Boolean)) {
    await sql(`delete from public.audit_log
                where row_id::text = '${id}'
                   or before::text like '%${id}%'
                   or after::text  like '%${id}%'`)
  }
  if (fixtureAttendanceIds.length) {
    const list = fixtureAttendanceIds.map((id) => `'${id}'`).join(', ')
    await sql(`delete from public.audit_log
                where table_name = 'attendance_wages'
                  and coalesce(after->>'attendance_id', before->>'attendance_id') in (${list})`)
  }

  // "ลบแล้ว" คือคำขอ · "เหลือ 0 แถว" คือคำตอบ — ต้องอ่านกลับมานับเสมอ
  const left = (await sql(
    `select count(*)::int n from public.employees where full_name like '${MARK}%'`)).rows[0]
  const leftAdv = (await sql(
    `select count(*)::int n from public.advances
      where id in (${advanceIds.length ? advanceIds.map((i) => `'${i}'`).join(',') : `'${'0'.repeat(8)}-0000-0000-0000-000000000000'`})`)).rows[0]
  console.log(
    `\n  เก็บกวาด: เหลือคนงานทดสอบ ${left?.n ?? '?'} แถว · ใบเบิกทดสอบ ${leftAdv?.n ?? '?'} แถว`)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n  ${results.length - failed.length}/${results.length} ผ่าน`)
process.exit(failed.length === 0 ? 0 : 1)
