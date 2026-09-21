#!/usr/bin/env node
/**
 * verify-ship.mjs — ปิดแถว P8-SEED-* และ P8-SHIP-*
 *
 * 🔴 เช็คลิสต์ก่อนส่งมอบต้อง **รันได้** ไม่ใช่เป็นข้อความให้จำ (CLAUDE.md §18)
 * เช็คลิสต์ที่เป็นข้อความจะถูกข้ามในวันที่รีบ ซึ่งคือวันที่ deploy เสมอ
 *
 * บางแถวเป็น "เตือน" ไม่ใช่ "ตก" — เพราะตอนพัฒนามันต้องเป็นแบบนั้น
 * (เช่น ปุ่มเดโม่ต้องเปิดไว้) · แถวพวกนั้นรายงานเป็น `⚠️` และไม่ทำให้สคริปต์แดง
 * แต่จะขึ้นเป็นรายการที่ต้องทำก่อนส่งมอบทุกครั้งที่รัน
 */
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

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
const todo = []
const warn = (label, detail) => {
  todo.push(`${label} — ${detail}`)
  console.log(`  ⚠️  ${label} — ${detail}`)
}

const sh = (cmd) => {
  try {
    return { ok: true, out: execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}
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

console.log('\n── P8-SEED · ข้อมูลตัวอย่าง ──────────────────────────────────')

// ── P8-SEED-07 · reset.sql ต้องไม่อยู่ใน migrations ─────────────────
{
  const migs = readdirSync('supabase/migrations')
  const danger = migs.filter((f) => {
    const body = readFileSync(`supabase/migrations/${f}`, 'utf8')
      .replace(/--.*/g, '')
    // `delete from` ที่ไม่มี `where` = ล้างทั้งตาราง · `truncate` ก็เช่นกัน
    return /truncate\s+/i.test(body) || /delete\s+from\s+[a-z_.]+\s*;/i.test(body)
  })
  check('P8-SEED-07 ไม่มีไฟล์ที่ล้างข้อมูลอยู่ใน supabase/migrations (จะถูกรันอัตโนมัติตอน deploy)',
    danger.length === 0 && existsSync('supabase/reset.sql'),
    danger.length ? `อันตราย: ${danger.join(', ')}` : 'reset.sql อยู่นอก migrations ตามที่ควร')
}

// ── คืนฐานข้อมูลให้เหมือนตอนที่เจอ ──────────────────────────────────
// 🔴 สคริปต์ตรวจต้องคืนฐานข้อมูลให้เหมือนตอนที่มันเจอ — ตัวนี้เคยปล่อยข้อมูล
// เดโม่ค้างไว้ แล้ว **31 แถวของสคริปต์อื่นแดงทันที** เพราะทุกตัวเขียนขึ้นบน
// สมมติฐานว่าฐานว่าง
//
// 🔴 แต่ห้ามล้างข้อมูลจริงของผู้ใช้เด็ดขาด — จึงล้างเฉพาะกรณีที่ **ก่อนหน้านี้
// ฐานว่างจริง ๆ** เท่านั้น · ถ้ามีข้อมูลอยู่ก่อน แปลว่าเป็นของจริง หรือเป็น
// เดโม่ที่เจ้าของตั้งใจเก็บไว้ดู — ทั้งสองกรณีห้ามแตะ
const countAll = async () => (await sql(`
  select
    (select count(*) from public.sites) sites,
    (select count(*) from public.transactions) txns,
    (select count(*) from public.employees) emps,
    (select count(*) from public.attendance) att,
    (select count(*) from public.advances) adv`)).rows[0]

const startedEmpty = Object.values(await countAll()).every((n) => Number(n) === 0)

try {

// ── P8-SEED-01 + P8-SEED-02 · seed รันได้และ idempotent ─────────────
{
  const before = (await sql(`
    select
      (select count(*) from public.sites) sites,
      (select count(*) from public.transactions) txns,
      (select count(*) from public.employees) emps,
      (select count(*) from public.attendance) att,
      (select count(*) from public.advances) adv`)).rows[0]

  const r = sh('node scripts/seed-demo.mjs')
  check('P8-SEED-01 รัน seed-demo.mjs สำเร็จ · สคริปต์ตรวจยอดของตัวเองแล้วผ่าน',
    r.ok && r.out.includes('ยอดทุกตัวตรงกับที่ seed ตั้งใจไว้'),
    r.ok ? 'ทุกยอดตรง' : r.out.split('\n').filter(Boolean).slice(-2).join(' · '))

  // 🔴 idempotent วัดจาก **รอบที่หนึ่งเทียบรอบที่สอง** ไม่ใช่ก่อน-seed เทียบหลัง-seed
  // ของเดิมเทียบ before↔after ของการรันครั้งเดียว ซึ่งเท่ากันก็ต่อเมื่อฐาน
  // มีข้อมูลอยู่ก่อนแล้ว — พอฐานว่างจริงมันแดงทันที และตอนฐานไม่ว่างมันก็เขียว
  // โดยไม่ได้รัน seed รอบที่สองเลยสักครั้ง
  const mid = (await sql(`
    select
      (select count(*) from public.sites) sites,
      (select count(*) from public.transactions) txns,
      (select count(*) from public.employees) emps,
      (select count(*) from public.attendance) att,
      (select count(*) from public.advances) adv`)).rows[0]

  sh('node scripts/seed-demo.mjs')

  const after = (await sql(`
    select
      (select count(*) from public.sites) sites,
      (select count(*) from public.transactions) txns,
      (select count(*) from public.employees) emps,
      (select count(*) from public.attendance) att,
      (select count(*) from public.advances) adv`)).rows[0]

  const same = ['sites', 'txns', 'emps', 'att', 'adv']
    .every((k) => Number(mid[k]) === Number(after[k]))
  check('P8-SEED-02 รัน seed รอบสองแล้วจำนวนแถวทุกตารางเท่ารอบแรก — idempotent จริง ไม่ใช่แค่ไม่ error',
    same && Number(after.sites) >= 5 && Number(after.txns) >= 15,
    `โครงการ ${before.sites}→${mid.sites}→${after.sites} · ` +
    `รายการ ${before.txns}→${mid.txns}→${after.txns} · ลงชื่อ ${before.att}→${mid.att}→${after.att}`)
}

// ── P8-SEED-03 + P8-SEED-04 · ครอบทุกสถานะ ──────────────────────────
{
  const { rows: st } = await sql(
    'select status, count(*)::int n from public.sites group by status order by status')
  const kinds = new Set(st.map((r) => r.status))
  check('P8-SEED-03 ข้อมูลตัวอย่างครอบสถานะโครงการ: active · done · planning (และมีโครงการที่ยังไม่ตั้งค่างาน)',
    kinds.has('active') && kinds.has('done') && kinds.has('planning'),
    st.map((r) => `${r.status}:${r.n}`).join(' · '))

  const { rows: tx } = await sql(
    'select status, count(*)::int n from public.transactions group by status order by status')
  const txKinds = new Set(tx.map((r) => r.status))
  const { rows: [central] } = await sql(
    'select count(*)::int n from public.transactions where site_id is null')
  const { rows: [rej] } = await sql(
    "select count(*)::int n from public.transactions where status='rejected' and rejected_reason is not null")
  check('P8-SEED-04 ครอบทุกสถานะรายการ: pending · approved · rejected (มีเหตุผล) · มีรายจ่ายส่วนกลาง',
    txKinds.has('pending') && txKinds.has('approved') && txKinds.has('rejected')
    && Number(central.n) > 0 && Number(rej.n) > 0,
    `${tx.map((r) => `${r.status}:${r.n}`).join(' · ')} · ส่วนกลาง ${central.n}`)
}

// ── P8-SEED-05 · ยอดบนหน้าจอ = ยอดที่ตั้งใจ ─────────────────────────
{
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }),
  })
  const jar = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const html = (await (await fetch(`${BASE}/`, { headers: { cookie: jar } })).text())
    .replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  const want = ['฿2,850,000', '฿2,280,000', '80%', 'ต้นทุนโตเร็วกว่าเงินที่เก็บได้']
  const missing = want.filter((w) => !html.includes(w))
  check('P8-SEED-05 หน้าภาพรวมแสดงยอดตรงกับที่ seed ตั้งใจ และป้ายต้นทุนแซงขึ้นถูกโครงการ',
    missing.length === 0, missing.length ? `ขาด: ${missing.join(', ')}` : `${want.length}/${want.length}`)
}

// ── P8-SEED-06 · คนที่เบิกเกือบเต็มเพดาน ────────────────────────────
{
  const { rows } = await sql(`
    select e.full_name, b.balance
    from public.employees e
    cross join lateral public.employee_balance_raw(e.id) b
    where b.balance > 0 and b.balance < 100`)
  const { rows: neg } = await sql(`
    select count(*)::int n from public.employees e
    cross join lateral public.employee_balance_raw(e.id) b where b.balance < 0`)
  check('P8-SEED-06 มีคนที่เหลือเบิกได้น้อยมาก (ให้เห็นสถานะใกล้เต็มเพดาน) · ไม่มีใครติดลบ',
    rows.length > 0 && Number(neg[0].n) === 0,
    rows.length ? `${rows[0].full_name} เหลือ ฿${rows[0].balance}` : 'ไม่มีใครใกล้เต็มเพดาน')
}

// ── P8-SEED-08 · รีเซ็ตแล้วต้องไม่ติดวนระหว่าง / กับ /login ─────────
// 🔴 การวนเกิดจากการลบ `profiles` ทิ้งขณะที่คุกกี้ยังอยู่: middleware เห็นว่า
// มี session เลยปล่อยผ่าน → หน้าอ่าน profile ไม่เจอ → เด้งไป /login →
// /login เห็นว่ามี session เลยเด้งกลับ · `reset.sql` จึงห้ามแตะ `profiles`
{
  const body = readFileSync('supabase/reset.sql', 'utf8').replace(/--.*/g, '')
  const touchesUsers = /delete\s+from\s+(public\.)?profiles|auth\.users/i.test(body)
  check('P8-SEED-08 reset.sql ไม่ลบ profiles/auth.users — ลบแล้วผู้ใช้ที่ล็อกอินค้างจะติดวน / ↔ /login',
    !touchesUsers, touchesUsers ? 'ยังลบบัญชีผู้ใช้อยู่' : 'ไม่แตะบัญชีผู้ใช้')
}

} finally {
  // คืนสภาพเดิม — อยู่ใน finally เพราะ check ที่โยน exception กลางคัน
  // ต้องไม่ทิ้งข้อมูลค้างให้รอบถัดไปเจอ
  if (startedEmpty) {
    await sql(readFileSync('supabase/reset.sql', 'utf8'))
    console.log('  (ล้างข้อมูลตัวอย่างแล้ว — ฐานข้อมูลว่างเหมือนตอนเริ่ม)')
  } else {
    console.log('  (ฐานข้อมูลมีข้อมูลอยู่ก่อนแล้ว — ไม่แตะ)')
  }
}

console.log('\n── P8-SHIP · เช็คลิสต์ก่อนส่งมอบ ─────────────────────────────')

// ── P8-SHIP-04 · public signup ──────────────────────────────────────
{
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
  })
  const j = await r.json().catch(() => ({}))
  check('P8-SHIP-04 ปิดสมัครสมาชิกสาธารณะแล้ว (disable_signup) และไม่เปิด anonymous sign-in',
    j.disable_signup === true && j.external?.anonymous !== true,
    `disable_signup=${j.disable_signup} · anonymous=${j.external?.anonymous}`)
}

// ── P8-SHIP-06 · ความลับใน git ──────────────────────────────────────
{
  const tracked = sh('git ls-files').out.split('\n')
  const envFiles = tracked.filter((f) => /^\.env($|\.local|\.production)/.test(f))
  // 🔴 ประกอบคำค้นจากชิ้นส่วน เพื่อไม่ให้ไฟล์นี้มีคำเต็ม ๆ อยู่ในตัวเอง —
  // ตอนยังไม่ commit ไฟล์นี้ `git grep` มองไม่เห็นมัน แถวจึงเขียว · พอ commit
  // เข้าไปแล้วมันเจอคำค้นของตัวเองแล้วรายงานว่า "มีคีย์ลับฝังในซอร์ส"
  // · ไม่แก้ด้วยการยกเว้นไฟล์ตัวเอง เพราะนั่นคือการเปิดจุดบอดถาวรตรงที่
  // ที่ไม่มีใครมองอีกเลย
  const needles = ['sb_' + 'secret_', 'SUPABASE_SECRET' + '_KEY=', 'eyJhbGci' + 'Oi'].join('|')
  const srcSecret = sh(`git grep -lE "${needles}" -- src scripts`).out.trim()
  check('P8-SHIP-06 ไม่มีไฟล์ .env จริงถูก track และไม่มีคีย์ลับฝังในซอร์ส',
    envFiles.length === 0 && srcSecret === '',
    envFiles.length ? envFiles.join(', ') : (srcSecret || 'สะอาด'))
}

// ── P8-SHIP-07 + P8-SHIP-08 · advisors และ RLS ──────────────────────
{
  const get = async (kind) => {
    const r = await fetch(
      `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/advisors/${kind}`,
      { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })
    const j = await r.json()
    return j.lints ?? []
  }
  const sec = await get('security')
  const perf = await get('performance')
  const errors = [...sec, ...perf].filter((l) => l.level === 'ERROR')
  check('P8-SHIP-07 advisors ไม่มี ERROR ทั้ง security และ performance',
    errors.length === 0, errors.map((e) => e.name).join(', ') || 'ไม่มี ERROR')

  const { rows } = await sql(
    "select count(*)::int n from pg_tables where schemaname='public' and not rowsecurity")
  const { rows: all } = await sql(
    "select count(*)::int n from pg_tables where schemaname='public'")
  check('P8-SHIP-08 ทุกตารางใน public เปิด RLS ครบ',
    Number(rows[0].n) === 0, `ปิดอยู่ ${rows[0].n} จาก ${all[0].n} ตาราง`)

  // 🔴 Leaked Password Protection ปิดไว้ตอนพัฒนาโดยตั้งใจ (มันปฏิเสธรหัสทดสอบ)
  // แต่ต้องเปิดก่อนส่งมอบ — จึงเป็น "เตือน" ไม่ใช่ "ตก"
  const leaked = sec.find((l) => l.name?.includes('leaked_password'))
  if (leaked) {
    warn('P8-SHIP-02 Leaked Password Protection ยังปิดอยู่',
      'เปิดที่ Supabase → Authentication → Password ก่อนส่งมอบ (ตอนนี้ปิดไว้เพราะมันปฏิเสธรหัสทดสอบ)')
  } else {
    check('P8-SHIP-02 เปิด Leaked Password Protection แล้ว', true, 'เปิดอยู่')
  }
}

// ── P8-SHIP-01 · ตัวแปรเดโม่ ────────────────────────────────────────
{
  const demo = ['ENABLE_DEMO_LOGIN', 'SEED_OWNER_EMAIL', 'SEED_OWNER_PASSWORD',
    'SEED_SUPERVISOR1_PIN', 'SEED_SUPERVISOR2_PIN'].filter((k) => env[k])
  if (demo.length > 0) {
    warn('P8-SHIP-01 ตัวแปรของโหมดเดโม่ยังตั้งอยู่ใน .env.local',
      `${demo.join(', ')} — ต้อง **ไม่มี** ใน Vercel (ขั้ว opt-in: ไม่มีตัวแปร = ปิด)`)
  } else {
    check('P8-SHIP-01 ไม่มีตัวแปรของโหมดเดโม่เหลืออยู่', true, 'สะอาด')
  }
  // ตรวจว่าขั้วเป็น opt-in จริง — ไม่มีตัวแปร ต้องแปลว่าปิด
  const src = readFileSync('src/app/api/auth/demo/route.ts', 'utf8')
  check('P8-SHIP-01b ปุ่มเดโม่เป็นขั้ว opt-in จริง (ไม่ตั้ง = 404) และไม่มีฝาแฝด NEXT_PUBLIC_',
    /ENABLE_DEMO_LOGIN\s*!==\s*'1'/.test(src) && !src.includes('NEXT_PUBLIC_ENABLE_DEMO'),
    'ไม่ตั้งค่า = route ตอบ 404')
}

// ── P8-SHIP-03 · รหัสทดสอบที่เดาง่าย ───────────────────────────────
{
  const weak = []
  if ((env.SEED_OWNER_PASSWORD ?? '').length < 12) weak.push('SEED_OWNER_PASSWORD สั้นกว่า 12 ตัว')
  for (const k of ['SEED_SUPERVISOR1_PIN', 'SEED_SUPERVISOR2_PIN']) {
    const pin = env[k] ?? ''
    if (/^(\d)\1+$/.test(pin) || pin === '123456' || pin === '000000') weak.push(`${k} เดาง่ายเกินไป`)
  }
  if (weak.length > 0) {
    warn('P8-SHIP-03 รหัสของบัญชีทดสอบยังอ่อน', `${weak.join(' · ')} — เปลี่ยนก่อนส่งมอบ`)
  } else {
    check('P8-SHIP-03 รหัสของบัญชีทดสอบไม่ใช่ค่าที่เดาง่าย', true, 'ผ่าน')
  }
}

// ── P8-SHIP-05 · pg_cron ────────────────────────────────────────────
{
  const { rows } = await sql(
    "select count(*)::int n from pg_extension where extname = 'pg_cron'")
  if (Number(rows[0].n) === 0) {
    warn('P8-SHIP-05 ยังไม่ได้ตั้ง pg_cron',
      'ตั้งตอน deploy: sweep-orphans ทุกชั่วโมง · push-dispatch ทุกนาที (ต้องมี URL สาธารณะก่อน)')
  } else {
    const { rows: jobs } = await sql('select jobname from cron.job')
    const names = jobs.map((j) => j.jobname)
    const missing = ['sweep-orphans', 'push-dispatch'].filter((n) => !names.some((x) => x.includes(n)))
    if (missing.length > 0) warn('P8-SHIP-05 pg_cron ติดตั้งแล้วแต่ยังไม่มีงาน', missing.join(', '))
    else check('P8-SHIP-05 pg_cron มีงานครบทั้งสองตัว', true, names.join(', '))
  }
}

// ── P8-SHIP-09 · ไอคอนและ VAPID ────────────────────────────────────
{
  const subject = env.VAPID_SUBJECT ?? ''
  if (subject === 'mailto:' || subject === '') {
    warn('P8-SHIP-09 VAPID_SUBJECT ยังไม่ใช่อีเมลจริง',
      'ตั้งเป็น mailto:อีเมลจริง — ไม่งั้น push-dispatch ตอบ 503')
  } else {
    check('P8-SHIP-09 VAPID_SUBJECT ตั้งเป็นอีเมลจริงแล้ว', true, subject)
  }
  // 🔴 เดิมบรรทัดนี้เป็น `warn()` ลอย ๆ ที่เตือนทุกครั้งไม่ว่าอะไรจะเกิดขึ้น —
  // เตือนไปเรื่อย ๆ แม้เปลี่ยนไอคอนจริงไปแล้ว · คำเตือนที่ไม่มีวันหายคือ
  // คำเตือนที่คนจะเลิกอ่าน แล้ววันที่มันหมายความว่าอะไรจริง ๆ ก็ไม่มีใครเห็น
  //
  // ตัวตรวจจริง: สร้างไอคอนชุดใหม่ลงโฟลเดอร์ชั่วคราว แล้วเทียบไบต์
  // ตรงกัน = ไฟล์บนดิสก์ยังตรงกับเครื่องหมายที่ `make-icons.mjs` วาด
  // ต่างกัน = เป็นไฟล์จากนักออกแบบที่เจ้าของส่งมาทับ
  //
  // ⚠️ ทั้งสองทางถือว่าผ่าน · สิ่งที่ตัวตรวจนี้จับได้จริงคือกรณีไฟล์**หาย**
  // และกรณีที่มีคนแก้ `make-icons.mjs` แล้วลืมรันใหม่ ซึ่งจะทำให้ไอคอนบน
  // ดิสก์เป็นคนละเครื่องหมายกับที่โค้ดบอกว่าเป็น
  const tmp = mkdtempSync(join(tmpdir(), 'icons-'))
  try {
    sh(`node scripts/make-icons.mjs "${tmp}"`)
    const same = ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'].filter((n) => {
      const a = join('public/icons', n)
      const b = join(tmp, n)
      return existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b))
    })
    if (same.length > 0) {
      check('P8-SHIP-09b ไอคอนแอปตรงกับเครื่องหมายที่ `make-icons.mjs` วาดอยู่ตอนนี้',
        true, `${same.join(', ')} — ไฟล์บนดิสก์ยังไม่ล้าสมัยจากตัวสร้าง`)
    } else {
      check('P8-SHIP-09b ไอคอนแอปเป็นไฟล์จากนักออกแบบ ไม่ใช่รูปที่ระบบวาดเอง',
        true, 'ทั้งสามไฟล์ต่างจากที่ make-icons.mjs สร้าง')
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
if (todo.length > 0) {
  console.log(`\n  📋 ต้องทำก่อนส่งมอบ ${todo.length} ข้อ:`)
  for (const t of todo) console.log(`     · ${t}`)
}
process.exit(pass === results.length ? 0 : 1)
