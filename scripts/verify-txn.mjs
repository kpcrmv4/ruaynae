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
    `insert into public.sites(name) values ('ทดสอบ P2 ไซต์ของหัวหน้า') returning id`)).rows
  ;[{ id: othersId }] = (await sql(
    `insert into public.sites(name) values ('ทดสอบ P2 ไซต์คนอื่น') returning id`)).rows
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

  // ── P2-DB-01 · หัวหน้าไซต์คีย์รายจ่ายของไซต์ตัวเอง ────────────────
  let mineTxn = null
  {
    const before = await txnCount()
    const r = await post(supTok, expense({ note: 'ค่าปูนซีเมนต์ 10 ถุง' }))
    mineTxn = Array.isArray(r.body) ? r.body[0]?.id : null
    const after = await txnCount()
    const { rows: audit } = await sql(
      `select count(*)::int as n from public.audit_log
       where table_name='transactions' and action='INSERT' and row_id='${mineTxn}'`)
    check('P2-DB-01 หัวหน้าไซต์คีย์รายจ่ายไซต์ตัวเองได้ · status=pending · มี audit',
      r.status === 201 && after === before + 1
      && r.body?.[0]?.status === 'pending' && audit[0].n === 1,
      `${r.status} · ${before}→${after} · status ${r.body?.[0]?.status} · audit ${audit[0].n}`)
  }

  // ── P2-DB-02 · ไซต์ที่ไม่ได้ดูแล ──────────────────────────────────
  {
    const before = await txnCount()
    const bad = await post(supTok, expense({ site_id: othersId }))
    const mid = await txnCount()
    // ครึ่งบวก: ของไซต์ตัวเองยังเขียนได้ในคำสั่งถัดไป → ตารางไม่ได้พัง
    const good = await post(supTok, expense({ amount: 250 }))
    const after = await txnCount()
    check('P2-DB-02 หัวหน้าไซต์คีย์รายจ่ายไซต์ที่ไม่ได้ดูแลไม่ได้ · ของตัวเองยังได้',
      bad.status >= 400 && mid === before && good.status === 201 && after === before + 1,
      `ไซต์คนอื่น ${bad.status} · ${before}→${mid}→${after}`)
  }

  // ── P2-DB-03 · ตั้ง status='approved' ตอน insert ──────────────────
  // 🔴 ต้องเป็น error ที่มีเหตุผล ไม่ใช่โดน 0 แถวเงียบ ๆ
  {
    const before = await txnCount()
    const r = await post(supTok, expense({ status: 'approved' }))
    const after = await txnCount()
    check('P2-DB-03 หัวหน้าไซต์ตั้ง status=approved ตอนสร้าง → APPROVE_FORBIDDEN',
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
    check('P2-DB-04 หัวหน้าไซต์อนุมัติรายการตัวเองไม่ได้ → APPROVE_FORBIDDEN · ยัง pending',
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

  // ── P2-DB-05 · แก้ amount หลัง approved ไม่ได้ แม้แต่เจ้าของ ───────
  {
    const r = await db(ownerTok, `/transactions?id=eq.${mineTxn}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ amount: 99999 }),
    })
    const { rows } = await sql(
      `select amount::float8 as a from public.transactions where id='${mineTxn}'`)
    check('P2-DB-05 แก้จำนวนเงินของรายการที่อนุมัติแล้วไม่ได้ → AMOUNT_LOCKED · ยอดเดิมคงอยู่',
      /AMOUNT_LOCKED/.test(msgOf(r)) && rows[0].a === 1000,
      `${r.status} · ยอด ${rows[0].a}`)
  }

  // ── P2-DB-11 · ลบรายการที่ approved แล้วไม่ได้ ────────────────────
  {
    const before = await txnCount()
    const r = await db(ownerTok, `/transactions?id=eq.${mineTxn}`, { method: 'DELETE' })
    const after = await txnCount()
    check('P2-DB-11 ลบรายการที่อนุมัติแล้วไม่ได้ → APPROVED_IMMUTABLE · จำนวนเท่าเดิม',
      /APPROVED_IMMUTABLE/.test(msgOf(r)) && after === before,
      `${r.status} · ${before}→${after}`)
  }

  // ── P2-DB-07 · หัวหน้าไซต์คีย์รายรับไม่ได้ ────────────────────────
  {
    const before = await txnCount()
    const r = await post(supTok, {
      kind: 'income', site_id: mineId, category_id: incCat.id,
      amount: 500000, txn_date: today, pay_method: 'transfer', income_kind: 'deposit',
    })
    const after = await txnCount()
    check('P2-DB-07 หัวหน้าไซต์บันทึกรายรับไม่ได้ → ถูกปฏิเสธ · จำนวนเท่าเดิม',
      r.status >= 400 && after === before, `${r.status} · ${msgOf(r).slice(0, 50)}`)
  }

  // ── P2-DB-08 · หัวหน้าไซต์อ่านรายรับของไซต์ตัวเองไม่ได้ ───────────
  {
    await sql(`insert into public.transactions(kind, site_id, category_id, amount, txn_date,
                 pay_method, status, income_kind)
               values ('income','${mineId}','${incCat.id}', 400000, '${today}', 'transfer',
                       'approved', 'deposit')`)
    const inc = await db(supTok, `/transactions?select=id&kind=eq.income&site_id=eq.${mineId}`)
    const exp = await db(supTok, `/transactions?select=id&kind=eq.expense&site_id=eq.${mineId}`)
    const ownerInc = await db(ownerTok, `/transactions?select=id&kind=eq.income&site_id=eq.${mineId}`)
    check('P2-DB-08 หัวหน้าไซต์เห็นรายรับ 0 แถว · เห็นรายจ่ายของไซต์เดียวกัน > 0 · เจ้าของเห็นรายรับ',
      (Array.isArray(inc.body) ? inc.body.length : -1) === 0
      && exp.body?.length > 0 && ownerInc.body?.length > 0,
      `รายรับ ${Array.isArray(inc.body) ? inc.body.length : inc.status} · รายจ่าย ${exp.body?.length} · เจ้าของ ${ownerInc.body?.length}`)
  }

  // ── P2-DB-09 · รายจ่ายส่วนกลางไม่หลุดไปหาหัวหน้าไซต์ ──────────────
  {
    await sql(`insert into public.transactions(kind, site_id, category_id, amount, txn_date,
                 pay_method, status)
               values ('expense', null, '${expCat.id}', 777, '${today}', 'cash', 'approved')`)
    const sup = await db(supTok, '/transactions?select=id&site_id=is.null')
    const own = await db(ownerTok, '/transactions?select=id&site_id=is.null')
    check('P2-DB-09 หัวหน้าไซต์เห็นรายจ่ายส่วนกลาง 0 แถว · เจ้าของเห็น > 0',
      (Array.isArray(sup.body) ? sup.body.length : -1) === 0 && own.body?.length > 0,
      `หัวหน้าไซต์ ${Array.isArray(sup.body) ? sup.body.length : sup.status} · เจ้าของ ${own.body?.length}`)
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
    check('P2-DB-12/13/14 constraint ปฏิเสธค่าที่เป็นไปไม่ได้ · ไม่มีแถวใหม่',
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

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
