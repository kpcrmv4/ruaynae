#!/usr/bin/env node
/**
 * verify-approvals.mjs — ปิดแถว P3-API-01..04 และ P3-UI-01..06 ใน docs/test-plan/P3.md
 *
 * 🔴 แถวที่ยืนยันการ "ปฏิเสธ" ต้องยืนยัน **สถานะของแถวหลังจากนั้น** ด้วย
 * 403 ที่มาพร้อมกับข้อมูลที่เปลี่ยนไปแล้วคือการปฏิเสธที่มาช้าไปหนึ่งก้าว
 *
 * fixture ทุกตัวคืนค่าใน finally
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
  console.log(`  ${ok === 'skip' ? '⏭' : ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const req = (method, path, body, cookie) =>
  fetch(`${BASE}${path}`, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const jarOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

/** Next ฝัง RSC payload ไว้ใน <script> — ข้อความทุกคำจึงปรากฏสองครั้ง */
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

console.log('\n── P3 · คิวอนุมัติ ─────────────────────────────────────────')

const ownerJar = jarOf(await req('POST', '/api/auth/login', {
  email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }))
const supJar = jarOf(await req('POST', '/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN }))
if (!ownerJar || !supJar) throw new Error('ล็อกอินไม่สำเร็จ — dev server รันอยู่ไหม')

const [sup1] = (await sql(
  `select id, full_name from public.profiles where full_name = '${env.SEED_SUPERVISOR1_NAME}'`)).rows
const [owner] = (await sql("select id from public.profiles where role = 'owner' limit 1")).rows
const [expCat] = (await sql(
  "select id, name from public.categories where kind='expense' order by sort_order limit 1")).rows
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

// ── P3-UI-03 · สถานะว่าง ───────────────────────────────────────────
// ตรวจ**ก่อน**สร้าง fixture · ถ้าฐานมีของค้างอยู่จริงให้รายงานว่าตัดสินไม่ได้
// ดีกว่าไปแตะข้อมูลของผู้ใช้เพื่อให้ตัวตรวจผ่าน
{
  const [{ n }] = (await sql(
    "select count(*)::int n from public.transactions where status = 'pending'")).rows
  if (Number(n) > 0) {
    check('P3-UI-03 คิวว่าง → ข้อความบอกว่าไม่มีรายการรออนุมัติ', 'skip',
      `ฐานข้อมูลมีรายการค้างจริง ${n} รายการ — ตัดสินไม่ได้ในรอบนี้`)
  } else {
    const html = await page('/approvals', ownerJar)
    check('P3-UI-03 คิวว่าง → ข้อความบอกว่าไม่มีรายการรออนุมัติ ไม่ใช่ตารางเปล่า',
      html.includes('ไม่มีรายการรออนุมัติ'), 'สถานะว่างมีข้อความจริง')
  }
}

const NOTE_A = 'ค่าปูนทดสอบคิวอนุมัติ'
const NOTE_B = 'ค่าเหล็กทดสอบตีกลับ'
const NOTE_C = 'ค่าไม้แบบทดสอบไม่มีเหตุผล'
let siteId = null

try {
  ;[{ id: siteId }] = (await sql(
    "insert into public.sites(name, status) values ('ทดสอบคิวอนุมัติ โครงการก', 'active') returning id")).rows
  await sql(`insert into public.site_supervisors(site_id, profile_id)
             values ('${siteId}','${sup1.id}')`)

  const mk = async (amount, note) => {
    const r = await req('POST', '/api/transactions', {
      kind: 'expense', siteId, categoryId: expCat.id,
      amount: String(amount), txnDate: today, payMethod: 'cash', note,
    }, supJar)
    const b = await r.json().catch(() => ({}))
    return b.transaction?.id ?? b.id ?? null
  }

  const idA = await mk(1000, NOTE_A)
  const idB = await mk(2000, NOTE_B)
  const idC = await mk(3000, NOTE_C)
  if (!idA || !idB || !idC) throw new Error('สร้างรายการทดสอบไม่สำเร็จ')

  // ── P3-UI-01 · เจ้าของเห็นคิว ─────────────────────────────────────
  {
    const html = await page('/approvals', ownerJar)
    const want = [NOTE_A, NOTE_B, NOTE_C, sup1.full_name, 'ทดสอบคิวอนุมัติ โครงการก']
    const missing = want.filter((w) => !html.includes(w))
    check('P3-UI-01 คิวแสดงยอดเงิน ชื่อโครงการ คนคีย์ และรายละเอียดครบทุกรายการ',
      missing.length === 0 && html.includes('฿1,000'),
      missing.length ? `ขาด: ${missing.join(', ')}` : `${want.length}/${want.length} + ยอดเงิน`)
  }

  // ── P3-UI-02 · หัวหน้าโครงการเข้าหน้านี้ไม่ได้ ──────────────────────
  {
    const r = await fetch(`${BASE}/approvals`, { headers: { cookie: supJar }, redirect: 'manual' })
    const loc = r.headers.get('location') ?? ''
    // ฝั่งบวก: หน้าที่เขาเข้าได้ยังเข้าได้อยู่ ไม่ใช่เซสชันตายไปเฉย ๆ
    const ledger = await page('/ledger', supJar)
    check('P3-UI-02 หัวหน้าโครงการเปิด /approvals → ถูก redirect ออก · แต่ /ledger ยังเข้าได้',
      r.status === 307 && !loc.includes('/approvals') && ledger.includes(NOTE_A),
      `${r.status} → ${loc || '(ไม่มี location)'}`)
  }

  // ── P3-API-01 · หัวหน้าโครงการกดอนุมัติไม่ได้ ───────────────────────
  {
    const r = await req('PATCH', `/api/transactions/${idA}`, { action: 'approve' }, supJar)
    const b = await r.json().catch(() => ({}))
    const [{ status }] = (await sql(
      `select status from public.transactions where id = '${idA}'`)).rows
    check('P3-API-01 หัวหน้าโครงการยิง action=approve → 403 · แถวยัง pending',
      r.status === 403 && b.error === 'FORBIDDEN' && status === 'pending',
      `${r.status} ${b.error} · status=${status}`)
  }

  // ── P3-API-03 · ตีกลับโดยไม่บอกเหตุผล ────────────────────────────
  {
    const before = (await sql(
      `select count(*)::int n from public.notifications where txn_id = '${idC}'`)).rows[0].n
    const r = await req('PATCH', `/api/transactions/${idC}`, { action: 'reject' }, ownerJar)
    const b = await r.json().catch(() => ({}))
    const [row] = (await sql(
      `select status, rejected_reason from public.transactions where id = '${idC}'`)).rows
    const after = (await sql(
      `select count(*)::int n from public.notifications where txn_id = '${idC}'`)).rows[0].n
    check('P3-API-03 ตีกลับโดยไม่บอกเหตุผล → 400 REASON_REQUIRED · แถวไม่เปลี่ยน · ไม่มีแจ้งเตือนใหม่',
      r.status === 400 && b.error === 'REASON_REQUIRED'
      && row.status === 'pending' && row.rejected_reason === null && after === before,
      `${r.status} ${b.error} · status=${row.status} · แจ้งเตือน ${before}→${after}`)
  }

  // ── P3-API-02 · เจ้าของอนุมัติ ────────────────────────────────────
  {
    const before = (await sql(
      `select count(*)::int n from public.audit_log where row_id = '${idA}'`)).rows[0].n
    const r = await req('PATCH', `/api/transactions/${idA}`, { action: 'approve' }, ownerJar)
    const [row] = (await sql(
      `select status, approved_by, approved_at from public.transactions where id = '${idA}'`)).rows
    const after = (await sql(
      `select count(*)::int n from public.audit_log where row_id = '${idA}'`)).rows[0].n
    check('P3-API-02 เจ้าของอนุมัติ → 200 · approved_by เป็น id เจ้าของ · approved_at ไม่ว่าง · audit_log +1',
      r.status === 200 && row.status === 'approved' && row.approved_by === owner.id
      && Boolean(row.approved_at) && after === before + 1,
      `${r.status} · by=${row.approved_by === owner.id} · at=${Boolean(row.approved_at)} · audit +${after - before}`)
  }

  // ── P3-UI-04 · อนุมัติแล้วหายจากคิว และไปโผล่ที่รายการ ───────────
  {
    const queue = await page('/approvals', ownerJar)
    const ledger = await page('/ledger?status=approved', ownerJar)
    check('P3-UI-04 รายการที่อนุมัติแล้วหายจากคิว *และ* ไปโผล่ใน /ledger?status=approved',
      !queue.includes(NOTE_A) && queue.includes(NOTE_B) && ledger.includes(NOTE_A),
      `คิวยังมี A=${queue.includes(NOTE_A)} · คิวยังมี B=${queue.includes(NOTE_B)} · ledger มี A=${ledger.includes(NOTE_A)}`)
  }

  // ── P3-API-04 + P3-UI-06 · ตีกลับพร้อมเหตุผล ─────────────────────
  const REASON = 'สลิปเบลอ อ่านยอดไม่ออก'
  {
    const r = await req('PATCH', `/api/transactions/${idB}`, { action: 'reject', reason: REASON }, ownerJar)
    const [row] = (await sql(
      `select status, rejected_reason from public.transactions where id = '${idB}'`)).rows
    check('P3-API-04 ตีกลับพร้อมเหตุผล → 200 · status=rejected · เก็บเหตุผลตรงกับที่ส่งไป',
      r.status === 200 && row.status === 'rejected' && row.rejected_reason === REASON,
      `${r.status} · status=${row.status} · reason=${row.rejected_reason === REASON}`)

    const queue = await page('/approvals', ownerJar)
    const rejected = await page('/ledger?status=rejected', ownerJar)
    check('P3-UI-06 รายการที่ตีกลับหายจากคิว *และ* เหตุผลไปโผล่ที่ /ledger?status=rejected',
      !queue.includes(NOTE_B) && rejected.includes(NOTE_B) && rejected.includes(REASON),
      `คิวยังมี=${queue.includes(NOTE_B)} · ledger มีเหตุผล=${rejected.includes(REASON)}`)
  }
} finally {
  if (siteId) {
    await sql(`delete from public.transactions where site_id = '${siteId}'`)
    await sql(`delete from public.site_supervisors where site_id = '${siteId}'`)
    await sql(`delete from public.site_finance where site_id = '${siteId}'`)
    await sql(`delete from public.sites where id = '${siteId}'`)
  }
  console.log('  (ลบข้อมูลทดสอบแล้ว)')
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok === true).length
const skip = results.filter((r) => r.ok === 'skip').length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass - skip} · undecided ${skip}`)
process.exit(pass + skip === results.length ? 0 : 1)
