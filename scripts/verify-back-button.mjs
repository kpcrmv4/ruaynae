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
 * red-tested: 20 ก.ย. 2569 — ถอด `<BackButton />` ออกจาก `/audit` หนึ่งหน้า
 * แล้ว BACK-01 แดงพร้อมชี้ชื่อหน้าที่ขาด (`/audit (200 · 0 ปุ่ม)`) · ใส่กลับแล้วเขียว
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
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
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

// หน้าที่มีพารามิเตอร์ต้องหยิบ id จริงมาใส่ ไม่งั้นได้ 404 แล้วเช็คหน้าที่ไม่มีอยู่
const siteId = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sites?select=id&limit=1`, {
  headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` },
}).then((r) => r.json()).then((j) => j?.[0]?.id ?? null)

const routes = routesUnder('src/app/(app)')
  .map((p) => (p.includes('[id]') ? (siteId ? p.replace('[id]', siteId) : null) : p))
  .filter(Boolean)

// 🔴 หน้าแรกเป็นรากของแอป — ถอยจากตรงนั้นคือ **ออกจากเว็บ** ไม่ใช่ย้อนกลับ
// จึงเป็นหน้าเดียวที่ตั้งใจไม่มีปุ่ม และแถวนี้ยืนยันว่ามันไม่มีจริง ๆ
const ROOT = '/'

let checked = 0
const missing = []
for (const path of routes) {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie: ownerJar } })
  const html = await r.text()
  const hits = (html.match(/aria-label="ย้อนกลับ"/g) ?? []).length
  if (path === ROOT) {
    check('BACK-02 หน้าแรกไม่มีปุ่มย้อนกลับ (ถอยจากรากคือออกจากเว็บ)', hits === 0, `${hits} ปุ่ม`)
    continue
  }
  checked++
  if (r.status !== 200 || hits !== 1) missing.push(`${path} (${r.status} · ${hits} ปุ่ม)`)
}
check(
  `BACK-01 ทุกหน้าใต้ (app) มีปุ่มย้อนกลับหน้าละหนึ่งปุ่ม — ตรวจ ${checked} หน้า`,
  missing.length === 0,
  missing.length ? `ขาด/ผิด: ${missing.join(' · ')}` : `${checked}/${checked} หน้า`,
)

// จอใหญ่เห็นคำว่า "ย้อนกลับ" · จอเล็กเหลือแต่ไอคอน — ตรวจที่คลาสที่ตัดสินเรื่องนี้จริง
{
  const html = await fetch(`${BASE}/payroll`, { headers: { cookie: ownerJar } }).then((r) => r.text())
  const i = html.indexOf('aria-label="ย้อนกลับ"')
  const block = i < 0 ? '' : html.slice(i, i + 400)
  check(
    'BACK-03 จอใหญ่มีไอคอน + คำว่า "ย้อนกลับ" · จอเล็กซ่อนเฉพาะคำ (hidden sm:inline)',
    /class="hidden sm:inline"[^>]*>ย้อนกลับ</.test(block) && /svg/.test(block),
    block ? 'พบทั้งไอคอนและคำที่ซ่อนตามขนาดจอ' : 'ไม่พบปุ่มในหน้า /payroll',
  )
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
