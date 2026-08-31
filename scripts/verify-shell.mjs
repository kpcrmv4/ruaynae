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

/** ตัดเอาเฉพาะ <nav data-nav="…"> … </nav> — อ่านค่าจากธาตุที่เป็นเจ้าของค่า
 *  ไม่ใช่จากทั้งหน้า · นับ <a> ทั้งหน้าจะได้ลิงก์ใน sidebar ปนกับลิงก์ในเนื้อหา */
function navBlock(html, name) {
  const open = html.indexOf(`<nav data-nav="${name}"`)
  if (open === -1) return null
  const close = html.indexOf('</nav>', open)
  return close === -1 ? null : html.slice(open, close)
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
// (9 = ภาพรวม · ไซต์งาน · รายรับ-รายจ่าย · คนเข้าไซต์ · ค่าแรงและรอบจ่าย · รออนุมัติ
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
  for (const [role, jar] of [['เจ้าของ', ownerJar], ['หัวหน้าไซต์', supJar]]) {
    const nav = navBlock(await page('/', jar), 'bottom')
    rows.push(`${role}:${Boolean(nav && nav.includes('เพิ่มเติม'))}`)
  }
  check('P0-UI-03a ช่องที่ 5 ของแถบล่างคือ "เพิ่มเติม" ทั้งสอง role',
    rows.every((r) => r.endsWith(':true')), rows.join(' · '))
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
