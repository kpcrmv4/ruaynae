#!/usr/bin/env node
/**
 * verify-audit.mjs — ปิดแถว P6-DB-* และ P6-UI-* ใน docs/test-plan/P6.md
 *
 * 🔴 P6-DB-01 ตรวจจาก `pg_trigger` เทียบกับ **รายชื่อตารางทั้งหมดที่มีจริง**
 * ไม่ใช่รายชื่อที่พิมพ์ไว้ในสคริปต์ — ลิสต์ที่พิมพ์ไว้จะล้าสมัยทันทีที่มี
 * ตารางใหม่ แล้วแถวนี้จะเขียวต่อไปทั้งที่ตารางใหม่ไม่มีประวัติเลย
 */
import { readFileSync } from 'node:fs'
import { derivePassword, syntheticEmail } from '../src/lib/pin-core.ts'

const BASE = process.argv[2] ?? 'http://localhost:3200'
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)
const URL = env.NEXT_PUBLIC_SUPABASE_URL
const PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const SECRET = env.SUPABASE_SECRET_KEY

const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const req = (method, path, body, cookie) =>
  fetch(`${BASE}${path}`, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const jarOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
/**
 * HTML ที่มองเห็นบนหน้าจอ
 *
 * 🔴 นอกจากตัด <script> (RSC payload) แล้ว ต้องตัด **คอมเมนต์ของ React** ด้วย
 * React แทรก `<!-- -->` คั่นระหว่างตัวแปรสองตัวที่อยู่ติดกันใน JSX
 * ทำให้ `{field}: ` กลายเป็น `name<!-- -->: ` — ตัวตรวจที่หา "name:" จะแดง
 * ทั้งที่หน้าจอถูกต้องทุกตัวอักษร (หลุมเดียวกับ RSC payload คนละรูปแบบ)
 */
const visible = (html) =>
  html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '')
const page = async (path, cookie) =>
  visible(await (await fetch(`${BASE}${path}`, { headers: { cookie } })).text())

async function signIn(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: PUB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`sign-in ล้มเหลว ${email}`)
  return j.access_token
}
async function db(token, path, init = {}) {
  const headers = { apikey: PUB, 'Content-Type': 'application/json', ...init.headers }
  if (token !== 'anon') headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${URL}/rest/v1${path}`, { ...init, headers })
  const text = await r.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: r.status, ok: r.ok, body, raw: text }
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
  const t = await r.text()
  if (!r.ok) return { error: t, rows: [] }
  return { rows: JSON.parse(t) }
}
const countOf = async (filter = '') => {
  const r = await fetch(`${URL}/rest/v1/audit_log?select=id${filter}`, {
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, Prefer: 'count=exact', Range: '0-0' },
  })
  return Number(/\/(\d+)$/.exec(r.headers.get('content-range') ?? '')?.[1] ?? -1)
}

console.log('\n── P6 · ประวัติการแก้ไข ─────────────────────────────────────')

const ownerJar = jarOf(await req('POST', '/api/auth/login', {
  email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }))
const supJar = jarOf(await req('POST', '/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN }))
if (!ownerJar || !supJar) throw new Error('ล็อกอินไม่สำเร็จ — dev server รันอยู่ไหม')
const ownerTok = await signIn(env.SEED_OWNER_EMAIL, env.SEED_OWNER_PASSWORD)
const supTok = await signIn(
  syntheticEmail('sup1'), derivePassword(env.PIN_PEPPER, env.SEED_SUPERVISOR1_PIN))

const MARK = 'ทดสอบประวัติ'
let siteId = null

try {
  // ── P6-DB-01 · ทุกตารางมี audit trigger ───────────────────────────
  {
    const { rows } = await sql(`
      select t.tablename
      from pg_tables t
      where t.schemaname = 'public'
        -- ข้อยกเว้นที่ประกาศไว้ชัดเจน · ตารางใหม่ที่ไม่มี trigger ยังทำให้แถวนี้แดง
        --   audit_log เอง — audit ของ audit คือลูปไม่รู้จบ
        --   login_attempts — สถานะของตัวจำกัดอัตรา ไม่ใช่ข้อมูลธุรกิจ
        --     และถูกล้างเป็นประจำ · audit มันคือการเก็บทุกความพยายามล็อกอิน
        --     ไว้ตลอดกาล ซึ่งทั้งบวมและไม่มีใครใช้
        --   mcp_call_log — ร่องรอยการเรียกของ AI และตัวนับเพดานเรียก ไม่ใช่ข้อมูล
        --     ธุรกิจ · มันเป็นบันทึกอยู่แล้วในตัวเอง และไม่มี policy ให้ลบกับใครทั้งนั้น
        --     · ติด trigger เมื่อไหร่ = เขียนสองแถวต่อการเรียก tool หนึ่งครั้ง ลงตาราง
        --     ที่ลบไม่ได้ตลอดกาล เพื่อให้ใครสักคนได้อ่านว่า "มีแถวถูก insert ลงบันทึก"
        --     · ตารางคีย์ mcp_keys ยังต้องมี trigger เพราะตารางที่เก็บของยืนยันตัวตน
        --     จำเป็นต้องมีประวัติว่าใครออกและเพิกถอนใบไหนเมื่อไหร่
        and t.tablename not in ('audit_log', 'login_attempts', 'mcp_call_log')
        and not exists (
          select 1 from pg_trigger g
          join pg_class c on c.oid = g.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = t.tablename
            and not g.tgisinternal and g.tgname like '%\\_audit'
        )
      order by t.tablename`)
    const { rows: total } = await sql(
      "select count(*)::int n from pg_tables where schemaname = 'public'")
    check('P6-DB-01 ทุกตารางใน public (ยกเว้น audit_log เอง) มี audit trigger จริง',
      rows.length === 0 && Number(total[0].n) >= 21,
      rows.length ? `ไม่มี trigger: ${rows.map((r) => r.tablename).join(', ')}` : `ครบ ${total[0].n} ตาราง`)
  }

  // สร้างประวัติจริงขึ้นมาให้ตรวจ — ห้ามให้แถวไหนผ่านบนฐานที่ว่างเปล่า
  ;[{ id: siteId }] = (await sql(
    `insert into public.sites(name, status) values ('${MARK} โครงการ', 'planning') returning id`)).rows
  // แก้ผ่าน API เพื่อให้ `actor` เป็นเจ้าของจริง ไม่ใช่ null
  await req('PATCH', `/api/sites/${siteId}`, { name: `${MARK} โครงการ (แก้ชื่อแล้ว)` }, ownerJar)

  // ── P6-DB-02 · หัวหน้าโครงการอ่านไม่ได้ ──────────────────────────────
  {
    const sup = await db(supTok, '/audit_log?select=id')
    const owner = await db(ownerTok, '/audit_log?select=id&limit=5')
    check('P6-DB-02 หัวหน้าโครงการอ่าน audit_log ได้ 0 แถว · เจ้าของอ่านได้ > 0',
      (Array.isArray(sup.body) ? sup.body.length : -1) === 0 && (owner.body?.length ?? 0) > 0,
      `หัวหน้าโครงการ ${Array.isArray(sup.body) ? sup.body.length : '?'} · เจ้าของ ${owner.body?.length}`)
  }

  // ── P6-DB-03 · anon ───────────────────────────────────────────────
  {
    const r = await db('anon', '/audit_log?select=id')
    check('P6-DB-03 anon อ่าน audit_log ได้ 0 แถว',
      (Array.isArray(r.body) ? r.body.length : -1) === 0,
      `${r.status}/${Array.isArray(r.body) ? r.body.length : '?'}`)
  }

  // ── P6-DB-04 + P6-DB-05 · แก้/ลบประวัติไม่ได้ ─────────────────────
  {
    const [row] = (await db(ownerTok, '/audit_log?select=id,action&limit=1')).body
    const before = await countOf()
    const upd = await db(ownerTok, `/audit_log?id=eq.${row.id}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'HACKED' }),
    })
    const [afterRow] = (await sql(
      `select action from public.audit_log where id = ${row.id}`)).rows
    const del = await db(ownerTok, `/audit_log?id=eq.${row.id}`, { method: 'DELETE' })
    const after = await countOf()
    check('P6-DB-04 เจ้าของแก้แถว audit ไม่ได้ · ค่าเดิมไม่เปลี่ยน',
      afterRow?.action === row.action, `${upd.status} · action=${afterRow?.action}`)
    check('P6-DB-05 เจ้าของลบแถว audit ไม่ได้ · จำนวนเท่าเดิม',
      before === after && before > 0, `${del.status} · ${before}→${after}`)
  }

  // ── P6-DB-06 · ไม่มี policy UPDATE/DELETE ─────────────────────────
  {
    const { rows } = await sql(
      "select cmd from pg_policies where schemaname='public' and tablename='audit_log'")
    const cmds = rows.map((r) => r.cmd)
    check('P6-DB-06 audit_log มีเฉพาะ policy SELECT — ไม่มี UPDATE/DELETE ให้ใครทั้งนั้น',
      cmds.length > 0 && cmds.every((c) => c === 'SELECT'), cmds.join(', ') || 'ไม่มี policy เลย')
  }

  // ── P6-DB-07 · ไม่เก็บความลับ ─────────────────────────────────────
  {
    const { rows } = await sql(`
      select count(*)::int n from public.audit_log
      where before ? 'pin_hash' or after ? 'pin_hash'`)
    check('P6-DB-07 audit_log ไม่เก็บ pin_hash ในแถวไหนเลย',
      Number(rows[0].n) === 0, `${rows[0].n} แถวที่มี pin_hash`)
  }

  // ── P6-DB-08 · index ──────────────────────────────────────────────
  {
    const { rows } = await sql(
      "select indexdef from pg_indexes where schemaname='public' and tablename='audit_log'")
    const defs = rows.map((r) => r.indexdef).join('\n')
    check('P6-DB-08 index (table_name, row_id) และ (at desc) มีจริง',
      /\(table_name, row_id\)/i.test(defs) && /\(at DESC\)/i.test(defs), `${rows.length} index`)
  }

  // ── P6-UI-01 · หน้าแสดงรายการ ─────────────────────────────────────
  {
    const html = await page('/audit', ownerJar)
    check('P6-UI-01 หน้า /audit แสดงชื่อตาราง ชนิดการกระทำ และเวลา',
      html.includes('โครงการ') && html.includes('แก้ไข') && html.includes('เพิ่มใหม่'),
      'มีทั้งชื่อตารางและชนิดการกระทำ')
  }

  // ── P6-UI-02 · หัวหน้าโครงการเข้าไม่ได้ ──────────────────────────────
  {
    const r = await fetch(`${BASE}/audit`, { headers: { cookie: supJar }, redirect: 'manual' })
    const loc = r.headers.get('location') ?? ''
    const ledger = await page('/ledger', supJar)
    check('P6-UI-02 หัวหน้าโครงการเปิด /audit → ถูก redirect ออก · /ledger ยังเข้าได้',
      r.status === 307 && !loc.includes('/audit') && ledger.includes('รายรับ-รายจ่าย'),
      `${r.status} → ${loc || '(ไม่มี location)'}`)
  }

  // ── P6-UI-03 · กรองตามตาราง ───────────────────────────────────────
  {
    const sites = await page('/audit?table=sites', ownerJar)
    const profiles = await page('/audit?table=profiles', ownerJar)
    check('P6-UI-03 กรองตามตารางเปลี่ยนผลจริง — เห็นของ sites และไม่เห็นของ profiles ในหน้าเดียวกัน',
      sites.includes('โครงการ') && !sites.includes('ผู้ใช้ระบบ')
      && profiles.includes('ผู้ใช้ระบบ'),
      `sites มีผู้ใช้ระบบ=${sites.includes('ผู้ใช้ระบบ')}`)
  }

  // ── P6-UI-04 · กรองตามการกระทำ ────────────────────────────────────
  {
    const upd = await page('/audit?action=UPDATE', ownerJar)
    const ins = await page('/audit?action=INSERT', ownerJar)
    // ป้ายบนแถวบอกชนิด — ชิปตัวกรองมีทุกคำอยู่แล้ว จึงนับจากแถวไม่ใช่ทั้งหน้า
    const rowsOf = (html, label) =>
      (html.match(new RegExp(`data-audit-row[\\s\\S]{0,400}?${label}`, 'g')) ?? []).length
    check('P6-UI-04 กรอง UPDATE แล้วไม่มีแถว "เพิ่มใหม่" · กรอง INSERT แล้วไม่มีแถว "แก้ไข"',
      rowsOf(upd, 'แก้ไข') > 0 && rowsOf(upd, 'เพิ่มใหม่') === 0
      && rowsOf(ins, 'เพิ่มใหม่') > 0 && rowsOf(ins, 'แก้ไข') === 0,
      `UPDATE: แก้ไข ${rowsOf(upd, 'แก้ไข')} / เพิ่มใหม่ ${rowsOf(upd, 'เพิ่มใหม่')}`)
  }

  // ── P6-UI-05 · ชื่อคน ไม่ใช่ UUID ─────────────────────────────────
  // 🔴 ตรวจที่ **ช่องผู้ทำ** เท่านั้น ไม่ใช่ทั้งหน้า — ค่าของฟิลด์ที่เปลี่ยน
  // เป็น UUID ได้ตามปกติ (เช่น `site_id`) การหาว่า "ทั้งหน้าไม่มี UUID"
  // จึงแดงด้วยเหตุผลที่ไม่เกี่ยวกับกฎที่ตั้งใจตรวจ
  {
    const html = await page('/audit?table=sites', ownerJar)
    const actors = [...html.matchAll(/โดย\s*<span[^>]*>([^<]+)<\/span>/g)].map((m) => m[1].trim())
    const uuidActor = actors.filter((a) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a))
    check('P6-UI-05 ช่องผู้ทำแสดงชื่อคน ไม่ใช่ UUID ดิบ · แถวที่ระบบทำแสดงว่า "ระบบ"',
      actors.length > 0 && uuidActor.length === 0,
      `ผู้ทำ ${actors.length} แถว · เป็น UUID ${uuidActor.length} แถว · ตัวอย่าง: ${actors[0] ?? '—'}`)
  }

  // ── P6-UI-06 · แสดงเฉพาะฟิลด์ที่เปลี่ยน ───────────────────────────
  {
    const html = await page('/audit?table=sites&action=UPDATE', ownerJar)
    check('P6-UI-06 แถวแก้ไขแสดงเฉพาะฟิลด์ที่เปลี่ยน พร้อมค่าก่อน → ค่าหลัง ไม่ใช่ jsonb ทั้งก้อน',
      html.includes('name: ') && html.includes(`${MARK} โครงการ (แก้ชื่อแล้ว)`)
      && !html.includes('"created_at"'),
      'เห็นชื่อฟิลด์และค่าใหม่')
  }

  // ── P6-UI-07 · เลื่อนดูได้ครบ ไม่ซ้ำไม่หาย ────────────────────────
  {
    const seen = []
    let after = null
    for (let hop = 0; hop < 4; hop++) {
      const url = after ? `/audit?after=${encodeURIComponent(after)}` : '/audit'
      const html = await page(url, ownerJar)
      const ids = [...html.matchAll(/data-audit-row="(\d+)"/g)].map((m) => Number(m[1]))
      seen.push(...ids)
      const next = /after=([^"&]+)/.exec(html)
      if (!next) break
      const decoded = decodeURIComponent(next[1])
      if (decoded === after) break
      after = decoded
    }
    const unique = new Set(seen)
    check('P6-UI-07 เลื่อนดูหลายหน้า → ไม่มีแถวซ้ำ (keyset ตาม at desc, id desc)',
      seen.length > 0 && unique.size === seen.length,
      `เห็น ${seen.length} แถว · ไม่ซ้ำ ${unique.size} แถว`)
  }

  // ── P6-UI-08 · กรองแล้วไม่เจอ ─────────────────────────────────────
  {
    const html = await page('/audit?table=login_attempts&action=DELETE', ownerJar)
    check('P6-UI-08 กรองแล้วไม่เจอ → ข้อความคนละแบบกับ "ยังไม่มีประวัติ"',
      html.includes('ไม่พบประวัติที่ตรงกับเงื่อนไขนี้') && !html.includes('ยังไม่มีประวัติการแก้ไข —'),
      'แยกสองสถานะออกจากกัน')
  }
} finally {
  if (siteId) {
    await sql(`delete from public.site_finance where site_id = '${siteId}'`)
    await sql(`delete from public.sites where id = '${siteId}'`)
  }
  console.log('  (ลบข้อมูลทดสอบแล้ว · แถว audit ลบไม่ได้ตามการออกแบบ)')
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
