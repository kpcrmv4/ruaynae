#!/usr/bin/env node
/**
 * verify-auth.mjs — ปิดแถว P0-AUTH-* และ P0-API-* ใน docs/test-plan/P0.md
 *
 * ต้องมี dev server รันอยู่ · ส่ง base URL เป็น argv[2] (ดีฟอลต์ 3100)
 *
 * กติกา: แถวปฏิเสธยืนยัน "รหัสเหตุผล" ไม่ใช่แค่ว่าไม่ 200
 * · แถวที่บอกว่า "ต้องไม่มีคุกกี้" ต้องคู่กับแถวที่พิสูจน์ว่ากรณีถูกต้อง**มี**คุกกี้
 *   ไม่งั้นแยกไม่ออกว่ากันได้จริง หรือ route ไม่เคยตั้งคุกกี้ให้ใครเลย
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

const post = (path, body, headers = {}) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
  })

/** มีคุกกี้ session ของ Supabase ถูกตั้งกลับมาไหม */
const hasAuthCookie = (r) =>
  (r.headers.getSetCookie?.() ?? []).some((c) => /^sb-[^=]*auth-token/.test(c))

console.log(`\n── P0-AUTH · ล็อกอิน (${BASE}) ─────────────────────────────`)

// P0-AUTH-01 · อีเมล+รหัสผ่านถูก → 200 + คุกกี้
{
  const r = await post('/api/auth/login', { email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD })
  const b = await r.json()
  check('P0-AUTH-01 อีเมล+รหัสผ่านถูก → 200 · role=owner · มีคุกกี้ session',
    r.status === 200 && b.role === 'owner' && hasAuthCookie(r),
    `${r.status} role=${b.role} cookie=${hasAuthCookie(r)}`)
}

// P0-AUTH-02 · รหัสผ่านผิด → 401 พร้อมรหัสเหตุผล และต้องไม่มีคุกกี้
{
  const r = await post('/api/auth/login', { email: env.SEED_OWNER_EMAIL, password: 'ผิดแน่นอน-x9' })
  const b = await r.json()
  check('P0-AUTH-02 รหัสผ่านผิด → 401 INVALID_CREDENTIALS · ไม่มีคุกกี้',
    r.status === 401 && b.error === 'INVALID_CREDENTIALS' && !hasAuthCookie(r),
    `${r.status} ${b.error} cookie=${hasAuthCookie(r)}`)
}

// P0-AUTH-03 · PIN ถูก → 200 + คุกกี้ + ไม่คืนอีเมลสังเคราะห์
{
  const r = await post('/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN })
  const raw = await r.text()
  const b = JSON.parse(raw)
  check('P0-AUTH-03 PIN ถูก → 200 · role=site_supervisor · มีคุกกี้',
    r.status === 200 && b.role === 'site_supervisor' && hasAuthCookie(r),
    `${r.status} role=${b.role} cookie=${hasAuthCookie(r)}`)
  check('P0-AUTH-03b ไม่คืนอีเมลสังเคราะห์กลับไปให้ client',
    !/@staff\.invalid/.test(raw), raw.slice(0, 80))
}

// P0-AUTH-06 · PIN สั้นเกิน → 400 (ตรวจก่อนแตะฐานข้อมูล)
{
  const r = await post('/api/auth/pin', { pin: '24681' })
  const b = await r.json()
  check('P0-AUTH-06 PIN ไม่ครบ 6 หลัก → 400 PIN_LENGTH',
    r.status === 400 && b.error === 'PIN_LENGTH', `${r.status} ${b.error}`)
}

// P0-AUTH-04 · PIN ผิด → 401 + ไม่มีคุกกี้
{
  const r = await post('/api/auth/pin', { pin: '000000' })
  const b = await r.json()
  check('P0-AUTH-04 PIN ผิด → 401 INVALID_PIN · ไม่มีคุกกี้',
    r.status === 401 && b.error === 'INVALID_PIN' && !hasAuthCookie(r),
    `${r.status} ${b.error} cookie=${hasAuthCookie(r)}`)
}

console.log('\n── P0-API · ขอบเขต endpoint ────────────────────────────────')

// P0-API-01 + P0-API-03 · /api/* ตอนไม่ล็อกอินต้องได้ JSON 401 ไม่ใช่ 307 ไปหน้า HTML
{
  const r = await post('/api/auth/logout', {})
  const ct = r.headers.get('content-type') ?? ''
  const b = await r.json().catch(() => ({}))
  check('P0-API-01/03 logout ตอนไม่ล็อกอิน → 401 JSON (ไม่ใช่ 307 ไป /login)',
    r.status === 401 && b.error === 'UNAUTHENTICATED' && ct.startsWith('application/json'),
    `${r.status} ${b.error} ${ct.split(';')[0]}`)
}

// P0-API-02 · method ที่ไม่รองรับ
{
  const r = await fetch(`${BASE}/api/auth/pin`, { method: 'GET', redirect: 'manual' })
  check('P0-API-02 GET /api/auth/pin → 405', r.status === 405, String(r.status))
}

// P0-API-06 · หน้าเว็บที่ต้องล็อกอิน → 307 ไป /login
{
  const r = await fetch(`${BASE}/`, { redirect: 'manual' })
  const loc = r.headers.get('location') ?? ''
  check('P0-API-06 GET / ตอนไม่ล็อกอิน → 307 ไป /login',
    r.status === 307 && loc.includes('/login'), `${r.status} → ${loc}`)
}

// P0-API-04/05 · sw.js กับ manifest ต้องไม่ถูก gate
// (ยังไม่มีไฟล์จริงจนถึง P7 — ที่ตรวจตอนนี้คือ "ไม่ใช่ 307" ซึ่งคือคุณสมบัติของ matcher)
for (const [id, path] of [['P0-API-04', '/sw.js'], ['P0-API-05', '/manifest.webmanifest']]) {
  const r = await fetch(`${BASE}${path}`, { redirect: 'manual' })
  check(`${id} ${path} ไม่ถูก redirect ไป /login`, r.status !== 307, `${r.status}`)
}

// P0-AUTH-08 + P0-API-07 · วงจรเต็ม: เข้า → /login เด้งกลับ → ออก → / เด้งไป /login
// ต้องยิงจาก node เพราะเบราว์เซอร์ปิดสถานะของ opaque redirect ไม่ให้ JS อ่าน
{
  const login = await post('/api/auth/login', {
    email: env.SEED_OWNER_EMAIL,
    password: env.SEED_OWNER_PASSWORD,
  })
  // เก็บเฉพาะ name=value ไม่เอา attribute ต่อท้าย
  const jar = (login.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ')

  const atLogin = await fetch(`${BASE}/login`, { redirect: 'manual', headers: { cookie: jar } })
  check('P0-API-07 ล็อกอินแล้วเปิด /login → 307 กลับ / (ไม่วนซ้ำ)',
    atLogin.status === 307 && new URL(atLogin.headers.get('location'), BASE).pathname === '/',
    `${atLogin.status} → ${atLogin.headers.get('location')}`)

  const out = await post('/api/auth/logout', {}, { cookie: jar })
  const outJar = (out.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const afterOut = await fetch(`${BASE}/`, { redirect: 'manual', headers: { cookie: outJar } })
  check('P0-AUTH-08 ออกจากระบบ → 200 · แล้วเปิด / ได้ 307 ไป /login',
    out.status === 200 && afterOut.status === 307 &&
      (afterOut.headers.get('location') ?? '').includes('/login'),
    `logout ${out.status} · / หลังออก ${afterOut.status} → ${afterOut.headers.get('location')}`)
}

// P0-AUTH-10/11 · สวิตช์ปุ่มเดโม่เป็น opt-in
// ตรวจได้ทีละขั้วต่อการรันหนึ่งครั้ง เพราะ Next อ่าน env ตอนสตาร์ตเซิร์ฟเวอร์
// อีกขั้วรันด้วย:  ENABLE_DEMO_LOGIN=0 npx next dev -p 3100
// (Next 16 ไม่ยอมให้มี dev server ตัวที่สองของโฟลเดอร์เดียวกัน จึงต้องสลับ ไม่ใช่เปิดคู่)
{
  const on = env.ENABLE_DEMO_LOGIN === '1'
  const r = await post('/api/auth/demo', {})
  const b = await r.json().catch(() => ({}))
  if (on) {
    check('P0-AUTH-11 เปิดสวิตช์ → POST /api/auth/demo = 200 · มีคุกกี้',
      r.status === 200 && hasAuthCookie(r), `${r.status} cookie=${hasAuthCookie(r)}`)
  } else {
    check('P0-AUTH-10 ไม่เปิดสวิตช์ → 404 (ไม่ใช่ 403 ซึ่งยืนยันว่า route มีอยู่) · ไม่มีคุกกี้',
      r.status === 404 && b.error === 'NOT_FOUND' && !hasAuthCookie(r),
      `${r.status} ${b.error} cookie=${hasAuthCookie(r)}`)
  }
}

// ── rate limit ต้องรันท้ายสุด เพราะมันทำให้ bucket 'pin' ถูกบล็อก 15 นาที ──
console.log('\n── P0-AUTH-05 · rate limit ─────────────────────────────────')
{
  const first = await post('/api/auth/pin', { pin: '111111' })
  if (first.status === 429) {
    // หน้าต่างจากรอบก่อนยังไม่รีเซ็ต — ตัดสินไม่ได้ว่า limiter ทำงานถูกหรือค้าง
    check('P0-AUTH-05 ยิง PIN ผิดซ้ำ ๆ แล้วโดน 429', 'skip', 'ครั้งแรกได้ 429 อยู่แล้ว — undecided')
  } else {
    let blockedAt = null
    for (let i = 2; i <= 8 && blockedAt === null; i++) {
      const r = await post('/api/auth/pin', { pin: String(100000 + i) })
      if (r.status === 429) blockedAt = i
    }
    check('P0-AUTH-05 ยิง PIN ผิดซ้ำ ๆ แล้วโดน 429 ภายใน 8 ครั้ง',
      blockedAt !== null && blockedAt <= 8, blockedAt ? `โดนบล็อกที่ครั้งที่ ${blockedAt}` : 'ไม่เคยโดนบล็อก')
  }
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok === true).length
const skip = results.filter((r) => r.ok === 'skip').length
const fail = results.filter((r) => r.ok === false).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${fail} · undecided ${skip}`)
process.exit(fail ? 1 : 0)
