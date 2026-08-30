#!/usr/bin/env node
/**
 * verify-money.mjs — ปิดแถว P2-CALC-01..08 และปลดล็อก P1-CALC-07 / P1-CALC-08
 *
 * 🔴 ห้ามแถวใดผ่านบน `0 === 0`
 * ยอดเงินเป็นที่ที่กับดักนี้แพงที่สุด — จอโชว์ ฿0 · RPC คืน 0 · SQL คืน 0
 * แล้วทั้งสามชั้น "ตรงกัน" ทั้งที่ไม่เคยมีการบวกเกิดขึ้นเลยสักครั้ง
 * ทุกแถวในไฟล์นี้จึง **สร้างข้อมูลจริงก่อน** แล้วคืนค่าใน `finally`
 *
 * 🔴 อ่านตัวเลขจาก **การ์ดของไซต์นั้น** ไม่ใช่จากทั้งหน้า
 * หน้าภาพรวมมีหลายการ์ด · regex ที่กวาดทั้งหน้าจะจับตัวเลขของการ์ดอื่น
 * แล้วเช็คหลายแถวจะรายงานเลขเดียวกันหมดโดยเขียวทั้งกอง
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

const req = (method, path, body) =>
  fetch(`${BASE}${path}`, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const jarOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

/** Next ฝัง RSC payload ไว้ใน <script> — ข้อความทุกคำจึงปรากฏสองครั้ง */
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '')
const page = async (path, cookie) =>
  visible(await (await fetch(`${BASE}${path}`, { headers: { cookie } })).text())

/** ชิ้นส่วน HTML ของการ์ดไซต์ใบเดียว — ตัวเลขที่อ่านได้จึงเป็นของไซต์นั้นแน่ ๆ */
const cardOf = (html, siteId) =>
  html.split('href="/sites/').find((c) => c.startsWith(`${siteId}"`)) ?? null

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

console.log('\n── P2-CALC · ตัวเลขเงินต่อไซต์ ──────────────────────────────')

const ownerJar = jarOf(await req('POST', '/api/auth/login', {
  email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }))
const supJar = jarOf(await req('POST', '/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN }))
if (!ownerJar || !supJar) throw new Error('ล็อกอินไม่สำเร็จ — dev server รันอยู่ไหม')

const [sup1] = (await sql(
  `select id from public.profiles where full_name = '${env.SEED_SUPERVISOR1_NAME}'`)).rows
const [expCat] = (await sql(
  "select id from public.categories where kind='expense' order by sort_order limit 1")).rows
const [incCat] = (await sql(
  "select id from public.categories where kind='income' order by sort_order limit 1")).rows
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

const NAME = { a: 'ทดสอบเงิน ไซต์กำไรดี', b: 'ทดสอบเงิน ไซต์ต้นทุนแซง', c: 'ทดสอบเงิน ไซต์ยังไม่ตั้งค่างาน' }
let A = null
let B = null
let C = null

try {
  // ── fixture ─────────────────────────────────────────────────────────
  // 🔴 วันจบงานเป็นอดีตโดยตั้งใจ — หน้าภาพรวมเรียงตาม `end_date` จากน้อยไปมาก
  // ไซต์ทดสอบจึงอยู่ต้นลิสต์เสมอ ไม่ว่าฐานข้อมูลจะมีไซต์จริงกี่ไซต์
  const mk = async (name, contract) => {
    const [{ id }] = (await sql(
      `insert into public.sites(name, status, start_date, end_date)
       values ('${name}', 'active', '2000-01-01', '2000-06-30') returning id`)).rows
    if (contract !== null) {
      await sql(`update public.site_finance set contract_amount = ${contract} where site_id = '${id}'`)
    }
    return id
  }
  A = await mk(NAME.a, 1000000)
  B = await mk(NAME.b, 1000000)
  C = await mk(NAME.c, null) // ไม่ตั้งค่างาน → 0

  await sql(`insert into public.site_supervisors(site_id, profile_id) values ('${A}','${sup1.id}')`)

  await sql(`insert into public.transactions
      (kind, site_id, category_id, amount, txn_date, pay_method, status, note, income_kind)
    values
      ('income','${A}','${incCat.id}', 400000, '${today}', 'transfer', 'approved', 'เงินทดสอบ A รับแล้ว', 'deposit'),
      ('income','${A}','${incCat.id}', 100000, '${today}', 'transfer', 'pending',  'เงินทดสอบ A รออนุมัติ', 'installment'),
      ('expense','${A}','${expCat.id}', 300000, '${today}', 'cash', 'approved', 'ต้นทุนทดสอบ A', null),
      ('income','${B}','${incCat.id}', 100000, '${today}', 'transfer', 'approved', 'เงินทดสอบ B รับแล้ว', 'deposit'),
      ('expense','${B}','${expCat.id}', 500000, '${today}', 'cash', 'approved', 'ต้นทุนทดสอบ B', null)`)

  // ── P2-CALC-01 · เก็บเงินแล้ว = เฉพาะ approved ──────────────────────
  // 🔴 400,000 approved + 100,000 pending → ต้องได้ 40% ไม่ใช่ 50%
  // ถ้านับ pending ด้วย ตัวเลขจะเปลี่ยนตอนกดอนุมัติ ทั้งที่ไม่มีเงินเข้าจริง
  {
    const card = cardOf(await page('/', ownerJar), A)
    const paid = card && /เก็บเงินแล้ว[\s\S]{0,300}?฿([\d,]+) · (\d+)%/.exec(card)
    check('P2-CALC-01 เก็บเงินแล้วนับเฉพาะ approved — ฿400,000 · 40% (ไม่ใช่ 50%)',
      Boolean(paid) && paid[1] === '400,000' && paid[2] === '40',
      card ? `อ่านได้ ฿${paid?.[1]} · ${paid?.[2]}%` : 'ไม่พบการ์ดไซต์ A')
  }

  // ── P2-CALC-02 · ต้นทุน + กำไรคงเหลือ ───────────────────────────────
  {
    const card = cardOf(await page('/', ownerJar), A)
    const cost = card && /ต้นทุนที่จ่ายจริง[\s\S]{0,300}?฿([\d,]+) · (\d+)%/.exec(card)
    const profit = card && /กำไรคงเหลือ[\s\S]{0,200}?฿([\d,]+)/.exec(card)
    check('P2-CALC-02 ต้นทุน ฿300,000 · 30% และกำไรคงเหลือ ฿700,000',
      Boolean(cost) && cost[1] === '300,000' && cost[2] === '30'
      && Boolean(profit) && profit[1] === '700,000',
      `ต้นทุน ฿${cost?.[1]} · ${cost?.[2]}% · กำไร ฿${profit?.[1]}`)
  }

  // ── P2-CALC-05 · rejected ไม่ถูกนับ ─────────────────────────────────
  // วัดก่อน–หลัง แทนที่จะดูแค่ว่าเลขสุดท้ายถูก · เลขที่ถูกอาจถูกด้วยเหตุผลอื่น
  {
    const before = cardOf(await page('/', ownerJar), A)
    const b = /ต้นทุนที่จ่ายจริง[\s\S]{0,300}?฿([\d,]+) · (\d+)%/.exec(before ?? '')
    await sql(`insert into public.transactions
      (kind, site_id, category_id, amount, txn_date, pay_method, status, note, rejected_reason)
      values ('expense','${A}','${expCat.id}', 999999, '${today}', 'cash', 'rejected',
              'ต้นทุนทดสอบ A ที่ถูกตีกลับ', 'ตีกลับเพื่อทดสอบ')`)
    const after = cardOf(await page('/', ownerJar), A)
    const a = /ต้นทุนที่จ่ายจริง[\s\S]{0,300}?฿([\d,]+) · (\d+)%/.exec(after ?? '')
    check('P2-CALC-05 รายการที่ถูกตีกลับไม่ถูกนับ — ยอดก่อนและหลังเท่ากันที่ ฿300,000',
      Boolean(a) && a[1] === '300,000' && b?.[1] === a[1],
      `ก่อน ฿${b?.[1]} → หลัง ฿${a?.[1]}`)
  }

  // ── P2-CALC-04 · รายจ่ายส่วนกลางไม่เข้าไซต์ไหน ──────────────────────
  {
    const before = cardOf(await page('/', ownerJar), A)
    const b = /ต้นทุนที่จ่ายจริง[\s\S]{0,300}?฿([\d,]+)/.exec(before ?? '')
    await sql(`insert into public.transactions
      (kind, site_id, category_id, amount, txn_date, pay_method, status, note)
      values ('expense', null, '${expCat.id}', 50000, '${today}', 'cash', 'approved',
              'ค่าน้ำมันทดสอบส่วนกลาง')`)
    const after = cardOf(await page('/', ownerJar), A)
    const a = /ต้นทุนที่จ่ายจริง[\s\S]{0,300}?฿([\d,]+)/.exec(after ?? '')
    check('P2-CALC-04 รายจ่ายส่วนกลาง (site_id is null) ไม่ขยับต้นทุนของไซต์ใด',
      Boolean(a) && a[1] === '300,000' && b?.[1] === a[1],
      `ก่อน ฿${b?.[1]} → หลัง ฿${a?.[1]}`)
  }

  // ── P2-CALC-03 / P1-CALC-07 · ป้ายต้นทุนแซง ─────────────────────────
  // 🔴 ต้องตรวจทั้งฝั่ง "ขึ้น" และฝั่ง "ไม่ขึ้น" ในหน้าเดียวกัน
  // ป้ายที่ขึ้นทุกใบก็ไม่ได้บอกอะไร และตรวจแค่ใบเดียวจะแยกสองกรณีนี้ไม่ออก
  {
    const html = await page('/', ownerJar)
    const cardA = cardOf(html, A)
    const cardB = cardOf(html, B)
    const LABEL = 'ต้นทุนโตเร็วกว่าเงินที่เก็บได้'
    check('P2-CALC-03 P1-CALC-07 ไซต์ที่ต้นทุน% แซงเก็บเงิน% ขึ้นป้าย · ไซต์ที่ยังไม่แซงไม่ขึ้น (หน้าเดียวกัน)',
      Boolean(cardA) && Boolean(cardB)
      && cardB.includes(LABEL) && !cardA.includes(LABEL),
      `B(50%>10%)=${cardB?.includes(LABEL)} · A(30%<40%)=${cardA?.includes(LABEL)}`)
  }

  // ── P2-CALC-06 · การ์ดรออนุมัติ ─────────────────────────────────────
  {
    const html = await page('/', ownerJar)
    // 🔴 ยึดกับ `href` ของการ์ด ไม่ใช่คำว่า "รออนุมัติ"
    // เมนูข้างมีคำนั้นอยู่แล้วทุกหน้า · ยึดกับข้อความจึงไปอ่านโดนแถบเมนู
    // แล้วได้ `undefined` ทั้งที่การ์ดถูกต้อง
    const i = html.indexOf('/ledger?status=pending')
    const slice = i < 0 ? "" : html.slice(i, i + 1600)
    const cnt = /(\d[\d,]*)<span[^>]*>รายการ/.exec(slice)
    const total = /รวม ฿([\d,]+)/.exec(slice)
    const [row] = (await sql(
      "select count(*)::int as c, coalesce(sum(amount),0)::bigint as t from public.transactions where status='pending'")).rows
    const wantTotal = Number(row.t).toLocaleString('en-US')
    check('P2-CALC-06 การ์ดรออนุมัติแสดงจำนวนรายการและยอดรวม ตรงกับ SQL',
      Number(row.c) > 0
      && cnt?.[1] === String(row.c) && total?.[1] === wantTotal,
      `จอ ${cnt?.[1]}/${total?.[1]} · SQL ${row.c}/${wantTotal}`)
  }

  // ── P2-CALC-07 · ค่างาน 0 → ห้ามหารด้วยศูนย์ ────────────────────────
  {
    const html = await page(`/sites/${C}`, ownerJar)
    const bad = ['NaN', 'Infinity'].filter((w) => html.includes(w))
    check('P2-CALC-07 ไซต์ที่ยังไม่ได้ตั้งค่างาน → บอกตรง ๆ ไม่มี NaN/Infinity',
      html.includes('ยังไม่ได้ตั้ง') && bad.length === 0,
      bad.length ? `เจอ ${bad.join(', ')}` : 'ข้อความแทนเปอร์เซ็นต์')
  }

  // ── P2-CALC-08 · หัวหน้าไซต์ไม่เห็นเงินฝั่งรายรับ ───────────────────
  // 🔴 ยึดกับหลักฐานฝั่งบวกในหน้าเดียวกัน — "ไม่เจอคำนี้" อย่างเดียวผ่านได้
  // แม้หน้าจะว่างเปล่าเพราะเหตุอื่น
  {
    const html = await page(`/sites/${A}`, supJar)
    const leaks = ['เก็บเงินแล้ว', 'กำไรคงเหลือ', 'ค่างานตามสัญญา', '1,000,000', '400,000']
      .filter((w) => html.includes(w))
    const sees = html.includes('รายจ่ายที่อนุมัติแล้ว') && html.includes('300,000')
    check('P2-CALC-08 หัวหน้าไซต์ไม่เห็นค่างาน/รายรับ/กำไร แต่เห็นยอดรายจ่ายไซต์ตัวเอง',
      leaks.length === 0 && sees,
      leaks.length ? `หลุด: ${leaks.join(', ')}` : `เห็นรายจ่าย=${sees}`)
  }

  // ── P1-CALC-08 · กำไรคงเหลือตรงกับ SQL ตรง ๆ ────────────────────────
  {
    const [row] = (await sql(`
      select (
        (select f.contract_amount from public.site_finance f where f.site_id = '${A}')
        - coalesce((select sum(t.amount) from public.transactions t
                    where t.site_id = '${A}' and t.kind = 'expense' and t.status = 'approved'), 0)
      )::bigint as profit`)).rows
    const want = Number(row.profit).toLocaleString('en-US')
    const html = await page(`/sites/${A}`, ownerJar)
    const i = html.indexOf('กำไรคงเหลือ')
    const got = /฿([\d,]+)/.exec(i < 0 ? '' : html.slice(i, i + 400))
    check('P1-CALC-08 กำไรคงเหลือ = ค่างาน − ต้นทุนที่เกิดขึ้นแล้ว ตรงกับ SQL',
      Number(row.profit) !== 0 && got?.[1] === want,
      `จอ ฿${got?.[1]} · SQL ฿${want}`)
  }
} finally {
  for (const id of [A, B, C]) {
    if (id) {
      await sql(`delete from public.transactions where site_id = '${id}'`)
      await sql(`delete from public.site_supervisors where site_id = '${id}'`)
      await sql(`delete from public.site_finance where site_id = '${id}'`)
      await sql(`delete from public.sites where id = '${id}'`)
    }
  }
  await sql("delete from public.transactions where site_id is null and note = 'ค่าน้ำมันทดสอบส่วนกลาง'")
  console.log('  (ลบข้อมูลทดสอบแล้ว)')
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
