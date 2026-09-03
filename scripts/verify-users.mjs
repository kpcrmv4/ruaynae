#!/usr/bin/env node
/**
 * verify-users.mjs — ปิดแถว P05-USER-* (จัดการผู้ใช้ระบบ)
 *
 * แถวที่สำคัญที่สุดคือ "ตั้ง PIN ใหม่แล้วล็อกอินได้จริง" — PIN ถูกเก็บสองที่
 * (hash ในตาราง + รหัสผ่านของ auth.users) เขียนที่เดียวจะได้ PIN ที่หน้าจอ
 * บอกว่าตั้งแล้ว แต่กดเข้าไม่ได้ และไม่มี error บอกว่าเพราะอะไร
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

const req = (method, path, body, headers = {}) =>
  fetch(`${BASE}${path}`, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const jarOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

const sql = async (q) => {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    },
  )
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

console.log('\n── P05-USER · จัดการผู้ใช้ระบบ ─────────────────────────────')

// สิทธิ์
{
  const r = await req('POST', '/api/settings/users', { fullName: 'x' })
  check('P05-USER-01 ยังไม่ล็อกอิน → 401 JSON', r.status === 401, `${r.status}`)
}

const ownerJar = jarOf(
  await req('POST', '/api/auth/login', {
    email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD,
  }),
)
const supJar = jarOf(await req('POST', '/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN }))

{
  const r = await req('POST', '/api/settings/users',
    { fullName: 'ไม่ควรสร้างได้', role: 'site_supervisor', pin: '111222' }, { cookie: supJar })
  const b = await r.json().catch(() => ({}))
  const { 0: row } = await sql('select count(*)::int as n from public.profiles')
  check('P05-USER-02 หัวหน้าโครงการสร้างผู้ใช้ → 403 FORBIDDEN · ไม่มีแถวเพิ่ม',
    r.status === 403 && b.error === 'FORBIDDEN' && row.n === 3,
    `${r.status} ${b.error} · profiles ${row.n} แถว`)
}

let ownerId = null
{
  // หน้ารายชื่อเป็น Server Component — ตรวจที่ HTML ที่เซิร์ฟเวอร์ส่งออกมา
  const page = await (await fetch(`${BASE}/settings/users`, { headers: { cookie: ownerJar } })).text()
  const [{ id }] = await sql("select id from public.profiles where role = 'owner' limit 1")
  ownerId = id
  const names = ['เจ้าของกิจการ', env.SEED_SUPERVISOR1_NAME, env.SEED_SUPERVISOR2_NAME]
  check('P05-USER-03 หน้ารายชื่อผู้ใช้แสดงครบทั้ง 3 คน',
    names.every((n) => page.includes(n)),
    names.map((n) => `${n}=${page.includes(n)}`).join(' · '))
}

// PIN ซ้ำต้องถูกปฏิเสธพร้อมเหตุผล
{
  const r = await req('POST', '/api/settings/users',
    { fullName: 'ทดสอบ PIN ซ้ำ', role: 'site_supervisor', pin: env.SEED_SUPERVISOR1_PIN },
    { cookie: ownerJar })
  const b = await r.json().catch(() => ({}))
  const { 0: row } = await sql("select count(*)::int as n from public.profiles")
  check('P05-USER-04 สร้างผู้ใช้ด้วย PIN ที่มีคนใช้แล้ว → 409 PIN_TAKEN · ไม่มีแถวเพิ่ม',
    r.status === 409 && b.error === 'PIN_TAKEN' && row.n === 3,
    `${r.status} ${b.error} · profiles ${row.n} แถว`)
}

// รหัสผ่านสั้นเกินสำหรับบัญชีเจ้าของ
{
  const r = await req('POST', '/api/settings/users',
    { fullName: 'ทดสอบรหัสสั้น', role: 'owner', email: 'x@example.com', password: '123456' },
    { cookie: ownerJar })
  const b = await r.json().catch(() => ({}))
  check('P05-USER-05 สร้างเจ้าของด้วยรหัสสั้นกว่า 8 ตัว → 400 PASSWORD_TOO_SHORT',
    r.status === 400 && b.error === 'PASSWORD_TOO_SHORT', `${r.status} ${b.error}`)
}

// กันล็อกตัวเองออก
{
  const r = await req('PATCH', `/api/settings/users/${ownerId}`, { isActive: false }, { cookie: ownerJar })
  const b = await r.json().catch(() => ({}))
  const { 0: still } = await sql(`select is_active from public.profiles where id = '${ownerId}'`)
  check('P05-USER-06 เจ้าของปิดบัญชีตัวเอง → 409 SELF_DEACTIVATE_FORBIDDEN · ยังเปิดอยู่',
    r.status === 409 && b.error === 'SELF_DEACTIVATE_FORBIDDEN' && still.is_active === true,
    `${r.status} ${b.error} · is_active=${still.is_active}`)
}

// สร้างผู้ใช้ใหม่ แล้วพิสูจน์ว่า PIN ใช้ล็อกอินได้จริง
let newId = null
const NEW_PIN = '975310'
const RESET_PIN = '864209'
try {
  {
    const r = await req('POST', '/api/settings/users',
      { fullName: 'ทดสอบ สร้างใหม่', role: 'site_supervisor', pin: NEW_PIN },
      { cookie: ownerJar })
    const b = await r.json().catch(() => ({}))
    newId = b.user?.id ?? null
    check('P05-USER-07 สร้างหัวหน้าโครงการใหม่ → 201 · role ถูก · เปิดใช้งาน',
      r.status === 201 && b.user?.role === 'site_supervisor' && b.user?.is_active === true,
      `${r.status} ${b.user?.role}`)
  }

  {
    const r = await req('POST', '/api/auth/pin', { pin: NEW_PIN })
    const b = await r.json().catch(() => ({}))
    check('P05-USER-08 PIN ที่เพิ่งตั้งล็อกอินได้จริง (เขียนครบทั้ง hash และรหัสผ่าน auth)',
      r.status === 200 && b.role === 'site_supervisor', `${r.status} ${b.error ?? b.role}`)
  }

  // ตั้ง PIN ใหม่ → ของเดิมต้องใช้ไม่ได้ ของใหม่ต้องใช้ได้ (ทั้งสองฝั่ง)
  {
    const r = await req('PATCH', `/api/settings/users/${newId}`, { pin: RESET_PIN }, { cookie: ownerJar })
    check('P05-USER-09 ตั้ง PIN ใหม่ให้คนอื่น → 200', r.status === 200, `${r.status}`)

    const old = await req('POST', '/api/auth/pin', { pin: NEW_PIN })
    const neu = await req('POST', '/api/auth/pin', { pin: RESET_PIN })
    const nb = await neu.json().catch(() => ({}))
    check('P05-USER-10 PIN เดิมใช้ไม่ได้แล้ว และ PIN ใหม่ใช้ได้',
      old.status === 401 && neu.status === 200 && nb.role === 'site_supervisor',
      `เดิม ${old.status} · ใหม่ ${neu.status}`)
  }

  // ปิดบัญชีคนอื่นได้ และคนนั้นล็อกอินไม่ได้อีก
  {
    const r = await req('PATCH', `/api/settings/users/${newId}`, { isActive: false }, { cookie: ownerJar })
    const login = await req('POST', '/api/auth/pin', { pin: RESET_PIN })
    const lb = await login.json().catch(() => ({}))
    check('P05-USER-11 ปิดบัญชีคนอื่นได้ → คนนั้นล็อกอินไม่ได้ (403 ACCOUNT_DISABLED)',
      r.status === 200 && login.status === 403 && lb.error === 'ACCOUNT_DISABLED',
      `ปิด ${r.status} · ล็อกอิน ${login.status} ${lb.error}`)
  }
} finally {
  if (newId) {
    await sql(`delete from public.profiles where id = '${newId}'`).catch(() => {})
    await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${newId}`, {
      method: 'DELETE',
      headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` },
    }).catch(() => {})
    console.log('  (ลบผู้ใช้ทดสอบแล้ว)')
  }
}

// เจ้าของคนสุดท้ายลดขั้นตัวเองไม่ได้ (ตอนนี้มีเจ้าของคนเดียว)
{
  const r = await req('PATCH', `/api/settings/users/${ownerId}`, { role: 'site_supervisor' }, { cookie: ownerJar })
  const b = await r.json().catch(() => ({}))
  const { 0: still } = await sql(`select role from public.profiles where id = '${ownerId}'`)
  check('P05-USER-12 ลดขั้นเจ้าของคนสุดท้าย → 409 LAST_OWNER_FORBIDDEN · role ไม่เปลี่ยน',
    r.status === 409 && b.error === 'LAST_OWNER_FORBIDDEN' && still.role === 'owner',
    `${r.status} ${b.error} · role=${still.role}`)
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
