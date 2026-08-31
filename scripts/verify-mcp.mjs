#!/usr/bin/env node
/**
 * verify-mcp.mjs — ปิดแถว P9-* (ตัวเชื่อม MCP อ่านอย่างเดียว)
 *
 * 🔴 P9-SEC-04 "อ่านอย่างเดียวจริง" สำคัญที่สุด — tool ที่เขียนข้อมูลได้โดยไม่มีใคร
 * ตั้งใจจะไม่มีอาการเลยจนกว่าจะสาย · นับแถวก่อน/หลังเท่านั้นที่พิสูจน์ได้
 * การอ่านโค้ดแล้วบอกว่า "ไม่มี insert" ไม่ใช่หลักฐาน
 *
 * 🔴 สคริปต์นี้ **สร้างข้อมูลตัวอย่างของตัวเอง** แล้วลบทิ้งใน `finally` ไม่ใช่พึ่ง seed
 * ที่อาจมีหรือไม่มี — บนฐานข้อมูลว่าง P9-FN-03 คือ `0 === 0` ซึ่งเขียวตลอดกาล
 * และเขียวโดยไม่มีวันแดงแย่กว่าไม่มีแถวนั้นเลย · ยอดทุกตัว **ต่างกันหมดและไม่มี
 * ตัวไหนเป็นศูนย์** เพื่อให้หยิบคอลัมน์ผิดหรือคืน null แล้วแดงทันที · ชื่อของที่
 * สร้างบอกตัวเองว่าคืออะไร เผื่อสคริปต์ตายก่อนถึง `finally`
 *
 * ⚠️ ล้างเฉพาะ id ที่สคริปต์นี้สร้างเอง ห้ามล้างแบบไม่มีเงื่อนไข (CLAUDE.md §17 ข้อ 9)
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { generateKey, hashKey, keyPrefix } from '../src/lib/mcp/keys-core.ts'

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
/** แถวที่สภาพแวดล้อมตอนนี้ตัดสินไม่ได้ — รายงานเป็น undecided ไม่ใช่เขียวลอย ๆ */
const undecided = []
const skip = (label, why) => {
  undecided.push(label)
  console.log(`  ⚠️  ${label} — ${why}`)
}
const note = (text) => console.log(`  · ${text}`)

// ── Supabase Management API ───────────────────────────────────────────
// ⚠️ แต่ละคำขอเป็น **หนึ่งทรานแซกชัน** · หลายคำสั่งในคำขอเดียวจึงแชร์
// ทรานแซกชันกัน (พิสูจน์แล้ว: `set_config(...,true)` ในคำสั่งแรกยังอยู่ในคำสั่งถัดไป)
// และ API คืนผลของ **คำสั่งสุดท้าย** เท่านั้น
const sqlRaw = async (query) => {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    })
  const text = await r.text()
  if (!r.ok) return { ok: false, message: text.slice(0, 400), rows: [] }
  return { ok: true, message: '', rows: JSON.parse(text) }
}
const sql = async (query) => {
  const r = await sqlRaw(query)
  if (!r.ok) throw new Error(`SQL ล้มเหลว: ${r.message}\n--- ${query.slice(0, 300)}`)
  return r.rows
}

// ── JSON-RPC ──────────────────────────────────────────────────────────
let rpcId = 0
const rpc = (u, body, extra = {}) => fetch(u,
  { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) })
const call = async (u, method, params) => {
  const r = await rpc(u, { jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}) })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* บอดี้ว่างหรือไม่ใช่ JSON — ตัวเรียกตัดสินเอง */ }
  return { status: r.status, headers: r.headers, text, json, result: json?.result }
}
const tool = (u, name, args = {}) => call(u, 'tools/call', { name, arguments: args })
/** ข้อความของ tool มาเป็น JSON ในสตริง — ตัวไหน parse ไม่ได้คืน null ให้ผู้เรียกจับ */
const toolJson = (res) => {
  try { return JSON.parse(res.result.content[0].text) } catch { return null }
}

// ── หน้าเว็บ ──────────────────────────────────────────────────────────
const jarOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
const page = async (path, cookie) => {
  const r = await fetch(`${BASE}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} })
  return { status: r.status, location: r.headers.get('location') ?? '', html: await r.text() }
}

/**
 * ตารางที่ต้องไม่มีแถวเปลี่ยนเลยหลังยิงครบทุก tool — **อ่านรายชื่อจากฐานข้อมูลจริง**
 * ตารางใหม่ที่ใครเพิ่มวันหน้าจึงถูกคุมเองโดยไม่ต้องมาแก้ที่นี่ · ยกเว้นสองตัว:
 * `mcp_call_log` ต้อง**เพิ่ม** (ตรวจแยก) · `audit_log` เพิ่มได้โดยชอบ เพราะ `resolveKey()`
 * อัปเดต `mcp_keys.last_used_at` ผ่าน `after()` ทุกคำขอ (จำนวนแถว `mcp_keys` ยังเท่าเดิม)
 */
const EXCLUDE_FROM_READONLY = ['mcp_call_log', 'audit_log']
let READONLY_TABLES = []
const countAll = async () => {
  const rows = await sql(READONLY_TABLES
    .map((t) => `select '${t}' as t, count(*)::int as n from public.${t}`)
    .join(' union all '))
  return Object.fromEntries(rows.map((r) => [r.t, r.n]))
}

/** ฟิลด์ที่ห้ามหลุดออกไปที่คลาวด์ AI ไม่ว่าจะทางไหน (สเปก §7.1)
 *  ⚠️ ไม่ใส่ `address` เป็นสตริงค้นหา — คำสั้นเกินไปจนชนกับข้อความที่ไม่มีพิษภัย
 *  แล้วแถวจะแดงจนคนปิดมันทิ้ง · ใช้ **ค่าจริง** ของที่อยู่ใน fixture แทน ซึ่งตรงกว่า */
const BLOCKLIST = [
  'client_phone', 'object_key', 'thumb_key', 'pin_hash', 'key_hash',
  '@staff.invalid', 'p256dh', 'endpoint', 'tax_id',
]

// ── fixture ที่สคริปต์นี้สร้างเอง ─────────────────────────────────────
const TAG = 'ตรวจรับ MCP ชั่วคราว'
const F = {
  siteA: randomUUID(), siteB: randomUUID(),
  t1: randomUUID(), t2: randomUUID(), t3: randomUUID(),
  t4: randomUUID(), t5: randomUUID(), t6: randomUUID(),
  emp: randomUUID(), att: randomUUID(),
  ms1: randomUUID(), ms2: randomUUID(),
}
/** ทุกยอดต่างกันหมดและไม่มีศูนย์ — คอลัมน์สลับกันเมื่อไหร่แถวจะแดงทันที */
const A = {
  contract: '1234567.00',
  incomeApproved: '321111.11',
  incomePending: '12444.44',
  costExpense: '45222.22',
  costWage: '1850.75',      // 1 วัน × เรต 1850.75
  costPending: '7333.33',
}
const B = { contract: '987654.32', incomeApproved: '55111.55', costExpense: '3222.11' }
const SECRET_PHONE = '0899000111'
const SECRET_ADDR = 'ซอยลับเฉพาะตรวจรับ 99'

const keyIds = []          // คีย์ทุกใบที่สคริปต์นี้สร้าง — ลบทิ้งใน finally
let fixtureMade = false

console.log('\n── P9 · ตัวเชื่อม MCP ─────────────────────────────────────────')

// ── ก่อนเริ่ม: ของที่ขาดแล้วทำให้ทุกแถวแดงโดยที่แอปไม่ผิด ────────────
const bail = (why) => {
  console.log(`  ❌ ${why}`)
  console.log('\n  1 แถว: ผ่าน 0 · ตก 1\n')
  process.exit(1)
}
if (!env.MCP_KEY_PEPPER) bail('ไม่มี MCP_KEY_PEPPER ใน .env.local — ออกคีย์ทดสอบไม่ได้')
if (!(await fetch(BASE, { redirect: 'manual' }).then(() => true).catch(() => false))) {
  bail(`ไม่มี dev server ที่ ${BASE} — สั่ง \`npm run dev -- -p 3100\` ก่อน`)
}

const profileOf = (role) => sql(
  `select id::text as id from public.profiles where role='${role}' and is_active order by id limit 1`)
const [owner] = await profileOf('owner')
const [sup] = await profileOf('site_supervisor')
if (!owner || !sup) bail('ต้องมีทั้งเจ้าของและหัวหน้าไซต์ใน profiles — รัน scripts/seed-users.mjs ก่อน')

const secret = generateKey()
const url = `${BASE}/api/mcp/${secret}`
const TODAY = (await sql(`select (now() at time zone 'Asia/Bangkok')::date::text as d`))[0].d

READONLY_TABLES = (await sql(`
  select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
  order by table_name`))
  .map((r) => r.table_name)
  .filter((t) => !EXCLUDE_FROM_READONLY.includes(t))

try {
  // ══ 0 · หน้า /mcp ก่อนมีคีย์ใบแรก ══════════════════════════════════
  const signIn = async (path, body) => jarOf(await fetch(`${BASE}${path}`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
  const ownerJar = await signIn('/api/auth/login',
    { email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD })
  const supJar = await signIn('/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN })
  if (!ownerJar || !supJar) throw new Error('ล็อกอินไม่สำเร็จ — บัญชี seed ยังอยู่ครบไหม')

  {
    const r = await page('/mcp')
    // เทียบที่ **path** ไม่ใช่ท้ายสตริง — ของจริงพ่วง `?next=/mcp` มาด้วยเพื่อพากลับ
    // หลังล็อกอิน · เช็คแบบ endsWith จะแดงใส่พฤติกรรมที่ถูกต้อง
    const path = (() => { try { return new URL(r.location, BASE).pathname } catch { return '' } })()
    check('P9-UI-02 anon เปิด /mcp → 307 และ location ชี้ไปที่ /login',
      r.status === 307 && path === '/login',
      `${r.status} · ${r.location || '(ไม่มี location)'}`)
  }
  {
    const r = await page('/mcp', supJar)
    check('P9-UI-01 หัวหน้าไซต์เปิด /mcp → เด้งออกตั้งแต่ฝั่งเซิร์ฟเวอร์ ไม่ใช่ 200',
      r.status >= 300 && r.status < 400 && !r.location.endsWith('/mcp'),
      `${r.status} · ${r.location || '(ไม่มี location)'}`)
  }
  {
    const [{ n }] = await sql(
      'select count(*)::int as n from public.mcp_keys where revoked_at is null')
    if (n > 0) {
      skip('P9-UI-03 หน้า /mcp ตอนยังไม่มีคีย์ → สถานะว่างพร้อมทางไปต่อ',
        `มีคีย์ใช้งานอยู่แล้ว ${n} ใบ — สถานะว่างไม่เกิดขึ้นบนฐานนี้`)
    } else {
      const r = await page('/mcp', ownerJar)
      check('P9-UI-03 หน้า /mcp ตอนยังไม่มีคีย์ → สถานะว่างพร้อมทางไปต่อ ไม่ใช่ตารางเปล่า',
        r.status === 200 && r.html.includes('ยังไม่มีคีย์') && r.html.includes('ออกคีย์ใหม่'),
        `${r.status} · ว่าง=${r.html.includes('ยังไม่มีคีย์')}`)
    }
  }
  {
    // ⚠️ ตรวจที่ `data-testid` ไม่ใช่ที่ข้อความ — ข้อความเปลี่ยนได้ทุกวัน
    const r = await page('/mcp', ownerJar)
    check('P9-UI-06 เปิด /mcp จาก origin ในบ้าน → มี data-testid="mcp-origin-warning" ใน DOM พร้อมคำว่า localhost',
      r.html.includes('data-testid="mcp-origin-warning"') && r.html.includes('localhost'),
      `testid=${r.html.includes('data-testid="mcp-origin-warning"')} · localhost=${r.html.includes('localhost')}`)
  }

  // ══ 1 · fixture ════════════════════════════════════════════════════
  // 🔴 CTE ที่ insert แล้วอ่านกลับในคำสั่งเดียวมองไม่เห็นแถวของตัวเอง (§17 ข้อ 8)
  // → เขียนให้จบเป็นคำสั่ง ๆ ไป แล้วค่อยอ่าน
  const cat = Object.fromEntries((await sql(
    `select name, id::text as id from public.categories where is_active`,
  )).map((c) => [c.name, c.id]))
  const CAT_INSTALLMENT = cat['งวดงาน']
  const CAT_DEPOSIT = cat['มัดจำ / เงินล่วงหน้า']
  const CAT_MATERIAL = cat['ค่าวัสดุก่อสร้าง']
  const CAT_TRANSPORT = cat['ค่าขนส่ง']
  if (!CAT_INSTALLMENT || !CAT_DEPOSIT || !CAT_MATERIAL || !CAT_TRANSPORT) {
    throw new Error('หมวดตั้งต้นหายไปจากตาราง categories — ตรวจ migration ของ P2')
  }

  await sql(`
    insert into public.sites (id, name, client_name, client_phone, address, status, start_date, end_date, created_by)
    values ('${F.siteA}', '${TAG} ก (ห้ามใช้จริง)', 'ลูกค้าทดสอบ ก', '${SECRET_PHONE}',
            '${SECRET_ADDR}', 'active', date '${TODAY}' - 60, date '${TODAY}' + 10, '${owner.id}'),
           ('${F.siteB}', '${TAG} ข (ห้ามใช้จริง)', 'ลูกค้าทดสอบ ข', '${SECRET_PHONE}',
            '${SECRET_ADDR}', 'done',   date '${TODAY}' - 200, date '${TODAY}' - 30, '${owner.id}');

    update public.site_finance set contract_amount = ${A.contract} where site_id = '${F.siteA}';
    update public.site_finance set contract_amount = ${B.contract} where site_id = '${F.siteB}';

    insert into public.site_milestones (id, site_id, seq, name, planned_amount, planned_date)
    values ('${F.ms1}', '${F.siteA}', 1, '${TAG} งวดที่ 1', 400000.00, date '${TODAY}' - 40),
           ('${F.ms2}', '${F.siteA}', 2, '${TAG} งวดที่ 2', 500000.00, date '${TODAY}' + 5);

    insert into public.transactions (id, kind, site_id, category_id, amount, txn_date, status, income_kind, note, created_by)
    values ('${F.t1}', 'income',  '${F.siteA}', '${CAT_INSTALLMENT}', ${A.incomeApproved}, date '${TODAY}' - 30, 'approved', 'installment', '${TAG} งวดที่ 1', '${owner.id}'),
           ('${F.t2}', 'income',  '${F.siteA}', '${CAT_DEPOSIT}',     ${A.incomePending},  date '${TODAY}' - 5,  'pending',  'deposit',     '${TAG} มัดจำ', '${owner.id}'),
           ('${F.t5}', 'income',  '${F.siteB}', '${CAT_INSTALLMENT}', ${B.incomeApproved}, date '${TODAY}' - 90, 'approved', 'installment', '${TAG} งวดไซต์ ข', '${owner.id}');

    insert into public.transactions (id, kind, site_id, category_id, amount, txn_date, status, note, created_by)
    values ('${F.t3}', 'expense', '${F.siteA}', '${CAT_MATERIAL}',  ${A.costExpense},  date '${TODAY}' - 20, 'approved', '${TAG} ค่าปูนซีเมนต์และทรายหยาบ', '${owner.id}'),
           ('${F.t4}', 'expense', '${F.siteA}', '${CAT_TRANSPORT}', ${A.costPending},  date '${TODAY}' - 2,  'pending',  '${TAG} ค่าทรายถมอย่างเดียว', '${owner.id}'),
           ('${F.t6}', 'expense', '${F.siteB}', '${CAT_TRANSPORT}', ${B.costExpense},  date '${TODAY}' - 80, 'approved', '${TAG} ค่าขนส่งไซต์ ข', '${owner.id}');

    insert into public.employees (id, full_name, job_title, is_active)
    values ('${F.emp}', '${TAG} ช่างปูน', 'ช่างปูน', true);

    insert into public.employee_wages (employee_id, wage_type, daily_rate)
    values ('${F.emp}', 'daily', ${A.costWage});

    insert into public.attendance (id, work_date, site_id, employee_id, work_units, note, created_by)
    values ('${F.att}', date '${TODAY}' - 3, '${F.siteA}', '${F.emp}', 1.00, '${TAG}', '${owner.id}');
  `)
  fixtureMade = true
  note(`สร้างข้อมูลตัวอย่างชั่วคราว: ไซต์ 2 · รายการ 6 · คนงาน 1 · ลงชื่อ 1 · งวด 2 (ชื่อขึ้นต้นด้วย “${TAG}”)`)

  // ══ 2 · คีย์ทดสอบ ══════════════════════════════════════════════════
  // สร้างตรงในฐานข้อมูล ไม่ผ่าน UI — ที่ทดสอบคือ endpoint ไม่ใช่ฟอร์ม
  const mkKey = async (label, s = generateKey()) => {
    const [row] = await sql(`
      insert into public.mcp_keys (label, key_hash, key_prefix, created_by)
      values ('${label}', '${hashKey(env.MCP_KEY_PEPPER, s)}', '${keyPrefix(s)}', '${owner.id}')
      returning id::text as id`)
    keyIds.push(row.id)
    return { id: row.id, secret: s, url: `${BASE}/api/mcp/${s}` }
  }
  const mainKeyId = (await mkKey(`${TAG} (ลบอัตโนมัติ)`, secret)).id

  {
    const r = await page('/mcp', ownerJar)
    check('P9-UI-04 หน้า /mcp หลังมีคีย์ → ชื่อ · key_prefix · ออกเมื่อ · ใช้ล่าสุด · ปุ่มเพิกถอน ครบทุกคอลัมน์',
      r.status === 200
        && r.html.includes(`${TAG} (ลบอัตโนมัติ)`)
        && r.html.includes(keyPrefix(secret))
        && r.html.includes('ออกเมื่อ')
        && (r.html.includes('ยังไม่เคยใช้') || r.html.includes('ใช้ล่าสุด'))
        && r.html.includes('เพิกถอน'),
      `${r.status} · prefix=${r.html.includes(keyPrefix(secret))}`)
  }

  // ══ 3 · ตาราง RLS และ audit ════════════════════════════════════════
  {
    const r = await sqlRaw(`
      select set_config('request.jwt.claims',
        json_build_object('sub','${sup.id}','role','authenticated')::text, true);
      set local role authenticated;
      select count(*)::int as n from public.mcp_keys;`)
    check('P9-DB-01 หัวหน้าไซต์อ่าน mcp_keys ได้ 0 แถว — ไม่มี policy ให้ role นี้เลย',
      (r.ok && r.rows[0].n === 0) || (!r.ok && /permission denied/i.test(r.message)),
      r.ok ? `${r.rows[0].n} แถว` : 'permission denied (แน่นกว่าที่ขอ)')
  }
  {
    const r = await sqlRaw(`
      set local role anon;
      select count(*)::int as n from public.mcp_keys;`)
    check('P9-DB-02 anon อ่าน mcp_keys ได้ 0 แถว',
      (r.ok && r.rows[0].n === 0) || (!r.ok && /permission denied/i.test(r.message)),
      r.ok ? `${r.rows[0].n} แถว` : 'permission denied (แน่นกว่าที่ขอ)')
  }
  {
    const before = (await sql('select count(*)::int as n from public.mcp_keys'))[0].n
    const dup = await sqlRaw(`
      insert into public.mcp_keys (label, key_hash, key_prefix, created_by)
      values ('${TAG} ซ้ำ', '${hashKey(env.MCP_KEY_PEPPER, secret)}', '${keyPrefix(secret)}', '${owner.id}')`)
    const after = (await sql('select count(*)::int as n from public.mcp_keys'))[0].n
    check('P9-DB-03 insert mcp_keys ที่ key_hash ซ้ำ → ล้มเหลว (23505) และไม่มีแถวใหม่',
      !dup.ok && /duplicate key|23505|unique/i.test(dup.message) && after === before,
      `${dup.ok ? 'ผ่านไปได้ (ผิด)' : 'ถูกปฏิเสธ'} · แถว ${before} → ${after}`)
  }
  {
    // แก้ค่าเดิมทับตัวเอง — trigger ทำงานเต็มที่แต่ข้อมูลจริงไม่ขยับสักตัว
    // (เปลี่ยน pin_hash ของคนจริงคือการทำให้เขาล็อกอินไม่ได้)
    await sql(`
      update public.profiles set pin_hash = pin_hash where id = '${sup.id}';
      update public.mcp_keys  set key_hash = key_hash  where id = '${mainKeyId}';`)
    const [row] = await sql(`
      select
        count(*) filter (where a."before" ? 'pin_hash' or a."after" ? 'pin_hash')::int as pin,
        count(*) filter (where a."before" ? 'key_hash' or a."after" ? 'key_hash')::int as key,
        count(*)::int as total
      from public.audit_log a
      where a.row_id in ('${sup.id}', '${mainKeyId}')`)
    check('P9-DB-04 audit_log ของ profiles และ mcp_keys ไม่มีทั้ง pin_hash และ key_hash ในคอลัมน์ before/after',
      row.total > 0 && row.pin === 0 && row.key === 0,
      `${row.total} แถว · pin_hash ${row.pin} · key_hash ${row.key}`)
  }
  {
    // คีย์ใบแยกที่ไม่มีใครเรียกผ่าน HTTP — `last_used_at` จึงไม่มาปนตัวนับ
    const k = await mkKey(`${TAG} นับ audit`)
    await sql(`update public.mcp_keys set label = '${TAG} นับ audit 2' where id = '${k.id}'`)
    await sql(`update public.mcp_keys set revoked_at = now() where id = '${k.id}'`)
    const [row] = await sql(`
      select count(*)::int as n from public.audit_log
      where table_name = 'mcp_keys' and row_id = '${k.id}'`)
    check('P9-DB-05 insert → update → revoke บน mcp_keys ทำให้ audit_log เพิ่มขึ้น 3 แถวพอดี',
      row.n === 3, `${row.n} แถว`)
  }
  {
    const r = await sqlRaw(`
      select set_config('request.jwt.claims',
        json_build_object('sub','${owner.id}','role','authenticated')::text, true);
      set local role authenticated;
      with u as (update public.mcp_call_log set ok = ok where key_id = '${mainKeyId}' returning 1),
           d as (delete from public.mcp_call_log where key_id = '${mainKeyId}' returning 1)
      select (select count(*) from u)::int as upd, (select count(*) from d)::int as del;`)
    check('P9-DB-06 เจ้าของ UPDATE/DELETE บน mcp_call_log กระทบ 0 แถว — ไม่มี policy ให้ใครแก้ร่องรอย',
      (r.ok && r.rows[0].upd === 0 && r.rows[0].del === 0)
        || (!r.ok && /permission denied/i.test(r.message)),
      r.ok ? `update ${r.rows[0].upd} · delete ${r.rows[0].del}` : 'permission denied (แน่นกว่าที่ขอ)')
  }

  // ══ 4 · ฟังก์ชัน mcp_* ═════════════════════════════════════════════
  for (const [role, id] of [['anon', 'P9-FN-01'], ['authenticated', 'P9-FN-02']]) {
    const r = await sqlRaw(`
      set local role ${role};
      select public.mcp_sites('${owner.id}'::uuid, null, 20, 0);`)
    check(`${id} ${role} เรียก mcp_sites ตรง ๆ → permission denied for function`,
      !r.ok && /permission denied for function/i.test(r.message),
      r.ok ? 'เรียกผ่าน (ผิด)' : 'permission denied for function mcp_sites')
  }

  {
    // 🔴 ตัวเลขต้องตรงกับที่แอปคำนวณถึงสตางค์ — และแถวนี้ต้อง **แดงได้จริง**
    // เรียก `mcp_sites` ใน **คำขอของมันเอง** (ทรานแซกชันสะอาด ไม่มีใครสวมสิทธิ์
    // ให้ก่อน) เหมือน route จริงที่ใช้ service key เป๊ะ ๆ → ถ้า `mcp_assume_owner()`
    // ข้างในพัง คอลัมน์เงินจะเป็น null ทั้งแผง · แล้วเอา JSON นั้นไปเทียบในคำขอที่สอง
    // ซึ่งสวมสิทธิ์เจ้าของก่อนแล้วเรียก `site_money(null)` ของแอปตรง ๆ
    // ⚠️ เทียบเป็น `numeric` ในฐานข้อมูล ไม่ใช่ float ใน JS · และ **นับ null แยก**
    // เพราะ `null is distinct from null` เป็นเท็จ แถวจึงเขียวได้ทั้งที่ทั้งสองฝั่งว่าง
    // ซึ่งคืออาการของ service_role ที่ `auth.uid()` เป็น null พอดี
    const [{ j }] = await sql(
      `select public.mcp_sites('${owner.id}'::uuid, null, 100, 0)::text as j`)
    const [cmp] = await sql(`
      select public.mcp_assume_owner('${owner.id}'::uuid);
      with mine as (
        select (e->>'id')::uuid as site_id,
               (e->>'contract_amount')::numeric as contract_amount,
               (e->>'income_approved')::numeric as income_approved,
               (e->>'income_pending')::numeric  as income_pending,
               (e->>'cost_expense')::numeric    as cost_expense,
               (e->>'cost_wage')::numeric       as cost_wage,
               (e->>'cost_total')::numeric      as cost_total,
               (e->>'cost_pending')::numeric    as cost_pending,
               (e->>'profit_remaining')::numeric as profit_remaining
        from jsonb_array_elements($mcp$${j}$mcp$::jsonb) e
      ), theirs as (select * from public.site_money(null))
      select
        (select count(*) from mine)::int as n_mcp,
        (select count(*) from mine m join theirs t on t.site_id = m.site_id)::int as n_join,
        (select count(*) from mine
           where contract_amount is null or income_approved is null or income_pending is null
              or cost_expense is null or cost_wage is null or cost_total is null
              or cost_pending is null or profit_remaining is null)::int as n_null,
        (select count(*) from mine m join theirs t on t.site_id = m.site_id
           where m.contract_amount is distinct from t.contract_amount
              or m.income_approved is distinct from t.income_approved
              or m.income_pending  is distinct from t.income_pending
              or m.cost_expense    is distinct from t.cost_expense
              or m.cost_wage       is distinct from t.cost_wage
              or m.cost_total      is distinct from t.cost_total
              or m.cost_pending    is distinct from t.cost_pending
              or m.profit_remaining is distinct from (t.contract_amount - t.cost_total))::int as n_diff,
        (select count(*) from mine m
           where m.site_id = '${F.siteA}'
             and m.contract_amount = ${A.contract}
             and m.income_approved = ${A.incomeApproved}
             and m.income_pending  = ${A.incomePending}
             and m.cost_expense    = ${A.costExpense}
             and m.cost_wage       = ${A.costWage}
             and m.cost_total      = ${A.costExpense} + ${A.costWage}
             and m.cost_pending    = ${A.costPending}
             and m.profit_remaining = ${A.contract} - (${A.costExpense} + ${A.costWage}))::int as n_fix`)
    check('P9-FN-03 ตัวเลขจาก mcp_sites = ตัวเลขจาก site_money ทุกไซต์ทุกคอลัมน์ และตรงกับยอดที่ใส่ไว้เอง',
      cmp.n_mcp > 0 && cmp.n_join === cmp.n_mcp && cmp.n_null === 0
        && cmp.n_diff === 0 && cmp.n_fix === 1,
      `ไซต์ ${cmp.n_mcp} · จับคู่ได้ ${cmp.n_join} · null ${cmp.n_null} · ต่าง ${cmp.n_diff} · ไซต์ตัวอย่างตรงเป๊ะ ${cmp.n_fix}/1`)
  }

  {
    const [{ j }] = await sql(
      `select public.mcp_overview('${owner.id}'::uuid, date '${TODAY}')::text as j`)
    const [cmp] = await sql(`
      select public.mcp_assume_owner('${owner.id}'::uuid);
      with mine as (select $mcp$${j}$mcp$::jsonb as o),
           theirs as (select * from public.site_overview(date '${TODAY}'))
      select
        (select count(*) from mine, theirs
          where (o->>'total_count')::int      is distinct from theirs.total_count
             or (o->>'active_count')::int     is distinct from theirs.active_count
             or (o->>'active_contract')::numeric is distinct from theirs.active_contract
             or (o->>'due_soon_count')::int   is distinct from theirs.due_soon_count
             or (o->>'overdue_count')::int    is distinct from theirs.overdue_count
             or (o->>'active_income')::numeric is distinct from theirs.active_income
             or (o->>'active_cost')::numeric  is distinct from theirs.active_cost
             or (o->>'pending_count')::int    is distinct from theirs.pending_count
             or (o->>'pending_total')::numeric is distinct from theirs.pending_total)::int as n_diff,
        (select count(*) from mine
          where (o->>'active_contract')::numeric > 0
            and (o->>'active_income')::numeric  > 0
            and (o->>'active_cost')::numeric    > 0
            and (o->>'pending_total')::numeric  > 0)::int as n_alive,
        (select count(*) from mine
          where (o->>'active_income')::numeric = ${A.incomeApproved}
            and (o->>'active_cost')::numeric   = ${A.costExpense} + ${A.costWage})::int as n_fix`)
    check('P9-FN-04 ตัวเลขจาก mcp_overview = ตัวเลขจาก site_overview ทุกคอลัมน์ และไม่ใช่ null/0 ลอย ๆ',
      cmp.n_diff === 0 && cmp.n_alive === 1 && cmp.n_fix === 1,
      `ต่าง ${cmp.n_diff} · มีตัวเลขจริง ${cmp.n_alive}/1 · ตรงกับยอดที่ใส่ไว้ ${cmp.n_fix}/1`)
  }
  {
    const r = await sqlRaw(`select public.mcp_overview('${sup.id}'::uuid, null)`)
    check('P9-FN-05 เรียก mcp_overview ด้วย id หัวหน้าไซต์ → MCP_ACTOR_NOT_OWNER ไม่คืนแถวใด ๆ',
      !r.ok && r.message.includes('MCP_ACTOR_NOT_OWNER'),
      r.ok ? 'คืนข้อมูลออกมา (ผิด)' : 'MCP_ACTOR_NOT_OWNER')
  }

  // ══ 5 · โปรโตคอล ═══════════════════════════════════════════════════
  {
    // 🔴 แถวที่พลาดแล้วเจ็บที่สุดในเฟสนี้ — header นี้คือสัญญาณเริ่ม OAuth discovery
    const r = await call(`${BASE}/api/mcp/k_${'a'.repeat(43)}`, 'ping')
    const wa = r.headers.get('www-authenticate')
    check('P9-PROTO-01 คีย์ผิด → 401 และ **ไม่มี** header WWW-Authenticate',
      r.status === 401 && wa === null,
      `${r.status} · www-authenticate=${wa ?? '(ไม่มี ถูกต้อง)'}`)
  }
  {
    const r = await fetch(url, { method: 'GET', redirect: 'manual' })
    check('P9-PROTO-02 GET /api/mcp/<คีย์> → 405 และ header Allow เป็น POST',
      r.status === 405 && (r.headers.get('allow') ?? '').toUpperCase().includes('POST'),
      `${r.status} · Allow=${r.headers.get('allow') ?? '(ไม่มี)'}`)
  }
  {
    const r = await rpc(url, { jsonrpc: '2.0', method: 'ping' })
    const body = await r.text()
    const cl = r.headers.get('content-length')
    check('P9-PROTO-03 ข้อความที่ไม่มี id (notification) → 202 และบอดี้ว่างจริง ไม่ใช่ "{}"',
      r.status === 202 && body === '' && (cl === null || cl === '0'),
      `${r.status} · content-length=${cl ?? '(ไม่มี)'} · บอดี้ ${body.length} ตัวอักษร`)
  }
  {
    const a = await call(url, 'resources/list', {})
    const b = await call(url, 'resources/templates/list', {})
    check('P9-PROTO-04 resources/list และ resources/templates/list → อาร์เรย์ว่าง ไม่มีคีย์ error ไม่ใช่ -32601',
      a.status === 200 && b.status === 200
        && !('error' in (a.json ?? {})) && !('error' in (b.json ?? {}))
        && Array.isArray(a.result?.resources) && a.result.resources.length === 0
        && Array.isArray(b.result?.resourceTemplates) && b.result.resourceTemplates.length === 0,
      `${a.status}/${b.status} · resources=${JSON.stringify(a.result?.resources)} · templates=${JSON.stringify(b.result?.resourceTemplates)}`)
  }
  {
    const odd = '9999-99-99'
    const r = await call(url, 'initialize', { protocolVersion: odd, capabilities: {} })
    check('P9-PROTO-05 initialize สะท้อน protocolVersion ที่ client ส่งมาทุกตัวอักษร',
      r.result?.protocolVersion === odd, `ส่ง ${odd} · ได้ ${r.result?.protocolVersion}`)
  }
  {
    const rs = [
      await call(url, 'initialize', { protocolVersion: '2025-06-18' }),
      await call(url, 'tools/list', {}),
      await tool(url, 'get_metric_definitions'),
      await call(url, 'ping'),
    ]
    const withSession = rs.filter((r) => r.headers.get('mcp-session-id') !== null).length
    check('P9-PROTO-06 ไม่มี header mcp-session-id ในคำตอบของเมท็อดใดเลย (stateless คือสิ่งที่ทำให้รอดบน serverless)',
      withSession === 0, `${rs.length} เมท็อด · มี session-id ${withSession}`)
  }
  {
    const r = await call(url, 'tools/list', {})
    const tools = r.result?.tools ?? []
    const bad = tools.filter((t) => !t.inputSchema || typeof t.inputSchema !== 'object')
    check('P9-PROTO-07 tools/list คืน 7 ตัวพอดี ทุกตัวมี inputSchema เป็น object',
      r.status === 200 && tools.length === 7 && bad.length === 0,
      `${tools.length} ตัว · ไม่มี schema ${bad.length}`)
  }
  {
    const r = await call(url, 'ping')
    check('P9-PROTO-08 ping → 200 และ result เป็น {}',
      r.status === 200 && r.result && typeof r.result === 'object'
        && Object.keys(r.result).length === 0,
      `${r.status} · result=${JSON.stringify(r.result)}`)
  }
  {
    const list = await call(url, 'prompts/list', {})
    const prompts = list.result?.prompts ?? []
    const THAI_ONLY = /^[฀-๿\s]+$/
    const notThai = prompts.filter((p) => !THAI_ONLY.test(p.title ?? ''))
    let allOk = true
    for (const p of prompts) {
      const g = await call(url, 'prompts/get', { name: p.name, arguments: {} })
      if (g.status !== 200 || g.json?.error || !g.result?.messages?.length) allOk = false
    }
    check('P9-PROTO-09 prompts/list คืน 3 รายการชื่อไทยล้วน · prompts/get ของทั้งสามตอบ 200 ไม่มี error',
      prompts.length === 3 && notThai.length === 0 && allOk,
      `${prompts.length} รายการ · ไม่ใช่ไทย ${notThai.length} · get ครบ ${allOk}`)
  }
  {
    const r = await call(url, 'initialize', { protocolVersion: '2025-06-18' })
    check('P9-PROTO-10 initialize.instructions ชี้ให้อ่าน get_metric_definitions · capabilities มีทั้ง tools และ prompts',
      typeof r.result?.instructions === 'string'
        && r.result.instructions.includes('get_metric_definitions')
        && r.result?.capabilities && 'tools' in r.result.capabilities
        && 'prompts' in r.result.capabilities,
      `instructions=${String(r.result?.instructions ?? '').length} ตัวอักษร · capabilities=${Object.keys(r.result?.capabilities ?? {}).join(',')}`)
  }

  // ══ 6 · เครื่องมือทั้งเจ็ด + อ่านอย่างเดียว ════════════════════════
  const before = await countAll()
  const [{ n: logBefore }] = await sql('select count(*)::int as n from public.mcp_call_log')
  const blob = []

  {
    const r = await tool(url, 'get_metric_definitions')
    blob.push(r.text)
    const text = r.result?.content?.[0]?.text ?? ''
    // ⚠️ ข้อความจริงใช้คำว่า "ห้ามนับซ้ำ" (แรงกว่า "ไม่นับซ้ำ" ที่เขียนไว้ตอนร่าง)
    // และตรวจสูตรต้นทุนเพิ่มด้วย — นิยามที่ไม่มีสูตรคือนิยามที่โมเดลเดาต่อเอง
    check('P9-TOOL-01 get_metric_definitions → 200 · มีกฎห้ามนับซ้ำ และสูตร cost_total = cost_expense + cost_wage',
      r.status === 200 && text.includes('ห้ามนับซ้ำ')
        && text.includes('cost_total') && text.includes('cost_wage'),
      `${r.status} · ${text.length} ตัวอักษร`)
  }
  {
    const r = await tool(url, 'get_company_overview', {})
    blob.push(r.text)
    const j = toolJson(r)
    check('P9-TOOL-02 get_company_overview → 200 · content[0].text parse เป็น JSON ได้',
      r.status === 200 && j !== null && typeof j === 'object',
      `${r.status} · คีย์ ${j ? Object.keys(j).length : 0}`)
  }
  {
    const a = await tool(url, 'list_sites', { limit: 1, offset: 0 })
    const b = await tool(url, 'list_sites', { limit: 1, offset: 1 })
    blob.push(a.text, b.text)
    const ja = toolJson(a); const jb = toolJson(b)
    check('P9-TOOL-03 list_sites offset 0 กับ 1 คืนไซต์คนละ id — offset มีผลจริง',
      a.status === 200 && b.status === 200 && Array.isArray(ja) && Array.isArray(jb)
        && ja.length === 1 && jb.length === 1 && ja[0].id !== jb[0].id,
      `${ja?.[0]?.name ?? '—'} ≠ ${jb?.[0]?.name ?? '—'}`)
  }
  {
    const r = await tool(url, 'get_site_detail', { site_id: F.siteA })
    blob.push(r.text)
    const j = toolJson(r)
    const tx = j?.recent_transactions
    const okTx = Array.isArray(tx) && tx.length > 0 && tx.length <= 10
      && tx.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.txn_date ?? '') && typeof t.amount === 'number')
    check('P9-TOOL-04 get_site_detail → milestones เป็น array · recent_transactions ≤ 10 รายการ ทุกแถวมี txn_date และ amount',
      r.status === 200 && Array.isArray(j?.milestones) && j.milestones.length === 2 && okTx,
      `งวด ${j?.milestones?.length ?? '—'} · รายการ ${tx?.length ?? '—'}`)
  }
  {
    const r = await tool(url, 'search_transactions', { limit: 10 })
    blob.push(r.text)
    const j = toolJson(r)
    check('P9-TOOL-05 search_transactions → มีคีย์ total_count เป็นตัวเลข ไม่ใช่สตริง',
      r.status === 200 && typeof j?.total_count === 'number' && j.total_count >= 6,
      `total_count=${JSON.stringify(j?.total_count)} (${typeof j?.total_count})`)
  }
  {
    const r = await tool(url, 'get_pending_approvals', {})
    blob.push(r.text)
    const j = toolJson(r)
    check('P9-TOOL-06 get_pending_approvals → 200 · parse JSON ได้ · เห็นรายการ pending ที่มีอยู่จริง',
      r.status === 200 && j !== null && Array.isArray(j.rows) && j.pending_count >= 2,
      `รอ ${j?.pending_count ?? '—'} รายการ`)
  }
  {
    const r = await tool(url, 'get_payroll_summary', {})
    blob.push(r.text)
    const j = toolJson(r)
    check('P9-TOOL-07 get_payroll_summary → 200 · parse JSON ได้ · มีทั้ง balances และ runs',
      r.status === 200 && j !== null && Array.isArray(j.balances) && Array.isArray(j.runs),
      `ค้างจ่าย ${j?.balances?.length ?? '—'} คน · รอบจ่าย ${j?.runs?.length ?? '—'}`)
  }

  // ── อ่านอย่างเดียวจริงไหม + ฟิลด์ blocklist หลุดไหม ────────────────
  {
    const all = blob.join('\n')
    const leaked = BLOCKLIST.filter((f) => all.includes(f))
    if (all.includes(SECRET_PHONE)) leaked.push(`ค่าเบอร์โทร ${SECRET_PHONE}`)
    if (all.includes(SECRET_ADDR)) leaked.push(`ค่าที่อยู่ ${SECRET_ADDR}`)
    check('P9-SEC-03 ยิงครบทั้ง 7 tool แล้วไม่มีฟิลด์ใน blocklist (หรือค่าของมัน) หลุดออกไปแม้แต่ตัวเดียว',
      leaked.length === 0,
      leaked.length ? `หลุด: ${leaked.join(', ')}` : `สะอาด (${all.length} ตัวอักษร)`)
  }
  {
    const after = await countAll()
    const changed = READONLY_TABLES.filter((t) => before[t] !== after[t])
    const [{ n: logAfter }] = await sql('select count(*)::int as n from public.mcp_call_log')
    check('P9-SEC-04 ยิงครบทั้ง 7 tool แล้วไม่มีตารางไหนแถวเปลี่ยน ยกเว้น mcp_call_log ที่ต้องเพิ่ม',
      changed.length === 0 && logAfter > logBefore,
      changed.length
        ? `เปลี่ยน: ${changed.map((t) => `${t} ${before[t]}→${after[t]}`).join(', ')}`
        : `${READONLY_TABLES.length} ตารางเท่าเดิม · mcp_call_log ${logBefore}→${logAfter}`)
  }
  {
    const r = await tool(url, 'get_site_detail', { site_id: randomUUID() })
    check('P9-TOOL-08 get_site_detail ด้วย uuid ที่ไม่มีในตาราง → 200 พร้อม result.isError = true ไม่ใช่ JSON-RPC error',
      r.status === 200 && !r.json?.error && r.result?.isError === true,
      `${r.status} · isError=${JSON.stringify(r.result?.isError)}`)
  }
  {
    const both = await tool(url, 'search_transactions', { q: 'ปูน,ทราย', limit: 50 })
    const one = await tool(url, 'search_transactions', { q: 'ทราย', limit: 50 })
    const jb = toolJson(both); const jo = toolJson(one)
    const ids = (j) => (j?.rows ?? []).map((r) => r.id)
    check('P9-TOOL-09 คำค้นที่มีคอมมาเป็น AND ไม่ใช่ OR — "ปูน,ทราย" ไม่รวมแถวที่มีแค่ "ทราย"',
      jb !== null && jo !== null
        && ids(jb).includes(F.t3) && !ids(jb).includes(F.t4)
        && ids(jo).includes(F.t3) && ids(jo).includes(F.t4),
      `ปูน,ทราย → ${ids(jb).length} แถว · ทราย → ${ids(jo).length} แถว`)
  }

  // ══ 7 · ความปลอดภัย ════════════════════════════════════════════════
  {
    const k = await mkKey(`${TAG} เพิกถอนแล้ว`)
    const okBefore = await call(k.url, 'ping')
    await sql(`update public.mcp_keys set revoked_at = now() where id = '${k.id}'`)
    const r = await call(k.url, 'ping')
    check('P9-SEC-01 คีย์ที่ตั้ง revoked_at แล้ว → 401 ทันที (ก่อนหน้านั้นใช้ได้ปกติ)',
      okBefore.status === 200 && r.status === 401,
      `ก่อนเพิกถอน ${okBefore.status} · หลังเพิกถอน ${r.status}`)
  }
  {
    // นับตัวจริงอยู่ในฐานข้อมูล (serverless มีหลาย instance) → เติมร่องรอย 59 ครั้ง
    // ในนาทีที่แล้วให้คีย์ใบนี้ แล้วยิงจริงอีก 2 ครั้ง: ครั้งที่ 60 ต้องผ่าน
    // ครั้งที่ 61 ต้องโดนกั้น · ยิงจริง 61 ครั้งได้ผลเท่ากันแต่ช้ากว่าสามสิบเท่า
    const k = await mkKey(`${TAG} เพดานเรียก`)
    await sql(`
      insert into public.mcp_call_log (key_id, tool, ok, ms, at)
      select '${k.id}', 'get_company_overview', true, 5, now() - interval '10 seconds'
      from generate_series(1, 59)`)
    const at60 = await tool(k.url, 'get_company_overview', {})
    const at61 = await tool(k.url, 'get_company_overview', {})
    const msg = at61.result?.content?.[0]?.text ?? ''
    check('P9-SEC-02 เกินเพดาน 60 ครั้ง/นาที → 200 พร้อม isError และข้อความไทยว่าเรียกถี่ ไม่ใช่ 429',
      at60.status === 200 && at60.result?.isError !== true
        && at61.status === 200 && at61.result?.isError === true && msg.includes('เรียกถี่'),
      `ครั้งที่ 60 isError=${at60.result?.isError ?? false} · ครั้งที่ 61 ${at61.status} “${msg}”`)
  }
  {
    // นับบนคีย์ใบของตัวเอง — คีย์หลักมีเสียงรบกวนจากแถวอื่นตลอดเวลา
    const k = await mkKey(`${TAG} นับร่องรอย`)
    const calls = [
      ['get_metric_definitions', {}],
      ['get_company_overview', {}],
      ['เครื่องมือที่ไม่มีจริง', {}],
      ['get_site_detail', { site_id: 'ไม่ใช่ uuid' }],
    ]
    for (const [name, args] of calls) await tool(k.url, name, args)
    const [{ n }] = await sql(
      `select count(*)::int as n from public.mcp_call_log where key_id = '${k.id}'`)
    check('P9-SEC-05 tools/call ทุกครั้งลง mcp_call_log ครบพอดี ทั้งที่สำเร็จและที่ล้มเหลว',
      n === calls.length, `เรียก ${calls.length} ครั้ง · บันทึก ${n} แถว`)
  }
  {
    // 🔴 pepper ที่หายไปแล้วโปรแกรมยังเดินต่อ = HMAC ที่คำนวณจาก `undefined`
    // ซึ่งเหมือนกันทุกเครื่องที่ลืมตั้งค่า — เท่ากับไม่มี pepper เลยโดยไม่มีใครรู้
    // ตรวจที่ `src/lib/mcp/keys.ts` **ไฟล์จริง** โดยโหลดในลูกโพรเซสที่ไม่มี pepper
    // (ยิงผ่าน HTTP ไม่ได้ในเครื่องนี้ — ต้องมี dev server ตัวที่สองซึ่งจะแย่ง `.next`
    //  กับตัวที่รันอยู่ · ดูเหตุผลเต็มในแถว P9-SEC-06 ของ docs/test-plan/P9.md)
    const dir = mkdtempSync(join(tmpdir(), 'verify-mcp-'))
    try {
      const stub = join(dir, 'stub.mjs')
      writeFileSync(stub,
        'export const after = () => {}\nexport const getSupabaseAdmin = () => ({})\nexport default {}\n')
      // `registerHooks` แทน alias ของ tsconfig ที่ node ไม่รู้จัก และแทน import ที่
      // ต้องอยู่ในบริบท RSC (`server-only`) — ไฟล์ที่โหลดยังเป็น keys.ts ตัวจริง
      const probe = join(dir, 'probe.mjs')
      writeFileSync(probe, `
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
const STUB = ${JSON.stringify(pathToFileURL(stub).href)}
const ROOT = ${JSON.stringify(process.cwd())}
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'server-only' || spec === 'next/server' || spec === '@/lib/supabase/admin')
    return { url: STUB, shortCircuit: true }
  if (spec.startsWith('@/'))
    return { url: pathToFileURL(join(ROOT, 'src', spec.slice(2) + '.ts')).href, shortCircuit: true }
  return next(spec, ctx)
} })
try {
  const m = await import(pathToFileURL(join(ROOT, 'src/lib/mcp/keys.ts')).href)
  console.log(JSON.stringify({ threw: false, ok: typeof m.hashKeyWithPepper === 'function' }))
} catch (e) {
  console.log(JSON.stringify({ threw: true, message: String(e?.message ?? e) }))
}
`)

      const run = (pepper) => {
        const r = spawnSync(process.execPath, [probe],
          { encoding: 'utf8', env: { ...process.env, MCP_KEY_PEPPER: pepper } })
        const line = (r.stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? '{}'
        try { return JSON.parse(line) } catch { return { threw: null } }
      }
      const without = run('')
      const withIt = run(env.MCP_KEY_PEPPER)
      check('P9-SEC-06 ไม่มี MCP_KEY_PEPPER → โมดูลคีย์ล้มตอนโหลดพร้อมข้อความชี้ชัด (route จึงตอบ 500) ไม่ใช่ hash จาก undefined เงียบ ๆ',
        without.threw === true && without.message.includes('MCP_KEY_PEPPER')
          && withIt.threw === false && withIt.ok === true,
        `ไม่มี pepper → ${without.threw ? `throw “${without.message}”` : 'โหลดผ่าน (ผิด)'} · มี pepper → ${withIt.threw ? 'throw (ผิด)' : 'โหลดผ่าน'}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
} finally {
  // 🔴 คืนฐานข้อมูลให้เหมือนตอนที่เจอ — ลบเฉพาะ id ที่สคริปต์นี้สร้างเอง
  // ห้ามล้างแบบไม่มีเงื่อนไข (CLAUDE.md §17 ข้อ 9)
  const ids = (arr) => arr.map((v) => `'${v}'`).join(',')
  const steps = [
    ['attendance', `delete from public.attendance where id in (${ids([F.att])})`],
    ['employee_wages', `delete from public.employee_wages where employee_id in (${ids([F.emp])})`],
    ['employees', `delete from public.employees where id in (${ids([F.emp])})`],
    ['site_milestones', `delete from public.site_milestones where id in (${ids([F.ms1, F.ms2])})`],
    ['transactions', `delete from public.transactions where id in (${ids([F.t1, F.t2, F.t3, F.t4, F.t5, F.t6])})`],
    ['site_finance', `delete from public.site_finance where site_id in (${ids([F.siteA, F.siteB])})`],
    ['sites', `delete from public.sites where id in (${ids([F.siteA, F.siteB])})`],
  ]
  // mcp_call_log ของคีย์เหล่านี้หายตามเองด้วย on delete cascade
  if (keyIds.length) steps.push(['mcp_keys', `delete from public.mcp_keys where id in (${ids(keyIds)})`])
  const failed = []
  for (const [name, q] of steps) {
    if (!fixtureMade && name !== 'mcp_keys') continue
    const r = await sqlRaw(q)
    if (!r.ok) failed.push(`${name}: ${r.message.slice(0, 120)}`)
  }
  // ⚠️ ตัวนับนี้ต้องไม่โยน ไม่งั้นมันจะกลบ error จริงที่ทำให้สคริปต์หลุดมาถึง finally
  const leftRes = await sqlRaw(`
    select (select count(*) from public.sites where name like '${TAG}%')::int as sites,
           (select count(*) from public.employees where full_name like '${TAG}%')::int as emps,
           (select count(*) from public.mcp_keys where label like '${TAG}%')::int as keys`)
  const left = leftRes.ok ? leftRes.rows[0] : { sites: -1, emps: -1, keys: -1 }
  const clean = failed.length === 0 && left.sites === 0 && left.emps === 0 && left.keys === 0
  note(clean
    ? 'ล้างข้อมูลตัวอย่างครบแล้ว — ฐานข้อมูลกลับไปเหมือนตอนเริ่ม'
    : `⚠️ ล้างไม่ครบ · ค้าง ไซต์ ${left.sites} · คนงาน ${left.emps} · คีย์ ${left.keys}${failed.length ? ` · ${failed.join(' | ')}` : ''}`)
  if (!clean) {
    results.push({ label: 'ล้างข้อมูลตัวอย่าง', ok: false })
    console.log('  ❌ ล้างข้อมูลตัวอย่างที่สคริปต์นี้สร้างไม่หมด — ลบด้วยมือก่อนรันตัวตรวจอื่น')
  }
}

const pass = results.filter((r) => r.ok).length
const total = results.length + undecided.length
console.log(`\n  ${total} แถว: ผ่าน ${pass} · ตก ${results.length - pass}${undecided.length ? ` · undecided ${undecided.length}` : ''}\n`)
process.exit(pass === results.length ? 0 : 1)
