#!/usr/bin/env node
/**
 * verify-shell.mjs — ปิดครึ่งที่วัดได้จาก HTML ของแถว P0-UI-*
 *
 * แถว P0-UI-01/02/03 เดิมถูกติ๊กจากการวัดด้วย Chrome MCP ระหว่างเฟส P0
 * ซึ่ง `scripts/verify-matrix.mjs` จับได้ว่าไม่มีคำสั่งไหนรันแล้วแดงได้เลย
 * ไฟล์นี้เอาส่วนที่ **เซิร์ฟเวอร์เรนเดอร์แล้วตัดสินได้** กลับมาเป็นของจริง
 *
 * สิ่งที่ไฟล์นี้ตัดสิน **ไม่ได้** และยังต้องรอ Playwright ที่ P8:
 *   - `display:none` ตาม media query (เป็นผลของ CSS ไม่ใช่ของ HTML)
 *   - `scrollWidth <= innerWidth` (ต้องมี viewport จริง)
 *   - `aria-expanded` หลังกด (ต้องมีการโต้ตอบ)
 *   - ปุ่ม disabled ระหว่างส่ง และการกดซ้ำ
 * แถวพวกนั้นถูกลดเป็น 👤 ในตาราง ไม่ใช่ปล่อยติ๊กค้างไว้
 *
 * ท้ายไฟล์มีแถว **R5-NAV-*** — ป้ายตัวเลขของค้างบนเมนู ซึ่งเซิร์ฟเวอร์
 * เรนเดอร์มาในตัว HTML จึงตัดสินได้ที่นี่เหมือนกัน · fixture คืนค่าใน `finally`
 * และทุกตัวเลขวัด **เทียบกับค่าตั้งต้นของฐานที่รันอยู่** ไม่ใช่ล้างให้เหลือศูนย์ก่อนวัด
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

const login = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const jar = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  if (!jar) throw new Error(`ล็อกอินล้มเหลว ${path}: ${r.status}`)
  return jar
}

const page = async (path, cookie) =>
  (await fetch(`${BASE}${path}`, { headers: { cookie } })).text()

const sql = async (q) => {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    },
  )
  const text = await r.text()
  if (!r.ok) return { error: text, rows: [] }
  return { rows: JSON.parse(text) }
}

/** ตัดเอาเฉพาะ <nav data-nav="…"> … </nav> — อ่านค่าจากธาตุที่เป็นเจ้าของค่า
 *  ไม่ใช่จากทั้งหน้า · นับ <a> ทั้งหน้าจะได้ลิงก์ใน sidebar ปนกับลิงก์ในเนื้อหา */
function navBlock(html, name) {
  const open = html.indexOf(`<nav data-nav="${name}"`)
  if (open === -1) return null
  const close = html.indexOf('</nav>', open)
  return close === -1 ? null : html.slice(open, close)
}

/**
 * ป้ายตัวเลขของเมนูหนึ่ง — `null` = ไม่เจอเมนูนั้น · `0` = มีเมนูแต่ไม่มีป้าย
 *
 * 🔴 สองค่านี้ต้องแยกกัน · ถ้ายุบ "ไม่มีเมนู" กับ "ไม่มีป้าย" เป็นค่าเดียว
 * แถวที่เช็คว่า "ป้าย 0 ต้องไม่ถูกวาด" จะเขียวทั้งที่เมนูหายไปทั้งอัน
 */
function badgeOfHref(navHtml, href) {
  if (!navHtml) return null
  const part = navHtml.split('<a ').find((p) => p.includes(`href="${href}"`))
  if (!part) return null
  const m = /data-badge="(\d+)"/.exec(part)
  return m ? Number(m[1]) : 0
}

/** ป้ายบนปุ่ม "เพิ่มเติม" ของแถบล่าง (เป็น <button> ไม่ใช่ <a>) */
function moreBadge(navHtml) {
  if (!navHtml) return null
  const part = navHtml.split('<button').find((p) => p.includes('เพิ่มเติม'))
  if (!part) return null
  const m = /data-badge="(\d+)"/.exec(part)
  return m ? Number(m[1]) : 0
}

console.log(`\n── P0-UI · โครงหน้าจอที่วัดจาก HTML ได้ (${BASE}) ──────────`)

const ownerJar = await login('/api/auth/login', {
  email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD,
})
const supJar = await login('/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN })

// ── P0-UI-01 · sidebar ของเจ้าของมีลิงก์ 9 รายการ และมีรายการ active ────
// จำนวนเป็น **ตัวเลขที่พิมพ์ไว้** โดยตั้งใจ ไม่ใช่นับจาก `nav.ts`
// นับจากไฟล์เดียวกับที่แอปอ่าน = เอาโค้ดไปเทียบกับตัวเอง แล้วแถวนี้จะไม่มีวันแดงอีกเลย
// ต่อให้เมนูหายไปทั้งกลุ่ม · ตัวเลขที่ต้องมาแก้ตอนเพิ่มเมนูคือราคาที่ถูกกว่ามาก
// (9 = ภาพรวม · โครงการ · รายรับ-รายจ่าย · คนเข้าโครงการ · ค่าแรงและรอบจ่าย · รออนุมัติ
//  · ประวัติการแก้ไข · ตั้งค่า · เชื่อมต่อ AI — ตัวสุดท้ายเพิ่มมาในเฟส P9)
{
  const html = await page('/', ownerJar)
  const nav = navBlock(html, 'sidebar')
  const links = nav ? (nav.match(/<a\s/g) ?? []).length : -1
  // รายการที่ตรงกับ URL ปัจจุบันต้องมีคลาส active — ถ้าไม่มี คนจะไม่รู้ว่าอยู่หน้าไหน
  const hasActive = Boolean(nav && nav.includes('bg-sidebar-active-bg'))
  check('P0-UI-01 sidebar ของเจ้าของมีลิงก์ 9 รายการ และมีรายการที่ active',
    links === 9 && hasActive, `ลิงก์ ${links} · active ${hasActive}`)
}

// ── P0-UI-02a · แถบล่างมี 5 ช่อง · ช่องกลางไม่มีข้อความแต่มี aria-label ──
{
  const html = await page('/', ownerJar)
  const nav = navBlock(html, 'bottom')
  const slots = nav ? (nav.match(/<a\s|<button\s/g) ?? []).length : -1
  // ช่องกลางเป็นปุ่มไอคอนล้วน — มีข้อความกำกับเมื่อไหร่ ปุ่มยกจะกลายเป็นปุ่มธรรมดา
  // และคนที่ใช้โปรแกรมอ่านหน้าจอจะไม่รู้ว่ามันทำอะไรถ้าไม่มี aria-label
  const primary = nav ? /aria-label="[^"]+"/.exec(nav) : null
  check('P0-UI-02a แถบล่างมี 5 ช่อง · ช่องกลางมี aria-label ไม่ว่าง',
    slots === 5 && Boolean(primary), `ช่อง ${slots} · ${primary ? primary[0] : 'ไม่มี aria-label'}`)
}

// ── P0-UI-03a · ช่องที่ 5 คือ "เพิ่มเติม" ทั้งสอง role ──────────────────
{
  const rows = []
  for (const [role, jar] of [['เจ้าของ', ownerJar], ['หัวหน้าโครงการ', supJar]]) {
    const nav = navBlock(await page('/', jar), 'bottom')
    rows.push(`${role}:${Boolean(nav && nav.includes('เพิ่มเติม'))}`)
  }
  check('P0-UI-03a ช่องที่ 5 ของแถบล่างคือ "เพิ่มเติม" ทั้งสอง role',
    rows.every((r) => r.endsWith(':true')), rows.join(' · '))
}

// ══════════════════════════════════════════════════════════════════════
// R5-NAV · ตัวเลขของค้างบนเมนู
// ══════════════════════════════════════════════════════════════════════
console.log('\n── R5-NAV · ป้ายตัวเลขของค้างบนเมนู ────────────────────────')

// 🔴 วัดเทียบกับ **ค่าตั้งต้นของฐานที่รันอยู่** ไม่ใช่คาดว่าจะเป็น 0
// ฐานของลูกค้ามีของค้างอยู่แล้วได้ · สคริปต์ที่ล้างให้เหลือ 0 ก่อนวัด
// คือสคริปต์ที่ลบงานค้างจริงของเจ้าของทิ้ง (CLAUDE.md §17 ข้อ 14)
const base = (await sql(`select
    (select count(*)::int from public.transactions where status='pending')  as pending,
    (select count(*)::int from public.transactions where status='rejected') as rejected`)).rows[0]

const [sup1] = (await sql(
  `select id from public.profiles where full_name = '${env.SEED_SUPERVISOR1_NAME}'`)).rows
const [expCat] = (await sql(
  "select id from public.categories where kind='expense' order by sort_order limit 1")).rows
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

let navSite = null
try {
  ;[{ id: navSite }] = (await sql(
    "insert into public.sites(name) values ('ทดสอบ R5 ป้ายเมนู') returning id")).rows
  await sql(`insert into public.site_supervisors(site_id, profile_id, effective_from)
             values ('${navSite}','${sup1.id}', current_date - 1)`)
  const mk = (status, amount) => sql(
    `insert into public.transactions
       (kind, site_id, category_id, amount, txn_date, pay_method, status, created_by)
     values ('expense','${navSite}','${expCat.id}',${amount},'${today}','cash','${status}','${sup1.id}')`)
  await mk('pending', 101)
  await mk('pending', 102)
  await mk('rejected', 103)

  const ownerHtml = await page('/', ownerJar)
  const side = navBlock(ownerHtml, 'sidebar')
  const bar = navBlock(ownerHtml, 'bottom')

  // ── R5-NAV-01 · รออนุมัติ — เจ้าของ เห็นทั้งสองแถบ ──────────────────
  {
    const want = base.pending + 2
    check('R5-NAV-01 ป้าย "รออนุมัติ" ตรงกับจำนวนที่ค้างจริง ทั้ง sidebar และแถบล่าง',
      badgeOfHref(side, '/approvals') === want && badgeOfHref(bar, '/approvals') === want,
      `ต้องการ ${want} · sidebar ${badgeOfHref(side, '/approvals')} · แถบล่าง ${badgeOfHref(bar, '/approvals')}`)
  }

  // ── R5-NAV-02 · รายการที่ถูกตีกลับ — เมนูรายรับ-รายจ่าย ─────────────
  {
    const want = base.rejected + 1
    check('R5-NAV-02 ป้ายเมนู "รายรับ-รายจ่าย" = จำนวนรายการที่ถูกตีกลับและยังค้าง',
      badgeOfHref(side, '/ledger') === want && badgeOfHref(bar, '/ledger') === want,
      `ต้องการ ${want} · sidebar ${badgeOfHref(side, '/ledger')} · แถบล่าง ${badgeOfHref(bar, '/ledger')}`)
  }

  // ── R5-NAV-03 · ห้ามนับซ้ำ และห้ามวาดป้ายให้เมนูที่ไม่มีของค้าง ──────
  // เมนูที่อยู่บนแถบล่างแล้วต้องไม่ถูกรวมเข้าปุ่ม "เพิ่มเติม" อีกรอบ
  // (อาการของบั๊กนี้คือเลขเดียวกันโผล่สองที่ แล้วไม่มีใครรู้ว่าอันไหนจริง)
  {
    check('R5-NAV-03 เมนูที่อยู่บนแถบล่างแล้วไม่ถูกนับซ้ำที่ปุ่ม "เพิ่มเติม" · เมนูที่ไม่มีของค้างไม่มีป้าย',
      moreBadge(bar) === 0 && badgeOfHref(side, '/sites') === 0 && badgeOfHref(bar, '/sites') === null,
      `เพิ่มเติม ${moreBadge(bar)} · โครงการ(sidebar) ${badgeOfHref(side, '/sites')}`)
  }

  // ── R5-NAV-04 · หัวหน้าโครงการ ────────────────────────────────────────
  {
    const supBar = navBlock(await page('/', supJar), 'bottom')
    check('R5-NAV-04 หัวหน้าโครงการเห็นป้ายของที่ถูกตีกลับบนช่อง "รายการ" · ไม่มีช่องรออนุมัติให้ติดป้าย',
      badgeOfHref(supBar, '/ledger') >= 1 && badgeOfHref(supBar, '/approvals') === null,
      `รายการ ${badgeOfHref(supBar, '/ledger')} · รออนุมัติ ${badgeOfHref(supBar, '/approvals')}`)
  }
} finally {
  if (navSite) {
    await sql(`delete from public.transactions where site_id = '${navSite}'`)
    await sql(`delete from public.site_supervisors where site_id = '${navSite}'`)
    await sql(`delete from public.sites where id = '${navSite}'`)
  }
  console.log('  (ลบข้อมูลทดสอบแล้ว)')
}

// ── R5-NAV-05 · ป้ายต้องหายไปเมื่อของค้างหมด ───────────────────────────
// วัดหลังเก็บกวาดแล้ว — ป้ายต้องกลับไปเท่าค่าตั้งต้น และถ้าตั้งต้นเป็น 0
// ต้องไม่มี `data-badge` เลยสักตัว ไม่ใช่มีป้ายที่เขียนว่า 0
{
  const bar = navBlock(await page('/', ownerJar), 'bottom')
  const pending = badgeOfHref(bar, '/approvals')
  const rejected = badgeOfHref(bar, '/ledger')
  check('R5-NAV-05 ป้ายกลับไปเท่าค่าตั้งต้นหลังของค้างหมด · ค่า 0 ไม่ถูกวาดเป็นป้าย',
    pending === base.pending && rejected === base.rejected,
    `รออนุมัติ ${pending}/${base.pending} · ตีกลับ ${rejected}/${base.rejected}`)
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
