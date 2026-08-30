#!/usr/bin/env node
/**
 * verify-p0-rest.mjs — ปิดแถว P0 ที่ค้าง `☐` มาตั้งแต่ต้นโครงการ
 *
 * แถวพวกนี้เขียนไว้ตอน P0 แล้วไม่เคยมีคำสั่งรองรับ — ซึ่งตามกฎของ
 * kp-acceptance-test-matrix แปลว่ามันไม่เคยถูกตรวจเลย ไม่ใช่ "ตรวจแล้วรอติ๊ก"
 *
 * ห้ามพิมพ์ค่าความลับลง stdout เด็ดขาด
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createHmac } from 'node:crypto'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const results = []
const check = (label, ok, detail = '') => {
  results.push({ ok })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}
const sh = (cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    return (e.stdout ?? '') + (e.stderr ?? '')
  }
}
/** ตัดคอมเมนต์ก่อน grep — กฎที่ถูก "ประโยคอธิบายกฎ" ทำให้ผ่าน คือกฎที่ไม่มีวันแดง */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*.*$/gm, '')

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)
const sql = async (query) => {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    },
  )
  const b = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`SQL ล้มเหลว: ${JSON.stringify(b)?.slice(0, 200)}`)
  return b
}
const files = (glob) => sh(`git ls-files ${glob}`).split('\n').filter(Boolean)

console.log('\n── P0 ที่ค้างอยู่ ──────────────────────────────────────────')

// ── P0-DB-13 · ทุกคอลัมน์ของ profiles ต้องมีโค้ดที่เขียนมันจริง ──────
// คอลัมน์ที่ schema มีแต่ไม่มีใครเขียน = ฟีเจอร์ที่ออกแบบไว้แล้วไม่ได้สร้าง
{
  const src = files('src').filter((f) => /\.tsx?$/.test(f))
    .map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n')
  const written = new Set(
    [...src.matchAll(/(?:insert|update|upsert)\(\s*\{([^}]*)\}/gs)]
      .flatMap((m) => [...m[1].matchAll(/(\w+)\s*:/g)].map((c) => c[1])),
  )
  // ตัวที่ผ่าน Admin API (createUser) นับด้วย — มันคือการเขียนเหมือนกัน
  const viaAdmin = /user_metadata|createUser|updateUserById/.test(src)
  const need = ['full_name', 'role', 'pin_hash', 'is_active']
  const missing = need.filter((c) => !written.has(c) && !(viaAdmin && c === 'role'))
  check('P0-DB-13 ทุกคอลัมน์ของ profiles มีโค้ดที่เขียนค่าลงไปจริง (ไม่ใช่คอลัมน์ที่ไม่มีใครใช้)',
    missing.length === 0, missing.length ? `ไม่มีใครเขียน: ${missing.join(', ')}` : need.join(' · '))
}

// ── P0-DB-15 · pin_hash ต้องใช้เป็นรหัสผ่านไม่ได้ ────────────────────
// 🔴 ถ้า pin_hash กับรหัสผ่านของ auth.users มาจากสูตรเดียวกัน ฐานข้อมูลที่รั่ว
// จะกลายเป็นรายการรหัสผ่านพร้อมใช้ — ผู้โจมตีไม่ต้องเดา PIN เลย
{
  const pin = env.SEED_SUPERVISOR1_PIN
  const rows = await sql(`
    select p.id, p.pin_hash, u.email
    from public.profiles p join auth.users u on u.id = p.id
    where p.pin_hash is not null and p.is_active limit 1`)
  const row = rows[0]

  if (!row || !pin) {
    check('P0-DB-15 pin_hash ใช้เป็นรหัสผ่านไม่ได้', false, 'ไม่มีบัญชี PIN ให้ทดสอบ')
  } else {
    const signIn = async (password) => {
      const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: row.email, password }),
      })
      return { ok: r.ok, body: await r.json().catch(() => ({})) }
    }

    // ค่าในคอลัมน์เอาไปล็อกอินตรง ๆ ต้องไม่ผ่าน
    const asPassword = await signIn(row.pin_hash)
    // แต่รหัสที่ derive จาก PIN ของคนเดียวกันต้องผ่าน — ไม่งั้นแถวนี้เขียว
    // เพราะ "ล็อกอินไม่ได้ทั้งคู่" ซึ่งไม่ได้พิสูจน์อะไรเลย
    // ใช้สูตรเดียวกับ src/lib/pin-core.ts — ถ้าเดาสูตรเอง แถวนี้จะแดงเพราะ
    // "ล็อกอินไม่ได้ทั้งคู่" ซึ่งไม่ได้พิสูจน์เรื่อง domain เลย
    const hmacHex = (domain) =>
      createHmac('sha256', env.PIN_PEPPER).update(`${domain}:${pin}`).digest('hex')
    const derived = 'pin_' + hmacHex('auth-password')
    const asDerived = await signIn(derived)

    const lookup = hmacHex('pin-lookup')
    const domainsDiffer = row.pin_hash !== derived && row.pin_hash === lookup

    check('P0-DB-15 pin_hash ใช้เป็นรหัสผ่านไม่ได้ · แต่รหัสที่ derive จาก PIN เดียวกันใช้ได้ (คนละ domain จริง)',
      !asPassword.ok && /Invalid login credentials/i.test(asPassword.body?.error_description ?? asPassword.body?.msg ?? '')
      && asDerived.ok && domainsDiffer,
      `เอาค่าในคอลัมน์ไปล็อกอิน=${asPassword.ok ? 'ผ่าน (อันตราย)' : 'ไม่ผ่าน'} · ` +
      `รหัสที่ derive จาก PIN=${asDerived.ok ? 'ผ่าน' : 'ไม่ผ่าน'} · คนละ domain=${domainsDiffer}`)
  }
}

// ── P0-AUTH-07 · บัญชีที่ถูกปิดใช้งานต้องล็อกอินไม่ได้ ───────────────
{
  const email = `disabled-${Date.now()}@e2e.local`
  const password = 'p0auth07-' + Math.random().toString(36).slice(2, 10)
  const admin = (path, init) =>
    fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin${path}`, {
      ...init,
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })

  let userId = null
  try {
    const made = await admin('/users', {
      method: 'POST',
      body: JSON.stringify({ email, password, email_confirm: true }),
    })
    const u = await made.json().catch(() => ({}))
    userId = u?.id ?? null

    if (!userId) {
      check('P0-AUTH-07 บัญชีที่ถูกปิดใช้งานล็อกอินไม่ได้', false, 'สร้างบัญชีทดสอบไม่สำเร็จ')
    } else {
      await sql(`update public.profiles set is_active = false, full_name = 'บัญชีทดสอบปิดใช้งาน'
                 where id = '${userId}'`)

      const r = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const b = await r.json().catch(() => ({}))
      const setCookie = r.headers.get('set-cookie') ?? ''

      check('P0-AUTH-07 บัญชีที่ถูกปิดใช้งานล็อกอินไม่ได้ — 403 ACCOUNT_DISABLED และไม่มีคุกกี้ session',
        r.status === 403 && b.error === 'ACCOUNT_DISABLED' && !/sb-[^=]*auth-token=/.test(setCookie),
        `${r.status} ${b.error ?? ''} · คุกกี้ session=${/sb-[^=]*auth-token=/.test(setCookie) ? 'มี (อันตราย)' : 'ไม่มี'}`)
    }
  } finally {
    // 🔴 คืนสภาพเสมอ — บัญชีทดสอบที่ค้างไว้จะไปโผล่ในหน้าผู้ใช้ระบบของจริง
    if (userId) await admin(`/users/${userId}`, { method: 'DELETE' })
  }
}

// ── P0-AUTH-12 · เปลี่ยนรหัสผ่านตัวเองต้องถามรหัสปัจจุบัน ────────────
{
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }),
  })
  const cookie = (login.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0]).join('; ')

  const post = (body) =>
    fetch(`${BASE}/api/auth/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify(body),
    })

  const noCurrent = await post({ newPassword: 'x'.repeat(12) })
  const nc = await noCurrent.json().catch(() => ({}))

  const wrongCurrent = await post({ currentPassword: 'ไม่ใช่รหัสจริงแน่ ๆ', newPassword: 'x'.repeat(12) })
  const wc = await wrongCurrent.json().catch(() => ({}))

  // ต้องยืนยันด้วยว่ารหัสเดิม **ยังใช้ได้อยู่** — ไม่งั้น "เปลี่ยนไม่สำเร็จ"
  // อาจแปลว่าเปลี่ยนไปแล้วเป็นค่าอื่นก็ได้
  const stillWorks = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }),
  })

  check('P0-AUTH-12 เปลี่ยนรหัสผ่านตัวเองต้องส่งรหัสปัจจุบัน — 400 CURRENT_PASSWORD_REQUIRED · รหัสผิด 401 · รหัสเดิมยังใช้ได้',
    noCurrent.status === 400 && nc.error === 'CURRENT_PASSWORD_REQUIRED'
    && wrongCurrent.status === 401 && wc.error === 'INVALID_CREDENTIALS'
    && stillWorks.ok,
    `ไม่ส่งรหัสเดิม=${noCurrent.status} ${nc.error ?? ''} · รหัสผิด=${wrongCurrent.status} ${wc.error ?? ''} · รหัสเดิมยังล็อกอินได้=${stillWorks.ok}`)
}

// ── P0-UI-09 / P0-UI-10 · ห้าม emoji · ห้าม alert() ─────────────────
{
  const tsx = files('src').filter((f) => f.endsWith('.tsx'))
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u
  const withEmoji = tsx.filter((f) => emojiRe.test(stripComments(readFileSync(f, 'utf8'))))
  check('P0-UI-09 ไม่มี emoji ในโค้ดที่เรนเดอร์ออกหน้าจอ (ใช้ lucide เท่านั้น)',
    withEmoji.length === 0, withEmoji.length ? withEmoji.join(', ') : `ตรวจ ${tsx.length} ไฟล์`)

  const withAlert = tsx.filter((f) => /\balert\s*\(/.test(stripComments(readFileSync(f, 'utf8'))))
  check('P0-UI-10 ไม่มี alert() — ใช้ sonner toast เท่านั้น',
    withAlert.length === 0, withAlert.length ? withAlert.join(', ') : `ตรวจ ${tsx.length} ไฟล์`)
}

// ── P0-SEC-03 · secret key ต้องไม่หลุดเข้าไฟล์ฝั่ง client ────────────
{
  const clientFiles = files('src').filter((f) => /\.tsx?$/.test(f))
    .filter((f) => /^['"]use client['"]/m.test(readFileSync(f, 'utf8')))
  const leaked = clientFiles.filter((f) =>
    /SUPABASE_SECRET|PIN_PEPPER|CRON_SECRET|VAPID_PRIVATE/.test(stripComments(readFileSync(f, 'utf8'))))
  check('P0-SEC-03 ไม่มีความลับฝั่งเซิร์ฟเวอร์ในไฟล์ที่มี "use client"',
    leaked.length === 0, leaked.length ? leaked.join(', ') : `ตรวจ ${clientFiles.length} ไฟล์ client`)
}

// ── P0-SEC-05 · ทุก Supabase call ต้อง destructure error ────────────
// 🔴 error ที่ไม่ถูกเช็คคือการเขียนที่เงียบหายไปโดยแอปรายงานว่าสำเร็จ
{
  const bad = []
  for (const f of files('src').filter((x) => /\.tsx?$/.test(x))) {
    const src = stripComments(readFileSync(f, 'utf8'))
    // จับ `const ... = await <อะไรก็ได้>.from(...)....` แล้วดูฝั่งซ้ายของ =
    for (const m of src.matchAll(/const\s+(\{[^}]*\}|\w+)\s*=\s*await\s+[^\n]*\.from\(/g)) {
      const lhs = m[1]
      if (!lhs.startsWith('{')) { bad.push(`${f}: รับผลเป็นตัวแปรเดียว`); continue }
      if (!/\berror\b/.test(lhs)) bad.push(`${f}: ${lhs.replace(/\s+/g, ' ').slice(0, 40)}`)
    }
  }
  check('P0-SEC-05 ทุกคำสั่ง .from() ที่ await ผลลัพธ์ destructure error ออกมาด้วย',
    bad.length === 0, bad.length ? bad.slice(0, 3).join(' · ') : 'ครบทุกที่')
}

const pass = results.filter((r) => r.ok).length
const fail = results.length - pass
console.log('\n══════════════════════════════════════════════')
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${fail}`)
process.exit(fail ? 1 : 0)
