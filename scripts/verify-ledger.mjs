#!/usr/bin/env node
/**
 * verify-ledger.mjs — ปิดแถว P2-UI-09 ถึง P2-UI-16 ใน docs/test-plan/P2.md
 *
 * 🔴 แถวที่จับบั๊กได้บ่อยที่สุดคือ `P2-UI-15` (การแบ่งหน้า)
 * offset pagination จะทำให้แถว **ซ้ำหรือหาย** เมื่อมีคนบันทึกรายการใหม่
 * ระหว่างที่อีกคนกำลังเลื่อนดู · อาการคือ "ตัวเลขไม่ตรง" ที่ไล่หาไม่เจอ
 * เพราะข้อมูลถูกต้องทุกแถว แค่มีบางแถวไม่เคยถูกแสดง
 *
 * fixture ทุกตัวคืนค่าใน finally
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
/**
 * HTML ที่ **มองเห็นบนหน้าจอ** เท่านั้น
 *
 * 🔴 Next ฝัง RSC payload ไว้ในแท็ก <script> ของหน้าเดียวกัน ข้อความทุกคำ
 * จึงปรากฏ **สองครั้ง** · ตัวตรวจที่นับจากทั้งหน้าจะได้เลขเป็นสองเท่าเสมอ
 * แล้วรายงานว่า "แถวซ้ำ" ทั้งที่หน้าจอถูกต้อง — เจอตอน P2-UI-15 นับได้ 70
 * จาก 35 แถว · ตัดสคริปต์ทิ้งก่อนอ่านเสมอ
 */
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '')
const page = async (path, cookie) =>
  visible(await (await fetch(`${BASE}${path}`, { headers: { cookie } })).text())

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
  if (!r.ok) return { error: t }
  return { rows: JSON.parse(t) }
}

console.log('\n── P2-UI · หน้ารายการรายรับ-รายจ่าย ────────────────────────')

const ownerJar = jarOf(await req('POST', '/api/auth/login', {
  email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }))
const supJar = jarOf(await req('POST', '/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN }))
if (!ownerJar || !supJar) throw new Error('ล็อกอินไม่สำเร็จ — dev server รันอยู่ไหม')

const [sup1] = (await sql(
  `select id from public.profiles where full_name = '${env.SEED_SUPERVISOR1_NAME}'`)).rows
const [expCat] = (await sql(
  "select id, name from public.categories where kind='expense' order by sort_order limit 1")).rows
const [incCat] = (await sql(
  "select id, name from public.categories where kind='income' order by sort_order limit 1")).rows
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

let mineId = null
let othersId = null
try {
  ;[{ id: mineId }] = (await sql(
    `insert into public.sites(name) values ('ทดสอบ LEDGER ไซต์ของหัวหน้า') returning id`)).rows
  ;[{ id: othersId }] = (await sql(
    `insert into public.sites(name) values ('ทดสอบ LEDGER ไซต์คนอื่น') returning id`)).rows
  await sql(`insert into public.site_supervisors(site_id, profile_id)
             values ('${mineId}','${sup1.id}')`)

  // ── ข้อมูลตั้งต้นที่ครอบทุกสถานะและทุกชนิด ────────────────────────
  await sql(`insert into public.transactions
      (kind, site_id, category_id, amount, txn_date, pay_method, status, note, income_kind, rejected_reason)
    values
      ('expense','${mineId}','${expCat.id}', 1000, '${today}', 'cash', 'pending',
       'ค่าปูน ร้านเจริญ, สาขาสอง', null, null),
      ('expense','${mineId}','${expCat.id}', 2000, '${today}', 'transfer', 'approved',
       'ค่าเหล็กเส้น', null, null),
      ('expense','${mineId}','${expCat.id}', 3000, '${today}', 'cash', 'rejected',
       'ค่าอะไรไม่รู้', null, 'ไม่มีสลิป'),
      ('expense','${othersId}','${expCat.id}', 4000, '${today}', 'cash', 'approved',
       'รายจ่ายของไซต์คนอื่น', null, null),
      ('expense', null, '${expCat.id}', 500, '${today}', 'cash', 'approved',
       'ค่าน้ำมันรถเจ้าของ', null, null),
      ('income','${mineId}','${incCat.id}', 400000, '${today}', 'transfer', 'approved',
       'มัดจำงวดแรก', 'deposit', null)`)

  // ── P2-UI-09 · เจ้าของเห็นทุกอย่าง ────────────────────────────────
  {
    const html = await page('/ledger', ownerJar)
    const want = ['ค่าเหล็กเส้น', 'มัดจำงวดแรก', 'ค่าน้ำมันรถเจ้าของ', 'รายจ่ายของไซต์คนอื่น']
    const missing = want.filter((w) => !html.includes(w))
    check('P2-UI-09 เจ้าของเห็นทั้งรายรับ รายจ่าย ทุกไซต์ และส่วนกลาง',
      missing.length === 0, missing.length ? `ขาด: ${missing.join(', ')}` : '4/4')
  }

  // ── P2-UI-10 · หัวหน้าไซต์เห็นเฉพาะของตัวเอง ──────────────────────
  {
    const html = await page('/ledger', supJar)
    check('P2-UI-10 หัวหน้าไซต์เห็นรายจ่ายไซต์ตัวเอง · ไม่เห็นไซต์อื่น รายรับ และส่วนกลาง',
      html.includes('ค่าเหล็กเส้น')
      && !html.includes('รายจ่ายของไซต์คนอื่น')
      && !html.includes('มัดจำงวดแรก')
      && !html.includes('ค่าน้ำมันรถเจ้าของ'),
      'ตรวจทั้งฝั่งเห็นและฝั่งไม่เห็นในหน้าเดียวกัน')
  }

  // ── P2-UI-11 · ป้ายผูกไซต์ vs ส่วนกลาง ────────────────────────────
  {
    const html = await page('/ledger', ownerJar)
    const central = html.includes('border-dashed') && html.includes('ส่วนกลาง')
    const bound = html.includes('ทดสอบ LEDGER ไซต์ของหัวหน้า')
    check('P2-UI-11 รายการส่วนกลางมีชิปขอบประ · รายการผูกไซต์แสดงชื่อไซต์',
      central && bound, `ขอบประ=${central} · ชื่อไซต์=${bound}`)
  }

  // ── P2-UI-12 · ป้ายสถานะครบ 3 ค่า ไม่มีค่าดิบ ─────────────────────
  {
    const html = await page('/ledger', ownerJar)
    const labels = ['รออนุมัติ', 'อนุมัติแล้ว', 'ตีกลับ']
    const missing = labels.filter((l) => !html.includes(l))
    // ค่าดิบต้องไม่โผล่เป็นข้อความบนแถว (ในลิงก์ตัวกรองมีได้ตามปกติ)
    const raw = ['>pending<', '>approved<', '>rejected<'].filter((r) => html.includes(r))
    check('P2-UI-12 ป้ายสถานะภาษาไทยครบ 3 ค่า และไม่มีค่าดิบภาษาอังกฤษบนแถว',
      missing.length === 0 && raw.length === 0,
      missing.length ? `ขาด: ${missing.join(', ')}` : `3/3 · ค่าดิบ ${raw.length}`)
  }

  // ── P2-UI-13 · ตัวกรองเปลี่ยนผลจริง และอยู่ใน URL ─────────────────
  {
    const pending = await page('/ledger?status=pending', ownerJar)
    const income = await page('/ledger?kind=income', ownerJar)
    const central = await page('/ledger?site=central', ownerJar)
    check('P2-UI-13 กรองสถานะ · ชนิด · ส่วนกลาง เปลี่ยนผลจริงทั้งฝั่งมีและฝั่งไม่มี',
      pending.includes('ค่าปูน') && !pending.includes('ค่าเหล็กเส้น')
      && income.includes('มัดจำงวดแรก') && !income.includes('ค่าเหล็กเส้น')
      && central.includes('ค่าน้ำมันรถเจ้าของ') && !central.includes('ค่าเหล็กเส้น'),
      'ทั้ง 3 ตัวกรอง')
  }

  // ── P2-UI-14 · คอมมาในคำค้น ───────────────────────────────────────
  // 🔴 คอมมาเป็นตัวคั่นเงื่อนไขของ PostgREST · ไม่ตัดทิ้งแล้วคำค้นจะกลาย
  // เป็นเงื่อนไขที่สอง ซึ่งคืนผลผิดโดยไม่มี error
  {
    const r = await fetch(`${BASE}/ledger?q=${encodeURIComponent('ร้านเจริญ, สาขาสอง')}`,
      { headers: { cookie: ownerJar } })
    const html = visible(await r.text())
    check('P2-UI-14 คำค้นที่มีคอมมาไม่พังและไม่กลายเป็นเงื่อนไขที่สอง',
      r.status === 200 && html.includes('ค่าปูน') && !html.includes('ค่าเหล็กเส้น'),
      `${r.status} · เจอรายการที่ตรง=${html.includes('ค่าปูน')}`)
  }

  // ── P2-UI-16 · สถานะว่างของการกรอง ────────────────────────────────
  {
    const html = await page('/ledger?q=ไม่มีทางมีรายการชื่อนี้', ownerJar)
    check('P2-UI-16 ค้นหาไม่เจอ → ข้อความคนละแบบกับ "ยังไม่มีรายการ"',
      html.includes('ไม่พบรายการที่ตรงกับเงื่อนไขนี้')
      && !html.includes('ยังไม่มีรายการ —'),
      'แยกสองสถานะออกจากกัน')
  }

  // ── P2-UI-15 · แบ่งหน้าแบบ keyset — ห้ามซ้ำ ห้ามหาย ───────────────
  // 🔴 สร้าง 35 แถวที่ **วันที่เดียวกันทั้งหมด** โดยตั้งใจ — offset pagination
  // จะดูปกติถ้าวันที่ต่างกัน ตัวตัดสินคือกรณีที่คีย์เรียงชนกัน
  {
    const values = Array.from({ length: 35 }, (_, i) =>
      `('expense','${othersId}','${expCat.id}', ${100 + i}, '${today}', 'cash', 'approved', 'แบ่งหน้า ${i}')`,
    ).join(',')
    await sql(`insert into public.transactions
      (kind, site_id, category_id, amount, txn_date, pay_method, status, note) values ${values}`)

    const seen = []
    let after = null
    for (let hop = 0; hop < 5; hop++) {
      const url = after
        ? `/ledger?site=${othersId}&after=${encodeURIComponent(after)}`
        : `/ledger?site=${othersId}`
      const html = await page(url, ownerJar)
      const ids = [...html.matchAll(/แบ่งหน้า (\d+)/g)].map((m) => Number(m[1]))
      seen.push(...ids)
      const next = /after=([^"&]+)/.exec(html)
      if (!next) break
      const decoded = decodeURIComponent(next[1])
      if (decoded === after) break
      after = decoded
    }
    const unique = new Set(seen)
    check('P2-UI-15 เลื่อนดู 35 แถววันที่เดียวกัน → ครบ 35 แถว ไม่ซ้ำไม่หาย',
      unique.size === 35 && seen.length === 35,
      `เห็น ${seen.length} แถว · ไม่ซ้ำ ${unique.size} แถว`)
  }
} finally {
  for (const id of [mineId, othersId]) {
    if (id) {
      await sql(`delete from public.transactions where site_id = '${id}'`)
      await sql(`delete from public.sites where id = '${id}'`)
    }
  }
  await sql("delete from public.transactions where site_id is null and note = 'ค่าน้ำมันรถเจ้าของ'")
  console.log('  (ลบข้อมูลทดสอบแล้ว)')
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
