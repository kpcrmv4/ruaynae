#!/usr/bin/env node
/**
 * verify-rls.mjs — ปิดแถว P0-DB-01..10 ใน docs/test-plan/P0.md
 *
 * กติกาที่บังคับตัวเอง (kp-acceptance-test-matrix):
 *  - แถวปฏิเสธยืนยัน "เหตุผล" ไม่ใช่แค่ Boolean(error)
 *  - `0 แถว` ไม่เคยเป็นคำตอบเดียว — ต้องพิสูจน์ฝั่งบวกในคำสั่งเดียวกัน
 *    ไม่งั้นแยกไม่ออกว่า RLS กันจริง หรือแค่ไม่มีข้อมูลตั้งแต่แรก
 *  - fixture ที่แก้ ต้องคืนใน finally เสมอ ไม่ใช่หลัง check สุดท้าย
 */
import { readFileSync } from 'node:fs'
import { hashPin, derivePassword, syntheticEmail } from '../src/lib/pin-core.ts'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)
const URL = env.NEXT_PUBLIC_SUPABASE_URL
const PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const SECRET = env.SUPABASE_SECRET_KEY
const PEPPER = env.PIN_PEPPER

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

/** ยิง PostgREST ในนามใครสักคน · anon = ไม่ส่ง Authorization */
async function db(token, path, init = {}) {
  const headers = { apikey: token === 'anon' ? PUB : PUB, 'Content-Type': 'application/json', ...init.headers }
  if (token !== 'anon') headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${URL}/rest/v1${path}`, { ...init, headers })
  const text = await r.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: r.status, ok: r.ok, body, raw: text }
}
const asService = (path, init = {}) =>
  db(SECRET, path, { ...init, headers: { apikey: SECRET, ...init.headers } })

console.log('\n── เข้าสู่ระบบ ─────────────────────────────────────────────')
const ownerTok = await signIn(env.SEED_OWNER_EMAIL, env.SEED_OWNER_PASSWORD)
const supTok = await signIn(syntheticEmail('sup1'), derivePassword(PEPPER, env.SEED_SUPERVISOR1_PIN))
console.log('  owner และ supervisor1 ล็อกอินสำเร็จ')

const [ownerRow] = (await asService('/profiles?select=id,full_name&role=eq.owner')).body
const [sup1Row] = (await asService(`/profiles?select=id,full_name,pin_hash&full_name=eq.${encodeURIComponent(env.SEED_SUPERVISOR1_NAME)}`)).body
const [sup2Row] = (await asService(`/profiles?select=id,pin_hash&full_name=eq.${encodeURIComponent(env.SEED_SUPERVISOR2_NAME)}`)).body

console.log('\n── P0-DB · RLS และ audit ───────────────────────────────────')

// P0-DB-01 · การสร้าง profiles ต้องมีร่องรอยใน audit_log
// และทุกแถว INSERT ต้องเป็น site_supervisor — พิสูจน์ว่า handle_new_user
// ไม่เคยอ่าน role จาก metadata ที่ client ส่งมา ต่อให้บัญชีนั้นจะเป็นเจ้าของ
// การเลื่อนขั้นเกิดทีหลังด้วย secret key จึงต้องไปโผล่เป็นแถว UPDATE
{
  const ins = (await asService('/audit_log?select=after&table_name=eq.profiles&action=eq.INSERT')).body
  const allDefault = ins.length > 0 && ins.every((r) => r.after?.role === 'site_supervisor')
  const promoted = (await asService('/audit_log?select=before,after&table_name=eq.profiles&action=eq.UPDATE')).body
    .filter((r) => r.before?.role === 'site_supervisor' && r.after?.role === 'owner')
  check('P0-DB-01 audit INSERT ทุกแถวเป็น site_supervisor · การเลื่อนเป็น owner โผล่เป็น UPDATE',
    ins.length >= 3 && allDefault && promoted.length === 1,
    `INSERT ${ins.length} แถว ค่าเริ่มต้นถูกหมด: ${allDefault} · เลื่อนขั้น ${promoted.length} ครั้ง`)
}

// audit ต้องไม่เก็บ pin_hash
{
  const rows = (await asService('/audit_log?select=before,after&table_name=eq.profiles')).body
  const leaked = rows.filter((r) => 'pin_hash' in (r.after ?? {}) || 'pin_hash' in (r.before ?? {}))
  check('P0-DB-01b audit_log ไม่เก็บ pin_hash', leaked.length === 0,
    `รั่ว ${leaked.length} จาก ${rows.length} แถว`)
}

// P0-DB-02 · owner แก้ชื่อตัวเอง → audit UPDATE เพิ่ม
{
  const before = (await asService('/audit_log?select=id&action=eq.UPDATE')).body.length
  const orig = ownerRow.full_name
  try {
    const upd = await db(ownerTok, `/profiles?id=eq.${ownerRow.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ full_name: orig + ' (ทดสอบ)' }),
    })
    const after = (await asService('/audit_log?select=id&action=eq.UPDATE')).body.length
    check('P0-DB-02 owner แก้ชื่อตัวเองได้ และ audit UPDATE +1',
      upd.body?.length === 1 && after === before + 1, `แถวที่เขียน ${upd.body?.length} · audit ${before}→${after}`)
  } finally {
    await asService(`/profiles?id=eq.${ownerRow.id}`, {
      method: 'PATCH', body: JSON.stringify({ full_name: orig }),
    })
  }
}

// P0-DB-03 · supervisor เลื่อนขั้นตัวเองไม่ได้ และต้องได้ "เหตุผล" ไม่ใช่แค่ error
{
  const r = await db(supTok, `/profiles?id=eq.${sup1Row.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ role: 'owner' }),
  })
  const msg = JSON.stringify(r.body ?? '')
  const stillSup = (await asService(`/profiles?select=role&id=eq.${sup1Row.id}`)).body[0]?.role
  check('P0-DB-03 supervisor เลื่อนขั้นตัวเองไม่ได้ (ROLE_CHANGE_FORBIDDEN)',
    /ROLE_CHANGE_FORBIDDEN/.test(msg) && stillSup === 'site_supervisor',
    `role ยังเป็น ${stillSup}`)
}

// P0-DB-04 · supervisor เห็นเฉพาะแถวตัวเอง — ยืนยันทั้งสองฝั่งในครั้งเดียว
{
  const mine = await db(supTok, `/profiles?select=id&id=eq.${sup1Row.id}`)
  const others = await db(supTok, `/profiles?select=id&id=eq.${ownerRow.id}`)
  check('P0-DB-04 supervisor เห็นแถวตัวเอง 1 แถว และไม่เห็นของ owner',
    mine.body?.length === 1 && others.body?.length === 0,
    `ตัวเอง ${mine.body?.length} · ของ owner ${others.body?.length}`)
}

// P0-DB-05 · owner เห็นครบ
{
  const all = await db(ownerTok, '/profiles?select=id')
  check('P0-DB-05 owner เห็น profiles ครบ 3 แถว', all.body?.length === 3, `${all.body?.length} แถว`)
}

// P0-DB-06 · audit_log เห็นได้เฉพาะ owner
{
  const sup = await db(supTok, '/audit_log?select=id')
  const own = await db(ownerTok, '/audit_log?select=id')
  check('P0-DB-06 supervisor อ่าน audit_log ได้ 0 แถว แต่ owner ได้ > 0',
    sup.body?.length === 0 && own.body?.length > 0,
    `supervisor ${sup.body?.length} · owner ${own.body?.length}`)
}

// P0-DB-07/08 · audit_log แก้/ลบไม่ได้
// ⚠️ ไม่มี policy = PostgREST ตอบ "สำเร็จ" แต่โดน 0 แถว (การปฏิเสธเงียบ)
//    จึงต้องวัดที่จำนวนแถวที่ถูกกระทบ ไม่ใช่ที่ error
{
  const before = (await asService('/audit_log?select=id')).body.length
  const upd = await db(ownerTok, '/audit_log?id=gt.0', {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ action: 'HACKED' }),
  })
  const del = await db(ownerTok, '/audit_log?id=gt.0', {
    method: 'DELETE', headers: { Prefer: 'return=representation' },
  })
  const after = (await asService('/audit_log?select=id')).body.length
  const hacked = (await asService("/audit_log?select=id&action=eq.HACKED")).body.length
  check('P0-DB-07/08 owner แก้/ลบ audit_log ไม่ได้ (0 แถวถูกกระทบ · count เท่าเดิม)',
    (upd.body?.length ?? 0) === 0 && (del.body?.length ?? 0) === 0 && after === before && hacked === 0,
    `แก้ ${upd.body?.length ?? 0} · ลบ ${del.body?.length ?? 0} · count ${before}→${after}`)
}

// P0-DB-09 · anon ไม่เห็นอะไรเลย แต่ owner เห็น (ยืนยันสองฝั่ง)
{
  const anon = await db('anon', '/profiles?select=id')
  const own = await db(ownerTok, '/profiles?select=id')
  check('P0-DB-09 anon อ่าน profiles ได้ 0 แถว แต่ owner ได้ 3',
    (Array.isArray(anon.body) ? anon.body.length : -1) === 0 && own.body?.length === 3,
    `anon ${Array.isArray(anon.body) ? anon.body.length : anon.status} · owner ${own.body?.length}`)
}

// P0-DB-10 · PIN ซ้ำไม่ได้ (บังคับที่ฐานข้อมูล)
{
  const orig = sup2Row.pin_hash
  try {
    const r = await asService(`/profiles?id=eq.${sup2Row.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ pin_hash: sup1Row.pin_hash }),
    })
    const msg = JSON.stringify(r.body ?? '')
    const now = (await asService(`/profiles?select=pin_hash&id=eq.${sup2Row.id}`)).body[0]?.pin_hash
    check('P0-DB-10 ตั้ง PIN ซ้ำกับคนอื่นไม่ได้ (unique violation)',
      /duplicate key|profiles_pin_hash_key|23505/.test(msg) && now === orig,
      `pin_hash ไม่เปลี่ยน: ${now === orig}`)
  } finally {
    await asService(`/profiles?id=eq.${sup2Row.id}`, {
      method: 'PATCH', body: JSON.stringify({ pin_hash: orig }),
    })
  }
}

// P0-DB-17 · login_attempts เห็นได้เฉพาะ owner
{
  await asService('/login_attempts', {
    method: 'POST', body: JSON.stringify({ ip: '203.0.113.1', identifier: 'probe', kind: 'pin', ok: false }),
  })
  try {
    const sup = await db(supTok, '/login_attempts?select=id')
    const own = await db(ownerTok, '/login_attempts?select=id')
    check('P0-DB-17 supervisor อ่าน login_attempts ได้ 0 แต่ owner ได้ > 0',
      sup.body?.length === 0 && own.body?.length > 0,
      `supervisor ${sup.body?.length} · owner ${own.body?.length}`)
  } finally {
    await asService("/login_attempts?identifier=eq.probe", { method: 'DELETE' })
  }
}

// ── P0-DB-08 · ลบ audit_log ไม่ได้ (แต่ PostgREST ไม่บอกว่าล้มเหลว) ────
// 🔴 ไม่มี policy สำหรับ DELETE บนตารางนี้ แถวจึงมองไม่เห็นสำหรับคำสั่งลบ
// PostgREST ตอบว่าสำเร็จทั้งที่โดน 0 แถว — ต้องวัดที่จำนวนแถวที่เปลี่ยน
// ไม่ใช่ที่ status · ครึ่งบวก: ต้องมีแถวอยู่ก่อนจริง ไม่งั้น 0→0 ผ่านฟรี
{
  const countAudit = async () => {
    const r = await asService('/audit_log?select=id')
    return Array.isArray(r.body) ? r.body.length : -1
  }

  const before = await countAudit()
  const del = await db(ownerTok, '/audit_log?id=neq.00000000-0000-0000-0000-000000000000', {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  })
  const after = await countAudit()
  const removed = Array.isArray(del.body) ? del.body.length : 0
  check('P0-DB-08 เจ้าของลบ audit_log ไม่ได้ — โดน 0 แถว และจำนวนแถวเท่าเดิม',
    before > 0 && removed === 0 && after === before,
    `แถวที่ถูกลบ ${removed} · ${before}→${after}`)
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
