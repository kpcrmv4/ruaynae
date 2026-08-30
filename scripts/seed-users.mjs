#!/usr/bin/env node
/**
 * seed-users.mjs — สร้างบัญชีทดสอบจากค่าใน .env.local
 *
 * ทำไมเป็นสคริปต์ node ไม่ใช่ migration SQL:
 * รหัสผ่านของบัญชี PIN ถูก derive จาก PIN + PIN_PEPPER ซึ่ง Postgres ไม่รู้จัก
 * pepper — migration จึงสร้างบัญชีที่ล็อกอินได้จริงไม่ได้เลย
 * และการฝังรหัสผ่านลง SQL แล้ว commit = รหัสติดอยู่ในประวัติ git ตลอดไป
 *
 * idempotent: รันซ้ำได้ · ไม่พิมพ์ค่าความลับออก stdout
 */
import { readFileSync } from 'node:fs'
import { hashPin, derivePassword, syntheticEmail, isValidPin } from '../src/lib/pin-core.ts'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)

const URL = env.NEXT_PUBLIC_SUPABASE_URL
const SECRET = env.SUPABASE_SECRET_KEY
const PEPPER = env.PIN_PEPPER
for (const [k, v] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: URL, SUPABASE_SECRET_KEY: SECRET, PIN_PEPPER: PEPPER }))
  if (!v) throw new Error(`.env.local ขาด ${k}`)

const h = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' }

const admin = async (path, init = {}) => {
  const r = await fetch(`${URL}/auth/v1${path}`, { ...init, headers: { ...h, ...init.headers } })
  const t = await r.text()
  return { ok: r.ok, status: r.status, body: t ? JSON.parse(t) : null }
}
const rest = async (path, init = {}) => {
  const r = await fetch(`${URL}/rest/v1${path}`, { ...init, headers: { ...h, ...init.headers } })
  const t = await r.text()
  if (!r.ok) throw new Error(`REST ${r.status} ${path}: ${t.slice(0, 300)}`)
  return t ? JSON.parse(t) : null
}

/** หา user จากอีเมล (Admin API ไม่มี get-by-email ตรง ๆ ต้องไล่หน้า) */
async function findUserByEmail(email) {
  for (let page = 1; page <= 10; page++) {
    const { body } = await admin(`/admin/users?page=${page}&per_page=200`)
    const users = body?.users ?? []
    const hit = users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (hit) return hit
    if (users.length < 200) return null
  }
  return null
}

async function upsertUser({ email, password, fullName, role, pin }) {
  let user = await findUserByEmail(email)

  if (!user) {
    const { ok, status, body } = await admin('/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password, email_confirm: true }),
    })
    if (!ok) throw new Error(`สร้างผู้ใช้ไม่สำเร็จ (${status}): ${JSON.stringify(body).slice(0, 200)}`)
    user = body
    console.log(`  สร้างใหม่  ${fullName}`)
  } else {
    // รันซ้ำ: sync รหัสผ่านให้ตรงกับ env เสมอ ไม่งั้นเปลี่ยน PIN ใน env แล้ว
    // ล็อกอินไม่ได้ โดยไม่มีอะไรบอกว่าเพราะอะไร
    const { ok, status, body } = await admin(`/admin/users/${user.id}`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    })
    if (!ok) throw new Error(`อัปเดตรหัสผ่านไม่สำเร็จ (${status}): ${JSON.stringify(body).slice(0, 200)}`)
    console.log(`  มีอยู่แล้ว ${fullName} (sync รหัสผ่าน)`)
  }

  // trigger handle_new_user สร้างแถว profiles ให้แล้วโดยตั้ง role เป็น
  // site_supervisor เสมอ · การเลื่อนเป็น owner ทำได้เฉพาะ secret key ตรงนี้
  const payload = { full_name: fullName, role, is_active: true }
  if (pin !== undefined) payload.pin_hash = pin === null ? null : hashPin(PEPPER, pin)

  const rows = await rest(`/profiles?id=eq.${user.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  })
  // 🔴 อ่านผลกลับมาเสมอ — RLS/policy ที่ปฏิเสธจะ match 0 แถวโดยไม่มี error
  if (!rows?.length) throw new Error(`อัปเดต profiles ไม่โดนสักแถว (${fullName}) — เช็ค policy`)
  return { id: user.id, profile: rows[0] }
}

const supervisors = [1, 2]
  .map((n) => ({
    name: env[`SEED_SUPERVISOR${n}_NAME`],
    pin: env[`SEED_SUPERVISOR${n}_PIN`],
    code: `sup${n}`,
  }))
  .filter((s) => s.name && s.pin)

for (const s of supervisors) {
  if (!isValidPin(s.pin)) throw new Error(`PIN ของ ${s.name} ไม่ใช่ตัวเลข 6 หลัก`)
}
const pins = new Set(supervisors.map((s) => s.pin))
if (pins.size !== supervisors.length) throw new Error('PIN ใน .env.local ซ้ำกัน — คนละคนต้องคนละ PIN')

console.log('\nseed ผู้ใช้:')
const owner = await upsertUser({
  email: env.SEED_OWNER_EMAIL,
  password: env.SEED_OWNER_PASSWORD,
  fullName: 'เจ้าของกิจการ',
  role: 'owner',
  pin: null,
})

const made = []
for (const s of supervisors) {
  made.push(
    await upsertUser({
      email: syntheticEmail(s.code),
      password: derivePassword(PEPPER, s.pin),
      fullName: s.name,
      role: 'site_supervisor',
      pin: s.pin,
    }),
  )
}

const counts = await rest('/profiles?select=role')
const byRole = counts.reduce((a, r) => ({ ...a, [r.role]: (a[r.role] ?? 0) + 1 }), {})
console.log(`\nรวม: profiles ${counts.length} แถว · ${JSON.stringify(byRole)}`)
console.log(`owner id: ${owner.id}`)
console.log(`supervisor ids: ${made.map((m) => m.id).join(', ')}`)
