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

console.log('\n── P1-UI / P1-API · หน้าโครงการและ endpoint ────────────────')

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
// ตัดสินได้เฉพาะตอนฐานข้อมูลยังไม่มีโครงการเลย · ถ้ามีแล้วให้ตอบว่าตัดสินไม่ได้
// ไม่ใช่ลบข้อมูลของคนอื่นทิ้งเพื่อให้ตรวจผ่าน
{
  const before = await siteCount()
  if (before !== 0) {
    check('P1-UI-03 ยังไม่มีโครงการเลย → สถานะว่าง + ปุ่มเพิ่มโครงการ', 'skip',
      `ฐานข้อมูลมี ${before} โครงการอยู่แล้ว — undecided`)
  } else {
    const html = await page('/sites', ownerJar)
    check('P1-UI-03 ยังไม่มีโครงการเลย → สถานะว่าง + ปุ่มเพิ่มโครงการ',
      html.includes('ยังไม่มีโครงการในระบบ') && html.includes('เพิ่มโครงการ'),
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
  // ── P1-API-02 · หัวหน้าโครงการสร้างโครงการเองไม่ได้ ────────────────────────
  {
    const before = await siteCount()
    const r = await createSite({ name: 'หัวหน้าโครงการไม่ควรสร้างได้' }, supJar)
    const after = await siteCount()
    check('P1-API-02 หัวหน้าโครงการ POST /api/sites → 403 FORBIDDEN · จำนวนโครงการเท่าเดิม',
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
      body: JSON.stringify({ name: 'โครงการที่ RLS ต้องกัน' }),
    })
    const mid = await siteCount()
    // ครึ่งบวก: เจ้าของต้องสร้างได้ในคำสั่งถัดไป — พิสูจน์ว่าตารางไม่ได้พัง
    const ok = await createSite({ name: 'ทดสอบ โครงการของเจ้าของ', contractAmount: 2000000 })
    const after = await siteCount()
    check('P1-DB-02 หัวหน้าโครงการ insert ตรงเข้า sites ไม่ผ่าน RLS · เจ้าของสร้างได้',
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
    check(`${label} · จำนวนโครงการเท่าเดิม`,
      r.status === 400 && r.body.error === code && after === before,
      `${r.status} ${r.body.error} · ${before}→${after}`)
  }

  // ── P1-API-09 · สร้างสำเร็จแล้วมี audit และแถวโผล่ในหน้ารายการ ────────
  {
    const before = await siteCount()
    const name = `ทดสอบ โครงการที่เพิ่งสร้าง ${Date.now()}`
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
    check('P1-API-09 สร้างโครงการ → 201 · sites +1 · audit_log +1 · แถวใหม่อยู่ในหน้า /sites',
      r.status === 201 && after === before + 1 && audit[0].n === 1 && html.includes(name),
      `${r.status} · ${before}→${after} · audit ${audit[0].n} · ในหน้า ${html.includes(name)}`)

    // ค่าที่ส่งเป็นข้อความมีจุลภาคต้องถูกอ่านเป็นตัวเลข ไม่ใช่ 0 เงียบ ๆ
    const { rows: saved } = await sql(
      `select f.contract_amount::float8 as amount, s.client_name, s.start_date::text as sd
       from public.sites s join public.site_finance f on f.site_id = s.id
       where s.id='${r.body.site?.id}'`,
    )
    check('P1-API-09b ค่างาน "1,500,000" ถูกบันทึกเป็น 1500000 และวันเริ่มเป็น ค.ศ.',
      saved[0]?.amount === 1500000 && saved[0]?.sd === '2026-03-01',
      `${saved[0]?.amount} · ${saved[0]?.sd}`)
  }

  // ── P1-UI-01 / 02 · ใครเห็นอะไรบ้าง ─────────────────────────────────
  const mine = await createSite({ name: 'ทดสอบ โครงการที่หัวหน้าดูแล', contractAmount: 900000 })
  const others = await createSite({ name: 'ทดสอบ โครงการที่หัวหน้าไม่ได้ดูแล', contractAmount: 800000 })
  await sql(`insert into public.site_supervisors(site_id, profile_id)
             values ('${mine.body.site.id}','${sup1.id}')`)
  await sql(`insert into public.site_supervisors(site_id, profile_id)
             values ('${others.body.site.id}','${sup2.id}')`)

  {
    const html = await page('/sites', ownerJar)
    check('P1-UI-01 เจ้าของเห็นโครงการครบทุกโครงการ',
      html.includes('ทดสอบ โครงการที่หัวหน้าดูแล') && html.includes('ทดสอบ โครงการที่หัวหน้าไม่ได้ดูแล'),
      'เห็นทั้งสองโครงการ')
  }
  {
    // ครึ่งบวกและครึ่งลบอยู่ในการตรวจเดียวกัน — "ไม่เห็นอะไรเลย" ผ่านได้ทั้งที่หน้าพัง
    const html = await page('/sites', supJar)
    check('P1-UI-02 หัวหน้าโครงการเห็นเฉพาะโครงการตัวเอง · ชื่อโครงการคนอื่นไม่ปรากฏในหน้าเดียวกัน',
      html.includes('ทดสอบ โครงการที่หัวหน้าดูแล') && !html.includes('ทดสอบ โครงการที่หัวหน้าไม่ได้ดูแล'),
      'เห็นของตัวเอง ไม่เห็นของคนอื่น')
  }

  // ── P1-UI-05 · ป้ายสถานะครบทั้ง 5 ค่าของ enum ───────────────────────
  // ตรวจทีละค่าโดยกรองหน้าให้เหลือเฉพาะโครงการที่มีสถานะนั้น — ไม่ใช่แค่ดูว่า
  // ข้อความไทยโผล่ที่ไหนสักที่ (ชิปตัวกรองมีครบทั้ง 5 คำอยู่แล้วเสมอ
  // ตรวจแบบนั้นจะเขียวโดยไม่มีโครงการสักโครงการที่สถานะนั้นจริง)
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
      // ชื่อโครงการต้องอยู่ในหน้า และป้ายไทยต้องปรากฏมากกว่าครั้งเดียว
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

  // ── P1-UI-03b · สถานะว่างของการค้นหา ต้องคนละข้อความกับ "ยังไม่มีโครงการเลย" ─
  {
    const html = await page('/sites?q=ไม่มีทางมีโครงการชื่อนี้', ownerJar)
    check('P1-UI-03b ค้นหาไม่เจอ → ข้อความคนละแบบกับ "ยังไม่มีโครงการในระบบ"',
      html.includes('ไม่พบโครงการที่ตรงกับเงื่อนไขนี้') && !html.includes('ยังไม่มีโครงการในระบบ'),
      'แยกสองสถานะออกจากกัน')
  }
} finally {
  for (const id of created) await sql(`delete from public.sites where id = '${id}'`)
  console.log(`  (ลบโครงการทดสอบ ${created.length} โครงการแล้ว)`)
}

console.log('\n── P1 · หน้ารายละเอียดโครงการ · แก้ไข · หัวหน้าโครงการ · งวดเงิน ──')

const created2 = []
try {
  const mk = async (body) => {
    const r = await req('POST', '/api/sites', body, { cookie: ownerJar })
    const b = await r.json()
    created2.push(b.site.id)
    return b.site.id
  }
  const mineId = await mk({
    name: 'ทดสอบ โครงการที่มีรายละเอียด', contractAmount: 3000000,
    startDate: '2026-03-01', endDate: '2026-08-31', clientName: 'คุณสมชาย',
  })
  const othersId = await mk({ name: 'ทดสอบ โครงการของคนอื่น' })

  // ── P1-API-01 · ทุก endpoint ตอนไม่ล็อกอินต้องเป็น 401 JSON ─────────
  // ครบทั้ง 6 คู่ method×path ไม่ใช่แค่ตัวแรก — endpoint ที่ลืมด่านมักเป็น
  // ตัวที่เพิ่มทีหลัง ซึ่งก็คือตัวที่ไม่มีใครนึกถึงตอนเขียนตัวตรวจ
  {
    const calls = [
      ['POST', '/api/sites', { name: 'x' }],
      ['PATCH', `/api/sites/${mineId}`, { name: 'x' }],
      ['POST', `/api/sites/${mineId}/supervisors`, { profileId: sup1.id }],
      ['DELETE', `/api/sites/${mineId}/supervisors?assignment=${mineId}`, undefined],
      ['POST', `/api/sites/${mineId}/milestones`, { name: 'x' }],
      ['DELETE', `/api/sites/${mineId}/milestones?milestone=${mineId}`, undefined],
    ]
    const bad = []
    for (const [m, path, body] of calls) {
      const r = await req(m, path, body)
      const ct = r.headers.get('content-type') ?? ''
      if (r.status !== 401 || !ct.includes('application/json')) {
        bad.push(`${m} ${path.split('?')[0]} → ${r.status}`)
      }
    }
    check('P1-API-01 ทุก endpoint (6 คู่ method×path) ตอนไม่ล็อกอิน → 401 JSON',
      bad.length === 0, bad.length ? bad.join(' · ') : '6/6')
  }

  // ── P1-API-03 · PATCH โครงการที่ไม่มีอยู่ ────────────────────────────
  {
    const r = await req('PATCH', '/api/sites/00000000-0000-0000-0000-000000000000',
      { name: 'ไม่มีโครงการนี้' }, { cookie: ownerJar })
    const b = await r.json().catch(() => ({}))
    check('P1-API-03 PATCH โครงการที่ไม่มีอยู่ → 404 NOT_FOUND',
      r.status === 404 && b.error === 'NOT_FOUND', `${r.status} ${b.error}`)
  }

  // ── P1-API-10 · หัวหน้าโครงการแก้โครงการไม่ได้ · ค่าเดิมไม่เปลี่ยน ───────
  {
    const r = await req('PATCH', `/api/sites/${mineId}`,
      { name: 'ชื่อที่ไม่ควรถูกเขียน', contractAmount: 1 }, { cookie: supJar })
    const b = await r.json().catch(() => ({}))
    const { rows } = await sql(
      `select s.name, f.contract_amount::float8 as amount from public.sites s
       join public.site_finance f on f.site_id = s.id where s.id='${mineId}'`)
    check('P1-API-10 หัวหน้าโครงการ PATCH โครงการ → 403 · ชื่อและค่างานไม่เปลี่ยน',
      r.status === 403 && b.error === 'FORBIDDEN'
      && rows[0].name === 'ทดสอบ โครงการที่มีรายละเอียด' && rows[0].amount === 3000000,
      `${r.status} ${b.error} · ${rows[0].name} ${rows[0].amount}`)
  }

  // ── P1-API-11 · เจ้าของแก้ได้จริง ────────────────────────────────
  // ครึ่งบวกของแถวข้างบน — ถ้าไม่มี "403" อาจแปลว่า endpoint พังสำหรับทุกคน
  {
    const r = await req('PATCH', `/api/sites/${mineId}`, {
      name: 'ทดสอบ โครงการที่แก้ชื่อแล้ว', contractAmount: 3500000,
      startDate: '2026-03-01', endDate: '2026-09-30', status: 'paused',
      clientName: 'คุณสมชาย', clientPhone: '0891112222', address: 'ซอยทดสอบ 5',
    }, { cookie: ownerJar })
    const { rows } = await sql(
      `select s.name, s.status::text as status, f.contract_amount::float8 as amount,
              s.end_date::text as ed, s.client_phone, s.address
       from public.sites s join public.site_finance f on f.site_id = s.id
       where s.id='${mineId}'`)
    const a = rows[0]
    check('P1-API-11 เจ้าของ PATCH → 200 · ทุกคอลัมน์ถูกเขียนจริง',
      r.status === 200 && a.name === 'ทดสอบ โครงการที่แก้ชื่อแล้ว' && a.status === 'paused'
      && a.amount === 3500000 && a.ed === '2026-09-30'
      && a.client_phone === '0891112222' && a.address === 'ซอยทดสอบ 5',
      `${r.status} · ${a.status} ${a.amount} ${a.ed}`)
  }

  // ── P1-API-06 · มอบหมายทับช่วงเวลาเดิม → 409 OVERLAP ─────────────
  {
    const first = await req('POST', `/api/sites/${mineId}/supervisors`,
      { profileId: sup1.id, effectiveFrom: '2026-03-01' }, { cookie: ownerJar })
    const before = (await sql(
      `select count(*)::int as n from public.site_supervisors where profile_id='${sup1.id}'`)).rows[0].n
    const dup = await req('POST', `/api/sites/${othersId}/supervisors`,
      { profileId: sup1.id, effectiveFrom: '2026-06-01' }, { cookie: ownerJar })
    const dupBody = await dup.json().catch(() => ({}))
    const after = (await sql(
      `select count(*)::int as n from public.site_supervisors where profile_id='${sup1.id}'`)).rows[0].n
    check('P1-API-06 มอบหมายทับช่วงเดิม → 409 OVERLAP · ไม่มีแถวใหม่',
      first.status === 201 && dup.status === 409 && dupBody.error === 'OVERLAP' && after === before,
      `แรก ${first.status} · ซ้ำ ${dup.status} ${dupBody.error} · ${before}→${after}`)
  }

  // ── P1-UI-04 · หัวหน้าโครงการเปิดโครงการที่ไม่ได้ดูแล → 404 ────────────
  // 🔴 หน้าเปล่าที่ตอบ 200 อ่านเหมือนระบบพัง และยังยืนยันให้ด้วยว่าโครงการนี้มีจริง
  // ต้องรันตรงนี้ — ก่อน P1-API-12 ย้าย sup1 ไปโครงการอื่น
  {
    const mine = await fetch(`${BASE}/sites/${mineId}`, { headers: { cookie: supJar } })
    const other = await fetch(`${BASE}/sites/${othersId}`, { headers: { cookie: supJar } })
    check('P1-UI-04 หัวหน้าโครงการเปิดโครงการที่ดูแลได้ 200 · โครงการที่ไม่ได้ดูแลได้ 404',
      mine.status === 200 && other.status === 404, `ของตัวเอง ${mine.status} · ของคนอื่น ${other.status}`)
  }

  // ── P1-API-12 · ช่วงที่ต่อกันพอดีต้องมอบหมายได้ผ่าน API ด้วย ──────
  // ฐานข้อมูลยอมแล้ว (P1-DB-08) แต่ถ้าชั้น API ดันไปตรวจซ้ำแบบผิด ๆ
  // ผู้ใช้จะยังทำไม่ได้อยู่ดี — กฎที่ถูกที่ชั้นล่างแต่ผิดที่ชั้นบนก็ยังผิด
  {
    await sql(`update public.site_supervisors set effective_to = '2026-05-31'
               where site_id='${mineId}' and profile_id='${sup1.id}'`)
    const r = await req('POST', `/api/sites/${othersId}/supervisors`,
      { profileId: sup1.id, effectiveFrom: '2026-06-01', effectiveTo: '2026-12-31' },
      { cookie: ownerJar })
    const b = await r.json().catch(() => ({}))
    check('P1-API-12 ช่วงที่ต่อกันพอดี (จบ 31 พ.ค. เริ่ม 1 มิ.ย.) มอบหมายได้ → 201',
      r.status === 201 && Boolean(b.assignment?.id), `${r.status} ${b.error ?? ''}`)
  }

  // ── P1-API-13 · งวดเงิน: เว้นเลขงวดแล้วระบบต่อท้ายให้ · ซ้ำ → 409 ──
  {
    const a = await req('POST', `/api/sites/${mineId}/milestones`,
      { name: 'งวดที่ 1 — วางฐานราก', plannedAmount: '1,000,000', plannedDate: '2026-04-15' },
      { cookie: ownerJar })
    const ab = await a.json().catch(() => ({}))
    const b2 = await req('POST', `/api/sites/${mineId}/milestones`,
      { name: 'งวดที่ 2 — ขึ้นโครง', plannedAmount: 900000 }, { cookie: ownerJar })
    const bb = await b2.json().catch(() => ({}))
    const dup = await req('POST', `/api/sites/${mineId}/milestones`,
      { name: 'งวดซ้ำ', seq: 1 }, { cookie: ownerJar })
    const db2 = await dup.json().catch(() => ({}))
    const { rows } = await sql(
      `select count(*)::int as n, sum(planned_amount)::float8 as total
       from public.site_milestones where site_id='${mineId}'`)
    check('P1-API-13 เว้นเลขงวด → ได้ 1 แล้ว 2 · เลขซ้ำ → 409 SEQ_TAKEN · เหลือ 2 งวด',
      ab.milestone?.seq === 1 && bb.milestone?.seq === 2
      && dup.status === 409 && db2.error === 'SEQ_TAKEN'
      && rows[0].n === 2 && rows[0].total === 1900000,
      `งวด ${ab.milestone?.seq}/${bb.milestone?.seq} · ซ้ำ ${dup.status} · ${rows[0].n} งวด รวม ${rows[0].total}`)
  }

  // ── P1-CALC-06 · "วันนี้" ต้องเป็นวันไทย ไม่ใช่วัน UTC ──────────────
  // โครงการที่เริ่มและจบ "วันนี้ตามเวลาไทย" ต้องอ่านได้ว่าเหลือ 0 วัน
  // 🔴 ตัดสินได้เฉพาะช่วง 17:00–23:59 UTC (= 00:00–06:59 ของวันถัดไปตามเวลาไทย)
  // ซึ่งเป็นช่วงเดียวที่สองเขตเวลาอยู่คนละวัน · นอกช่วงนั้นสองแบบให้คำตอบ
  // เหมือนกัน แถวนี้จึงแยกไม่ออกและต้องตอบว่าตัดสินไม่ได้ ไม่ใช่ตอบว่าผ่าน
  {
    const bkkToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
    const hourUtc = new Date().getUTCHours()

    const oneDayId = await mk({
      name: 'ทดสอบ โครงการวันเดียว', startDate: bkkToday, endDate: bkkToday,
    })
    const html = await page(`/sites/${oneDayId}`, ownerJar)
    const ok = html.includes('เหลืออีก 0 วัน') && html.includes('100%')

    if (hourUtc < 17) {
      check('P1-CALC-06 "วันนี้" ผูกกับ Asia/Bangkok ไม่ใช่ UTC', 'skip',
        `ตอนนี้ ${hourUtc}:xx UTC — สองเขตเวลายังเป็นวันเดียวกัน จึงแยกไม่ออก (หน้าแสดงถูก: ${ok})`)
    } else {
      check('P1-CALC-06 "วันนี้" ผูกกับ Asia/Bangkok ไม่ใช่ UTC', ok,
        `UTC ${new Date().toISOString().slice(0, 10)} · ไทย ${bkkToday} → เหลือ 0 วัน: ${ok}`)
    }
  }

  // ── P1-UI-12 · หน้ารายละเอียดแสดงของที่บันทึกไว้จริง ─────────────
  {
    const html = await page(`/sites/${mineId}`, ownerJar)
    const want = ['ทดสอบ โครงการที่แก้ชื่อแล้ว', 'หยุดชั่วคราว', '3,500,000',
      'งวดที่ 1 — วางฐานราก', env.SEED_SUPERVISOR1_NAME, '0891112222']
    const missing = want.filter((w) => !html.includes(w))
    check('P1-UI-12 หน้ารายละเอียดแสดงชื่อ · สถานะไทย · ค่างาน · งวด · หัวหน้าโครงการ · เบอร์',
      missing.length === 0, missing.length ? `ขาด: ${missing.join(', ')}` : '6/6')
  }

  // ── P1-UI-14 · หัวหน้าโครงการไม่เห็นค่างานบนหน้าจอ ──────────────────
  // ครึ่งบวก: เจ้าของเห็นทั้งตัวเลขและหัวข้อ ในโครงการเดียวกัน หน้าเดียวกัน
  // 🔴 นี่เป็นแค่ชั้นหน้าจอ · ชั้นที่บังคับจริงคือ RLS ของตาราง site_finance
  // ซึ่งพิสูจน์แยกที่ P1-DB-14 — ถ้ามีแค่แถวนี้ ก็คือการซ่อนปุ่ม ไม่ใช่การคุมสิทธิ์
  {
    const sup = await page(`/sites/${mineId}`, supJar)
    const own = await page(`/sites/${mineId}`, ownerJar)
    check('P1-UI-14 หัวหน้าโครงการไม่เห็นค่างานบนหน้ารายละเอียด · เจ้าของเห็น',
      !sup.includes('3,500,000') && !sup.includes('ค่างานตามสัญญา')
      && own.includes('3,500,000') && own.includes('ค่างานตามสัญญา'),
      `หัวหน้าโครงการเห็นตัวเลข=${sup.includes('3,500,000')} · เจ้าของเห็น=${own.includes('3,500,000')}`)
  }

  // ── P1-CALC-05 · ค่างาน 0 ต้องไม่หารด้วยศูนย์ ────────────────────
  // `othersId` ถูกสร้างโดยไม่ใส่ค่างาน → contract_amount = 0
  // ครึ่งบวก: โครงการที่ตั้งค่างานแล้วต้องแสดงตัวเลข ไม่ใช่ข้อความเดียวกัน
  {
    const zero = await page(`/sites/${othersId}`, ownerJar)
    const some = await page(`/sites/${mineId}`, ownerJar)
    const noNaN = !/NaN|Infinity/.test(zero)
    check('P1-CALC-05 ค่างาน 0 → "ยังไม่ได้ตั้งค่างาน" ไม่มี NaN/Infinity · โครงการที่ตั้งแล้วโชว์ตัวเลข',
      zero.includes('ยังไม่ได้ตั้งค่างาน') && noNaN
      && some.includes('3,500,000') && !some.includes('ยังไม่ได้ตั้งค่างาน'),
      `ค่างาน 0: ข้อความถูก=${zero.includes('ยังไม่ได้ตั้งค่างาน')} ไม่มี NaN=${noNaN}`)
  }
} finally {
  for (const id of created2) await sql(`delete from public.sites where id = '${id}'`)
  console.log(`  (ลบโครงการทดสอบชุดที่สอง ${created2.length} โครงการแล้ว)`)
}

console.log('\n── P1 · หน้าภาพรวม ────────────────────────────────────────')

const created3 = []
try {
  const mk = async (body) => {
    const r = await req('POST', '/api/sites', body, { cookie: ownerJar })
    const b = await r.json()
    created3.push(b.site.id)
    return b.site.id
  }
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  const plus = (days) => {
    const d = new Date(`${today}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }

  // fixture ที่ทำให้ทุกช่องมีเลขที่ไม่ใช่ศูนย์ — ไม่งั้นทุกชั้นจะตรงกันที่ 0
  // โดยไม่ได้พิสูจน์การนับสักครั้ง
  const mineId = await mk({
    name: 'ทดสอบ ภาพรวม โครงการของหัวหน้า', contractAmount: 1000000,
    startDate: plus(-60), endDate: plus(10),          // ใกล้ครบกำหนด
  })
  await mk({
    name: 'ทดสอบ ภาพรวม โครงการเลยกำหนด', contractAmount: 2000000,
    startDate: plus(-200), endDate: plus(-5),         // เลยกำหนดแล้ว
  })
  await mk({
    name: 'ทดสอบ ภาพรวม โครงการปิดแล้ว', contractAmount: 5000000, status: 'done',
  })
  await sql(`insert into public.site_supervisors(site_id, profile_id)
             values ('${mineId}','${sup1.id}')`)

  const rpc = async (token) => {
    const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/site_overview`, {
      method: 'POST',
      headers: {
        apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_on: today }),
    })
    return (await r.json())?.[0]
  }
  const ownerToken = await supabaseToken(env.SEED_OWNER_EMAIL, env.SEED_OWNER_PASSWORD)

  // ── P1-DB-13 · RPC เป็น security invoker จริง ────────────────────
  // 🔴 ถ้าเผลอเขียนเป็น definer ตัวเลขทั้งบริษัทจะหลุดไปหาหัวหน้าโครงการทันที
  // โดยหน้าจอดูปกติทุกอย่าง · เทียบสองฝั่งในการตรวจเดียวจึงเป็นทางเดียวที่จับได้
  {
    const o = await rpc(ownerToken)
    const s = await rpc(supToken)
    // ค่างานเป็นความลับจากหัวหน้าโครงการแล้ว (P1-DB-16) แถวนี้จึงวัดที่ **การนับโครงการ**
    // ซึ่งยังเป็นตัวชี้ว่า invoker ทำงาน: definer จะทำให้เขานับได้ทั้งบริษัท
    check('P1-DB-13 site_overview() เป็น security invoker — เจ้าของนับได้ทุกโครงการ หัวหน้าโครงการนับได้แค่ของตัวเอง',
      o?.active_count >= 2 && o?.overdue_count >= 1
      && Number(s?.active_count) === 1 && Number(s?.overdue_count) === 0
      && Number(s?.total_count) === 1,
      `เจ้าของ active=${o?.active_count} เลยกำหนด=${o?.overdue_count} · หัวหน้าโครงการ active=${s?.active_count} total=${s?.total_count}`)
  }

  // ── P1-UI-09 · หน้าภาพรวมของเจ้าของ ──────────────────────────────
  {
    const html = await page('/', ownerJar)
    const want = ['กำลังก่อสร้าง', 'ค่างานที่รับไว้', 'ใกล้ครบกำหนด', 'เลยกำหนดแล้ว',
      'ทดสอบ ภาพรวม โครงการของหัวหน้า', 'ทดสอบ ภาพรวม โครงการเลยกำหนด']
    const missing = want.filter((w) => !html.includes(w))
    // โครงการที่ปิดแล้วต้องไม่อยู่ในรายการ "กำลังก่อสร้าง"
    const leaked = html.includes('ทดสอบ ภาพรวม โครงการปิดแล้ว')
    check('P1-UI-09 ภาพรวมของเจ้าของ: การ์ด 4 ใบ + โครงการที่กำลังทำ · โครงการที่ปิดแล้วไม่โผล่',
      missing.length === 0 && !leaked,
      missing.length ? `ขาด: ${missing.join(', ')}` : `4 การ์ด · โครงการปิดแล้วรั่ว=${leaked}`)
  }

  // ── P1-UI-10a · หัวหน้าโครงการเห็นเฉพาะของตัวเอง ────────────────────
  {
    const html = await page('/', supJar)
    check('P1-UI-10a ภาพรวมของหัวหน้าโครงการ: เห็นโครงการตัวเอง · ไม่เห็นโครงการอื่น · ไม่มีตัวเลขทั้งบริษัท',
      html.includes('ทดสอบ ภาพรวม โครงการของหัวหน้า')
      && !html.includes('ทดสอบ ภาพรวม โครงการเลยกำหนด')
      && html.includes('ภาพรวมเฉพาะโครงการที่คุณดูแล')
      && !html.includes('3,000,000'),
      'เห็นของตัวเอง ไม่เห็นของคนอื่น')
  }

  // ── P1-UI-13 · โครงการที่เลยกำหนดต้องขึ้นป้ายเตือน ──────────────────
  // ครึ่งบวก: โครงการที่ยังอยู่ในกำหนดต้องไม่ขึ้นป้ายนี้ในหน้าเดียวกัน
  {
    const html = await page('/', ownerJar)
    const overdueBlock = html.slice(html.indexOf('ทดสอบ ภาพรวม โครงการเลยกำหนด'))
      .slice(0, 900)
    const okBlock = html.slice(html.indexOf('ทดสอบ ภาพรวม โครงการของหัวหน้า')).slice(0, 900)
    check('P1-UI-13 โครงการที่เลยกำหนดขึ้นป้าย "เลยกำหนด" · โครงการที่ยังไม่เลยไม่ขึ้น',
      overdueBlock.includes('เลยกำหนด') && !okBlock.includes('เลยมา'),
      `โครงการเลยกำหนด=${overdueBlock.includes('เลยกำหนด')} · โครงการปกติสะอาด=${!okBlock.includes('เลยมา')}`)
  }
} finally {
  for (const id of created3) await sql(`delete from public.sites where id = '${id}'`)
  console.log(`  (ลบโครงการทดสอบชุดที่สาม ${created3.length} โครงการแล้ว)`)
}

// ── P1-CALC · แถบเวลา — ตรรกะบริสุทธิ์ ไม่ต้องมีฐานข้อมูล ────────────
console.log('\n── P1-CALC · แถบความคืบหน้าตามเวลา ────────────────────────')
{
  const { timeProgress } = await import('../src/lib/sites.ts')
  const pct = (s, e, t) => {
    const r = timeProgress(s, e, t)
    return r.kind === 'ok' ? r.percent : r.kind
  }

  // 1 มี.ค. – 31 ส.ค. = 184 วัน (นับรวมสองปลาย) · วันที่ 30 ส.ค. คือวันที่ 183
  const r = timeProgress('2026-03-01', '2026-08-31', '2026-08-30')
  check('P1-CALC-01 ช่วง 1 มี.ค.–31 ส.ค. · วันนี้ 30 ส.ค. → 183/184 วัน = 99%',
    r.kind === 'ok' && r.totalDays === 184 && r.elapsedDays === 183 && r.percent === 99,
    r.kind === 'ok' ? `${r.elapsedDays}/${r.totalDays} = ${r.percent}%` : r.kind)

  check('P1-CALC-02 วันนี้อยู่ก่อนวันเริ่ม → 0% ไม่ใช่ค่าติดลบ',
    pct('2026-03-01', '2026-08-31', '2026-01-15') === 0,
    `${pct('2026-03-01', '2026-08-31', '2026-01-15')}%`)

  check('P1-CALC-03 วันนี้อยู่หลังวันจบ → 100% ไม่เกิน 100',
    pct('2026-03-01', '2026-08-31', '2027-01-15') === 100,
    `${pct('2026-03-01', '2026-08-31', '2027-01-15')}%`)

  check('P1-CALC-04 ไม่ได้ตั้งวันเริ่มหรือวันจบ → unset (ไม่ใช่ 0% ที่อ่านเหมือนยังไม่เริ่ม)',
    pct(null, '2026-08-31', '2026-08-30') === 'unset'
    && pct('2026-03-01', null, '2026-08-30') === 'unset'
    && pct(null, null, '2026-08-30') === 'unset', 'ทั้ง 3 กรณี')

  // 🔴 วันเดียวกันต้องได้ 100% ไม่ใช่หารด้วยศูนย์
  const one = timeProgress('2026-05-05', '2026-05-05', '2026-05-05')
  check('P1-CALC-05b งานวันเดียว (เริ่มและจบวันเดียวกัน) → 1/1 วัน = 100% ไม่ใช่ NaN',
    one.kind === 'ok' && one.totalDays === 1 && one.percent === 100,
    one.kind === 'ok' ? `${one.elapsedDays}/${one.totalDays} = ${one.percent}%` : one.kind)

  // 🔴 กฎที่แดงได้ทุกเวลา — ต่างจาก P1-CALC-06 ที่ตัดสินได้แค่บางช่วงของวัน
  // `new Date().toISOString().slice(0,10)` คือวิธีหา "วันนี้" ที่ผิดตั้งแต่
  // 7 โมงเช้าเวลาไทยของทุกวันบนเซิร์ฟเวอร์ UTC และไม่มีอะไรฟ้อง
  {
    const { readFileSync, readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])
    const offenders = walk('src').filter((f) => /\.tsx?$/.test(f)).filter((f) => {
      const bare = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      return /toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/.test(bare)
        || /toISOString\(\)\s*\.\s*split\(/.test(bare)
    })
    check('P1-CALC-06b ไม่มีที่ไหนหา "วันนี้" ด้วย toISOString() (ซึ่งเป็นวัน UTC)',
      offenders.length === 0, offenders.length ? offenders.join(', ') : 'ตรวจซอร์สทั้ง src/ แล้ว')
  }
}

// ── P1-DB-12 · ทุกคอลัมน์ที่ไม่ใช่ generated ต้องมีโค้ดเขียน ──────────
// คอลัมน์ที่ schema มีให้แต่ไม่มีใครเขียนลงไป คือฟีเจอร์ที่ออกแบบไว้แล้วไม่ได้สร้าง
// — `tsc` เขียว หน้าจอปกติ และไม่มีอะไรบอกเลยว่ามันว่างอยู่ตลอดกาล
{
  const { readFileSync, readdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])
  const src = walk('src').filter((f) => /\.tsx?$/.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')
    // ตัดคอมเมนต์ก่อน — คอมเมนต์ที่อธิบายคอลัมน์จะทำให้ผ่านโดยไม่มีใครเขียนจริง
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // 🔴 แล้วตัด **สตริง** ทิ้งด้วย — `.select('id, seq, planned_amount, planned_date')`
    // ทำให้ทุกคอลัมน์ในลิสต์ดูเหมือนถูกเขียน ทั้งที่มันคือการ *อ่าน*
    // (จับได้ตอน red-test: ลบ `planned_date` ออกจาก payload แล้วแถวยังเขียว)
    .replace(/'[^'\n]*'/g, "''").replace(/"[^"\n]*"/g, '""').replace(/`[^`]*`/g, '``')

  const COLUMNS = [
    'name', 'client_name', 'client_phone', 'address', 'contract_amount',
    'start_date', 'end_date', 'status',
    'effective_from', 'effective_to',
    'seq', 'planned_amount', 'planned_date',
  ]

  // 🔴 `client_name: string | null` ในนิยาม type ก็แมตช์ `client_name:` เหมือนกัน
  // ปล่อยไว้แถวนี้จะเขียวเพราะ "มีคนประกาศชนิดของคอลัมน์" ไม่ใช่เพราะมีคนเขียนค่า
  // จึงต้องตัดรูปแบบที่ตามด้วยคำที่เป็นชนิดข้อมูลออก และยอมรับรูปย่อ (`name,`) ด้วย
  // 🔴 `:\s*(?!string)` ใช้ไม่ได้ — `\s*` ถอยกลับไปแมตช์ศูนย์ตัวได้ แล้ว lookahead
  // จะไปตรวจที่ตัวเว้นวรรค ซึ่งไม่ใช่ `string` จึงผ่านตลอด · ต้อง **จับค่า**
  // ที่อยู่หลังโคลอนออกมาเทียบตรง ๆ (เจอตอน red-test: ลบ payload ออกแล้วยังเขียว)
  const TYPE_WORDS = new Set([
    'string', 'number', 'boolean', 'unknown', 'null', 'Date', 'SiteStatus', 'ReactNode',
  ])
  const writes = (c) => {
    const re = new RegExp(`\\b${c}\\s*(?:(,)|:\\s*([^\\s,;}]+))`, 'g')
    let m
    while ((m = re.exec(src)) !== null) {
      if (m[1]) return true                                  // รูปย่อ `name,`
      if (!TYPE_WORDS.has(m[2])) return true                 // `name: <ค่าจริง>`
    }
    return false
  }
  const orphans = COLUMNS.filter((c) => !writes(c))
  check('P1-DB-12 ทุกคอลัมน์ของ P1 มีโค้ดที่เขียนค่าลงไปจริง',
    orphans.length === 0, orphans.length ? `ไม่มีใครเขียน: ${orphans.join(', ')}` : `${COLUMNS.length} คอลัมน์`)
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok === true).length
const skip = results.filter((r) => r.ok === 'skip').length
const fail = results.length - pass - skip
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${fail} · undecided ${skip}`)
process.exit(fail ? 1 : 0)
