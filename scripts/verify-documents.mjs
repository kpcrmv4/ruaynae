#!/usr/bin/env node
/**
 * verify-documents.mjs — ปิดแถว `R12-DB-*` `R12-NO-*` `R12-API-*` `R12-CUS-*`
 * `R12-SITE-*` `R12-PRT-*` `R12-SET-*` `R12-DEAD-*` และ `R12-UI-*` ที่ตัดสินจาก
 * HTML ที่เซิร์ฟเวอร์เรนเดอร์ได้
 *
 * (สูตรเงินกับข้อความบาทอยู่ที่ `verify-doc-math.mjs` · แถวที่ต้องมีเบราว์เซอร์
 *  จริง — toast · ปุ่ม disabled · print preview — อยู่ที่ `verify-ui-browser.mjs`)
 *
 * 🔴 **ไฟล์นี้แตะฐานข้อมูลจริง** — จึงต้อง
 *   1. สำรอง `doc_counters` และช่องผู้ขายใน `app_settings` ไว้ก่อน แล้วคืนใน `finally`
 *      (ทั้งคู่เป็นค่าที่เจ้าของตั้งเอง ไม่ใช่ของทดสอบ · §17 ข้อ 14)
 *   2. ลบเอกสาร/ลูกค้า/รายรับ/โครงการที่สร้างเอง **ตาม id ที่เก็บไว้ตอนสร้าง**
 *      ไม่ใช่เดาจากสภาพข้อมูล (§17 ข้อ 24)
 *   3. **อ่านกลับมานับ** ว่าเหลือ 0 แถวจริง ไม่ใช่เชื่อว่า delete สำเร็จ (§17 ข้อ 24)
 *
 * ต้องมี dev server รันอยู่ (ค่าเริ่มต้น http://localhost:3200)
 *   node scripts/verify-documents.mjs [baseUrl]
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

/**
 * 🔴 ทนต่อ `429 ThrottlerException` ของ Management API ด้วยการถอยแล้วลองใหม่
 *
 * ไฟล์นี้ยิง SQL หลายร้อยครั้งต่อรอบ และตัวที่โดน 429 บ่อยที่สุดคือ**ชุดเก็บกวาด
 * ท้ายไฟล์** ซึ่งเป็นชุดที่ล้มไม่ได้ที่สุด — ล้มเมื่อไหร่คือทิ้งเอกสารทดสอบไว้ใน
 * ฐานของลูกค้าจริง และทิ้งตัวนับเลขที่เอกสารไว้ผิดค่า (CLAUDE.md §17 ข้อ 9)
 */
const sql = async (q, tries = 5) => {
  for (let i = 0; ; i++) {
    const r = await fetch(
      `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: q }),
      },
    )
    const t = await r.text()
    if (r.ok) return JSON.parse(t)
    if ((r.status === 429 || /Throttler/i.test(t)) && i < tries - 1) {
      await new Promise((res) => setTimeout(res, 2000 * 2 ** i))
      continue
    }
    throw new Error(`${q.slice(0, 80)} → ${t.slice(0, 300)}`)
  }
}
/** ยอมให้ล้มได้ — ใช้กับ red test ที่คาดว่าฐานข้อมูลจะปฏิเสธ */
const sqlTry = async (q) => {
  try {
    return { rows: await sql(q) }
  } catch (e) {
    return { error: String(e.message ?? e) }
  }
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`

const req = (method, path, body, headers = {}) =>
  fetch(`${BASE}${path}`, {
    method,
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const jarOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
const page = async (path, cookie) =>
  (await fetch(`${BASE}${path}`, { headers: { cookie } })).text()
const pageStatus = async (path, cookie) =>
  (await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'manual' })).status

/**
 * ดึง access token ออกจากคุกกี้ที่ route ล็อกอินของเราแปะมา
 *
 * 🔴 ไม่คำนวณอีเมลสังเคราะห์ของบัญชี PIN เอง — รหัสในอีเมลนั้นสุ่มตอนสร้างผู้ใช้
 * สคริปต์ที่เดาว่าเป็น `sup1` จะพังทันทีบนฐานของลูกค้าจริงที่ไม่ได้มาจาก seed
 */
const tokenFromJar = (jar) => {
  const parts = jar.split('; ').filter((c) => /-auth-token(\.\d+)?=/.test(c)).sort()
  if (parts.length === 0) return null
  const raw = parts.map((p) => p.slice(p.indexOf('=') + 1)).join('')
  const b64 = decodeURIComponent(raw).replace(/^base64-/, '')
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')).access_token ?? null
}
const subOf = (token) =>
  JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub

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
/** ยิง PostgREST ตรง ๆ ด้วยตัวตนที่กำหนด — ทดสอบ RLS โดยไม่ผ่าน route ของเรา */
const rest = (path, token, init = {}) =>
  fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

const MARK = 'ตรวจเอกสาร R12'
const made = { docs: [], customers: [], txns: [], sites: [] }
/**
 * 🔴 ทุก id ที่สคริปต์นี้เคยสร้าง — **ไม่เคยถูกลบออกจากลิสต์นี้เลย**
 *
 * `made.*` หดลงระหว่างทาง (ลบไปแล้ว / ไม่ต้องลบซ้ำ) ซึ่งถูกสำหรับการลบแถว
 * แต่ผิดสำหรับการลบ `audit_log` — แถวที่ถูกลบไปแล้วยิ่งทิ้งร่องรอยไว้แน่นอน
 * รอบแรกจึงทิ้ง audit ของโครงการ/รายรับทดสอบไว้ 128 แถวโดยที่สคริปต์รายงานว่าสะอาด
 */
const everMade = []
const track = (bucket, id) => { if (id) { made[bucket].push(id); everMade.push(id) } }
let snapCounters = []
let snapSettings = null
let runStart = null

const src = (p) => readFileSync(p, 'utf8')
/** ส่วนตัวเลขของเลขที่เอกสาร — สูตรเดียวกับ `docNoSeq()` ใน `src/lib/documents.ts` */
const docNoSeqOf = (no) => Number(/(\d+)$/.exec(String(no ?? ''))?.[1] ?? -1)

/** สร้างร่างผ่าน API แล้วจำ id ไว้ลบทีหลัง */
async function draft(jar, over = {}) {
  const r = await req('POST', '/api/documents', {
    kind: 'receipt',
    customerName: `${MARK} · ลูกค้าทดสอบ`,
    docDate: '2026-09-21',
    vatMode: 'inclusive',
    vatRate: 0.07,
    lines: [{ description: 'งานทดสอบ', qty: 1, unit: 'งาน', unitPrice: 122500 }],
    ...over,
  }, { cookie: jar })
  const b = await r.json().catch(() => ({}))
  track('docs', b.id)
  return { status: r.status, body: b }
}
const setCounter = (jar, field, value) =>
  req('PATCH', '/api/settings/documents', { [field]: value }, { cookie: jar })

try {
  runStart = (await sql('select now() as t'))[0].t
  snapCounters = await sql('select kind::text as kind, prefix, pad, last_no from public.doc_counters')
  snapSettings = (await sql(
    'select phone, email, branch_label, bank_account, doc_footer from public.app_settings limit 1',
  ))[0] ?? null
  console.log(`\n  (สำรองตัวนับเลขที่เอกสาร: ${JSON.stringify(snapCounters)})`)

  const ownerJar = jarOf(await req('POST', '/api/auth/login', {
    email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD,
  }))
  const supJar = jarOf(await req('POST', '/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN }))
  if (!ownerJar || !supJar) {
    throw new Error('ล็อกอินไม่สำเร็จ — ตรวจว่า dev server รันอยู่และ seed ผู้ใช้แล้ว')
  }
  const ownerToken = await supabaseToken(env.SEED_OWNER_EMAIL, env.SEED_OWNER_PASSWORD)
  const supToken = tokenFromJar(supJar)
  if (!supToken) throw new Error('อ่าน token ของหัวหน้าโครงการจากคุกกี้ไม่ได้')
  const supId = subOf(supToken)

  // โครงการทดสอบ — ต้องมีเพราะ R12-DB-10 ต้องลบโครงการที่มีเอกสารผูกอยู่
  // 🔴 มอบหมายให้หัวหน้าโครงการที่ล็อกอินอยู่จริง เพื่อให้ R12-DB-02 เป็นคำถามที่
  // แรงที่สุด: *ดูแลโครงการนี้อยู่แท้ ๆ* ก็ยังต้องไม่เห็นเอกสารของมัน
  const [testSite] = await sql(
    `insert into public.sites (name, client_name, status, start_date)
     values (${q(`${MARK} · โครงการทดสอบ`)}, ${q(MARK)}, 'active', current_date)
     returning id`)
  track('sites', testSite.id)
  await sql(`insert into public.site_supervisors (site_id, profile_id, effective_from)
             values (${q(testSite.id)}, ${q(supId)}, current_date)
             on conflict do nothing`)

  // ═══ 1 · โครงสร้างฐานข้อมูล ══════════════════════════════════════
  console.log('\n── R12-DB · ฐานข้อมูล ───────────────────────────────────────')
  const TABLES = ['customers', 'doc_counters', 'documents', 'document_lines']

  {
    const rows = await sql(
      `select relname, relrowsecurity from pg_class
        where relnamespace = 'public'::regnamespace
          and relname in (${TABLES.map(q).join(',')})`)
    check('R12-DB-01 RLS เปิดครบ 4 ตาราง',
      rows.length === 4 && rows.every((r) => r.relrowsecurity === true),
      rows.map((r) => `${r.relname}=${r.relrowsecurity}`).join(' · '))

    const pol = await sql(
      `select tablename, count(*)::int as n from pg_policies
        where schemaname = 'public' and tablename in (${TABLES.map(q).join(',')})
        group by tablename`)
    check('R12-DB-01b ทั้ง 4 ตารางมี policy ครบ 4 คำสั่ง (select/insert/update/delete)',
      pol.length === 4 && pol.every((r) => r.n === 4),
      pol.map((r) => `${r.tablename}=${r.n}`).join(' · '))
  }

  {
    const rows = await sql(
      `select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where c.relnamespace = 'public'::regnamespace
          and c.relname in (${TABLES.map(q).join(',')})
          and t.tgfoid = 'public.audit_row'::regproc and not t.tgisinternal`)
    check('R12-DB-05 audit trigger ติดครบ 4 ตาราง',
      new Set(rows.map((r) => r.relname)).size === 4,
      rows.map((r) => r.relname).join(' · '))
  }

  {
    const idx = await sql(
      `select indexname from pg_indexes where schemaname = 'public'
        and tablename in ('documents','document_lines','customers')`)
    const names = new Set(idx.map((i) => i.indexname))
    const want = [
      'documents_kind_no_uniq', 'documents_kind_date_idx', 'documents_site_idx',
      'documents_customer_idx', 'documents_txn_idx', 'documents_source_idx',
      'documents_kind_status_idx', 'documents_created_by_idx', 'documents_issued_by_idx',
      'document_lines_doc_idx', 'customers_name_uniq',
    ]
    check('R12-DB-13 index ครบตามที่ใช้กรองจริง · FK ทุกตัวมี index คลุม (§5)',
      want.every((w) => names.has(w)),
      want.filter((w) => !names.has(w)).join(' · ') || `ครบ ${want.length} ตัว`)

    // R12-DB-14 · advisor ต้องไม่มีอะไรใหม่ของ R12 ค้าง
    // (ตัวที่เหลือคือ WARN ของ `issue_document` ซึ่งตั้งใจ — ต้องให้ `authenticated`
    //  เรียกได้ และมันเช็ค `is_owner()` ข้างในเอง แบบเดียวกับ `next_doc_no`)
    const fkNoIndex = await sql(
      `select conname from pg_constraint c
        where c.conrelid in ('public.documents'::regclass, 'public.document_lines'::regclass,
                             'public.customers'::regclass, 'public.doc_counters'::regclass)
          and c.contype = 'f'
          and not exists (
            select 1 from pg_index i
             where i.indrelid = c.conrelid
               and (i.indkey::int2[])[0:array_length(c.conkey,1)-1] @> c.conkey)`)
    check('R12-DB-14 ไม่มี FK ของ R12 ตัวไหนที่ยังไม่มี index คลุม',
      fkNoIndex.length === 0, fkNoIndex.map((r) => r.conname).join(' · ') || 'ครบทุกตัว')
  }

  {
    // R12-DB-09 — red test: ยัดเลขซ้ำเข้าไปตรง ๆ ต้องถูก **index ที่ตั้งใจ** ปฏิเสธ
    const [a] = await sql(
      `insert into public.documents (kind, doc_no, status, customer_name, doc_date)
       values ('receipt', 'ZZTEST0001', 'issued', ${q(MARK)}, current_date) returning id`)
    track('docs', a.id)
    const dup = await sqlTry(
      `insert into public.documents (kind, doc_no, status, customer_name, doc_date)
       values ('receipt', 'ZZTEST0001', 'issued', ${q(MARK)}, current_date)`)
    const other = await sqlTry(
      `insert into public.documents (kind, doc_no, status, customer_name, doc_date)
       values ('quotation', 'ZZTEST0001', 'issued', ${q(MARK)}, current_date) returning id`)
    if (other.rows?.[0]?.id) track('docs', other.rows[0].id)
    check('R12-DB-09 `doc_no` ไม่ซ้ำ **ต่อชนิด** — ซ้ำในชนิดเดียวกันถูกปฏิเสธ · คนละชนิดผ่าน',
      Boolean(dup.error) && /documents_kind_no_uniq/.test(dup.error) && Boolean(other.rows),
      dup.error ? 'ปฏิเสธโดย documents_kind_no_uniq · ชนิดอื่นใช้เลขเดียวกันได้' : 'ไม่ถูกปฏิเสธ')

    // R12-DB-08 — ลบเอกสารที่ไม่ใช่ร่าง ต้องถูก guard ที่ตั้งใจปฏิเสธ
    const del = await sqlTry(`delete from public.documents where id = ${q(a.id)}`)
    check('R12-DB-08 ลบได้เฉพาะร่าง — ใบที่ออกเลขแล้วถูก `guard_document_delete` ปฏิเสธ',
      Boolean(del.error) && /DOC_DELETE_ISSUED/.test(del.error),
      del.error ? 'DOC_DELETE_ISSUED' : 'ลบผ่าน (ไม่ควร)')

    // R12-DB-06 — ล็อกเมื่อ sent · คู่ตรงข้าม: ตอน issued ยังแก้ได้
    const okEdit = await sqlTry(
      `update public.documents set customer_name = ${q(`${MARK} แก้ได้`)} where id = ${q(a.id)}`)
    await sql(`update public.documents set status = 'sent' where id = ${q(a.id)}`)
    const noEdit = await sqlTry(
      `update public.documents set customer_name = ${q(`${MARK} แก้ไม่ได้`)} where id = ${q(a.id)}`)
    check('R12-DB-06 ล็อกหลังส่งให้ลูกค้า (D4) — `issued` ยังแก้ได้ · `sent` ถูก DOC_LOCKED ปฏิเสธ',
      !okEdit.error && Boolean(noEdit.error) && /DOC_LOCKED/.test(noEdit.error),
      `issued=${okEdit.error ? 'แก้ไม่ได้ (ผิด)' : 'แก้ได้'} · sent=${noEdit.error ? 'DOC_LOCKED' : 'แก้ได้ (ผิด)'}`)

    // เลขที่เอกสารเปลี่ยนไม่ได้เด็ดขาด
    const noNo = await sqlTry(
      `update public.documents set doc_no = 'ZZTEST9999' where id = ${q(a.id)}`)
    check('R12-DB-06b เลขที่เอกสารเปลี่ยนไม่ได้แม้ในฐานข้อมูล',
      Boolean(noNo.error) && /DOC_NO_IMMUTABLE/.test(noNo.error),
      noNo.error ? 'DOC_NO_IMMUTABLE' : 'เปลี่ยนได้ (ไม่ควร)')
  }

  {
    // R12-DB-15 — ชนิดที่ generator สร้างมีตารางและ enum ของ R12 ครบ
    const t = src('src/lib/database.types.ts')
    const want = ['documents:', 'document_lines:', 'doc_counters:', 'customers:',
      'doc_kind:', 'doc_status:', 'vat_mode:']
    check('R12-DB-15 `database.types.ts` มีทั้ง 4 ตารางและ 3 enum ของ R12',
      want.every((w) => t.includes(w)),
      want.filter((w) => !t.includes(w)).join(' · ') || 'ครบ')
  }

  // ═══ 2 · RLS ตามตัวตนจริง ════════════════════════════════════════
  console.log('\n── R12-DB · ใครเห็นอะไร (ยิง PostgREST ตรง) ───────────────')
  {
    const ownerRead = await rest('documents?select=id&limit=5', ownerToken)
    const ownerRows = await ownerRead.json().catch(() => [])
    const supRead = await rest('documents?select=id&limit=5', supToken)
    const supRows = await supRead.json().catch(() => [])
    check('R12-DB-02 หัวหน้าโครงการอ่านเอกสารไม่ได้ (คู่ตรงข้าม: เจ้าของอ่านได้)',
      Array.isArray(ownerRows) && ownerRows.length > 0
        && Array.isArray(supRows) && supRows.length === 0,
      `owner=${Array.isArray(ownerRows) ? ownerRows.length : '?'} แถว · supervisor=${Array.isArray(supRows) ? supRows.length : '?'} แถว`)

    const supWrite = await rest('documents', supToken, {
      method: 'POST',
      body: JSON.stringify({ kind: 'receipt', customer_name: MARK, doc_date: '2026-09-21' }),
    })
    check('R12-DB-03 หัวหน้าโครงการเขียนเอกสารไม่ได้',
      supWrite.status === 401 || supWrite.status === 403,
      `HTTP ${supWrite.status}`)

    const anonRead = await rest('documents?select=id&limit=5', null)
    const anonRows = await anonRead.json().catch(() => null)
    const anonCust = await rest('customers?select=id&limit=5', null)
    const anonCustRows = await anonCust.json().catch(() => null)
    check('R12-DB-04 `anon` ไม่เห็นเอกสารและลูกค้าเลย',
      (Array.isArray(anonRows) ? anonRows.length === 0 : true)
        && (Array.isArray(anonCustRows) ? anonCustRows.length === 0 : true),
      `documents=${Array.isArray(anonRows) ? anonRows.length : anonRead.status} · customers=${Array.isArray(anonCustRows) ? anonCustRows.length : anonCust.status}`)
  }

  // ═══ 3 · เลขที่เอกสาร ════════════════════════════════════════════
  console.log('\n── R12-NO · เลขที่เอกสาร ────────────────────────────────────')
  await sql('delete from public.doc_counters')

  {
    // R12-NO-01 · ยังไม่ตั้งเลข → ออกเอกสารไม่ได้ (ไม่ใช่ออกเลข 1 ให้เอง)
    const d = await draft(ownerJar)
    const r = await req('POST', `/api/documents/${d.body.id}/issue`, undefined, { cookie: ownerJar })
    const b = await r.json().catch(() => ({}))
    check('R12-NO-01 ยังไม่ตั้งเลข แล้วกดออกเอกสาร → 409 DOC_COUNTER_NOT_SET',
      r.status === 409 && b.error === 'DOC_COUNTER_NOT_SET', `HTTP ${r.status} ${b.error}`)

    const stillDraft = (await sql(
      `select status::text as s, doc_no from public.documents where id = ${q(d.body.id)}`))[0]
    check('R12-NO-01b ใบที่ออกไม่สำเร็จยังเป็นร่างและไม่มีเลข',
      stillDraft.s === 'draft' && stillDraft.doc_no === null,
      `${stillDraft.s} · ${stillDraft.doc_no}`)

    // R12-NO-02 · กรอก RC1140 → ใบแรกคือ RC1141
    const set = await setCounter(ownerJar, 'receiptLastNo', 'RC1140')
    const issue = await req('POST', `/api/documents/${d.body.id}/issue`, undefined, { cookie: ownerJar })
    const ib = await issue.json().catch(() => ({}))
    check('R12-NO-02 กรอก `RC1140` → ใบแรกที่ออกคือ `RC1141`',
      set.status === 200 && issue.status === 200 && ib.doc_no === 'RC1141',
      `${ib.doc_no}`)

    // R12-NO-03 · ใบที่สอง
    const d2 = await draft(ownerJar)
    const i2 = await (await req('POST', `/api/documents/${d2.body.id}/issue`, undefined, { cookie: ownerJar })).json()
    check('R12-NO-03 ใบที่สองได้ `RC1142` · ตัวนับเดินทีละ 1', i2.doc_no === 'RC1142', `${i2.doc_no}`)

    // R12-NO-06 · ตั้งเลขย้อนหลังต่ำกว่าที่ออกไปแล้ว ต้องถูกปฏิเสธ
    const behind = await setCounter(ownerJar, 'receiptLastNo', 'RC1100')
    const bb = await behind.json().catch(() => ({}))
    check('R12-NO-06 ตั้งเลขย้อนหลังต่ำกว่าใบที่ออกแล้ว → 409 DOC_NO_BEHIND พร้อมบอกเลขสูงสุด',
      behind.status === 409 && bb.error === 'DOC_NO_BEHIND' && Number(bb.highest) >= 1142,
      `HTTP ${behind.status} ${bb.error} highest=${bb.highest}`)

    // R12-NO-10 · ยกเลิกแล้วเลขไม่ถูกใช้ซ้ำ
    const voided = await req('POST', `/api/documents/${d2.body.id}/void`,
      { reason: 'ทดสอบ' }, { cookie: ownerJar })
    const d3 = await draft(ownerJar)
    const i3 = await (await req('POST', `/api/documents/${d3.body.id}/issue`, undefined, { cookie: ownerJar })).json()
    check('R12-NO-10 ยกเลิกใบ `RC1142` แล้วใบถัดไปเป็น `RC1143` — เลขที่ยกเลิกไม่ถูกใช้ซ้ำ',
      voided.status === 200 && i3.doc_no === 'RC1143', `${i3.doc_no}`)

    // R12-NO-09 · สองชนิดเดินเลขคนละชุด
    const setQ = await setCounter(ownerJar, 'quotationLastNo', 'QT0005')
    const dq = await draft(ownerJar, { kind: 'quotation' })
    const iq = await (await req('POST', `/api/documents/${dq.body.id}/issue`, undefined, { cookie: ownerJar })).json()
    const [rc] = await sql(`select last_no from public.doc_counters where kind = 'receipt'`)
    check('R12-NO-09 เลขของสองชนิดไม่ก้าวก่ายกัน — ออกใบเสนอราคาแล้วตัวนับใบเสร็จไม่ขยับ',
      setQ.status === 200 && iq.doc_no === 'QT0006' && Number(rc.last_no) === 1143,
      `${iq.doc_no} · ตัวนับใบเสร็จยังเป็น ${rc.last_no}`)

    // R12-NO-08 · ยิงขนาน 5 ครั้ง ต้องได้ 5 เลขไม่ซ้ำ
    const five = await Promise.all([0, 1, 2, 3, 4].map(() => draft(ownerJar)))
    const issued = await Promise.all(
      five.map((d) => req('POST', `/api/documents/${d.body.id}/issue`, undefined, { cookie: ownerJar })
        .then((r) => r.json().catch(() => ({})))),
    )
    const nos = issued.map((x) => x.doc_no).filter(Boolean)
    check('R12-NO-08 ออกเอกสารพร้อมกัน 5 คำขอ → ได้ 5 เลขไม่ซ้ำกันเลย',
      nos.length === 5 && new Set(nos).size === 5,
      nos.sort().join(' '))

    // R12-NO-07 · เปลี่ยน prefix กลางคัน
    const setRe = await setCounter(ownerJar, 'receiptLastNo', 'RE2000')
    const dRe = await draft(ownerJar)
    const iRe = await (await req('POST', `/api/documents/${dRe.body.id}/issue`, undefined, { cookie: ownerJar })).json()
    check('R12-NO-07 เปลี่ยน prefix กลางคัน (`RC`→`RE2000`) → ใบถัดไป `RE2001` · ใบเก่ายังเป็น RC',
      setRe.status === 200 && iRe.doc_no === 'RE2001', `${iRe.doc_no}`)
  }

  // ═══ 4 · endpoint ════════════════════════════════════════════════
  console.log('\n── R12-API · endpoint ───────────────────────────────────────')
  {
    // R12-API-01 · สร้างร่าง 3 บรรทัด — ยอดมาจากฐานข้อมูล ไม่ใช่จากหน้าจอ
    const three = await draft(ownerJar, {
      kind: 'quotation',
      lines: [
        { description: 'บรรทัด 1', qty: 1, unit: 'งาน', unitPrice: 50000 },
        { description: 'บรรทัด 2', qty: 1, unit: 'งาน', unitPrice: 30000 },
        { description: 'บรรทัด 3', qty: 1, unit: 'งาน', unitPrice: 20000 },
      ],
    })
    const [row] = await sql(
      `select status::text as s, doc_no, subtotal::float8 as sub, vat_amount::float8 as vat,
              total::float8 as total, amount_words
         from public.documents where id = ${q(three.body.id)}`)
    check('R12-API-01 สร้างร่าง 3 บรรทัด → 201 · เป็นร่าง · ยังไม่มีเลข · ยอดคิดในฐานข้อมูล',
      three.status === 201 && row.s === 'draft' && row.doc_no === null
        && row.sub === 93457.94 && row.vat === 6542.06 && row.total === 100000
        && row.amount_words === 'หนึ่งแสนบาทถ้วน',
      `${row.sub}/${row.vat}/${row.total} · ${row.amount_words}`)

    // R12-CALC-13 · ค่าคงที่ของตาราง — ทุกแถวต้อง `total = Σ บรรทัด + vat`
    // 🔴 ตรวจ **ทั้งตาราง** ไม่ใช่เฉพาะใบที่เพิ่งสร้าง · ถ้ามีทางไหนเขียนยอด
    // โดยไม่ผ่าน `doc_recalc()` มันจะโผล่ตรงนี้ ไม่ว่าจะเขียนจากที่ไหน
    {
      const bad = await sql(
        `select d.id, d.total::float8 as t, d.subtotal::float8 as s, d.vat_amount::float8 as v,
                coalesce(sum(l.line_total), 0)::float8 as lines
           from public.documents d
           left join public.document_lines l on l.document_id = d.id
          group by d.id, d.total, d.subtotal, d.vat_amount
         having round(coalesce(sum(l.line_total), 0), 2) <> round(d.subtotal, 2)
             or round(d.subtotal + d.vat_amount, 2) <> round(d.total, 2)`)
      check('R12-CALC-13 ทุกแถวในตาราง: Σ บรรทัด = subtotal และ subtotal + vat = total',
        bad.length === 0,
        bad.length ? bad.slice(0, 3).map((b) => `${b.id} ${b.lines}/${b.s}/${b.v}/${b.t}`).join(' · ')
          : 'ไม่มีแถวไหนขัดกับบรรทัดของตัวเอง')
    }

    const nLines = (await sql(
      `select count(*)::int as n from public.document_lines where document_id = ${q(three.body.id)}`))[0].n
    check('R12-API-01b บรรทัดถูกเขียนครบ 3 แถว', Number(nLines) === 3, `${nLines} แถว`)

    // R12-API-02 · ไม่มีบรรทัดเลย
    const noLines = await req('POST', '/api/documents', {
      kind: 'receipt', customerName: MARK, docDate: '2026-09-21', lines: [],
    }, { cookie: ownerJar })
    const nlBody = await noLines.json().catch(() => ({}))
    check('R12-API-02 สร้างโดยไม่มีบรรทัดเลย → 422 DOC_LINES_EMPTY',
      noLines.status === 422 && nlBody.error === 'DOC_LINES_EMPTY', `HTTP ${noLines.status} ${nlBody.error}`)

    // R12-API-03 · ชื่อลูกค้าว่าง
    const noName = await req('POST', '/api/documents', {
      kind: 'receipt', customerName: '   ', docDate: '2026-09-21',
      lines: [{ description: 'ก', qty: 1, unitPrice: 1 }],
    }, { cookie: ownerJar })
    const nnBody = await noName.json().catch(() => ({}))
    check('R12-API-03 ชื่อลูกค้าว่าง (ช่องว่างล้วน) → 422 DOC_CUSTOMER_REQUIRED',
      noName.status === 422 && nnBody.error === 'DOC_CUSTOMER_REQUIRED', `HTTP ${noName.status} ${nnBody.error}`)

    // R12-API-04 · site_id ที่ไม่มีจริง → 422 ไม่ใช่ 500 จาก FK
    const badSite = await req('POST', '/api/documents', {
      kind: 'receipt', customerName: MARK, docDate: '2026-09-21',
      siteId: '00000000-0000-4000-8000-000000000000',
      lines: [{ description: 'ก', qty: 1, unitPrice: 1 }],
    }, { cookie: ownerJar })
    const bsBody = await badSite.json().catch(() => ({}))
    check('R12-API-04 `site_id` ที่ไม่มีจริง → 422 SITE_NOT_FOUND (ไม่ใช่ 500 จาก FK)',
      badSite.status === 422 && bsBody.error === 'SITE_NOT_FOUND', `HTTP ${badSite.status} ${bsBody.error}`)

    // R12-API-05 · ไม่ผูกโครงการ
    const free = await draft(ownerJar, { siteId: '' })
    const [freeRow] = await sql(`select site_id from public.documents where id = ${q(free.body.id)}`)
    check('R12-API-05 `siteId` ว่าง → สร้างได้ และ `site_id` เป็น null จริง',
      free.status === 201 && freeRow.site_id === null, `site_id=${freeRow.site_id}`)

    // เอกสารที่ผูกโครงการ — ใช้ต่อในหมวด SITE
    const linked = await draft(ownerJar, { siteId: made.sites[0], kind: 'quotation' })
    const linked2 = await draft(ownerJar, { siteId: made.sites[0] })

    // R12-API-06 · double-click ปุ่มออกเอกสาร
    const dd = await draft(ownerJar)
    const [c1, c2] = await Promise.all([
      req('POST', `/api/documents/${dd.body.id}/issue`, undefined, { cookie: ownerJar }),
      req('POST', `/api/documents/${dd.body.id}/issue`, undefined, { cookie: ownerJar }),
    ])
    const codes = [c1.status, c2.status].sort()
    const [ddRow] = await sql(`select doc_no from public.documents where id = ${q(dd.body.id)}`)
    check('R12-API-06 double-click ออกเอกสาร → สำเร็จ 1 · อีกคำขอ 409 · ใบได้เลขเดียว',
      codes[0] === 200 && codes[1] === 409 && Boolean(ddRow.doc_no),
      `HTTP ${codes.join('/')} · ${ddRow.doc_no}`)

    // R12-BAHT-12 · `amount_words` เป็นสำเนาที่แช่ไว้ ไม่ได้คิดใหม่ตอนอ่าน
    {
      const [w1] = await sql(
        `select amount_words from public.documents where id = ${q(dd.body.id)}`)
      await sql(`update public.documents set amount_words = 'ZZ-สำเนาเก่า' where id = ${q(dd.body.id)}`)
      const h = await page(`/documents/${dd.body.id}`, ownerJar)
      check('R12-BAHT-12 หน้าจออ่าน `amount_words` จากแถว ไม่ได้คิดใหม่ทุกครั้งที่เปิด',
        w1.amount_words.includes('บาท') && h.includes('ZZ-สำเนาเก่า'),
        `เขียนตอนออกเอกสาร "${w1.amount_words}" · หน้าจอโชว์ค่าที่อยู่ในแถว`)
      await sql(`update public.documents set amount_words = ${q(w1.amount_words)}
                  where id = ${q(dd.body.id)}`)
    }

    // R12-API-07 / 08 · ไม่ล็อกอิน และ PIN หัวหน้าโครงการ
    const ENDPOINTS = [
      ['POST', '/api/documents'],
      ['PATCH', `/api/documents/${dd.body.id}`],
      ['DELETE', `/api/documents/${dd.body.id}`],
      ['POST', `/api/documents/${dd.body.id}/issue`],
      ['POST', `/api/documents/${dd.body.id}/send`],
      ['POST', `/api/documents/${dd.body.id}/accept`],
      ['POST', `/api/documents/${dd.body.id}/void`],
      ['POST', `/api/documents/${dd.body.id}/convert`],
      ['POST', `/api/documents/${dd.body.id}/income`],
      ['POST', '/api/customers'],
      ['PATCH', '/api/settings/documents'],
    ]
    const anonCodes = []
    const supCodes = []
    for (const [m, p] of ENDPOINTS) {
      anonCodes.push((await req(m, p, {})).status)
      supCodes.push((await req(m, p, {}, { cookie: supJar })).status)
    }
    check(`R12-API-07 ทั้ง ${ENDPOINTS.length} endpoint ตอบ 401 เมื่อไม่ล็อกอิน (ไม่ใช่ 307 ไปหน้า login)`,
      anonCodes.every((c) => c === 401), anonCodes.join(' '))
    check(`R12-API-08 ทั้ง ${ENDPOINTS.length} endpoint ตอบ 403 เมื่อเป็นหัวหน้าโครงการ`,
      supCodes.every((c) => c === 403), supCodes.join(' '))

    // R12-API-10 · issued แต่ยังไม่ส่ง → แก้ได้ (D4)
    const patchIssued = await req('PATCH', `/api/documents/${dd.body.id}`, {
      customerName: `${MARK} · แก้หลังออกเลข`,
    }, { cookie: ownerJar })
    check('R12-API-10 `PATCH` ใบที่ `issued` แต่ยังไม่ส่ง → 200 แก้ได้ (D4)',
      patchIssued.status === 200, `HTTP ${patchIssued.status}`)

    // R12-API-23 · ส่งมาเฉพาะบางช่อง — ช่องอื่นต้องไม่ถูกแตะ
    const beforePatch = (await sql(
      `select customer_name, doc_date::text as d, vat_mode::text as m, total::float8 as t
         from public.documents where id = ${q(dd.body.id)}`))[0]
    await req('PATCH', `/api/documents/${dd.body.id}`, { note: 'เฉพาะหมายเหตุ' }, { cookie: ownerJar })
    const afterPatch = (await sql(
      `select customer_name, doc_date::text as d, vat_mode::text as m, total::float8 as t, note
         from public.documents where id = ${q(dd.body.id)}`))[0]
    check('R12-API-23 `PATCH` เฉพาะบางช่อง → ช่องที่ไม่ได้ส่งมาไม่ถูกแตะเลย',
      afterPatch.customer_name === beforePatch.customer_name && afterPatch.d === beforePatch.d
        && afterPatch.m === beforePatch.m && afterPatch.t === beforePatch.t
        && afterPatch.note === 'เฉพาะหมายเหตุ',
      `ชื่อ/วันที่/โหมด/ยอด เท่าเดิม · note ถูกเขียน`)

    // R12-API-22 · ค่าที่ไม่อยู่ใน enum ต้องไม่หลุดเข้าฐาน
    const bogus = await draft(ownerJar, { vatMode: 'vat5' })
    const [bogusRow] = await sql(`select vat_mode::text as m from public.documents where id = ${q(bogus.body.id)}`)
    check('R12-API-22 `vatMode=\'vat5\'` ไม่หลุดเข้าฐาน — ตกไปเป็น `inclusive` ที่ถูกต้อง',
      bogus.status === 201 && bogusRow.m === 'inclusive', `vat_mode=${bogusRow.m}`)

    // R12-API-09 · sent แล้วแก้ไม่ได้
    const sendOk = await req('POST', `/api/documents/${dd.body.id}/send`, undefined, { cookie: ownerJar })
    const patchSent = await req('PATCH', `/api/documents/${dd.body.id}`,
      { customerName: `${MARK} · ห้ามแก้` }, { cookie: ownerJar })
    const psBody = await patchSent.json().catch(() => ({}))
    check('R12-API-09 `PATCH` ใบที่ `sent` แล้ว → 409 DOC_LOCKED',
      sendOk.status === 200 && patchSent.status === 409 && psBody.error === 'DOC_LOCKED',
      `send=${sendOk.status} · patch=${patchSent.status} ${psBody.error}`)

    const sendTwice = await req('POST', `/api/documents/${dd.body.id}/send`, undefined, { cookie: ownerJar })
    check('R12-API-09b ติ๊ก "ส่งแล้ว" ซ้ำ → 409 DOC_ALREADY_SENT (ไม่เขียนทับเวลาเดิม)',
      sendTwice.status === 409, `HTTP ${sendTwice.status}`)

    // R12-API-11 / 12 · ยกเลิก
    const noReason = await req('POST', `/api/documents/${dd.body.id}/void`, {}, { cookie: ownerJar })
    const nrBody = await noReason.json().catch(() => ({}))
    check('R12-API-11 `POST /void` โดยไม่ใส่เหตุผล → 422 VOID_REASON_REQUIRED',
      noReason.status === 422 && nrBody.error === 'VOID_REASON_REQUIRED', `HTTP ${noReason.status} ${nrBody.error}`)

    const void1 = await req('POST', `/api/documents/${dd.body.id}/void`, { reason: 'ทดสอบยกเลิก' }, { cookie: ownerJar })
    const void2 = await req('POST', `/api/documents/${dd.body.id}/void`, { reason: 'ซ้ำ' }, { cookie: ownerJar })
    const v2Body = await void2.json().catch(() => ({}))
    check('R12-API-12 ยกเลิกใบที่ยกเลิกแล้ว → 409 DOC_ALREADY_VOID · เหตุผลเดิมไม่ถูกทับ',
      void1.status === 200 && void2.status === 409 && v2Body.error === 'DOC_ALREADY_VOID',
      `${void1.status}/${void2.status}`)

    const [voidRow] = await sql(`select void_reason from public.documents where id = ${q(dd.body.id)}`)
    check('R12-API-12b เหตุผลที่เก็บไว้คือเหตุผลของครั้งแรก',
      voidRow.void_reason === 'ทดสอบยกเลิก', `${voidRow.void_reason}`)

    // R12-API-13 · accept กับใบเสร็จ
    const acceptReceipt = await req('POST', `/api/documents/${linked2.body.id}/accept`, undefined, { cookie: ownerJar })
    const arBody = await acceptReceipt.json().catch(() => ({}))
    check('R12-API-13 `POST /accept` กับ **ใบเสร็จ** → 422 ACCEPT_QUOTATION_ONLY',
      acceptReceipt.status === 422 && arBody.error === 'ACCEPT_QUOTATION_ONLY',
      `HTTP ${acceptReceipt.status} ${arBody.error}`)

    // คู่ตรงข้าม: ใบเสนอราคาที่ออกแล้ว ตอบรับได้
    await req('POST', `/api/documents/${linked.body.id}/issue`, undefined, { cookie: ownerJar })
    const acceptQ = await req('POST', `/api/documents/${linked.body.id}/accept`, undefined, { cookie: ownerJar })
    check('R12-API-13b คู่ตรงข้าม — ใบเสนอราคาที่ออกแล้ว ตอบรับได้ (200)',
      acceptQ.status === 200, `HTTP ${acceptQ.status}`)

    // R12-API-14 / 15 · convert
    const conv = await req('POST', `/api/documents/${linked.body.id}/convert`, undefined, { cookie: ownerJar })
    const convBody = await conv.json().catch(() => ({}))
    if (convBody.id) track('docs', convBody.id)
    const [convRow] = convBody.id
      ? await sql(`select kind::text as k, status::text as s, site_id, total::float8 as t,
                          source_document_id from public.documents where id = ${q(convBody.id)}`)
      : [{}]
    const [srcRow] = await sql(
      `select status::text as s, total::float8 as t from public.documents where id = ${q(linked.body.id)}`)
    check('R12-API-14 `convert` ใบเสนอราคา → ใบเสร็จ**ร่าง** ยอด/โครงการ/ต้นทางครบ · ใบต้นทางไม่เปลี่ยนสถานะ',
      conv.status === 201 && convRow.k === 'receipt' && convRow.s === 'draft'
        && convRow.site_id === made.sites[0] && convRow.t === srcRow.t
        && convRow.source_document_id === linked.body.id && srcRow.s === 'accepted',
      `${convRow.k}/${convRow.s} · ยอด ${convRow.t} · ต้นทางยังเป็น ${srcRow.s}`)

    const conv2 = await req('POST', `/api/documents/${linked.body.id}/convert`, undefined, { cookie: ownerJar })
    const conv2Body = await conv2.json().catch(() => ({}))
    check('R12-API-15 `convert` ซ้ำ → 409 DOC_ALREADY_CONVERTED พร้อม id ของใบเดิม',
      conv2.status === 409 && conv2Body.error === 'DOC_ALREADY_CONVERTED' && conv2Body.id === convBody.id,
      `HTTP ${conv2.status} ${conv2Body.error}`)

    // R12-API-16 … 20 · ผูกรายรับ
    const [incomeCat] = await sql(
      `select id from public.categories where kind = 'income' and is_active order by sort_order limit 1`)
    const recA = await draft(ownerJar, { siteId: made.sites[0] })
    await req('POST', `/api/documents/${recA.body.id}/issue`, undefined, { cookie: ownerJar })

    const inc = await req('POST', `/api/documents/${recA.body.id}/income`,
      { categoryId: incomeCat.id, payMethod: 'transfer' }, { cookie: ownerJar })
    const incBody = await inc.json().catch(() => ({}))
    if (incBody.txnId) track('txns', incBody.txnId)
    const [txnRow] = incBody.txnId
      ? await sql(`select amount::float8 as a, kind::text as k, status::text as s, site_id
                     from public.transactions where id = ${q(incBody.txnId)}`)
      : [{}]
    const [docTotal] = await sql(`select total::float8 as t from public.documents where id = ${q(recA.body.id)}`)
    check('R12-API-16 `POST /income` สร้างรายรับ **ยอดเต็มตามหน้ากระดาษ** (D3) · approved · ผูกโครงการเดียวกัน',
      inc.status === 201 && txnRow.a === docTotal.t && txnRow.k === 'income'
        && txnRow.s === 'approved' && txnRow.site_id === made.sites[0],
      `฿${txnRow.a} = ฿${docTotal.t} · ${txnRow.s}`)

    const incAgain = await req('POST', `/api/documents/${recA.body.id}/income`,
      { categoryId: incomeCat.id }, { cookie: ownerJar })
    const iaBody = await incAgain.json().catch(() => ({}))
    const nTxn = (await sql(
      `select count(*)::int as n from public.transactions where id = ${q(incBody.txnId)}`))[0].n
    check('R12-API-18 กด "ลงรายรับ" ซ้ำ → 409 DOC_INCOME_LINKED · **ไม่มีรายรับแถวที่สอง** (กับดักข้อ 1)',
      incAgain.status === 409 && iaBody.error === 'DOC_INCOME_LINKED' && Number(nTxn) === 1,
      `HTTP ${incAgain.status} · รายรับ ${nTxn} แถว`)

    // R12-API-17 · ผูกกับรายรับที่คีย์ไว้แล้ว
    const [existingTxn] = await sql(
      `insert into public.transactions (kind, site_id, category_id, amount, txn_date, pay_method, status, income_kind, note)
       values ('income', ${q(made.sites[0])}, ${q(incomeCat.id)}, 1000, current_date, 'cash', 'approved', 'other', ${q(MARK)})
       returning id`)
    track('txns', existingTxn.id)
    const recB = await draft(ownerJar, { siteId: made.sites[0] })
    await req('POST', `/api/documents/${recB.body.id}/issue`, undefined, { cookie: ownerJar })
    const beforeN = (await sql('select count(*)::int as n from public.transactions')) [0].n
    const link = await req('POST', `/api/documents/${recB.body.id}/income`,
      { txnId: existingTxn.id }, { cookie: ownerJar })
    const linkBody = await link.json().catch(() => ({}))
    const afterN = (await sql('select count(*)::int as n from public.transactions'))[0].n
    check('R12-API-17 ผูกกับรายรับที่มีอยู่แล้ว → ไม่สร้างแถวใหม่เลย (`created: false`)',
      link.status === 200 && linkBody.created === false && Number(afterN) === Number(beforeN),
      `created=${linkBody.created} · แถวรายรับ ${beforeN}→${afterN}`)

    const linkTaken = await req('POST', `/api/documents/${recA.body.id}/income`,
      { txnId: existingTxn.id }, { cookie: ownerJar })
    check('R12-API-17b ผูกรายรับที่ใบอื่นจองไปแล้ว → 409 (ไม่ให้สองใบชี้รายรับแถวเดียว)',
      linkTaken.status === 409, `HTTP ${linkTaken.status}`)

    // R12-API-19 · income กับใบเสนอราคา
    const qDraft = await draft(ownerJar, { kind: 'quotation' })
    await req('POST', `/api/documents/${qDraft.body.id}/issue`, undefined, { cookie: ownerJar })
    const incQ = await req('POST', `/api/documents/${qDraft.body.id}/income`,
      { categoryId: incomeCat.id }, { cookie: ownerJar })
    const iqBody = await incQ.json().catch(() => ({}))
    check('R12-API-19 `POST /income` กับ **ใบเสนอราคา** → 422 INCOME_RECEIPT_ONLY',
      incQ.status === 422 && iqBody.error === 'INCOME_RECEIPT_ONLY', `HTTP ${incQ.status} ${iqBody.error}`)

    // R12-API-20 / R12-DB-07 · ลบรายรับที่ผูกอยู่ → เอกสารไม่หาย แต่ txn_id ว่าง
    const delTxn = await req('DELETE', `/api/transactions/${incBody.txnId}`, undefined, { cookie: ownerJar })
    const [afterDel] = await sql(
      `select txn_id, status::text as s from public.documents where id = ${q(recA.body.id)}`)
    check('R12-API-20 ลบรายรับที่ผูกกับใบเสร็จ → ใบเสร็จยังอยู่ · `txn_id` กลายเป็น null (ไม่ใช่ลบใบตาม)',
      delTxn.status === 200 && afterDel.txn_id === null && afterDel.s !== undefined,
      `HTTP ${delTxn.status} · txn_id=${afterDel.txn_id} · สถานะ ${afterDel.s}`)
    if (delTxn.status === 200) made.txns = made.txns.filter((t) => t !== incBody.txnId)

    // R12-DB-07 · ล็อกเมื่อผูกรายรับแล้ว (ยังไม่ได้ sent)
    const recC = await draft(ownerJar, { siteId: made.sites[0] })
    await req('POST', `/api/documents/${recC.body.id}/issue`, undefined, { cookie: ownerJar })
    const incC = await req('POST', `/api/documents/${recC.body.id}/income`,
      { categoryId: incomeCat.id }, { cookie: ownerJar })
    const incCBody = await incC.json().catch(() => ({}))
    if (incCBody.txnId) track('txns', incCBody.txnId)
    const patchLinked = await req('PATCH', `/api/documents/${recC.body.id}`,
      { customerName: `${MARK} · ห้ามแก้` }, { cookie: ownerJar })
    check('R12-DB-07 ใบที่ `issued` + ผูกรายรับแล้ว → แก้ไม่ได้ (409 DOC_LOCKED) แม้ยังไม่ติ๊กส่ง',
      patchLinked.status === 409, `HTTP ${patchLinked.status}`)

    // R12-API-21 / R12-CUS-01 · ลูกค้า
    const cus = await req('POST', '/api/customers', {
      name: `${MARK} · เทศบาลทดสอบ`, taxId: '0994000123456',
      branch: '(สำนักงานใหญ่)', address: 'ที่อยู่ทดสอบ', phone: '053000000',
    }, { cookie: ownerJar })
    const cusBody = await cus.json().catch(() => ({}))
    if (cusBody.customer?.id) track('customers', cusBody.customer.id)
    check('R12-CUS-01 เพิ่มลูกค้าใหม่ → 201 พร้อม id และชื่อที่บันทึกจริง',
      cus.status === 201 && Boolean(cusBody.customer?.id), `HTTP ${cus.status}`)

    const cusDup = await req('POST', '/api/customers', {
      name: `  ${MARK} · เทศบาลทดสอบ  `,
    }, { cookie: ownerJar })
    const cdBody = await cusDup.json().catch(() => ({}))
    check('R12-API-21 ชื่อลูกค้าซ้ำ (ต่างแค่ช่องว่างหน้า-หลัง) → 409 CUSTOMER_DUPLICATE + id ของรายเดิม',
      cusDup.status === 409 && cdBody.error === 'CUSTOMER_DUPLICATE'
        && cdBody.id === cusBody.customer?.id,
      `HTTP ${cusDup.status} ${cdBody.error}`)

    // R12-DB-11 · ลบลูกค้าที่มีเอกสารผูกอยู่ → เอกสารยังอยู่ ชื่อบนใบยังอยู่
    const withCus = await draft(ownerJar, { customerId: cusBody.customer?.id })
    await sql(`delete from public.customers where id = ${q(cusBody.customer.id)}`)
    const [afterCusDel] = await sql(
      `select customer_id, customer_name from public.documents where id = ${q(withCus.body.id)}`)
    check('R12-DB-11 ลบลูกค้าที่มีเอกสารผูกอยู่ → เอกสารยังอยู่ · `customer_id` null · **สำเนาชื่อบนใบยังอยู่**',
      afterCusDel.customer_id === null && afterCusDel.customer_name.includes(MARK),
      `customer_id=${afterCusDel.customer_id} · ชื่อบนใบ "${afterCusDel.customer_name}"`)
    made.customers = made.customers.filter((c) => c !== cusBody.customer.id)

    // R12-DB-12 · สำเนาผู้ขายแช่แข็ง
    // 🔴 ตั้งค่าที่ **ไม่ใช่ null** ก่อนออกใบเก่า ไม่งั้น `null === null` ผ่านฟรี
    await sql(`update public.app_settings set phone = 'ZZ-เบอร์เก่า' where id = true`)
    const oldDoc = await draft(ownerJar)
    await req('POST', `/api/documents/${oldDoc.body.id}/issue`, undefined, { cookie: ownerJar })
    await sql(`update public.app_settings set phone = 'ZZ-เบอร์ใหม่' where id = true`)
    const freshDoc = await draft(ownerJar)
    await req('POST', `/api/documents/${freshDoc.body.id}/issue`, undefined, { cookie: ownerJar })
    const [sellerOld] = await sql(
      `select seller->>'phone' as p from public.documents where id = ${q(oldDoc.body.id)}`)
    const [sellerNew] = await sql(
      `select seller->>'phone' as p from public.documents where id = ${q(freshDoc.body.id)}`)
    check('R12-DB-12 สำเนาผู้ขายแช่แข็ง — แก้เบอร์บริษัทแล้วใบเก่าไม่เปลี่ยน · ใบใหม่ได้ค่าใหม่',
      sellerOld.p === 'ZZ-เบอร์เก่า' && sellerNew.p === 'ZZ-เบอร์ใหม่',
      `ใบเก่า "${sellerOld.p}" · ใบใหม่ "${sellerNew.p}"`)

    // ── เดินเครื่องสถานะให้ครบทุกเส้น (R12-ST-*) ──────────────────
    console.log('\n── R12-ST · เครื่องสถานะของเอกสาร ──────────────────────────')
    {
      const at = async (id) =>
        (await sql(`select status::text as s, doc_no, issued_at, sent_at, accepted_at, voided_at
                      from public.documents where id = ${q(id)}`))[0]

      // ST-01 · ร่าง — ไม่มีเลข · แก้ได้ · ลบได้
      const a = await draft(ownerJar, { kind: 'quotation' })
      const a0 = await at(a.body.id)
      const editDraft = await req('PATCH', `/api/documents/${a.body.id}`,
        { customerName: `${MARK} · แก้ร่างได้` }, { cookie: ownerJar })
      const b = await draft(ownerJar)
      const delDraft = await req('DELETE', `/api/documents/${b.body.id}`, undefined, { cookie: ownerJar })
      if (delDraft.status === 200) made.docs = made.docs.filter((x) => x !== b.body.id)
      check('R12-ST-01 ร่าง — ไม่มีเลขที่ · แก้ได้ · ลบได้',
        a0.s === 'draft' && a0.doc_no === null && editDraft.status === 200 && delDraft.status === 200,
        `doc_no=${a0.doc_no} · patch=${editDraft.status} · delete=${delDraft.status}`)

      // ST-09 · ร่าง → "ส่งแล้ว" โดยข้ามการออกเลข
      const skip = await req('POST', `/api/documents/${a.body.id}/send`, undefined, { cookie: ownerJar })
      const skipBody = await skip.json().catch(() => ({}))
      check('R12-ST-09 ร่าง → ติ๊ก "ส่งแล้ว" โดยยังไม่ออกเลข → 409 DOC_NOT_ISSUED',
        skip.status === 409 && skipBody.error === 'DOC_NOT_ISSUED', `HTTP ${skip.status} ${skipBody.error}`)

      // ST-02 · ร่าง → ออกเอกสาร
      await req('POST', `/api/documents/${a.body.id}/issue`, undefined, { cookie: ownerJar })
      const a1 = await at(a.body.id)
      check('R12-ST-02 ออกเอกสาร → `issued` · ได้เลขที่ · `issued_at` ถูกตั้ง',
        a1.s === 'issued' && Boolean(a1.doc_no) && Boolean(a1.issued_at), `${a1.s} ${a1.doc_no}`)

      // ST-10 · ลบใบที่ออกเลขแล้ว
      const delIssued = await req('DELETE', `/api/documents/${a.body.id}`, undefined, { cookie: ownerJar })
      const diBody = await delIssued.json().catch(() => ({}))
      check('R12-ST-10 ลบใบที่ออกเลขแล้ว → 409 DOC_DELETE_ISSUED (ให้ยกเลิกแทน เลขจะได้ไม่หาย)',
        delIssued.status === 409 && diBody.error === 'DOC_DELETE_ISSUED',
        `HTTP ${delIssued.status} ${diBody.error}`)

      // ST-03 · ออกเลขแล้วยังแก้ได้ · เลขไม่เปลี่ยน · audit เก็บ before/after
      const editIssued = await req('PATCH', `/api/documents/${a.body.id}`,
        { customerName: `${MARK} · แก้หลังออกเลขได้` }, { cookie: ownerJar })
      const a2 = await at(a.body.id)
      // แถวที่ **ชื่อเปลี่ยนจริง** ไม่ใช่แถวล่าสุด — route เขียน `amount_words`
      // ตามหลังการแก้เสมอ แถวสุดท้ายจึงเป็นแถวที่ชื่อเท่าเดิมทั้งสองฝั่ง
      const [auditRow] = await sql(
        `select before->>'customer_name' as b, after->>'customer_name' as a
           from public.audit_log
          where table_name = 'documents' and row_id::text = ${q(a.body.id)} and action = 'UPDATE'
            and before->>'customer_name' is distinct from after->>'customer_name'
          order by at desc limit 1`)
      check('R12-ST-03 `issued` → แก้ได้ (D4) · เลขเดิม · audit มีทั้ง before และ after',
        editIssued.status === 200 && a2.doc_no === a1.doc_no
          && Boolean(auditRow?.b) && Boolean(auditRow?.a) && auditRow.b !== auditRow.a,
        `เลข ${a2.doc_no} · audit "${auditRow?.b}" → "${auditRow?.a}"`)

      // ST-04 · ส่งให้ลูกค้าแล้ว
      await req('POST', `/api/documents/${a.body.id}/send`, undefined, { cookie: ownerJar })
      const a3 = await at(a.body.id)
      check('R12-ST-04 ติ๊กส่งแล้ว → `sent` · `sent_at` ถูกตั้ง',
        a3.s === 'sent' && Boolean(a3.sent_at), `${a3.s}`)

      // ST-05 · sent แล้วแก้ไม่ได้ และ **แถวต้องไม่เปลี่ยน**
      const before5 = await at(a.body.id)
      const edit5 = await req('PATCH', `/api/documents/${a.body.id}`,
        { customerName: `${MARK} · ห้ามแก้` }, { cookie: ownerJar })
      const after5 = await at(a.body.id)
      check('R12-ST-05 `sent` → แก้ไม่ได้ (409) · แถวไม่เปลี่ยนสักช่อง',
        edit5.status === 409 && JSON.stringify(before5) === JSON.stringify(after5),
        `HTTP ${edit5.status} · แถวเท่าเดิม`)

      // ST-06 · ลูกค้าตอบรับ
      await req('POST', `/api/documents/${a.body.id}/accept`, undefined, { cookie: ownerJar })
      const a4 = await at(a.body.id)
      check('R12-ST-06 ใบเสนอราคาที่ส่งแล้ว → ตอบรับได้ · `accepted_at` ถูกตั้ง',
        a4.s === 'accepted' && Boolean(a4.accepted_at), `${a4.s}`)

      // ST-07 · ยกเลิก — เลขไม่ถูกใช้ซ้ำ และแถวยังอยู่ในลิสต์
      await req('POST', `/api/documents/${a.body.id}/void`,
        { reason: 'ทดสอบเครื่องสถานะ' }, { cookie: ownerJar })
      const a5 = await at(a.body.id)
      const listVoid = await page('/documents?kind=quotation&status=void', ownerJar)
      const nextQ = await draft(ownerJar, { kind: 'quotation' })
      const nextNo = await (await req('POST', `/api/documents/${nextQ.body.id}/issue`,
        undefined, { cookie: ownerJar })).json()
      check('R12-ST-07 ยกเลิกได้จาก `accepted` · แถวยังอยู่ในลิสต์ · เลขที่ยกเลิกไม่ถูกใช้ซ้ำ',
        a5.s === 'void' && Boolean(a5.voided_at) && listVoid.includes(a.body.id)
          && nextNo.doc_no !== a5.doc_no && docNoSeqOf(nextNo.doc_no) > docNoSeqOf(a5.doc_no),
        `${a5.doc_no} (ยกเลิก) → ใบถัดไป ${nextNo.doc_no}`)

      // ST-08 · void แล้วทำอะไรไม่ได้อีกเลย
      const voidActions = await Promise.all([
        req('PATCH', `/api/documents/${a.body.id}`, { customerName: 'x' }, { cookie: ownerJar }),
        req('POST', `/api/documents/${a.body.id}/send`, undefined, { cookie: ownerJar }),
        req('POST', `/api/documents/${a.body.id}/accept`, undefined, { cookie: ownerJar }),
        req('POST', `/api/documents/${a.body.id}/void`, { reason: 'ซ้ำ' }, { cookie: ownerJar }),
        req('POST', `/api/documents/${a.body.id}/convert`, undefined, { cookie: ownerJar }),
        req('DELETE', `/api/documents/${a.body.id}`, undefined, { cookie: ownerJar }),
      ])
      const codes8 = voidActions.map((r) => r.status)
      const a6 = await at(a.body.id)
      check('R12-ST-08 ใบที่ยกเลิกแล้ว — ทุกคำสั่งถูกปฏิเสธ (4xx) และแถวไม่เปลี่ยน',
        codes8.every((c) => c >= 400 && c < 500) && JSON.stringify(a5) === JSON.stringify(a6),
        codes8.join(' '))
    }

    // ── หน้า HTML ที่ตัดสินจากฝั่งเซิร์ฟเวอร์ได้ ──────────────────
    console.log('\n── R12-UI / R12-SITE / R12-PRT / R12-SET · หน้าจอ ──────────')
    const list0 = await page('/documents', ownerJar)

    // ── สี่สถานะของ `/documents` (§15) ────────────────────────────
    {
      const nothing = await page(
        `/documents?kind=receipt&q=${encodeURIComponent('ZZไม่มีทางมีลูกค้าชื่อนี้')}`, ownerJar)
      check('R12-UI-01 ค้นแล้วไม่เจอ → สถานะว่างที่บอกว่าให้ล้างตัวกรอง ไม่ใช่หน้าโล่ง',
        nothing.includes('ไม่พบเอกสารที่ตรงกับเงื่อนไขนี้'), 'ข้อความสถานะว่างแบบ "ค้นไม่เจอ"')

      const skeleton = src('src/app/(app)/documents/loading.tsx')
      check('R12-UI-02 มีโครงร่างระหว่างโหลด และมันถูกส่งออกไปจริงในสตรีม',
        /animate-pulse|Skeleton/.test(skeleton) && list0.includes('animate-pulse'),
        'loading.tsx + โครงร่างอยู่ใน HTML ที่สตรีมมา')

      const listSrc = src('src/app/(app)/documents/(list)/page.tsx')
      check('R12-UI-03 query พัง → การ์ดผิดพลาดพร้อมปุ่มลองใหม่ ไม่ใช่ลิสต์ว่างที่อ่านเหมือน "ไม่มีข้อมูล"',
        listSrc.includes('DataError') && listSrc.includes('if (error)'),
        'สาขา error แยกจากสาขาว่างจริง')
    }

    const list = await page('/documents', ownerJar)
    const STATUS_CHIPS = ['ทั้งหมด', 'ร่าง', 'ออกเลขแล้ว', 'ส่งให้ลูกค้าแล้ว', 'ลูกค้าตอบรับแล้ว', 'ยกเลิกแล้ว']
    check('R12-UI-04 `/documents` มีแท็บสองชนิด และตัวกรองสถานะครบ 6 ค่า',
      list.includes('ใบเสนอราคา') && list.includes('ใบเสร็จรับเงิน')
        && STATUS_CHIPS.every((s) => list.includes(s)),
      STATUS_CHIPS.filter((s) => !list.includes(s)).join(' · ') || 'แท็บ + ชิปสถานะครบ')

    // กรองด้วย id ของเอกสารจริง ไม่ใช่เดาจากเลขที่ — prefix เปลี่ยนได้ (NO-07)
    const listSite = await page(`/documents?kind=receipt&site=${made.sites[0]}`, ownerJar)
    const listNone = await page('/documents?kind=receipt&site=none', ownerJar)
    const listAll = await page('/documents?kind=receipt', ownerJar)
    check('R12-UI-06 ตัวกรองโครงการ 3 แบบ — ทั้งหมด/โครงการหนึ่ง ๆ/**ไม่ผูกโครงการ** ให้ผลต่างกันจริง',
      listAll.includes(linked2.body.id) && listSite.includes(linked2.body.id)
        && !listNone.includes(linked2.body.id) && listNone.includes(free.body.id),
      'ใบที่ผูกโครงการโผล่เฉพาะสองมุมมองแรก · ใบที่ไม่ผูกโผล่ใน site=none')

    // 🔴 คู่ที่ขาดไม่ได้ของแถวข้างบน — ตัวกรองที่ทำงานตอนยัด URL เองได้
    // แต่ไม่มีปุ่มบนจอ คือตัวกรองที่ไม่มีอยู่จริงสำหรับคนใช้ (§15)
    check('R12-UI-06b มีกล่องเลือกโครงการบนหน้าจริง รวมตัวเลือก "ไม่ผูกโครงการ"',
      listAll.includes('เฉพาะใบที่ไม่ผูกโครงการ') && listAll.includes('ทุกโครงการ'),
      'กล่องเลือกโครงการของ DocFilters')

    // R12-UI-07 · ช่วงวัน 4 preset + กำหนดเอง
    const RANGES = ['ทุกช่วงเวลา', 'วันนี้', 'เดือนนี้', 'เดือนที่แล้ว', 'ปีนี้', 'กำหนดช่วงเอง…']
    const monthStart = `${new Date().toISOString().slice(0, 7)}-01`
    const inMonth = await page(`/documents?kind=receipt&from=${monthStart}`, ownerJar)
    const longAgo = await page('/documents?kind=receipt&from=2000-01-01&to=2000-12-31', ownerJar)
    check('R12-UI-07 ช่วงวันมีครบ 5 ตัวเลือก + กำหนดเอง · และกรองได้จริง (ปี 2000 ต้องไม่เหลือใบ)',
      RANGES.every((r) => listAll.includes(r))
        && inMonth.includes(linked2.body.id) && !longAgo.includes(linked2.body.id),
      RANGES.filter((r) => !listAll.includes(r)).join(' · ') || 'ครบ และกรองจริง')

    const listQ = await page('/documents?kind=receipt&q=' + encodeURIComponent('เทศบาล,ท่าผา'), ownerJar)
    check('R12-UI-08 ค้นหาด้วยคำที่มีคอมมา → ไม่พัง และไม่กลายเป็นเงื่อนไขที่สอง (§7)',
      listQ.includes('เอกสาร') && !listQ.includes('Application error'), 'หน้ายังเรนเดอร์ปกติ')

    const detail = await page(`/documents/${recC.body.id}`, ownerJar)
    check('R12-UI-15 หน้ารายละเอียดใบเสร็จมีบรรทัดหัก ณ ที่จ่าย 1% แบบคำนวณสด (D1)',
      detail.includes('หัก ณ ที่จ่าย 1%') && detail.includes('ไม่ใช่รายรับที่หายไป'),
      'บรรทัด WHT')
    // 🔴 ตัดสินที่ซอร์ส ไม่ใช่ที่คำในหน้า — คำว่า "หลักประกันสัญญาคืน" เป็น
    // **ชื่อหมวดรายรับ** ที่ R11 สร้าง และมันโผล่ในกล่องเลือกหมวดของปุ่ม
    // "ลงรายรับ" อย่างถูกต้อง · การเช็คคำจะตกด้วยเหตุผลที่ไม่เกี่ยวกับ D2 เลย
    const docSrcAll = [
      'src/app/(app)/documents/(list)/page.tsx', 'src/app/(app)/documents/[id]/page.tsx',
      'src/app/(app)/documents/[id]/print/page.tsx', 'src/app/(app)/documents/[id]/edit/page.tsx',
      'src/app/(app)/documents/new/page.tsx',
      'src/components/documents/doc-form.tsx', 'src/components/documents/doc-actions.tsx',
      'src/lib/documents.ts', 'src/lib/doc-server.ts',
      'src/app/api/documents/route.ts', 'src/app/api/documents/[id]/route.ts',
      'src/app/api/documents/[id]/issue/route.ts',
    ].map((f) => src(f)).join('\n')
    check('R12-UI-15b เอกสารไม่อ้าง `site_finance` / หลักประกัน เลยแม้แต่ที่เดียว (D2)',
      !/site_finance|bond_|bondStatus|\/lib\/bonds/.test(docSrcAll),
      'คนละบล็อกกับหลักประกันสัญญาโดยสมบูรณ์')

    // R12-UI-14 · ออกเลขแล้วแต่ยังไม่ติ๊กส่ง — ต้องบอกให้ชัดว่ายังแก้ได้
    {
      const stillEditable = await draft(ownerJar)
      await req('POST', `/api/documents/${stillEditable.body.id}/issue`, undefined, { cookie: ownerJar })
      const h = await page(`/documents/${stillEditable.body.id}`, ownerJar)
      check('R12-UI-14 ใบที่ `issued` ยังไม่ติ๊กส่ง → บอกว่า "ยังแก้ได้" และมีปุ่มส่งให้ลูกค้าแล้ว',
        h.includes('ยังแก้ได้') && h.includes('ส่งให้ลูกค้าแล้ว'),
        'แถบบอกสถานะการล็อกตรงกับสิ่งที่ policy ยอม (§17 ข้อ 18)')
    }

    const print = await page(`/documents/${recC.body.id}/print`, ownerJar)
    check('R12-PRT-02 หน้าพิมพ์ใบเสร็จมีหัวเอกสาร ยอดสามบรรทัด และช่องลงนามสองช่อง',
      print.includes('ใบเสร็จรับเงิน') && print.includes('จำนวนเงินรวมทั้งสิ้น')
        && print.includes('ภาษีมูลค่าเพิ่ม') && print.includes('ผู้รับเอกสาร'),
      'กระดาษครบองค์ประกอบ')
    check('R12-PRT-01 เชลล์ถูกซ่อนตอนพิมพ์ (`print-hide`) และ `@page` เป็น A4',
      print.includes('print-hide')
        && /@page\s*\{[^}]*A4/.test(src('src/app/globals.css')),
      'print-hide + @page size: A4')

    // R12-PRT-04 · ยอดบนกระดาษต้องเป็นตัวเดียวกับในฐานข้อมูล ทศนิยมสองตำแหน่ง
    {
      const [m] = await sql(
        `select to_char(subtotal, 'FM999,999,999.00') as sub,
                to_char(vat_amount, 'FM999,999,999.00') as vat,
                to_char(total, 'FM999,999,999.00') as tot,
                amount_words
           from public.documents where id = ${q(recC.body.id)}`)
      check('R12-PRT-04 ยอดสามบรรทัดบนกระดาษ = ยอดในฐานข้อมูลเป๊ะ · มีข้อความจำนวนเงินเป็นภาษาไทย',
        print.includes(m.sub) && print.includes(m.vat) && print.includes(m.tot)
          && print.includes(m.amount_words),
        `${m.sub} + ${m.vat} = ${m.tot} · (${m.amount_words})`)
    }

    // R12-PRT-08 · ลูกค้าไม่มีเลขผู้เสียภาษี (เหมือน RC1136 ของจริง)
    // 🔴 ดูเฉพาะ **เนื้อกระดาษ** ไม่ใช่ทั้งหน้า — สตรีม RSC ท้ายไฟล์เต็มไปด้วย
    // คำว่า `null` ตามปกติของมัน ถ้าเทียบทั้งหน้าแถวนี้จะแดงด้วยเหตุผลที่ไม่เกี่ยวกัน
    const paper = print.slice(print.indexOf('class="paper'), print.indexOf('</article>'))
    check('R12-PRT-08 ใบเสร็จที่ลูกค้าไม่มีเลขผู้เสียภาษี — พิมพ์ได้ และหน้ารายละเอียดเตือนให้เติม',
      paper.length > 500 && !/\b(undefined|null|NaN)\b/.test(paper)
        && detail.includes('เลขประจำตัวผู้เสียภาษีของผู้ซื้อ'),
      `เนื้อกระดาษ ${paper.length} อักษร · ไม่มีช่องที่เขียนว่า null และมีแถบเตือนในหน้ารายละเอียด`)

    // R12-SET-03 · VAT ตั้งต้น — ไม่ส่งมาเลยต้องได้ inclusive 7%
    {
      const bare = await req('POST', '/api/documents', {
        kind: 'receipt', customerName: `${MARK} · ไม่ส่งโหมดภาษี`, docDate: '2026-09-21',
        lines: [{ description: 'ก', qty: 1, unitPrice: 107 }],
      }, { cookie: ownerJar })
      const bb2 = await bare.json().catch(() => ({}))
      if (bb2.id) track('docs', bb2.id)
      const [row2] = await sql(
        `select vat_mode::text as m, vat_rate::float8 as r, subtotal::float8 as s,
                vat_amount::float8 as v, total::float8 as t
           from public.documents where id = ${q(bb2.id)}`)
      check('R12-SET-03 ไม่ส่งโหมดภาษีมาเลย → `inclusive` 7% · ฿107 ถอดเป็น 100 + 7',
        row2.m === 'inclusive' && row2.r === 0.07 && row2.s === 100 && row2.v === 7 && row2.t === 107,
        `${row2.m} ${row2.r} · ${row2.s}+${row2.v}=${row2.t}`)
    }

    // R12-PRT-06 / R12-PRT-07 · กระดาษไม่พึ่ง R2 และไม่เปลี่ยนตามธีม
    {
      const printSrc = src('src/app/(app)/documents/[id]/print/page.tsx')
      const css = src('src/app/globals.css')
      check('R12-PRT-06 กระดาษไม่โหลดรูปจาก R2 เลย → R2 ล่มก็ยังพิมพ์ได้',
        !/<img|next\/image|uploads\//.test(printSrc), 'ไม่มี <img> บนกระดาษ')
      check('R12-PRT-07 กระดาษเป็นขาว-ดำตายตัว ไม่ตามธีมมืด · และ `@media print` บังคับพื้นขาว',
        printSrc.includes('bg-white') && printSrc.includes('text-black')
          && /@media print[\s\S]{0,600}(background|白|#fff|white)/i.test(css),
        'พิมพ์จากโหมดมืดได้กระดาษขาวเหมือนกัน')
    }

    const printQ = await page(`/documents/${linked.body.id}/print`, ownerJar)
    check('R12-PRT-03 หน้าพิมพ์ใบเสนอราคาใช้หัวข้อของตัวเอง',
      printQ.includes('ใบเสนอราคา') && !printQ.includes('ใบเสร็จรับเงิน/ใบกำกับภาษี'),
      'หัวข้อถูกชนิด')

    const settingsMain = await page('/settings', ownerJar)
    check('R12-SET-04 หน้า `/settings` มีปุ่มเข้าหน้าตั้งค่าเอกสารจริง (§15)',
      settingsMain.includes('/settings/documents'), 'ปุ่ม "เอกสาร"')

    const setPage = await page('/settings/documents', ownerJar)
    check('R12-SET-01 หน้าตั้งค่าเอกสารบอกว่าช่องคือ **เลขล่าสุด** และโชว์ใบถัดไป',
      setPage.includes('เลขล่าสุดที่ออกไปแล้ว') && setPage.includes('ใบถัดไปจะเป็น'),
      'ข้อความช่วยตรงกับความหมายของช่อง')
    check('R12-SET-02 ช่องผู้ขายที่เพิ่มใหม่ครบ (โทร · อีเมล · สาขา · บัญชีรับเงิน · ท้ายกระดาษ)',
      ['โทรศัพท์', 'อีเมล', 'สำนักงานใหญ่ / สาขา', 'บัญชีรับเงิน', 'ข้อความท้ายกระดาษ']
        .every((s) => setPage.includes(s)), 'ครบ 5 ช่อง')

    const sitePage = await page(`/sites/${made.sites[0]}`, ownerJar)
    // 🔴 ไม่เทียบกับ id ใบใดใบหนึ่ง — บล็อกโชว์แค่ 5 ใบล่าสุด ใบที่เลือกมาเทียบ
    // อาจไม่ติดห้าอันดับแรก แล้วแถวจะแดงสลับไปมาโดยที่หน้าจอถูกต้องทุกครั้ง
    const siteDocIds = new Set(
      (await sql(`select id from public.documents where site_id = ${q(made.sites[0])}`))
        .map((r) => r.id))
    const shown = [...new Set(
      (sitePage.match(/\/documents\/([0-9a-f-]{36})/g) ?? []).map((m) => m.slice(11)))]
    check('R12-SITE-01 หน้าโครงการมีบล็อก "เอกสารของโครงการนี้" พร้อมเลขที่และป้ายสถานะ',
      sitePage.includes('เอกสารของโครงการนี้') && shown.length > 0
        && /[A-Z]{2}\d{4}/.test(sitePage),
      `โชว์ ${shown.length} ใบ จากทั้งหมด ${siteDocIds.size} ใบของโครงการ`)
    check('R12-SITE-02 ทุกแถวลิงก์ไปหน้ารายละเอียด และทุกใบที่โชว์เป็นของโครงการนี้จริง',
      shown.length > 0 && shown.every((id) => siteDocIds.has(id)),
      shown.filter((id) => !siteDocIds.has(id)).join(' · ') || 'ไม่มีใบของโครงการอื่นหลุดเข้ามา')
    // `&` ใน href ถูก escape เป็น `&amp;` ใน HTML — เทียบแบบถอด escape ก่อน
    const plain = (h) => h.replace(/&amp;/g, '&')
    check('R12-SITE-04 มีปุ่มออกเอกสารของโครงการนี้ (พาไปฟอร์มพร้อมเลือกโครงการไว้แล้ว)',
      plain(sitePage).includes(`/documents/new?kind=quotation&site=${made.sites[0]}`)
        && plain(sitePage).includes(`/documents/new?kind=receipt&site=${made.sites[0]}`),
      'ทั้งสองชนิด')
    check('R12-SITE-08 โครงการที่มีเอกสารมากกว่า 5 ใบ → โชว์ล่าสุด 5 ใบ + ทางไปดูทั้งหมด',
      sitePage.includes('ยังมีอีก — ดูทั้งหมด')
        && (sitePage.match(/\/documents\/[0-9a-f-]{36}"/g) ?? []).length <= 6,
      'ไม่ปล่อยลิสต์ยาวไม่จำกัดบนหน้าที่มีอย่างอื่นด้วย')

    check('R12-SITE-05 เอกสารที่ไม่ผูกโครงการ ไม่โผล่ในหน้าโครงการไหนเลย',
      !sitePage.includes(free.body.id), 'ใบที่ site_id = null ไม่อยู่ในบล็อก')

    // R12-SITE-03 · โครงการที่ยังไม่มีเอกสาร
    {
      const [emptySite] = await sql(
        `insert into public.sites (name, client_name, status, start_date)
         values (${q(`${MARK} · โครงการยังไม่มีเอกสาร`)}, ${q(MARK)}, 'active', current_date)
         returning id`)
      track('sites', emptySite.id)
      const h = await page(`/sites/${emptySite.id}`, ownerJar)
      check('R12-SITE-03 โครงการที่ยังไม่มีเอกสาร → ข้อความว่าง + ปุ่มออกเอกสารทั้งสองชนิด',
        h.includes('ยังไม่มีเอกสารที่ผูกกับโครงการนี้')
          && h.replace(/&amp;/g, '&').includes(`/documents/new?kind=receipt&site=${emptySite.id}`),
        'สถานะว่างที่บอกว่าทำอะไรต่อได้')
      await sql(`delete from public.sites where id = ${q(emptySite.id)}`)
      made.sites = made.sites.filter((s) => s !== emptySite.id)
    }

    check('R12-UI-17 วันที่บนหน้าจอเป็น พ.ศ. · ตัวเลขเงินใช้ `tnum` ทุกที่',
      /25\d\d/.test(list) && list.includes('tnum') && sitePage.includes('tnum'),
      'ปี พ.ศ. + tabular-nums')

    check('R12-SITE-07 บล็อกเอกสารแยกจากบล็อกหลักประกันสัญญา (D2) — คนละหัวข้อกัน',
      sitePage.includes('เอกสารของโครงการนี้')
        && !/เอกสารของโครงการนี้[\s\S]{0,400}หลักประกันสัญญา/.test(sitePage),
      'ไม่ปนกัน')

    // ⚠️ `R12-UI-10` / `R12-UI-11` (สวิตช์ VAT · เพิ่ม-ลบบรรทัด) อยู่ใน
    // `verify-ui-browser.mjs` ไม่ใช่ตรงนี้ — หน้าที่เนื้อหาเป็น client component
    // ถูกห่อด้วย `loading.tsx` แล้ว HTML ที่ `fetch` ได้มีแต่โครงร่าง
    // (พิสูจน์แล้วกับ `/entry` ด้วย ไม่ใช่เฉพาะหน้าเอกสาร)

    // หัวหน้าโครงการเปิดหน้าเอกสารไม่ได้ และหน้าโครงการไม่โชว์บล็อกเอกสาร
    const supDocs = await pageStatus('/documents', supJar)
    const supSite = await page(`/sites/${made.sites[0]}`, supJar)
    check('R12-UI-18 หัวหน้าโครงการเปิด `/documents` ไม่ได้ (เด้งออก ไม่ใช่หน้าเปล่า)',
      supDocs === 307 || supDocs === 302 || supDocs === 404, `HTTP ${supDocs}`)
    check('R12-SITE-06 หัวหน้าโครงการเปิดหน้าโครงการเดียวกัน — ไม่เห็นบล็อกเอกสารเลย',
      !supSite.includes('เอกสารของโครงการนี้'), 'บล็อกไม่ถูกเรนเดอร์')

    const supNav = supSite
    check('R12-UI-19 เมนู "เอกสาร" ไม่โผล่ให้หัวหน้าโครงการ (คู่ตรงข้าม: เจ้าของเห็น)',
      !supNav.includes('ใบเสนอราคา ใบเสร็จ/ใบกำกับภาษี')
        && sitePage.includes('ใบเสนอราคา ใบเสร็จ/ใบกำกับภาษี'),
      'คำอธิบายเมนูของ /documents')

    // 🔴 คู่ตรงข้ามของการแก้ guard — "โครงการถูกลบ" ต้องผ่าน แต่ "มีคนย้าย
    // โครงการของใบที่ล็อกแล้ว" ต้องยังถูกปฏิเสธ · ไม่มีแถวนี้ การแก้ข้อนั้น
    // จะกลายเป็นการเปิดรูให้ย้ายใบเสร็จที่ส่งไปแล้วไปโครงการอื่นเงียบ ๆ
    const [otherSite] = await sql(
      `insert into public.sites (name, client_name, status, start_date)
       values (${q(`${MARK} · โครงการปลายทาง`)}, ${q(MARK)}, 'active', current_date) returning id`)
    track('sites', otherSite.id)
    const moveLocked = await sqlTry(
      `update public.documents set site_id = ${q(otherSite.id)} where id = ${q(recC.body.id)}`)
    check('R12-DB-10b คู่ตรงข้าม — ย้ายโครงการของใบที่ล็อกแล้วยังถูก DOC_LOCKED ปฏิเสธ',
      Boolean(moveLocked.error) && /DOC_LOCKED/.test(moveLocked.error),
      moveLocked.error ? 'DOC_LOCKED' : 'ย้ายได้ (รูที่เปิดจากการแก้ guard)')
    await sql(`delete from public.sites where id = ${q(otherSite.id)}`)
    made.sites = made.sites.filter((s) => s !== otherSite.id)

    // R12-DB-10 · ลบโครงการที่มีเอกสารผูกอยู่
    const docsOfSite = (await sql(
      `select count(*)::int as n from public.documents where site_id = ${q(made.sites[0])}`))[0].n
    await sql(`delete from public.site_supervisors where site_id = ${q(made.sites[0])}`)
    await sql(`delete from public.transactions where site_id = ${q(made.sites[0])}`)
    await sql(`delete from public.sites where id = ${q(made.sites[0])}`)
    const survived = (await sql(
      `select count(*)::int as n from public.documents where id in (${made.docs.map(q).join(',')})`))[0].n
    const orphaned = (await sql(
      `select count(*)::int as n from public.documents
        where id in (${made.docs.map(q).join(',')}) and site_id is null`))[0].n
    check('R12-DB-10 ลบโครงการที่มีเอกสารผูกอยู่ → เอกสารไม่หายสักใบ · `site_id` กลายเป็น null',
      Number(docsOfSite) > 0 && Number(survived) === made.docs.length
        && Number(orphaned) === made.docs.length,
      `เอกสารของโครงการ ${docsOfSite} ใบ → เหลือ ${survived} ใบ · site_id null ทั้งหมด`)
    made.sites = []
    made.txns = []
  }

  // ═══ 5 · ไม่มีโค้ดตาย ════════════════════════════════════════════
  console.log('\n── R12-DEAD · ไม่มีของที่ไม่มีใครเรียก ─────────────────────')
  {
    const all = [
      'src/app/api/documents/route.ts',
      'src/app/api/documents/[id]/route.ts',
      'src/app/api/documents/[id]/issue/route.ts',
      'src/app/api/documents/[id]/send/route.ts',
      'src/app/api/documents/[id]/accept/route.ts',
      'src/app/api/documents/[id]/void/route.ts',
      'src/app/api/documents/[id]/convert/route.ts',
      'src/app/api/documents/[id]/income/route.ts',
      'src/app/api/settings/documents/route.ts',
      'src/app/api/customers/route.ts',
      'src/app/api/customers/[id]/route.ts',
    ]
    const callers = [
      'src/components/documents/doc-form.tsx',
      'src/components/documents/doc-actions.tsx',
      'src/components/documents/print-button.tsx',
      'src/app/(app)/settings/documents/documents-client.tsx',
      'src/app/(app)/settings/customers/customers-client.tsx',
    ].map((f) => src(f)).join('\n')
    const missing = all.filter((f) => {
      const url = '/' + f.replace(/^src\/app\//, '').replace(/\/route\.ts$/, '')
        .replace(/\[id\]/, '${')
      const base = url.split('${')[0]
      return !callers.includes(base)
    })
    check('R12-DEAD-03 ทุก endpoint ของ R12 มีปุ่มบนหน้าจอที่เรียกมันจริง (§15)',
      missing.length === 0, missing.join(' · ') || `ครบ ${all.length} เส้นทาง`)

    // R12-DEAD-02 · prop ที่รับมาแล้วไม่ได้ใช้ = ของประดับที่คนอ่านโค้ดเชื่อว่าทำงาน
    {
      const orphans = []
      for (const f of [
        'src/components/documents/doc-row.tsx', 'src/components/documents/doc-form.tsx',
        'src/components/documents/doc-actions.tsx', 'src/components/documents/print-button.tsx',
        'src/components/documents/new-doc-button.tsx',
        'src/app/(app)/settings/customers/customers-client.tsx',
        'src/app/(app)/settings/documents/documents-client.tsx',
      ]) {
        const t = src(f)
        // `({ a, b, c }: {...})` ของ export function/const ตัวแรกในไฟล์
        const m = /export (?:function|const) \w+[^(]*\(\{([^}]*)\}/.exec(t)
        if (!m) continue
        const body = t.slice(m.index + m[0].length)
        for (const raw of m[1].split(',')) {
          const name = raw.split('=')[0].split(':')[0].trim()
          if (!name) continue
          if (!new RegExp(`\\b${name}\\b`).test(body)) orphans.push(`${f} → ${name}`)
        }
      }
      check('R12-DEAD-02 ไม่มี prop ที่รับมาแล้วไม่ได้ถูกใช้เลยสักตัว',
        orphans.length === 0, orphans.join(' · ') || 'ทุก prop ถูกอ่านจริง')
    }

    const detailSrc = src('src/app/(app)/documents/[id]/page.tsx')
    check('R12-DEAD-04 `source_document_id` ถูกอ่านจริง — หน้ารายละเอียดลิงก์กลับไปใบต้นทาง',
      detailSrc.includes('source_document_id') && detailSrc.includes('ใบเสนอราคาต้นทาง'),
      'ลิงก์ "ใบเสนอราคาต้นทาง"')

    const cols = (await sql(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'documents'`)).map((c) => c.column_name)
    const codeAll = [
      'src/app/api/documents/route.ts', 'src/app/api/documents/[id]/route.ts',
      'src/app/api/documents/[id]/issue/route.ts', 'src/app/api/documents/[id]/send/route.ts',
      'src/app/api/documents/[id]/accept/route.ts', 'src/app/api/documents/[id]/void/route.ts',
      'src/app/api/documents/[id]/convert/route.ts', 'src/app/api/documents/[id]/income/route.ts',
      'supabase/migrations/20260921120000_r12_documents.sql',
    ].map((f) => src(f)).join('\n')
    const unwritten = cols.filter((c) => !codeAll.includes(c))
    check(`R12-DEAD-01 ทั้ง ${cols.length} คอลัมน์ของ \`documents\` มีโค้ดที่เขียนค่าลงไปจริง`,
      unwritten.length === 0, unwritten.join(' · ') || 'ไม่มีคอลัมน์ที่ไม่มีใครเขียน')

    const uiFiles = [
      'src/components/documents/doc-form.tsx', 'src/components/documents/doc-actions.tsx',
      'src/components/documents/doc-row.tsx', 'src/components/documents/new-doc-button.tsx',
      'src/components/documents/print-button.tsx',
      'src/app/(app)/documents/(list)/page.tsx', 'src/app/(app)/documents/[id]/page.tsx',
      'src/app/(app)/documents/[id]/edit/page.tsx', 'src/app/(app)/documents/[id]/print/page.tsx',
      'src/app/(app)/documents/new/page.tsx',
      'src/app/(app)/settings/documents/page.tsx',
      'src/app/(app)/settings/documents/documents-client.tsx',
      'src/app/(app)/settings/customers/page.tsx',
      'src/app/(app)/settings/customers/customers-client.tsx',
    ].map((f) => ({ f, t: src(f) }))
    const emoji = uiFiles.filter(({ t }) => /\p{Extended_Pictographic}/u.test(t.replace(/🔴|⚠️|✅|❌|☐|👤/g, '')))
    const alerts = uiFiles.filter(({ t }) => /\balert\s*\(/.test(t))
    check('R12-UI-22 ไม่มี emoji ในข้อความผู้ใช้ · ไม่มี `alert()` · toast เป็น sonner ทั้งหมด',
      emoji.length === 0 && alerts.length === 0,
      [...emoji, ...alerts].map((x) => x.f).join(' · ') || `ตรวจ ${uiFiles.length} ไฟล์`)

    const errMaps = uiFiles.filter(({ t }) => t.includes('e.message') || t.includes('err.message'))
    check('R12-UI-23 ไม่มีที่ไหนเอา `e.message` ของเบราว์เซอร์ขึ้นจอ (§17 ข้อ 13)',
      errMaps.length === 0, errMaps.map((x) => x.f).join(' · ') || 'ใช้ข้อความไทยที่เราเขียนเอง')
  }

} finally {
  console.log('\n── เก็บกวาด ─────────────────────────────────────────────────')

  // 1 · เอกสาร + บรรทัด — ปิด guard ชั่วคราวใน DO block เดียว (atomic:
  //     ถ้าลบไม่สำเร็จ ทุกอย่างรวมทั้งการปิด trigger ถูก rollback ไปด้วย)
  if (made.docs.length) {
    const list = made.docs.map(q).join(',')
    await sql(`
      do $$
      begin
        execute 'alter table public.documents disable trigger documents_guard';
        execute 'alter table public.documents disable trigger documents_guard_delete';
        execute 'alter table public.document_lines disable trigger document_lines_guard';
        delete from public.document_lines where document_id in (${list});
        update public.documents set source_document_id = null, txn_id = null where id in (${list});
        delete from public.documents where id in (${list});
        execute 'alter table public.documents enable trigger documents_guard';
        execute 'alter table public.documents enable trigger documents_guard_delete';
        execute 'alter table public.document_lines enable trigger document_lines_guard';
      end $$;`)
  }
  if (made.txns.length) {
    await sql(`delete from public.transactions where id in (${made.txns.map(q).join(',')})`)
  }
  if (made.customers.length) {
    await sql(`delete from public.customers where id in (${made.customers.map(q).join(',')})`)
  }
  if (made.sites.length) {
    const s = made.sites.map(q).join(',')
    await sql(`delete from public.site_supervisors where site_id in (${s})`)
    await sql(`delete from public.transactions where site_id in (${s})`)
    await sql(`delete from public.sites where id in (${s})`)
  }

  // 2 · ตัวนับเลขที่เอกสารและช่องผู้ขาย — คืนค่าที่เจ้าของตั้งไว้เป๊ะ ๆ
  await sql('delete from public.doc_counters')
  for (const c of snapCounters) {
    await sql(`insert into public.doc_counters (kind, prefix, pad, last_no)
               values (${q(c.kind)}::public.doc_kind, ${q(c.prefix)}, ${c.pad}, ${c.last_no})`)
  }
  if (snapSettings) {
    const v = (x) => (x === null || x === undefined ? 'null' : q(x))
    await sql(`update public.app_settings set
                 phone = ${v(snapSettings.phone)}, email = ${v(snapSettings.email)},
                 branch_label = ${v(snapSettings.branch_label)},
                 bank_account = ${v(snapSettings.bank_account)},
                 doc_footer = ${v(snapSettings.doc_footer)}
               where id = true`)
  }

  // 3 · ประวัติใน audit_log ของรอบนี้
  //     เอกสาร/ลูกค้า/รายรับ/โครงการ ลบตาม **id ที่จดไว้ตอนสร้าง** (§17 ข้อ 24)
  for (const id of everMade) {
    await sql(`delete from public.audit_log
                where row_id::text = ${q(id)}
                   or before::text like ${q(`%${id}%`)} or after::text like ${q(`%${id}%`)}`)
  }
  // ร่องรอยที่ไม่ได้อ้าง id ตรง ๆ — จับจากข้อความที่สคริปต์นี้ประดิษฐ์ขึ้นเอง
  // (ชื่อโครงการ/ลูกค้า/หมายเหตุรายรับที่ขึ้นต้นด้วย MARK) ไม่ใช่จาก "สภาพของข้อมูล"
  await sql(`delete from public.audit_log
              where before::text like ${q(`%${MARK}%`)} or after::text like ${q(`%${MARK}%`)}`)
  // `doc_counters` / `app_settings` / `document_lines` ไม่มีคอลัมน์ `id` ที่จดไว้ได้
  // จึงลบตาม **ช่วงเวลาของรอบนี้** ซึ่งแคบและเริ่มนับตอนสคริปต์เริ่มเท่านั้น
  if (runStart) {
    await sql(`delete from public.audit_log
                where table_name in ('doc_counters', 'app_settings', 'document_lines')
                  and at >= ${q(runStart)}::timestamptz`)
  }

  // 4 · อ่านกลับมานับ — ไม่เชื่อว่า delete สำเร็จ (§17 ข้อ 24)
  const left = (await sql(
    `select
       (select count(*)::int from public.documents where customer_name like ${q(`%${MARK}%`)}) as docs,
       (select count(*)::int from public.customers where name like ${q(`%${MARK}%`)}) as cus,
       (select count(*)::int from public.sites where name like ${q(`%${MARK}%`)}) as sites,
       (select count(*)::int from public.transactions where note like ${q(`%${MARK}%`)}) as txns,
       (select count(*)::int from public.audit_log
         where before::text like ${q(`%${MARK}%`)} or after::text like ${q(`%${MARK}%`)}) as audit`))[0]
  const clean = Number(left.docs) + Number(left.cus) + Number(left.sites)
    + Number(left.txns) + Number(left.audit) === 0
  console.log(clean
    ? '  ✅ ลบข้อมูลทดสอบและประวัติของรอบนี้ครบแล้ว (อ่านกลับมานับ = 0 ทุกตาราง รวม audit_log)'
    : `  ⚠️ เหลือของทดสอบ — เอกสาร ${left.docs} · ลูกค้า ${left.cus} · โครงการ ${left.sites} · รายรับ ${left.txns} · audit ${left.audit}`)

  const restored = await sql('select kind::text as kind, prefix, pad, last_no from public.doc_counters')
  console.log(`  ตัวนับหลังคืนค่า: ${JSON.stringify(restored)}`)
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok === true).length
const skip = results.filter((r) => r.ok === 'skip').length
const fail = results.length - pass - skip
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ข้าม ${skip} · ตก ${fail}`)
process.exit(fail === 0 ? 0 : 1)
