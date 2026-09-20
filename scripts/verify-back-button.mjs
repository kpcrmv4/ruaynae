#!/usr/bin/env node
/**
 * verify-back-button.mjs — ปุ่มย้อนกลับต้องขึ้น **ทุกหน้า** (คำสั่งเจ้าของ 20 ก.ย. 2569)
 *
 * 🔴 เช็คว่ามี `import` ในซอร์สไม่นับเป็นหลักฐาน — ไฟล์ที่ import แล้ววางปุ่มไว้
 * ในกิ่ง `if` ที่ไม่เคยเป็นจริงก็ผ่านการ grep ได้สบาย · ตรงนี้จึง **ขอ HTML จริง
 * จากเซิร์ฟเวอร์ทีละหน้า** แล้วนับปุ่มที่เรนเดอร์ออกมาจริง
 *
 * และต้องนับ **ทุกเส้นทางใต้ `(app)` จากโครงไฟล์** ไม่ใช่รายการที่พิมพ์มือไว้
 * ไม่งั้นหน้าที่เพิ่มวันหน้าจะไม่มีใครถาม
 *
 * 🔴 **รอบ 21 ก.ย. 2569 เจ้าของย้ำอีกครั้ง**: *"ปุ่มย้อนกลับทุกหน้า ให้อยู่แถว
 * เดียวกับชื่อหน้าด้านบนสุด โดยเอาปุ่มไว้ชิดขวาของจอเสมอ"* → เปลี่ยนสองอย่าง
 *   1. **หน้าแรกมีปุ่มด้วย** — ข้อยกเว้นเดิมอ้างว่า "ถอยจากรากคือออกจากเว็บ"
 *      ซึ่งไม่จริงตั้งแต่ `BackButton` เช็ค `history.state.idx` แล้ว (ไม่มีประวัติ
 *      = `push(fallbackHref)` ไม่ใช่ถอยออกนอกเว็บ) · เหตุผลเดิมหมดอายุไปก่อนแล้ว
 *   2. **ทุกหน้าต้องผ่าน `PageHeader`** ไม่ใช่ประกอบแถวหัวข้อเอง — ตำแหน่งปุ่มถึงจะ
 *      เหมือนกันทุกหน้าจริง · หน้าที่วาง `<BackButton />` เองผ่าน BACK-01 ได้สบาย
 *      แต่ปุ่มไปอยู่ใต้หัวข้อหรือปนกับปุ่มอื่น ซึ่งคืออาการที่เจ้าของแจ้งมาพอดี
 *
 * ⚠️ เส้นทางที่มี `[id]` ต้องใส่ **id ของชนิดที่ถูกต้อง** — เดิมยัด id ของโครงการ
 * ลงไปในทุกเส้นทางรวมถึง `/documents/[id]` ซึ่งได้หน้า "ไม่พบ" ที่ตอบ 200
 * (เพราะ `loading.tsx` ส่งหัวออกไปก่อน · §17 ข้อ 6) แล้วแถวนี้ก็ไปตรวจหน้านั้นแทน
 *
 * red-tested: 20 ก.ย. 2569 — ถอด `<BackButton />` ออกจาก `/audit` หนึ่งหน้า
 * แล้ว BACK-01 แดงพร้อมชี้ชื่อหน้าที่ขาด (`/audit (200 · 0 ปุ่ม)`) · ใส่กลับแล้วเขียว
 * · 21 ก.ย. 2569 — วาง `<BackButton />` ตรง ๆ กลับเข้า `/audit` แล้ว BACK-07 แดง
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:3200'
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

const jarOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

/** ทุก `page.tsx` ใต้ `(app)` → เส้นทางจริง (ตัด route group ที่อยู่ในวงเล็บทิ้ง) */
function routesUnder(dir, prefix = '') {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const seg = e.name.startsWith('(') ? '' : `/${e.name}`
      out.push(...routesUnder(join(dir, e.name), prefix + seg))
    } else if (e.name === 'page.tsx') {
      out.push(prefix === '' ? '/' : prefix)
    }
  }
  return out
}

console.log(`\n🔎 verify-back-button · ${BASE}`)

const ownerJar = jarOf(
  await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }),
  }),
)
if (!ownerJar) throw new Error('ล็อกอินไม่สำเร็จ — dev server รันอยู่ไหม')

const restId = async (table) =>
  fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, {
    headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` },
  }).then((r) => r.json()).then((j) => j?.[0]?.id ?? null).catch(() => null)

const [siteId, docId] = await Promise.all([restId('sites'), restId('documents')])

/** id ที่ถูกชนิดของเส้นทางนั้น — ไม่มีข้อมูลให้ทดสอบ = ข้ามอย่างเปิดเผย */
const idFor = (path) => (path.startsWith('/documents/') ? docId : siteId)

const skipped = []
const routes = routesUnder('src/app/(app)')
  .map((p) => {
    if (!p.includes('[id]')) return p
    const id = idFor(p)
    if (!id) { skipped.push(p); return null }
    return p.replace('[id]', id)
  })
  .filter(Boolean)

let checked = 0
const missing = []
const pages = new Map()
for (const path of routes) {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie: ownerJar } })
  const html = await r.text()
  pages.set(path, html)
  const hits = (html.match(/aria-label="ย้อนกลับ"/g) ?? []).length
  checked++
  if (r.status !== 200 || hits !== 1) missing.push(`${path} (${r.status} · ${hits} ปุ่ม)`)
}
check(
  `BACK-01 ทุกหน้าใต้ (app) **รวมหน้าแรก** มีปุ่มย้อนกลับหน้าละหนึ่งปุ่ม — ตรวจ ${checked} หน้า`,
  missing.length === 0,
  missing.length
    ? `ขาด/ผิด: ${missing.join(' · ')}`
    : `${checked}/${checked} หน้า${skipped.length ? ` · ข้าม ${skipped.join(' ')} (ยังไม่มีข้อมูลให้เปิด)` : ''}`,
)

// ── BACK-02 · ปุ่มอยู่ใน **แถวหัวข้อ** ไม่ใช่แถวถัดไป ────────────────────
// ตรวจลำดับในเอกสาร: ปุ่มต้องตามหลัง `<h1>` ตัวแรกของหน้า และต้องอยู่ก่อน
// เนื้อหาส่วนถัดไป · ตัวตัดสินเรื่อง **พิกัดบนจอ** คือ `BACK-08` ใน
// `verify-ui-browser` ซึ่งวัดขอบขวาจริงในเบราว์เซอร์ แถวนี้จับโครงสร้างที่ผิดชัด ๆ
{
  const bad = []
  for (const [path, html] of pages) {
    const h1 = html.indexOf('<h1')
    const btn = html.indexOf('aria-label="ย้อนกลับ"')
    if (h1 < 0) { bad.push(`${path} (ไม่มี h1)`); continue }
    if (btn < 0) { bad.push(`${path} (ไม่มีปุ่ม)`); continue }
    if (btn < h1) bad.push(`${path} (ปุ่มมาก่อนหัวข้อ)`)
  }
  check(
    `BACK-02 ทุกหน้ามี <h1> และปุ่มย้อนกลับตามหลังมันในแถวหัวข้อ — ตรวจ ${pages.size} หน้า`,
    bad.length === 0, bad.join(' · ') || `${pages.size}/${pages.size} หน้า`,
  )
}

// จอใหญ่เห็นคำว่า "ย้อนกลับ" · จอเล็กเหลือแต่ไอคอน — ตรวจที่คลาสที่ตัดสินเรื่องนี้จริง
{
  const html = pages.get('/payroll') ?? ''
  const i = html.indexOf('aria-label="ย้อนกลับ"')
  const block = i < 0 ? '' : html.slice(i, i + 400)
  check(
    'BACK-03 จอใหญ่มีไอคอน + คำว่า "ย้อนกลับ" · จอเล็กซ่อนเฉพาะคำ (hidden sm:inline)',
    /class="hidden sm:inline"[^>]*>ย้อนกลับ</.test(block) && /svg/.test(block),
    block ? 'พบทั้งไอคอนและคำที่ซ่อนตามขนาดจอ' : 'ไม่พบปุ่มในหน้า /payroll',
  )
}

// ── BACK-07 · ไม่มีหน้าไหนวาง <BackButton /> เอง ─────────────────────────
// 🔴 กฎ "อยู่แถวเดียวกับหัวข้อและชิดขวาเสมอ" จะอยู่ได้ก็ต่อเมื่อมี **ที่เดียว**
// ที่ตัดสินเรื่องนี้ · ไม่งั้นหน้าถัดไปที่ใครเขียนจะวางปุ่มไว้ตรงไหนก็ได้ แล้วผ่าน
// BACK-01 ได้เต็ม ๆ โดยที่ตำแหน่งบนจอไม่ตรงกับหน้าอื่นเลยสักหน้า
{
  const offenders = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name).replace(/\\/g, '/')
      if (e.isDirectory()) walk(full)
      else if (/\.tsx$/.test(e.name) && readFileSync(full, 'utf8').includes('<BackButton')) {
        offenders.push(full)
      }
    }
  }
  walk('src/app')
  walk('src/components')
  const ALLOWED = ['src/components/ui/page-header.tsx']
  const bad = offenders.filter((f) => !ALLOWED.includes(f))
  check(
    'BACK-07 มีที่เดียวที่วางปุ่มย้อนกลับคือ PageHeader — หน้าอื่นห้ามวางเอง',
    bad.length === 0, bad.join(' · ') || `ตรวจแล้ว มีแต่ ${ALLOWED[0]}`,
  )
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok === true).length
const skip = results.filter((r) => r.ok === 'skip').length
const fail = results.length - pass - skip
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ข้าม ${skip} · ตก ${fail}`)
process.exit(fail === 0 ? 0 : 1)
