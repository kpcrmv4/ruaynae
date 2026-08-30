#!/usr/bin/env node
/**
 * verify-sites-api.mjs — ปิดแถว P1-UI-* / P1-API-* และ P1-DB-02
 *
 * ตรวจที่ HTML ซึ่งเซิร์ฟเวอร์เรนเดอร์ ไม่ใช่ DOM ในเบราว์เซอร์
 * (ruling: dev chunk ถูกแคชด้วย URL คงที่ ผลจากเบราว์เซอร์จึงไม่น่าเชื่อถือ)
 * แถวที่ต้องมีเบราว์เซอร์จริง (toast · ปุ่ม disabled · กดซ้ำ) อยู่ที่ P8
 *
 * fixture ทุกตัวคืนค่าใน finally · ทุก "0 แถว" มีการพิสูจน์ฝั่งบวกคู่กัน
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

const req = (method, path, body, headers = {}) =>
  fetch(`${BASE}${path}`, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const jarOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
const page = async (path, cookie) => (await fetch(`${BASE}${path}`, { headers: { cookie } })).text()

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
  if (!r.ok) return { error: text }
  return { rows: JSON.parse(text) }
}
const siteCount = async () => (await sql('select count(*)::int as n from public.sites')).rows[0].n

const { derivePassword, syntheticEmail } = await import('../src/lib/pin-core.ts')
const supabaseToken = async (email, password) => {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(JSON.stringify(j))
  return j.access_token
}

console.log('\n── P1-UI / P1-API · หน้าไซต์งานและ endpoint ────────────────')

const ownerJar = jarOf(
  await req('POST', '/api/auth/login', {
    email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD,
  }),
)
const supJar = jarOf(await req('POST', '/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN }))
if (!ownerJar || !supJar) throw new Error('ล็อกอินไม่สำเร็จ — ตรวจว่า dev server รันอยู่และ seed ผู้ใช้แล้ว')

const supToken = await supabaseToken(
  syntheticEmail('sup1'), derivePassword(env.PIN_PEPPER, env.SEED_SUPERVISOR1_PIN),
)

const [sup1] = (await sql(
  `select id from public.profiles where full_name = '${env.SEED_SUPERVISOR1_NAME}'`,
)).rows
const [sup2] = (await sql(
  `select id from public.profiles where full_name = '${env.SEED_SUPERVISOR2_NAME}'`,
)).rows

// ── P1-UI-03 · สถานะว่างจริง — ต้องทำก่อนสร้าง fixture ──────────────────
// ตัดสินได้เฉพาะตอนฐานข้อมูลยังไม่มีไซต์เลย · ถ้ามีแล้วให้ตอบว่าตัดสินไม่ได้
// ไม่ใช่ลบข้อมูลของคนอื่นทิ้งเพื่อให้ตรวจผ่าน
{
  const before = await siteCount()
  if (before !== 0) {
    check('P1-UI-03 ยังไม่มีไซต์เลย → สถานะว่าง + ปุ่มเพิ่มไซต์งาน', 'skip',
      `ฐานข้อมูลมี ${before} ไซต์อยู่แล้ว — undecided`)
  } else {
    const html = await page('/sites', ownerJar)
    check('P1-UI-03 ยังไม่มีไซต์เลย → สถานะว่าง + ปุ่มเพิ่มไซต์งาน',
      html.includes('ยังไม่มีไซต์งานในระบบ') && html.includes('เพิ่มไซต์งาน'),
      'ข้อความสถานะว่างของเจ้าของ')
  }
}

// ── P1-API-01 (บางส่วน) · ยังไม่ล็อกอิน ──────────────────────────────────
// 🔴 ต้องเป็น 401 JSON ไม่ใช่ 307 ไปหน้า login — fetch จะตามรีไดเรกต์แล้วได้
// HTML ของหน้า login กลับมาเป็น 200 ซึ่งฝั่ง client อ่านว่า "สำเร็จ"
{
  const r = await req('POST', '/api/sites', { name: 'ไม่ควรถูกสร้าง' })
  const ct = r.headers.get('content-type') ?? ''
  check('P1-API-01a POST /api/sites ตอนไม่ล็อกอิน → 401 JSON (ไม่ใช่ 307)',
    r.status === 401 && ct.includes('application/json'), `${r.status} · ${ct.split(';')[0]}`)
}

const created = []
const createSite = async (body, jar = ownerJar) => {
  const r = await req('POST', '/api/sites', body, { cookie: jar })
  const b = await r.json().catch(() => ({}))
  if (r.status === 201 && b.site?.id) created.push(b.site.id)
  return { status: r.status, body: b }
}

try {
  // ── P1-API-02 · หัวหน้าไซต์สร้างไซต์เองไม่ได้ ────────────────────────
  {
    const before = await siteCount()
    const r = await createSite({ name: 'หัวหน้าไซต์ไม่ควรสร้างได้' }, supJar)
    const after = await siteCount()
    check('P1-API-02 หัวหน้าไซต์ POST /api/sites → 403 FORBIDDEN · จำนวนไซต์เท่าเดิม',
      r.status === 403 && r.body.error === 'FORBIDDEN' && after === before,
      `${r.status} ${r.body.error} · ${before}→${after}`)
  }

  // ── P1-DB-02 · RLS ปฏิเสธที่ชั้นฐานข้อมูลด้วย ไม่ใช่แค่ที่ route ─────
  // ยิง PostgREST ตรง ๆ ข้าม route ไปเลย — ถ้าผ่านแปลว่าด่านเดียวที่มีคือ if
  // ในโค้ด ซึ่งหายไปพร้อมกับการ refactor ครั้งหน้า
  {
    const before = await siteCount()
    const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sites`, {
      method: 'POST',
      headers: {
        apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${supToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ name: 'ไซต์ที่ RLS ต้องกัน' }),
    })
    const mid = await siteCount()
    // ครึ่งบวก: เจ้าของต้องสร้างได้ในคำสั่งถัดไป — พิสูจน์ว่าตารางไม่ได้พัง
    const ok = await createSite({ name: 'ทดสอบ ไซต์ของเจ้าของ', contractAmount: 2000000 })
    const after = await siteCount()
    check('P1-DB-02 หัวหน้าไซต์ insert ตรงเข้า sites ไม่ผ่าน RLS · เจ้าของสร้างได้',
      r.status >= 400 && mid === before && ok.status === 201 && after === before + 1,
      `RLS ${r.status} · ${before}→${mid}→${after}`)
  }

  // ── P1-API-04 / 05 / 07 / 08 · การตรวจ payload ────────────────────────
  const rejects = [
    ['P1-API-04 ค่างานติดลบ → 400 AMOUNT_INVALID',
      { name: 'ค่างานติดลบ', contractAmount: -1 }, 'AMOUNT_INVALID'],
    ['P1-API-05 วันจบมาก่อนวันเริ่ม → 400 DATE_RANGE_INVALID',
      { name: 'วันที่กลับด้าน', startDate: '2026-08-30', endDate: '2026-08-01' }, 'DATE_RANGE_INVALID'],
    ['P1-API-07 ส่งปี พ.ศ. → 400 DATE_BUDDHIST_ERA (ไม่ใช่รับไว้แล้วเพี้ยน 543 ปี)',
      { name: 'ปีพุทธศักราช', startDate: '2569-08-30' }, 'DATE_BUDDHIST_ERA'],
    ['P1-API-08 ไม่ใส่ชื่อ → 400 NAME_REQUIRED',
      { name: '   ' }, 'NAME_REQUIRED'],
  ]
  for (const [label, body, code] of rejects) {
    const before = await siteCount()
    const r = await createSite(body)
    const after = await siteCount()
    check(`${label} · จำนวนไซต์เท่าเดิม`,
      r.status === 400 && r.body.error === code && after === before,
      `${r.status} ${r.body.error} · ${before}→${after}`)
  }

  // ── P1-API-09 · สร้างสำเร็จแล้วมี audit และแถวโผล่ในหน้ารายการ ────────
  {
    const before = await siteCount()
    const name = `ทดสอบ ไซต์ที่เพิ่งสร้าง ${Date.now()}`
    const r = await createSite({
      name, clientName: 'บริษัท ทดสอบ จำกัด', clientPhone: '021234567',
      address: 'ถนนทดสอบ', contractAmount: '1,500,000', status: 'active',
      startDate: '2026-03-01', endDate: '2026-08-31',
    })
    const after = await siteCount()
    const { rows: audit } = await sql(
      `select count(*)::int as n from public.audit_log
       where table_name='sites' and action='INSERT' and row_id='${r.body.site?.id}'`,
    )
    const html = await page('/sites', ownerJar)
    check('P1-API-09 สร้างไซต์ → 201 · sites +1 · audit_log +1 · แถวใหม่อยู่ในหน้า /sites',
      r.status === 201 && after === before + 1 && audit[0].n === 1 && html.includes(name),
      `${r.status} · ${before}→${after} · audit ${audit[0].n} · ในหน้า ${html.includes(name)}`)

    // ค่าที่ส่งเป็นข้อความมีจุลภาคต้องถูกอ่านเป็นตัวเลข ไม่ใช่ 0 เงียบ ๆ
    const { rows: saved } = await sql(
      `select contract_amount::float8 as amount, client_name, start_date::text as sd
       from public.sites where id='${r.body.site?.id}'`,
    )
    check('P1-API-09b ค่างาน "1,500,000" ถูกบันทึกเป็น 1500000 และวันเริ่มเป็น ค.ศ.',
      saved[0]?.amount === 1500000 && saved[0]?.sd === '2026-03-01',
      `${saved[0]?.amount} · ${saved[0]?.sd}`)
  }

  // ── P1-UI-01 / 02 · ใครเห็นอะไรบ้าง ─────────────────────────────────
  const mine = await createSite({ name: 'ทดสอบ ไซต์ที่หัวหน้าดูแล', contractAmount: 900000 })
  const others = await createSite({ name: 'ทดสอบ ไซต์ที่หัวหน้าไม่ได้ดูแล', contractAmount: 800000 })
  await sql(`insert into public.site_supervisors(site_id, profile_id)
             values ('${mine.body.site.id}','${sup1.id}')`)
  await sql(`insert into public.site_supervisors(site_id, profile_id)
             values ('${others.body.site.id}','${sup2.id}')`)

  {
    const html = await page('/sites', ownerJar)
    check('P1-UI-01 เจ้าของเห็นไซต์ครบทุกไซต์',
      html.includes('ทดสอบ ไซต์ที่หัวหน้าดูแล') && html.includes('ทดสอบ ไซต์ที่หัวหน้าไม่ได้ดูแล'),
      'เห็นทั้งสองไซต์')
  }
  {
    // ครึ่งบวกและครึ่งลบอยู่ในการตรวจเดียวกัน — "ไม่เห็นอะไรเลย" ผ่านได้ทั้งที่หน้าพัง
    const html = await page('/sites', supJar)
    check('P1-UI-02 หัวหน้าไซต์เห็นเฉพาะไซต์ตัวเอง · ชื่อไซต์คนอื่นไม่ปรากฏในหน้าเดียวกัน',
      html.includes('ทดสอบ ไซต์ที่หัวหน้าดูแล') && !html.includes('ทดสอบ ไซต์ที่หัวหน้าไม่ได้ดูแล'),
      'เห็นของตัวเอง ไม่เห็นของคนอื่น')
  }

  // ── P1-UI-05 · ป้ายสถานะครบทั้ง 5 ค่าของ enum ───────────────────────
  // ตรวจทีละค่าโดยกรองหน้าให้เหลือเฉพาะไซต์ที่มีสถานะนั้น — ไม่ใช่แค่ดูว่า
  // ข้อความไทยโผล่ที่ไหนสักที่ (ชิปตัวกรองมีครบทั้ง 5 คำอยู่แล้วเสมอ
  // ตรวจแบบนั้นจะเขียวโดยไม่มีไซต์สักไซต์ที่สถานะนั้นจริง)
  {
    const STATUSES = [
      ['planning', 'เตรียมงาน'], ['active', 'กำลังก่อสร้าง'], ['paused', 'หยุดชั่วคราว'],
      ['done', 'ส่งมอบแล้ว'], ['cancelled', 'ยกเลิก'],
    ]
    const missing = []
    for (const [value, label] of STATUSES) {
      const name = `ทดสอบ สถานะ ${value}`
      const r = await createSite({ name, status: value })
      const html = await page(`/sites?status=${value}`, ownerJar)
      // ชื่อไซต์ต้องอยู่ในหน้า และป้ายไทยต้องปรากฏมากกว่าครั้งเดียว
      // (ครั้งแรกคือชิปตัวกรอง ครั้งที่สองคือป้ายบนแถว)
      const labelCount = html.split(label).length - 1
      if (r.status !== 201 || !html.includes(name) || labelCount < 2) {
        missing.push(`${value}(${r.status}/${labelCount})`)
      }
      // ค่าดิบภาษาอังกฤษต้องไม่ปรากฏเป็นข้อความบนแถว
      if (html.includes(`>${value}<`)) missing.push(`${value} แสดงเป็นค่าดิบ`)
    }
    check('P1-UI-05 ป้ายสถานะภาษาไทยครบทั้ง 5 ค่า ไม่มีค่าไหนแสดงเป็นค่าดิบ',
      missing.length === 0, missing.length ? missing.join(' · ') : '5/5')
  }

  // ── P1-UI-03b · สถานะว่างของการค้นหา ต้องคนละข้อความกับ "ยังไม่มีไซต์เลย" ─
  {
    const html = await page('/sites?q=ไม่มีทางมีไซต์ชื่อนี้', ownerJar)
    check('P1-UI-03b ค้นหาไม่เจอ → ข้อความคนละแบบกับ "ยังไม่มีไซต์งานในระบบ"',
      html.includes('ไม่พบไซต์งานที่ตรงกับเงื่อนไขนี้') && !html.includes('ยังไม่มีไซต์งานในระบบ'),
      'แยกสองสถานะออกจากกัน')
  }
} finally {
  for (const id of created) await sql(`delete from public.sites where id = '${id}'`)
  console.log(`  (ลบไซต์ทดสอบ ${created.length} ไซต์แล้ว)`)
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok === true).length
const skip = results.filter((r) => r.ok === 'skip').length
const fail = results.length - pass - skip
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${fail} · undecided ${skip}`)
process.exit(fail ? 1 : 0)
