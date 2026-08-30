#!/usr/bin/env node
/**
 * verify-sites.mjs — ปิดแถว P1-DB-* ใน docs/test-plan/P1.md
 * ทุก fixture คืนค่าใน finally · ทุก "0 แถว" มีการพิสูจน์ฝั่งบวกคู่กัน
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

const signIn = async (body, path) => {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`ล็อกอินล้มเหลว: ${JSON.stringify(j)}`)
  return j.access_token
}

/** ยิง PostgREST ในนามใครสักคน */
async function db(token, path) {
  const headers = { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }
  if (token !== 'anon') headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1${path}`, { headers })
  const t = await r.text()
  try { return { status: r.status, body: JSON.parse(t) } } catch { return { status: r.status, body: t } }
}

console.log('\n── P1-DB · ไซต์งานและผู้ดูแล ────────────────────────────────')

const tok = async (email, password) => {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(JSON.stringify(j))
  return j.access_token
}

const { hashPin, derivePassword, syntheticEmail } = await import('../src/lib/pin-core.ts')
const ownerTok = await tok(env.SEED_OWNER_EMAIL, env.SEED_OWNER_PASSWORD)
const supTok = await tok(syntheticEmail('sup1'), derivePassword(env.PIN_PEPPER, env.SEED_SUPERVISOR1_PIN))
void hashPin

const [sup1] = (await sql(
  `select id from public.profiles where full_name = '${env.SEED_SUPERVISOR1_NAME}'`,
)).rows
const [sup2] = (await sql(
  `select id from public.profiles where full_name = '${env.SEED_SUPERVISOR2_NAME}'`,
)).rows

let mineId = null
let othersId = null
try {
  // ── fixture: ไซต์ที่ sup1 ดูแล และไซต์ที่ sup2 ดูแล ─────────────────────
  ;[{ id: mineId }] = (await sql(
    `insert into public.sites(name, start_date, end_date)
     values ('ทดสอบ ไซต์ของฉัน', current_date - 10, current_date + 10) returning id`,
  )).rows
  ;[{ id: othersId }] = (await sql(
    `insert into public.sites(name) values ('ทดสอบ ไซต์คนอื่น') returning id`,
  )).rows
  await sql(`insert into public.site_supervisors(site_id, profile_id) values ('${mineId}','${sup1.id}')`)
  await sql(`insert into public.site_supervisors(site_id, profile_id) values ('${othersId}','${sup2.id}')`)

  // P1-DB-01 · สร้างไซต์แล้วมี audit
  {
    const { rows } = await sql(
      `select count(*)::int as n from public.audit_log
       where table_name='sites' and action='INSERT' and row_id in ('${mineId}','${othersId}')`,
    )
    check('P1-DB-01 สร้างไซต์แล้วมีแถว audit INSERT ครบ', rows[0].n === 2, `${rows[0].n} แถว`)
  }

  // P1-DB-03 · หัวหน้าไซต์เห็นเฉพาะไซต์ตัวเอง — ยืนยันสองฝั่งในครั้งเดียว
  {
    const mine = await db(supTok, `/sites?select=id&id=eq.${mineId}`)
    const others = await db(supTok, `/sites?select=id&id=eq.${othersId}`)
    check('P1-DB-03 หัวหน้าไซต์เห็นไซต์ตัวเอง 1 แถว และไม่เห็นไซต์คนอื่น',
      mine.body?.length === 1 && others.body?.length === 0,
      `ของตัวเอง ${mine.body?.length} · ของคนอื่น ${others.body?.length}`)
  }

  // P1-DB-04 · anon ไม่เห็นอะไร แต่ owner เห็น
  {
    const anon = await db('anon', '/sites?select=id')
    const own = await db(ownerTok, '/sites?select=id')
    check('P1-DB-04 anon อ่าน sites ได้ 0 แถว แต่ owner ได้ > 0',
      (Array.isArray(anon.body) ? anon.body.length : -1) === 0 && own.body?.length >= 2,
      `anon ${Array.isArray(anon.body) ? anon.body.length : anon.status} · owner ${own.body?.length}`)
  }

  // P1-DB-05 · หัวหน้าไซต์แก้ชื่อไซต์ไม่ได้ (RLS ปฏิเสธเงียบ ๆ = โดน 0 แถว)
  {
    const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sites?id=eq.${mineId}`, {
      method: 'PATCH',
      headers: {
        apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${supTok}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ name: 'ชื่อที่ไม่ควรถูกเขียน' }),
    })
    const changed = await r.json().catch(() => [])
    const { rows } = await sql(`select name from public.sites where id='${mineId}'`)
    check('P1-DB-05 หัวหน้าไซต์แก้ข้อมูลไซต์ไม่ได้ — โดน 0 แถว และค่าเดิมไม่เปลี่ยน',
      (Array.isArray(changed) ? changed.length : 0) === 0 && rows[0].name === 'ทดสอบ ไซต์ของฉัน',
      `แถวที่ถูกแก้ ${Array.isArray(changed) ? changed.length : '?'} · ชื่อ ${rows[0].name}`)
  }

  // ── ค่างานตามสัญญาเป็นความลับจากหัวหน้าไซต์ (เจ้าของตัดสิน 30 ส.ค. 2569) ──

  // P1-DB-14 · หัวหน้าไซต์อ่านตาราง site_finance ไม่ได้เลย
  // 🔴 ครึ่งบวกอยู่ในการตรวจเดียวกัน: เจ้าของต้องอ่านได้ > 0 แถว
  // ไม่งั้น "หัวหน้าไซต์เห็น 0 แถว" อาจแปลว่าไม่มีข้อมูลตั้งแต่แรก
  {
    await sql(`update public.site_finance set contract_amount = 1000000 where site_id='${mineId}'`)
    const sup = await db(supTok, '/site_finance?select=site_id,contract_amount')
    const own = await db(ownerTok, '/site_finance?select=site_id,contract_amount')
    check('P1-DB-14 หัวหน้าไซต์อ่าน site_finance ได้ 0 แถว · เจ้าของอ่านได้',
      (Array.isArray(sup.body) ? sup.body.length : -1) === 0 && own.body?.length >= 1,
      `หัวหน้าไซต์ ${Array.isArray(sup.body) ? sup.body.length : sup.status} · เจ้าของ ${own.body?.length}`)
  }

  // P1-DB-15 · ไม่มีคอลัมน์ contract_amount บนตาราง sites อีกแล้ว
  // ปิดทางอ้อม: ถ้ายังมีคอลัมน์อยู่ หัวหน้าไซต์อ่านผ่านแถว sites ที่เขาเห็นได้ทันที
  {
    const { rows } = await sql(
      `select count(*)::int as n from information_schema.columns
       where table_schema='public' and table_name='sites' and column_name='contract_amount'`)
    const { rows: fin } = await sql(
      `select count(*)::int as n from information_schema.columns
       where table_schema='public' and table_name='site_finance' and column_name='contract_amount'`)
    check('P1-DB-15 คอลัมน์ contract_amount ไม่อยู่บน sites แล้ว และย้ายไปอยู่บน site_finance',
      rows[0].n === 0 && fin[0].n === 1, `sites ${rows[0].n} · site_finance ${fin[0].n}`)
  }

  // P1-DB-16 · site_overview คืน null ให้หัวหน้าไซต์ ไม่ใช่ 0
  // 🔴 "ศูนย์" กับ "ไม่มีสิทธิ์เห็น" เป็นคนละเรื่อง — หน้าจอซ่อนการ์ดที่ได้ null ได้
  // แต่มันจะวาด ฿0 อย่างมั่นใจ แล้วคนอ่านจะเชื่อว่านั่นคือคำตอบ
  {
    const rpc = async (token) => {
      const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/site_overview`, {
        method: 'POST',
        headers: {
          apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_on: new Date().toISOString().slice(0, 10) }),
      })
      return (await r.json())?.[0]
    }
    const sup = await rpc(supTok)
    const own = await rpc(ownerTok)
    check('P1-DB-16 site_overview คืน active_contract = null ให้หัวหน้าไซต์ · ตัวเลขให้เจ้าของ',
      sup?.active_contract === null && Number(own?.active_contract) >= 1000000,
      `หัวหน้าไซต์ ${JSON.stringify(sup?.active_contract)} · เจ้าของ ${own?.active_contract}`)
  }

  // P1-DB-17 · ทุกไซต์ต้องมีแถว site_finance (trigger สร้างให้)
  {
    const { rows } = await sql(
      `select count(*)::int as n from public.sites s
       left join public.site_finance f on f.site_id = s.id where f.site_id is null`)
    const { rows: total } = await sql('select count(*)::int as n from public.sites')
    check('P1-DB-17 ทุกไซต์มีแถว site_finance — trigger สร้างให้ตอน insert',
      rows[0].n === 0 && total[0].n >= 2, `ไม่มีแถวการเงิน ${rows[0].n} จาก ${total[0].n} ไซต์`)
  }

  // P1-DB-07 · ช่วงเวลาทับกันถูกปฏิเสธ
  {
    const r = await sql(
      `insert into public.site_supervisors(site_id, profile_id, effective_from)
       values ('${othersId}','${sup1.id}', current_date)`,
    )
    const { rows } = await sql(
      `select count(*)::int as n from public.site_supervisors where profile_id='${sup1.id}'`,
    )
    check('P1-DB-07 คนเดียวอยู่สองไซต์วันเดียวกันไม่ได้ (exclusion constraint)',
      Boolean(r.error) && /conflicting key|exclusion/i.test(r.error) && rows[0].n === 1,
      `ถูกปฏิเสธ=${Boolean(r.error)} · แถวของ sup1 = ${rows[0].n}`)
  }

  // P1-DB-08 · ช่วงที่ต่อกันพอดีต้องเขียนได้ (พิสูจน์ว่า +1 ถูก)
  {
    await sql(
      `update public.site_supervisors set effective_to = current_date + 5
       where site_id='${mineId}' and profile_id='${sup1.id}'`,
    )
    const r = await sql(
      `insert into public.site_supervisors(site_id, profile_id, effective_from, effective_to)
       values ('${othersId}','${sup1.id}', current_date + 6, current_date + 20) returning id`,
    )
    check('P1-DB-08 ช่วงที่ต่อกันพอดีเขียนได้ (ไม่ถูกมองว่าทับกัน)',
      !r.error && r.rows?.length === 1, r.error ? String(r.error).slice(0, 60) : 'เขียนได้')
  }

  // P1-DB-09 · ย้ายล่วงหน้าแล้ววันนี้ยังเห็นไซต์เดิม
  // ("ปัจจุบัน" ต้องไม่ใช่ effective_to is null)
  {
    const mine = await db(supTok, `/sites?select=id&id=eq.${mineId}`)
    const future = await db(supTok, `/sites?select=id&id=eq.${othersId}`)
    check('P1-DB-09 ตั้งย้ายล่วงหน้าแล้ว วันนี้ยังเห็นไซต์เดิม และยังไม่เห็นไซต์ใหม่',
      mine.body?.length === 1 && future.body?.length === 0,
      `ไซต์เดิม ${mine.body?.length} · ไซต์ที่จะย้ายไป ${future.body?.length}`)
  }
} finally {
  for (const id of [mineId, othersId]) {
    if (id) await sql(`delete from public.sites where id = '${id}'`)
  }
  console.log('  (ลบไซต์ทดสอบแล้ว)')
}

// P1-DB-06 · ทุกตารางเปิด RLS
{
  const { rows } = await sql(
    "select count(*)::int as n from pg_tables where schemaname='public' and rowsecurity=false",
  )
  const { rows: all } = await sql("select count(*)::int as n from pg_tables where schemaname='public'")
  check('P1-DB-06 ทุกตารางใน public เปิด RLS',
    rows[0].n === 0 && all[0].n >= 8, `ปิดอยู่ ${rows[0].n} จาก ${all[0].n} ตาราง`)
}

// P1-DB-10 · supervises_site() ไม่มีทางลัด
{
  const { rows } = await sql(
    "select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='supervises_site'",
  )
  const bare = (rows[0]?.prosrc ?? '').replace(/--.*$/gm, '')
  check('P1-DB-10 supervises_site() ไม่มีทางลัด auth.uid() is null',
    rows.length === 1 && !/auth\.uid\(\)\s*is\s+null/i.test(bare), 'ตรวจซอร์สแล้ว')
}

// P1-DB-11 · advisors
for (const kind of ['security', 'performance']) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/advisors/${kind}`,
    { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } },
  )
  const { lints = [] } = await r.json()
  const errs = lints.filter((l) => l.level === 'ERROR')
  check(`P1-DB-11 advisors(${kind}) ไม่มี ERROR`, errs.length === 0,
    `ERROR ${errs.length} · WARN ${lints.filter((l) => l.level === 'WARN').length}`)
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
