#!/usr/bin/env node
/**
 * verify-txn.mjs — ปิดแถว P2-DB-* ใน docs/test-plan/P2.md
 *
 * เฟสนี้มีกฎที่บังคับด้วย **trigger** ไม่ใช่ policy โดยตั้งใจ —
 * policy ที่ปฏิเสธจะโดน 0 แถวแล้วตอบว่าสำเร็จ (เงียบ) ส่วน trigger `raise exception`
 * ให้ error จริงที่ผู้ใช้ได้เห็น · แถวปฏิเสธในนี้จึงยืนยัน **รหัสเหตุผล**
 * ไม่ใช่แค่ว่ามี error
 *
 * fixture ทุกตัวคืนค่าใน finally · ทุก "0 แถว" มีการพิสูจน์ฝั่งบวกคู่กัน
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)
const URL = env.NEXT_PUBLIC_SUPABASE_URL
const PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
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
  const text = await r.text()
  if (!r.ok) return { error: text }
  return { rows: JSON.parse(text) }
}

/** ยิง PostgREST ในนามใครสักคน · anon = ไม่ส่ง Authorization */
async function db(token, path, init = {}) {
  const headers = { apikey: PUB, 'Content-Type': 'application/json', ...init.headers }
  if (token !== 'anon') headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${URL}/rest/v1${path}`, { ...init, headers })
  const t = await r.text()
  let body = null
  try { body = t ? JSON.parse(t) : null } catch { body = t }
  return { status: r.status, ok: r.ok, body, raw: t }
}
const msgOf = (res) =>
  typeof res.body === 'object' && res.body ? String(res.body.message ?? '') : String(res.raw ?? '')

const { derivePassword, syntheticEmail } = await import('../src/lib/pin-core.ts')
const tok = async (email, password) => {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: PUB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(JSON.stringify(j))
  return j.access_token
}

console.log('\n── P2-DB · รายรับ-รายจ่าย · หมวด · สลิป ────────────────────')

const ownerTok = await tok(env.SEED_OWNER_EMAIL, env.SEED_OWNER_PASSWORD)
const supTok = await tok(
  syntheticEmail('sup1'), derivePassword(env.PIN_PEPPER, env.SEED_SUPERVISOR1_PIN),
)
const [sup1] = (await sql(
  `select id from public.profiles where full_name = '${env.SEED_SUPERVISOR1_NAME}'`)).rows
const [expCat] = (await sql(
  `select id from public.categories where kind='expense' order by sort_order limit 1`)).rows
const [incCat] = (await sql(
  `select id from public.categories where kind='income' order by sort_order limit 1`)).rows

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

let mineId = null
let othersId = null
try {
  ;[{ id: mineId }] = (await sql(
    `insert into public.sites(name) values ('ทดสอบ P2 โครงการของหัวหน้า') returning id`)).rows
  ;[{ id: othersId }] = (await sql(
    `insert into public.sites(name) values ('ทดสอบ P2 โครงการคนอื่น') returning id`)).rows
  await sql(`insert into public.site_supervisors(site_id, profile_id)
             values ('${mineId}','${sup1.id}')`)

  const txnCount = async () =>
    (await sql('select count(*)::int as n from public.transactions')).rows[0].n

  const post = (token, row) =>
    db(token, '/transactions', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    })

  const expense = (over = {}) => ({
    kind: 'expense', site_id: mineId, category_id: expCat.id,
    amount: 1000, txn_date: today, pay_method: 'cash', ...over,
  })

  // ── P2-DB-01 · หัวหน้าโครงการคีย์รายจ่ายของโครงการตัวเอง ────────────────
  let mineTxn = null
  {
    const before = await txnCount()
    const r = await post(supTok, expense({ note: 'ค่าปูนซีเมนต์ 10 ถุง' }))
    mineTxn = Array.isArray(r.body) ? r.body[0]?.id : null
    const after = await txnCount()
    const { rows: audit } = await sql(
      `select count(*)::int as n from public.audit_log
       where table_name='transactions' and action='INSERT' and row_id='${mineTxn}'`)
    check('P2-DB-01 หัวหน้าโครงการคีย์รายจ่ายโครงการตัวเองได้ · status=pending · มี audit',
      r.status === 201 && after === before + 1
      && r.body?.[0]?.status === 'pending' && audit[0].n === 1,
      `${r.status} · ${before}→${after} · status ${r.body?.[0]?.status} · audit ${audit[0].n}`)
  }

  // ── P2-DB-02 · โครงการที่ไม่ได้ดูแล ──────────────────────────────────
  {
    const before = await txnCount()
    const bad = await post(supTok, expense({ site_id: othersId }))
    const mid = await txnCount()
    // ครึ่งบวก: ของโครงการตัวเองยังเขียนได้ในคำสั่งถัดไป → ตารางไม่ได้พัง
    const good = await post(supTok, expense({ amount: 250 }))
    const after = await txnCount()
    check('P2-DB-02 หัวหน้าโครงการคีย์รายจ่ายโครงการที่ไม่ได้ดูแลไม่ได้ · ของตัวเองยังได้',
      bad.status >= 400 && mid === before && good.status === 201 && after === before + 1,
      `โครงการคนอื่น ${bad.status} · ${before}→${mid}→${after}`)
  }

  // ── P2-DB-03 · ตั้ง status='approved' ตอน insert ──────────────────
  // 🔴 ต้องเป็น error ที่มีเหตุผล ไม่ใช่โดน 0 แถวเงียบ ๆ
  {
    const before = await txnCount()
    const r = await post(supTok, expense({ status: 'approved' }))
    const after = await txnCount()
    check('P2-DB-03 หัวหน้าโครงการตั้ง status=approved ตอนสร้าง → APPROVE_FORBIDDEN',
      /APPROVE_FORBIDDEN/.test(msgOf(r)) && after === before,
      `${r.status} · ${msgOf(r).slice(0, 60)}`)
  }

  // ── P2-DB-04 · แก้ status ของรายการตัวเองเป็น approved ────────────
  {
    const r = await db(supTok, `/transactions?id=eq.${mineTxn}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'approved' }),
    })
    const { rows } = await sql(
      `select status::text as s from public.transactions where id='${mineTxn}'`)
    check('P2-DB-04 หัวหน้าโครงการอนุมัติรายการตัวเองไม่ได้ → APPROVE_FORBIDDEN · ยัง pending',
      /APPROVE_FORBIDDEN/.test(msgOf(r)) && rows[0].s === 'pending',
      `${r.status} · สถานะ ${rows[0].s}`)
  }

  // ── P2-DB-19 · created_by ถูกเติมโดยฐานข้อมูล และแก้ของตัวเองได้จริง ──
  // 🔴 นี่คือรากของบั๊กที่ P2-DB-04 จับได้: ไม่มีอะไรเติม created_by เลย
  // ค่าจึงเป็น null แล้วเงื่อนไข `created_by = auth.uid()` ในทุก policy
  // กลายเป็น null (ไม่ใช่ true) — กฎที่เขียนไว้สวยงามแต่เป็นจริงไม่ได้
  {
    const { rows } = await sql(
      `select created_by from public.transactions where id='${mineTxn}'`)
    const isSup = rows[0]?.created_by === sup1.id

    // ครึ่งบวก: แก้รายการ pending ของตัวเองได้จริง (ไม่ใช่แค่ "ไม่มี error")
    const edit = await db(supTok, `/transactions?id=eq.${mineTxn}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ note: 'แก้โน้ตโดยคนที่คีย์เอง' }),
    })
    const { rows: after } = await sql(
      `select note from public.transactions where id='${mineTxn}'`)
    check('P2-DB-19 created_by ถูกเติมเป็นคนที่คีย์ · เขาแก้รายการ pending ของตัวเองได้จริง',
      isSup && edit.status === 200 && after[0].note === 'แก้โน้ตโดยคนที่คีย์เอง',
      `created_by ตรงกับผู้คีย์=${isSup} · แก้ ${edit.status} · โน้ต "${after[0]?.note}"`)
  }

  // ── P2-DB-20 · ส่ง created_by ของคนอื่นมาใน payload ต้องไม่มีผล ─────
  // เรื่องเดียวกับ "ห้ามเชื่อ role ที่ client ส่งมา" — ถ้า default ทำงานแทน trigger
  // ค่าจาก client จะทับ default ได้ แล้วคนหนึ่งจะสร้างรายการในนามอีกคนได้ทันที
  {
    const [ownerRow] = (await sql(
      "select id from public.profiles where role='owner' limit 1")).rows
    const r = await post(supTok, expense({ amount: 55, created_by: ownerRow.id }))
    const id = Array.isArray(r.body) ? r.body[0]?.id : null
    const { rows } = await sql(`select created_by from public.transactions where id='${id}'`)
    check('P2-DB-20 created_by ที่ client ส่งมาถูกเพิกเฉย — ใช้ตัวตนจากเซสชันเสมอ',
      r.status === 201 && rows[0]?.created_by === sup1.id && rows[0]?.created_by !== ownerRow.id,
      `ส่งมาเป็นเจ้าของ แต่บันทึกเป็น ${rows[0]?.created_by === sup1.id ? 'ผู้คีย์จริง' : 'ค่าที่ส่งมา'}`)
  }

  // ── P2-DB-06 · เจ้าของอนุมัติได้ · approved_by ถูกเติมให้ ─────────
  {
    const r = await db(ownerTok, `/transactions?id=eq.${mineTxn}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'approved' }),
    })
    const { rows } = await sql(
      `select status::text as s, approved_by, approved_at from public.transactions
       where id='${mineTxn}'`)
    const { rows: audit } = await sql(
      `select count(*)::int as n from public.audit_log
       where table_name='transactions' and action='UPDATE' and row_id='${mineTxn}'
         and before->>'status' = 'pending'`)
    check('P2-DB-06 เจ้าของอนุมัติได้ · approved_by/at ถูกเติม · audit บันทึกค่าก่อนหน้า',
      r.status === 200 && rows[0].s === 'approved'
      && rows[0].approved_by && rows[0].approved_at && audit[0].n >= 1,
      `${r.status} · ${rows[0].s} · audit ${audit[0].n}`)
  }

  // ── P2-DB-05 · ยอดของรายการที่อนุมัติแล้ว — หัวหน้าโครงการแตะไม่ได้ ────
  // 🔴 แก้ความหมายเมื่อ R4: **เจ้าของ**แก้ได้แล้ว (รายการที่เจ้าของคีย์เอง
  // เกิดมาเป็น approved ทันที ล็อกไว้แปลว่าพิมพ์ผิดแล้วแก้ไม่ได้ตลอดกาล)
  // ส่วนหัวหน้าโครงการยังแตะไม่ได้เหมือนเดิม — การอนุมัติจึงยังมีความหมาย
  {
    const blocked = await db(supTok, `/transactions?id=eq.${mineTxn}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ amount: 88888 }),
    })
    const { rows: kept } = await sql(
      `select amount::float8 as a from public.transactions where id='${mineTxn}'`)
    check('P2-DB-05 หัวหน้าโครงการแก้ยอดของรายการที่อนุมัติแล้วไม่ได้ · ยอดเดิมคงอยู่',
      kept[0].a === 1000 && (blocked.status === 200 ? blocked.body?.length === 0 : true),
      `${blocked.status} · ยอด ${kept[0].a}`)

    const r = await db(ownerTok, `/transactions?id=eq.${mineTxn}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ amount: 99999 }),
    })
    const { rows } = await sql(
      `select amount::float8 as a from public.transactions where id='${mineTxn}'`)
    const { rows: audit } = await sql(
      `select count(*)::int as n from public.audit_log
       where table_name='transactions' and action='UPDATE' and row_id='${mineTxn}'
         and (before->>'amount')::float8 = 1000`)
    check('P2-DB-05b เจ้าของแก้ยอดของรายการที่อนุมัติแล้วได้ · ค่าเดิมถูกเก็บใน audit_log',
      r.status === 200 && rows[0].a === 99999 && audit[0].n >= 1,
      `${r.status} · ยอด ${rows[0].a} · audit ${audit[0].n}`)
  }

  // ── P2-DB-11 · ลบรายการที่ approved แล้ว — หัวหน้าโครงการไม่ได้ เจ้าของได้ ──
  // 🔴 แก้ความหมายเมื่อ R4 ด้วยเหตุผลเดียวกับ P2-DB-05 · ร่องรอยของแถวที่
  // ถูกลบยังอยู่ครบใน audit_log ซึ่งเป็นที่ที่ความรับผิดชอบอยู่จริง
  {
    const before = await txnCount()
    const blocked = await db(supTok, `/transactions?id=eq.${mineTxn}`, { method: 'DELETE' })
    const still = await txnCount()
    check('P2-DB-11 หัวหน้าโครงการลบรายการที่อนุมัติแล้วไม่ได้ · จำนวนเท่าเดิม',
      still === before, `${blocked.status} · ${before}→${still}`)

    const r = await db(ownerTok, `/transactions?id=eq.${mineTxn}`, { method: 'DELETE' })
    const after = await txnCount()
    const { rows: audit } = await sql(
      `select count(*)::int as n from public.audit_log
       where table_name='transactions' and action='DELETE' and row_id='${mineTxn}'
         and before is not null`)
    check('P2-DB-11b เจ้าของลบรายการที่อนุมัติแล้วได้ · audit_log เก็บค่าเดิมทั้งแถว',
      r.ok && after === before - 1 && audit[0].n >= 1,
      `${r.status} · ${before}→${after} · audit ${audit[0].n}`)
  }

  // ── P2-DB-07 · หัวหน้าโครงการคีย์รายรับไม่ได้ ────────────────────────
  {
    const before = await txnCount()
    const r = await post(supTok, {
      kind: 'income', site_id: mineId, category_id: incCat.id,
      amount: 500000, txn_date: today, pay_method: 'transfer', income_kind: 'deposit',
    })
    const after = await txnCount()
    check('P2-DB-07 หัวหน้าโครงการบันทึกรายรับไม่ได้ → ถูกปฏิเสธ · จำนวนเท่าเดิม',
      r.status >= 400 && after === before, `${r.status} · ${msgOf(r).slice(0, 50)}`)
  }

  // ── P2-DB-08 · หัวหน้าโครงการอ่านรายรับของโครงการตัวเองไม่ได้ ───────────
  {
    await sql(`insert into public.transactions(kind, site_id, category_id, amount, txn_date,
                 pay_method, status, income_kind)
               values ('income','${mineId}','${incCat.id}', 400000, '${today}', 'transfer',
                       'approved', 'deposit')`)
    const inc = await db(supTok, `/transactions?select=id&kind=eq.income&site_id=eq.${mineId}`)
    const exp = await db(supTok, `/transactions?select=id&kind=eq.expense&site_id=eq.${mineId}`)
    const ownerInc = await db(ownerTok, `/transactions?select=id&kind=eq.income&site_id=eq.${mineId}`)
    check('P2-DB-08 หัวหน้าโครงการเห็นรายรับ 0 แถว · เห็นรายจ่ายของโครงการเดียวกัน > 0 · เจ้าของเห็นรายรับ',
      (Array.isArray(inc.body) ? inc.body.length : -1) === 0
      && exp.body?.length > 0 && ownerInc.body?.length > 0,
      `รายรับ ${Array.isArray(inc.body) ? inc.body.length : inc.status} · รายจ่าย ${exp.body?.length} · เจ้าของ ${ownerInc.body?.length}`)
  }

  // ── P2-DB-09 · รายจ่ายส่วนกลางไม่หลุดไปหาหัวหน้าโครงการ ──────────────
  {
    await sql(`insert into public.transactions(kind, site_id, category_id, amount, txn_date,
                 pay_method, status)
               values ('expense', null, '${expCat.id}', 777, '${today}', 'cash', 'approved')`)
    const sup = await db(supTok, '/transactions?select=id&site_id=is.null')
    const own = await db(ownerTok, '/transactions?select=id&site_id=is.null')
    check('P2-DB-09 หัวหน้าโครงการเห็นรายจ่ายส่วนกลาง 0 แถว · เจ้าของเห็น > 0',
      (Array.isArray(sup.body) ? sup.body.length : -1) === 0 && own.body?.length > 0,
      `หัวหน้าโครงการ ${Array.isArray(sup.body) ? sup.body.length : sup.status} · เจ้าของ ${own.body?.length}`)
  }

  // ── P2-DB-10 · anon ไม่เห็นอะไรเลย ────────────────────────────────
  {
    const bad = []
    for (const t of ['transactions', 'attachments', 'upload_intents']) {
      const a = await db('anon', `/${t}?select=id`)
      if ((Array.isArray(a.body) ? a.body.length : -1) !== 0) bad.push(`${t}:${a.status}`)
    }
    const own = await db(ownerTok, '/transactions?select=id')
    check('P2-DB-10 anon อ่าน 3 ตารางได้ 0 แถวทั้งหมด · เจ้าของอ่านได้ > 0',
      bad.length === 0 && own.body?.length > 0,
      bad.length ? bad.join(', ') : `เจ้าของ ${own.body?.length} แถว`)
  }

  // ── P2-DB-12 / 13 / 14 · constraint ที่ schema บังคับ ─────────────
  {
    const cases = [
      ['P2-DB-12 จำนวนเงิน ≤ 0', expense({ amount: 0 }), /check|constraint/i],
      ['P2-DB-13 รายจ่ายแต่ใส่ income_kind', expense({ income_kind: 'deposit' }), /check|constraint/i],
      ['P2-DB-14 หมวดคนละชนิดกับรายการ', expense({ category_id: incCat.id }), /CATEGORY_KIND_MISMATCH/],
    ]
    const bad = []
    for (const [label, row, re] of cases) {
      const before = await txnCount()
      const r = await post(ownerTok, row)
      const after = await txnCount()
      if (!(re.test(msgOf(r)) && after === before)) bad.push(`${label} → ${r.status} ${msgOf(r).slice(0, 40)}`)
    }
    check('P2-DB-12 P2-DB-13 P2-DB-14 constraint ปฏิเสธค่าที่เป็นไปไม่ได้ · ไม่มีแถวใหม่',
      bad.length === 0, bad.length ? bad.join(' · ') : '3/3')
  }
} finally {
  for (const id of [mineId, othersId]) {
    if (id) {
      await sql(`delete from public.attachments a using public.transactions t
                 where a.transaction_id = t.id and t.site_id = '${id}'`)
      await sql(`delete from public.transactions where site_id = '${id}'`)
      await sql(`delete from public.sites where id = '${id}'`)
    }
  }
  await sql("delete from public.transactions where site_id is null and amount = 777")
  console.log('  (ลบข้อมูลทดสอบแล้ว)')
}

// ══════════════════════════════════════════════════════════════════════
// P2-API / P2-UI · ฟอร์มบันทึกและ endpoint (ต้องมี dev server รันอยู่)
// ══════════════════════════════════════════════════════════════════════
console.log('\n── P2-API / P2-UI · ฟอร์มบันทึก ────────────────────────────')

const BASE = process.argv[2] ?? 'http://localhost:3100'
const req = (method, path, body, headers = {}) =>
  fetch(`${BASE}${path}`, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const jarOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
const page = async (path, cookie) => (await fetch(`${BASE}${path}`, { headers: { cookie } })).text()

const ownerJar = jarOf(await req('POST', '/api/auth/login', {
  email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }))
const supJar = jarOf(await req('POST', '/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN }))
if (!ownerJar || !supJar) throw new Error('ล็อกอินไม่สำเร็จ — dev server รันอยู่ไหม')

let apiSite = null
let apiOther = null
let tempCategoryId = null
const apiTxns = []
try {
  ;[{ id: apiSite }] = (await sql(
    `insert into public.sites(name) values ('ทดสอบ P2API โครงการของหัวหน้า') returning id`)).rows
  ;[{ id: apiOther }] = (await sql(
    `insert into public.sites(name) values ('ทดสอบ P2API โครงการคนอื่น') returning id`)).rows
  await sql(`insert into public.site_supervisors(site_id, profile_id)
             values ('${apiSite}','${sup1.id}')`)

  const txnCount = async () =>
    (await sql('select count(*)::int as n from public.transactions')).rows[0].n

  const create = async (jar, over = {}) => {
    const r = await req('POST', '/api/transactions', {
      kind: 'expense', siteId: apiSite, categoryId: expCat.id,
      amount: 1200, txnDate: today, payMethod: 'cash', ...over,
    }, { cookie: jar })
    const b = await r.json().catch(() => ({}))
    if (b.transaction?.id) apiTxns.push(b.transaction.id)
    return { status: r.status, body: b }
  }

  // ── P2-API-01 · ทุก endpoint ตอนไม่ล็อกอิน ────────────────────────
  {
    const seed = await create(ownerJar, { amount: 111 })
    const id = seed.body.transaction?.id
    const calls = [
      ['POST', '/api/transactions', { kind: 'expense' }],
      ['PATCH', `/api/transactions/${id}`, { action: 'approve' }],
      ['DELETE', `/api/transactions/${id}`, undefined],
    ]
    const bad = []
    for (const [m, path, body] of calls) {
      const r = await req(m, path, body)
      const ct = r.headers.get('content-type') ?? ''
      if (r.status !== 401 || !ct.includes('application/json')) bad.push(`${m} → ${r.status}`)
    }
    check('P2-API-01 ทุก endpoint ตอนไม่ล็อกอิน → 401 JSON (ไม่ใช่ 307)',
      bad.length === 0, bad.length ? bad.join(' · ') : '3/3')
  }

  // ── P2-API-02 · หัวหน้าโครงการบันทึกรายรับ ───────────────────────────
  {
    const before = await txnCount()
    const r = await create(supJar, { kind: 'income', categoryId: incCat.id, incomeKind: 'deposit' })
    const after = await txnCount()
    check('P2-API-02 หัวหน้าโครงการ POST รายรับ → 403 INCOME_FORBIDDEN · ไม่มีแถวใหม่',
      r.status === 403 && r.body.error === 'INCOME_FORBIDDEN' && after === before,
      `${r.status} ${r.body.error} · ${before}→${after}`)
  }

  // ── P2-API-07 · status ที่ client ส่งมาถูกเพิกเฉย ─────────────────
  let supTxn = null
  {
    const r = await create(supJar, { status: 'approved', amount: 333 })
    supTxn = r.body.transaction?.id
    const { rows } = await sql(
      `select status::text as s from public.transactions where id='${supTxn}'`)
    check('P2-API-07 หัวหน้าโครงการส่ง status=approved มาด้วย → ถูกเพิกเฉย แถวเป็น pending',
      r.status === 201 && rows[0].s === 'pending', `${r.status} · สถานะ ${rows[0].s}`)
  }

  // ── P2-API-03 · หัวหน้าโครงการอนุมัติผ่าน API ────────────────────────
  {
    const r = await req('PATCH', `/api/transactions/${supTxn}`,
      { action: 'approve' }, { cookie: supJar })
    const b = await r.json().catch(() => ({}))
    const { rows } = await sql(
      `select status::text as s from public.transactions where id='${supTxn}'`)
    check('P2-API-03 หัวหน้าโครงการ PATCH approve → 403 · สถานะยัง pending',
      r.status === 403 && rows[0].s === 'pending', `${r.status} ${b.error} · ${rows[0].s}`)
  }

  // ── P2-API-04 · PATCH รายการที่ไม่มีอยู่ ──────────────────────────
  {
    const r = await req('PATCH', '/api/transactions/00000000-0000-0000-0000-000000000000',
      { action: 'approve' }, { cookie: ownerJar })
    const b = await r.json().catch(() => ({}))
    check('P2-API-04 PATCH รายการที่ไม่มีอยู่ → 404 NOT_FOUND',
      r.status === 404 && b.error === 'NOT_FOUND', `${r.status} ${b.error}`)
  }

  // ── P2-API-05 / 06 / UI-07 · การตรวจ payload ──────────────────────
  {
    const cases = [
      ['P2-API-05 ปี พ.ศ.', { txnDate: '2569-08-30' }, 'DATE_BUDDHIST_ERA'],
      ['P2-API-06 วันในอนาคต', { txnDate: '2099-01-01' }, 'DATE_FUTURE'],
      ['P2-UI-07 ไม่ใส่จำนวนเงิน', { amount: 0 }, 'AMOUNT_INVALID'],
    ]
    const bad = []
    for (const [label, over, code] of cases) {
      const before = await txnCount()
      const r = await create(ownerJar, over)
      const after = await txnCount()
      if (!(r.status === 400 && r.body.error === code && after === before)) {
        bad.push(`${label} → ${r.status} ${r.body.error}`)
      }
    }
    check('P2-API-05 P2-API-06 P2-UI-07 payload ที่ผิดถูกปฏิเสธพร้อมรหัสเหตุผล · ไม่มีแถวใหม่',
      bad.length === 0, bad.length ? bad.join(' · ') : '3/3')
  }

  // ── P2-API-08 · กดสองครั้งพร้อมกัน ────────────────────────────────
  // 🔴 ยิงพร้อมกันจริง ไม่ใช่ยิงต่อกัน — การกดซ้ำที่อันตรายคือตอนที่คำขอแรก
  // ยังไม่ตอบกลับ ซึ่งเป็นจังหวะที่ปุ่ม disabled ยังไม่ทันมีผล
  {
    const ref = crypto.randomUUID()
    const before = await txnCount()
    const body = {
      kind: 'expense', siteId: apiSite, categoryId: expCat.id,
      amount: 4242, txnDate: today, payMethod: 'cash', clientRef: ref,
    }
    const [a, b] = await Promise.all([
      req('POST', '/api/transactions', body, { cookie: ownerJar }),
      req('POST', '/api/transactions', body, { cookie: ownerJar }),
    ])
    const after = await txnCount()
    const { rows } = await sql(
      `select id from public.transactions where client_ref='${ref}'`)
    for (const r of rows) apiTxns.push(r.id)
    check('P2-API-08 ยิงบันทึกซ้ำพร้อมกันด้วย clientRef เดิม → เพิ่มแถวเดียว · ทั้งคู่ไม่ error',
      after === before + 1 && rows.length === 1 && a.status < 400 && b.status < 400,
      `${before}→${after} · แถวที่มี ref นี้ ${rows.length} · ${a.status}/${b.status}`)
  }

  // ── P2-UI-01 / 02 · ฟอร์มต่างกันตาม role ──────────────────────────
  {
    const sup = await page('/entry', supJar)
    const own = await page('/entry', ownerJar)
    check('P2-UI-01 P2-UI-02 หัวหน้าโครงการไม่มีปุ่มสลับไปรายรับ · เจ้าของมีทั้งสองปุ่ม',
      !sup.includes('aria-pressed') && sup.includes('บันทึกรายจ่าย')
      && own.includes('aria-pressed') && own.includes('รายรับ'),
      `หัวหน้าโครงการมีปุ่มสลับ=${sup.includes('aria-pressed')} · เจ้าของมี=${own.includes('aria-pressed')}`)
  }

  // ── P2-UI-03 / 04 · ตัวเลือกโครงการ ──────────────────────────────────
  {
    const sup = await page('/entry', supJar)
    const own = await page('/entry', ownerJar)
    check('P2-UI-03 P2-UI-04 หัวหน้าโครงการเห็นเฉพาะโครงการตัวเองและไม่มี "ส่วนกลาง" · เจ้าของมีครบ',
      sup.includes('ทดสอบ P2API โครงการของหัวหน้า')
      && !sup.includes('ทดสอบ P2API โครงการคนอื่น')
      && !sup.includes('ส่วนกลาง (ไม่ผูกโครงการ)')
      && own.includes('ทดสอบ P2API โครงการคนอื่น')
      && own.includes('ส่วนกลาง (ไม่ผูกโครงการ)'),
      'ตรวจทั้งฝั่งมีและฝั่งไม่มี')
  }

  // ── P2-API-09 · หัวหน้าโครงการเพิ่มหมวดไม่ได้ ─────────────────────────
  {
    const catCount = async () =>
      (await sql('select count(*)::int as n from public.categories')).rows[0].n
    const before = await catCount()
    const r = await req('POST', '/api/settings/categories',
      { name: 'หมวดที่ไม่ควรถูกสร้าง', kind: 'expense' }, { cookie: supJar })
    const b = await r.json().catch(() => ({}))
    const after = await catCount()
    // ครึ่งบวก: เจ้าของเพิ่มได้จริงในคำสั่งถัดไป
    const own = await req('POST', '/api/settings/categories',
      { name: 'ทดสอบ หมวดชั่วคราว', kind: 'expense', sortOrder: 950 }, { cookie: ownerJar })
    const ob = await own.json().catch(() => ({}))
    if (ob.category?.id) tempCategoryId = ob.category.id
    check('P2-API-09 หัวหน้าโครงการ POST หมวด → 403 · ไม่มีแถวใหม่ · เจ้าของเพิ่มได้',
      r.status === 403 && b.error === 'FORBIDDEN' && after === before && own.status === 201
      && ob.category?.sort_order === 950,
      `${r.status} ${b.error} · ${before}→${after} · เจ้าของ ${own.status} ลำดับ ${ob.category?.sort_order}`)
  }

  // ── P2-API-10 · ปิดหมวดที่ถูกใช้แล้ว ต้องไม่ทำให้ประวัติพัง ────────
  // 🔴 ปิดหมวด ≠ ลบหมวด · รายการเก่าที่อ้างหมวดนั้นต้องอ่านชื่อได้เหมือนเดิม
  // และหมวดต้องหายจากฟอร์มบันทึกใหม่เท่านั้น
  {
    const made = await req('POST', '/api/transactions', {
      kind: 'expense', siteId: apiSite, categoryId: tempCategoryId, amount: 777,
      txnDate: today, payMethod: 'cash',
    }, { cookie: ownerJar })
    const mb = await made.json().catch(() => ({}))
    if (mb.transaction?.id) apiTxns.push(mb.transaction.id)

    const off = await req('PATCH', `/api/settings/categories/${tempCategoryId}`,
      { isActive: false }, { cookie: ownerJar })

    const { rows } = await sql(
      `select c.name from public.transactions t
       join public.categories c on c.id = t.category_id
       where t.id = '${mb.transaction?.id}'`)
    const form = await page('/entry', ownerJar)
    const open = form.indexOf('<select id="category"')
    const block = open === -1 ? '' : form.slice(open, form.indexOf('</select>', open))

    check('P2-API-10 ปิดหมวดที่ถูกใช้แล้ว → 200 · รายการเก่ายังอ่านชื่อหมวดได้ · หายจากฟอร์มใหม่',
      made.status === 201 && off.status === 200
      && rows[0]?.name === 'ทดสอบ หมวดชั่วคราว'
      && !block.includes('ทดสอบ หมวดชั่วคราว'),
      `${off.status} · รายการเก่าอ่านได้=${rows[0]?.name === 'ทดสอบ หมวดชั่วคราว'} · อยู่ในฟอร์ม=${block.includes('ทดสอบ หมวดชั่วคราว')}`)
  }

  // ── P2-UI-08 · ปุ่มถ่ายรูปกับเลือกจากแกลอรี่ต้องแยกกัน ────────────
  // 🔴 ปุ่มเดียวแล้วให้ระบบถามว่าจะถ่ายหรือเลือก คือการเพิ่มขั้นตอนให้คนที่
  // ตัดสินใจไปแล้ว · และ capture="environment" คือสิ่งที่ทำให้กดแล้วเปิด
  // กล้องหลังตรง ๆ ไม่ใช่เด้งตัวเลือกไฟล์ขึ้นมาก่อน
  {
    const own = await page('/entry', ownerJar)
    const fileInputs = (own.match(/type="file"/g) ?? []).length
    const hasCapture = own.includes('capture="environment"')
    const hasBoth = own.includes('ถ่ายรูป') && own.includes('เลือกจากแกลอรี่')
    check('P2-UI-08 มีช่องเลือกไฟล์สองช่องแยกกัน · ปุ่มถ่ายรูปมี capture=environment',
      fileInputs === 2 && hasCapture && hasBoth,
      `ช่องไฟล์ ${fileInputs} · capture=${hasCapture} · ปุ่มครบ=${hasBoth}`)
  }

  // ── P2-UI-05 · หมวดกรองตามชนิด ────────────────────────────────────
  // ค่าเริ่มต้นของฟอร์มคือรายจ่าย → HTML ที่เซิร์ฟเวอร์เรนเดอร์ต้องมีแต่หมวดรายจ่าย
  // (การสลับไปรายรับเป็นงานของเบราว์เซอร์ ตรวจที่ P8)
  {
    const own = await page('/entry', ownerJar)
    // 🔴 อ่านจาก **ธาตุที่เป็นเจ้าของค่า** ไม่ใช่จากทั้งหน้า
    // ชื่อหมวดทุกหมวดถูกส่งเป็น prop ให้คอมโพเนนต์ฝั่ง client จึงโผล่อยู่ใน
    // payload ที่ฝังมากับ HTML ด้วยเสมอ — ตรวจทั้งหน้าจะแดงตลอดกาลทั้งที่
    // กล่องเลือกแสดงถูกต้อง (ตกหลุมเดิมกับที่บันทึกไว้ใน LESSONS แล้วครั้งหนึ่ง)
    const open = own.indexOf('<select id="category"')
    const block = open === -1 ? '' : own.slice(open, own.indexOf('</select>', open))
    const { rows: names } = await sql(
      "select name, kind::text as k from public.categories where is_active")
    const expNames = names.filter((n) => n.k === 'expense').map((n) => n.name)
    const incNames = names.filter((n) => n.k === 'income').map((n) => n.name)
    const missingExp = expNames.filter((n) => !block.includes(n))
    const leakedInc = incNames.filter((n) => block.includes(n))
    check('P2-UI-05 กล่องหมวดมีแต่หมวดรายจ่ายครบทุกตัว และไม่มีหมวดรายรับปนมา',
      block !== '' && missingExp.length === 0 && leakedInc.length === 0,
      `พบกล่อง=${block !== ''} · ขาดรายจ่าย ${missingExp.length} · รายรับปน ${leakedInc.length}`)
  }
} finally {
  for (const id of apiTxns) await sql(`delete from public.transactions where id = '${id}'`)
  if (tempCategoryId) await sql(`delete from public.categories where id = '${tempCategoryId}'`)
  for (const id of [apiSite, apiOther]) {
    if (id) {
      await sql(`delete from public.transactions where site_id = '${id}'`)
      await sql(`delete from public.sites where id = '${id}'`)
    }
  }
  console.log('  (ลบข้อมูลทดสอบฝั่ง API แล้ว)')
}


// ── P2-DB-15 · ทุกตารางเปิด RLS ────────────────────────────────────────
{
  const { rows } = await sql(
    "select count(*)::int as n from pg_tables where schemaname='public' and rowsecurity=false")
  const { rows: all } = await sql("select count(*)::int as n from pg_tables where schemaname='public'")
  check('P2-DB-15 ทุกตารางใน public เปิด RLS',
    rows[0].n === 0 && all[0].n >= 13, `ปิดอยู่ ${rows[0].n} จาก ${all[0].n} ตาราง`)
}

// ── P2-DB-18 · index ที่จำเป็นมีจริง ───────────────────────────────────
// ดัชนีที่หายไปไม่ทำให้อะไรพัง — มันแค่ช้าลงเรื่อย ๆ จนวันหนึ่งหน้าโหลดไม่ไหว
// ซึ่งเป็นวันที่ข้อมูลเยอะเกินกว่าจะทดลองแก้ได้สบายใจแล้ว
{
  const { rows } = await sql(
    "select indexdef from pg_indexes where schemaname='public' and tablename='transactions'")
  const defs = rows.map((r) => r.indexdef.replace(/\s+/g, ' ')).join('\n')
  const want = [
    [/\(txn_date DESC\)/i, 'txn_date desc'],
    [/\(site_id, txn_date DESC\)/i, 'site_id + txn_date desc'],
    [/\(status\).*WHERE.*pending/is, "status where pending"],
    [/\(category_id\)/i, 'FK category_id'],
    [/\(created_by\)/i, 'FK created_by'],
  ]
  const missing = want.filter(([re]) => !re.test(defs)).map(([, n]) => n)
  check('P2-DB-18 index ครบตามที่วางไว้',
    missing.length === 0, missing.length ? `ขาด: ${missing.join(', ')}` : `${want.length} ตัว`)
}

// ── P2-DB-16 · advisors ────────────────────────────────────────────────
for (const kind of ['security', 'performance']) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/advisors/${kind}`,
    { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })
  const { lints = [] } = await r.json()
  const errs = lints.filter((l) => l.level === 'ERROR')
  check(`P2-DB-16 advisors(${kind}) ไม่มี ERROR`, errs.length === 0,
    `ERROR ${errs.length} · WARN ${lints.filter((l) => l.level === 'WARN').length}`)
}

// ── P2-DB-17 · ทุกคอลัมน์ที่ไม่ใช่ generated มีโค้ดเขียน ───────────────
// คอลัมน์ที่ schema มีให้แต่ไม่มีใครเขียนลงไป คือฟีเจอร์ที่ออกแบบไว้แล้วไม่ได้สร้าง
// — tsc เขียว หน้าจอปกติ และไม่มีอะไรบอกว่ามันว่างอยู่ตลอดกาล
{
  const { readFileSync, readdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])
  const src = walk('src').filter((f) => /\.tsx?$/.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // ตัดสตริงทิ้งด้วย — `.select('a, b, c')` ทำให้ทุกคอลัมน์ในลิสต์ดูเหมือน
    // ถูก *เขียน* ทั้งที่มันคือการ *อ่าน*
    .replace(/'[^'\n]*'/g, "''").replace(/"[^"\n]*"/g, '""').replace(/`[^`]*`/g, '``')

  const COLUMNS = [
    'kind', 'site_id', 'category_id', 'amount', 'txn_date', 'pay_method', 'status',
    'income_kind', 'installment_no', 'note', 'rejected_reason',
    'object_key', 'thumb_key', 'byte_size', 'content_type',
    'expires_at', 'consumed_at', 'sort_order', 'is_active',
  ]
  // จับ **ค่า** ที่อยู่หลังโคลอนมาเทียบ ไม่ใช่ใช้ negative lookahead หลัง \s*
  // ซึ่งถอยกลับไปแมตช์ศูนย์ตัวได้แล้วผ่านตลอด (บทเรียนจาก P1-DB-12)
  const TYPE_WORDS = new Set([
    'string', 'number', 'boolean', 'unknown', 'null', 'Date',
    'TxnKind', 'TxnStatus', 'PayMethod', 'IncomeKind', 'ReactNode',
  ])
  // ยอมรับทั้งรูป object literal (`col: value` / `col,`) และการกำหนดค่าทีละฟิลด์
  // (`patch.col = value`) ซึ่งเป็นสำนวนที่ route แบบมีเงื่อนไขใช้จริง
  const writes = (c) => {
    if (new RegExp(`\\.${c}\\s*=[^=]`).test(src)) return true
    const re = new RegExp(`\\b${c}\\s*(?:(,)|:\\s*([^\\s,;}]+))`, 'g')
    let m
    while ((m = re.exec(src)) !== null) {
      if (m[1]) return true
      if (!TYPE_WORDS.has(m[2])) return true
    }
    return false
  }
  const orphans = COLUMNS.filter((c) => !writes(c))
  check('P2-DB-17 ทุกคอลัมน์ของ P2 มีโค้ดที่เขียนค่าลงไปจริง',
    orphans.length === 0,
    orphans.length ? `ไม่มีใครเขียน: ${orphans.join(', ')}` : `${COLUMNS.length} คอลัมน์`)
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
