#!/usr/bin/env node
/**
 * verify-txn-edit.mjs — ปิดแถว R4-* ใน docs/test-plan/R4-txn-crud.md
 *
 * เรื่องที่ตรวจ: แก้/ลบรายการที่บันทึกไปแล้ว
 *  · เจ้าของแตะได้ทุกแถว รวมที่อนุมัติแล้ว (ร่องรอยอยู่ที่ audit_log)
 *  · หัวหน้าโครงการแตะได้เฉพาะของตัวเองที่ยังไม่อนุมัติ
 *  · ของที่ถูกตีกลับ เจ้าตัวแก้แล้ว = ส่งใหม่ สถานะกลับเป็น pending เอง
 *
 * 🔴 "0 แถว" ทุกจุดมีการพิสูจน์ฝั่งบวกคู่กันเสมอ — ไม่งั้นแยกไม่ออกว่า
 * policy กันได้จริง หรือแค่ query เขียนผิดจนไม่โดนแถวไหนเลย
 *
 * fixture ทุกตัวคืนค่าใน `finally` (CLAUDE.md §17 ข้อ 9)
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
  if (!r.ok) return { error: text, rows: [] }
  return { rows: JSON.parse(text) }
}

async function db(token, path, init = {}) {
  const headers = { apikey: PUB, 'Content-Type': 'application/json', ...init.headers }
  if (token !== 'anon') headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${URL}/rest/v1${path}`, { ...init, headers })
  const t = await r.text()
  let body = null
  try { body = t ? JSON.parse(t) : null } catch { body = t }
  return { status: r.status, ok: r.ok, body, raw: t }
}

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

console.log('\n── R4-DB · แก้/ลบรายการที่บันทึกแล้ว ───────────────────────')

const ownerTok = await tok(env.SEED_OWNER_EMAIL, env.SEED_OWNER_PASSWORD)
const supTok = await tok(
  syntheticEmail('sup1'), derivePassword(env.PIN_PEPPER, env.SEED_SUPERVISOR1_PIN),
)
const [sup1] = (await sql(
  `select id from public.profiles where full_name = '${env.SEED_SUPERVISOR1_NAME}'`)).rows
const [owner] = (await sql("select id from public.profiles where role='owner' limit 1")).rows
const [expCat] = (await sql(
  "select id from public.categories where kind='expense' order by sort_order limit 1")).rows

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

let siteId = null
const txnCount = async () =>
  (await sql('select count(*)::int as n from public.transactions')).rows[0].n

/** สร้างรายการด้วยสิทธิ์ service (ตั้งสถานะและผู้คีย์ได้ตรง ๆ) */
const seedTxn = async (status, createdBy, amount, extra = '') => {
  const { rows } = await sql(
    `insert into public.transactions
       (kind, site_id, category_id, amount, txn_date, pay_method, status, created_by${extra ? ', rejected_reason' : ''})
     values ('expense','${siteId}','${expCat.id}',${amount},'${today}','cash','${status}','${createdBy}'${extra ? `,'${extra}'` : ''})
     returning id`)
  return rows[0].id
}

try {
  ;[{ id: siteId }] = (await sql(
    "insert into public.sites(name) values ('ทดสอบ R4 แก้ไขรายการ') returning id")).rows
  await sql(`insert into public.site_supervisors(site_id, profile_id, effective_from)
             values ('${siteId}','${sup1.id}', current_date - 1)`)

  // ── R4-DB-01 · เจ้าของแก้ยอดของรายการที่อนุมัติแล้ว ────────────────
  {
    const id = await seedTxn('approved', owner.id, 1000)
    const r = await db(ownerTok, `/transactions?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ amount: 1234, note: 'แก้ยอดแล้ว' }),
    })
    const { rows } = await sql(
      `select amount::float8 as a, note from public.transactions where id='${id}'`)
    const { rows: audit } = await sql(
      `select count(*)::int as n from public.audit_log
       where table_name='transactions' and action='UPDATE' and row_id='${id}'
         and (before->>'amount')::float8 = 1000`)
    check('R4-DB-01 เจ้าของแก้ยอดของรายการที่อนุมัติแล้วได้ · audit เก็บค่าเดิม',
      r.status === 200 && rows[0].a === 1234 && audit[0].n >= 1,
      `${r.status} · ยอด ${rows[0].a} · audit ${audit[0].n}`)
  }

  // ── R4-DB-02 · เจ้าของลบรายการที่อนุมัติแล้ว ──────────────────────
  {
    const id = await seedTxn('approved', owner.id, 1500)
    const before = await txnCount()
    const r = await db(ownerTok, `/transactions?id=eq.${id}`, { method: 'DELETE' })
    const after = await txnCount()
    const { rows: audit } = await sql(
      `select count(*)::int as n from public.audit_log
       where table_name='transactions' and action='DELETE' and row_id='${id}'
         and (before->>'amount')::float8 = 1500`)
    check('R4-DB-02 เจ้าของลบรายการที่อนุมัติแล้วได้ · audit เก็บค่าเดิมทั้งแถว',
      r.ok && after === before - 1 && audit[0].n >= 1,
      `${r.status} · ${before}→${after} · audit ${audit[0].n}`)
  }

  // ── R4-DB-03 / R4-DB-06 · ตีกลับแล้วแก้ = ส่งใหม่ ─────────────────
  {
    const id = await seedTxn('rejected', sup1.id, 2000, 'สลิปเบลอ')
    const before = (await sql(
      `select count(*)::int as n from public.notifications
       where user_id='${owner.id}' and title='รายการที่ตีกลับถูกแก้แล้วส่งใหม่'`)).rows[0].n
    const r = await db(supTok, `/transactions?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ amount: 2500, note: 'ถ่ายสลิปใหม่แล้ว' }),
    })
    const { rows } = await sql(
      `select status::text as s, coalesce(rejected_reason,'') as reason, amount::float8 as a
       from public.transactions where id='${id}'`)
    check('R4-DB-03 หัวหน้าโครงการแก้ของที่ถูกตีกลับได้ · สถานะกลับเป็น pending · เหตุผลถูกล้าง',
      r.status === 200 && rows[0].s === 'pending' && rows[0].reason === '' && rows[0].a === 2500,
      `${r.status} · ${rows[0].s} · เหตุผล "${rows[0].reason}" · ยอด ${rows[0].a}`)

    const after = (await sql(
      `select count(*)::int as n from public.notifications
       where user_id='${owner.id}' and title='รายการที่ตีกลับถูกแก้แล้วส่งใหม่'`)).rows[0].n
    check('R4-DB-06 เจ้าของได้แจ้งเตือนว่ามีของแก้แล้วส่งกลับเข้าคิว',
      after === before + 1, `${before}→${after}`)
  }

  // ── R4-DB-04 / R4-DB-05 · หัวหน้าโครงการแตะของที่อนุมัติแล้วไม่ได้ ───
  {
    const id = await seedTxn('approved', sup1.id, 3000)
    const before = await txnCount()
    const upd = await db(supTok, `/transactions?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ amount: 9999 }),
    })
    const { rows: kept } = await sql(
      `select amount::float8 as a from public.transactions where id='${id}'`)
    check('R4-DB-04 หัวหน้าโครงการแก้ยอดของรายการที่อนุมัติแล้วไม่ได้ · ยอดเดิมคงอยู่',
      kept[0].a === 3000, `${upd.status} · ยอด ${kept[0].a}`)

    const del = await db(supTok, `/transactions?id=eq.${id}`, { method: 'DELETE' })
    const after = await txnCount()
    check('R4-DB-05 หัวหน้าโครงการลบรายการที่อนุมัติแล้วไม่ได้ · จำนวนเท่าเดิม',
      after === before, `${del.status} · ${before}→${after}`)
  }

  // ── R4-DB-07 · ของที่ถูกตีกลับ เจ้าตัวทิ้งได้ ─────────────────────
  {
    const id = await seedTxn('rejected', sup1.id, 800, 'ซ้ำกับใบก่อน')
    const before = await txnCount()
    const r = await db(supTok, `/transactions?id=eq.${id}`, { method: 'DELETE' })
    const after = await txnCount()
    check('R4-DB-07 หัวหน้าโครงการลบรายการของตัวเองที่ถูกตีกลับได้',
      r.ok && after === before - 1, `${r.status} · ${before}→${after}`)
  }

  // ── R4-DB-08 · anon แตะอะไรไม่ได้เลย ──────────────────────────────
  {
    const id = await seedTxn('pending', sup1.id, 640)
    const before = await txnCount()
    const upd = await db('anon', `/transactions?id=eq.${id}`, {
      method: 'PATCH', body: JSON.stringify({ amount: 1 }),
    })
    const del = await db('anon', `/transactions?id=eq.${id}`, { method: 'DELETE' })
    const delAtt = await db('anon', '/attachments?id=neq.00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
    })
    const { rows } = await sql(
      `select amount::float8 as a from public.transactions where id='${id}'`)
    const after = await txnCount()
    // เจ้าของยิงคำสั่งเดียวกันได้ — พิสูจน์ว่า 0 แถวข้างบนมาจากสิทธิ์ ไม่ใช่ query ผิด
    const ownerOk = await db(ownerTok, `/transactions?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ amount: 641 }),
    })
    check('R4-DB-08 anon แก้/ลบไม่ได้เลย · ค่าไม่เปลี่ยน · เจ้าของทำได้ในคำสั่งถัดไป',
      rows[0].a === 640 && after === before
      && ownerOk.status === 200 && ownerOk.body?.length === 1,
      `anon ${upd.status}/${del.status}/${delAtt.status} · เจ้าของ ${ownerOk.status}`)
  }
} finally {
  if (siteId) {
    await sql(`delete from public.attachments a using public.transactions t
               where a.transaction_id = t.id and t.site_id = '${siteId}'`)
    await sql(`delete from public.transactions where site_id = '${siteId}'`)
    await sql(`delete from public.site_supervisors where site_id = '${siteId}'`)
    await sql(`delete from public.sites where id = '${siteId}'`)
  }
  await sql(`delete from public.notifications
             where title = 'รายการที่ตีกลับถูกแก้แล้วส่งใหม่'`)
  console.log('  (ลบข้อมูลทดสอบแล้ว)')
}

// ══════════════════════════════════════════════════════════════════════
// R4-API / R4-UI · endpoint และหน้าจอ (ต้องมี dev server รันอยู่)
// ══════════════════════════════════════════════════════════════════════
console.log('\n── R4-API / R4-UI · แก้ไขจากหน้าจอ ─────────────────────────')

const BASE = process.argv[2] ?? 'http://localhost:3200'
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
try {
  ;[{ id: apiSite }] = (await sql(
    "insert into public.sites(name) values ('ทดสอบ R4 API') returning id")).rows
  await sql(`insert into public.site_supervisors(site_id, profile_id, effective_from)
             values ('${apiSite}','${sup1.id}', current_date - 1)`)

  const mk = async (status, createdBy, amount) => {
    const { rows } = await sql(
      `insert into public.transactions
         (kind, site_id, category_id, amount, txn_date, pay_method, status, created_by)
       values ('expense','${apiSite}','${expCat.id}',${amount},'${today}','cash','${status}','${createdBy}')
       returning id`)
    return rows[0].id
  }

  // ── R4-API-01 · เจ้าของแก้เนื้อรายการที่อนุมัติแล้ว ────────────────
  {
    const id = await mk('approved', owner.id, 1000)
    const r = await req('PATCH', `/api/transactions/${id}`, {
      kind: 'expense', siteId: apiSite, categoryId: expCat.id,
      amount: 4321, txnDate: today, payMethod: 'transfer', note: 'แก้จากกล่องแก้ไข',
    }, { cookie: ownerJar })
    const { rows } = await sql(
      `select amount::float8 as a, pay_method::text as p, note
       from public.transactions where id='${id}'`)
    check('R4-API-01 เจ้าของ PATCH รายการที่อนุมัติแล้ว → 200 · ทุกฟิลด์ถูกเขียนจริง',
      r.status === 200 && rows[0].a === 4321 && rows[0].p === 'transfer'
      && rows[0].note === 'แก้จากกล่องแก้ไข',
      `${r.status} · ${rows[0].a} · ${rows[0].p}`)

    const d = await req('DELETE', `/api/transactions/${id}`, undefined, { cookie: ownerJar })
    const { rows: gone } = await sql(
      `select count(*)::int as n from public.transactions where id='${id}'`)
    check('R4-API-02 เจ้าของ DELETE รายการที่อนุมัติแล้ว → 200 · แถวหายจริง',
      d.status === 200 && gone[0].n === 0, `${d.status} · เหลือ ${gone[0].n} แถว`)
  }

  // ── R4-API-03 / 04 · หัวหน้าโครงการแตะของที่อนุมัติแล้วไม่ได้ ─────────
  {
    const id = await mk('approved', sup1.id, 2000)
    const p = await req('PATCH', `/api/transactions/${id}`, {
      kind: 'expense', siteId: apiSite, categoryId: expCat.id,
      amount: 9999, txnDate: today, payMethod: 'cash',
    }, { cookie: supJar })
    const pb = await p.json().catch(() => ({}))
    const { rows } = await sql(
      `select amount::float8 as a from public.transactions where id='${id}'`)
    check('R4-API-03 หัวหน้าโครงการ PATCH ของที่อนุมัติแล้ว → 403 EDIT_FORBIDDEN (ไม่ใช่ 200 เงียบ ๆ)',
      p.status === 403 && pb.error === 'EDIT_FORBIDDEN' && rows[0].a === 2000,
      `${p.status} · ${pb.error} · ยอด ${rows[0].a}`)

    const d = await req('DELETE', `/api/transactions/${id}`, undefined, { cookie: supJar })
    const db2 = await d.json().catch(() => ({}))
    const { rows: still } = await sql(
      `select count(*)::int as n from public.transactions where id='${id}'`)
    check('R4-API-04 หัวหน้าโครงการ DELETE ของที่อนุมัติแล้ว → 403 DELETE_FORBIDDEN · แถวยังอยู่',
      d.status === 403 && db2.error === 'DELETE_FORBIDDEN' && still[0].n === 1,
      `${d.status} · ${db2.error}`)
  }

  // ── R4-API-05 / 06 · แนบสลิปเพิ่ม ─────────────────────────────────
  {
    const id = await mk('pending', owner.id, 300)
    const many = Array.from({ length: 9 }, (_, i) => ({
      objectKey: `slips/ปลอม-${i}.webp`, thumbKey: `slips/thumb/ปลอม-${i}.webp`,
    }))
    const over = await req('POST', `/api/transactions/${id}/attachments`,
      { attachments: many }, { cookie: ownerJar })
    const ob = await over.json().catch(() => ({}))
    check('R4-API-05 แนบเกินเพดานต่อรายการ → 400 TOO_MANY_ATTACHMENTS',
      over.status === 400 && ob.error === 'TOO_MANY_ATTACHMENTS', `${over.status} · ${ob.error}`)

    const fake = await req('POST', `/api/transactions/${id}/attachments`, {
      attachments: [{ objectKey: 'slips/ไม่มีจริง.webp', thumbKey: 'slips/thumb/ไม่มีจริง.webp' }],
    }, { cookie: ownerJar })
    const fb = await fake.json().catch(() => ({}))
    const { rows: att } = await sql(
      `select count(*)::int as n from public.attachments where transaction_id='${id}'`)
    check('R4-API-06 คีย์ที่ไม่มี upload_intents ของตัวเอง → 400 INTENT_NOT_FOUND · ไม่มีแถวสลิป',
      fake.status === 400 && fb.error === 'INTENT_NOT_FOUND' && att[0].n === 0,
      `${fake.status} · ${fb.error} · สลิป ${att[0].n}`)
  }

  // ── R4-API-07 · ลบสลิปของรายการที่ไม่มีสิทธิ์แก้ ───────────────────
  {
    const id = await mk('approved', owner.id, 450)
    const [{ id: attId }] = (await sql(
      `insert into public.attachments(transaction_id, object_key, thumb_key, byte_size, content_type)
       values ('${id}','slips/r4.webp','slips/thumb/r4.webp', 10, 'image/webp') returning id`)).rows
    const r = await req('DELETE', `/api/attachments/${attId}`, undefined, { cookie: supJar })
    const { rows } = await sql(
      `select count(*)::int as n from public.attachments where id='${attId}'`)
    check('R4-API-07 หัวหน้าโครงการลบสลิปของรายการที่แก้ไม่ได้ → ปฏิเสธ · แถวสลิปยังอยู่',
      (r.status === 403 || r.status === 404) && rows[0].n === 1, `${r.status} · เหลือ ${rows[0].n}`)
  }

  // ── R4-API-08 · endpoint ใหม่ตอนไม่ล็อกอิน ────────────────────────
  {
    const bad = []
    const calls = [
      ['POST', `/api/transactions/${crypto.randomUUID()}/attachments`, { attachments: [] }],
      ['DELETE', `/api/attachments/${crypto.randomUUID()}`, undefined],
    ]
    for (const [m, path, body] of calls) {
      const r = await req(m, path, body)
      const ct = r.headers.get('content-type') ?? ''
      if (r.status !== 401 || !ct.includes('application/json')) bad.push(`${m} → ${r.status}`)
    }
    check('R4-API-08 endpoint ใหม่ตอนไม่ล็อกอิน → 401 JSON ทั้งคู่ (ไม่ใช่ 307 ไปหน้า HTML)',
      bad.length === 0, bad.length ? bad.join(' · ') : '2/2')
  }

  // ── R4-UI-01 / 02 · ปุ่มแก้ไขบนแถว ────────────────────────────────
  // 🔴 กรองด้วย `?site=` ให้ทั้งสองคนเห็น **สองแถวเดียวกันเป๊ะ** — เทียบ
  // จำนวนปุ่มจากหน้าที่มีจำนวนแถวไม่เท่ากันคือการเทียบคนละอย่าง
  {
    await mk('pending', sup1.id, 700)
    await mk('approved', sup1.id, 900)
    const marks = (html) => (html.match(/aria-label="แก้ไขรายการ/g) ?? []).length
    const ownerHtml = await page(`/ledger?site=${apiSite}`, ownerJar)
    const supHtml = await page(`/ledger?site=${apiSite}`, supJar)
    check('R4-UI-01 เจ้าของเห็นปุ่มแก้ไขครบทุกแถว (2 แถว → 2 ปุ่ม)',
      marks(ownerHtml) === 2, `พบ ${marks(ownerHtml)} ปุ่ม`)
    check('R4-UI-02 หัวหน้าโครงการเห็นทั้งสองแถว แต่มีปุ่มเฉพาะแถวที่ยังไม่อนุมัติ',
      marks(supHtml) === 1 && supHtml.includes('700') && supHtml.includes('900'),
      `ปุ่ม ${marks(supHtml)} · เห็นทั้งสองแถว ${supHtml.includes('700') && supHtml.includes('900')}`)
  }

  // ── R4-UI-07 / 10 · รายการท้ายหน้าโครงการ ────────────────────────────
  {
    const html = await page(`/sites/${apiSite}`, ownerJar)
    check('R4-UI-07 หน้าโครงการมีแผง "รายรับ-รายจ่ายล่าสุด" พร้อมลิงก์ไป /ledger ของโครงการนั้น',
      html.includes('รายรับ-รายจ่ายล่าสุด') && html.includes(`/ledger?site=${apiSite}`),
      html.includes('รายรับ-รายจ่ายล่าสุด') ? 'พบแผง' : 'ไม่พบแผง')
  }

  // ── R4-UI-08 · โครงการที่ยังไม่มีรายการ ──────────────────────────────
  {
    const [{ id: emptySite }] = (await sql(
      "insert into public.sites(name) values ('ทดสอบ R4 โครงการว่าง') returning id")).rows
    const html = await page(`/sites/${emptySite}`, ownerJar)
    check('R4-UI-08 โครงการที่ยังไม่มีรายการขึ้นสถานะว่าง ไม่ใช่แผงเปล่า',
      html.includes('ยังไม่มีรายการของโครงการนี้'), 'สถานะว่าง')
    await sql(`delete from public.sites where id='${emptySite}'`)
  }
} finally {
  if (apiSite) {
    await sql(`delete from public.attachments a using public.transactions t
               where a.transaction_id = t.id and t.site_id = '${apiSite}'`)
    await sql(`delete from public.transactions where site_id = '${apiSite}'`)
    await sql(`delete from public.site_supervisors where site_id = '${apiSite}'`)
    await sql(`delete from public.sites where id = '${apiSite}'`)
  }
  await sql("delete from public.sites where name like 'ทดสอบ R4%'")
  console.log('  (ลบข้อมูลทดสอบแล้ว)')
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '❌' : '✅'} R4 · ผ่าน ${results.length - failed.length}/${results.length}`)
process.exit(failed.length ? 1 : 0)
