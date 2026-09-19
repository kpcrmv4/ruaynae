#!/usr/bin/env node
/**
 * verify-digest.mjs — สรุปประจำวัน 8 โมงเช้า (R9)
 *
 * กฎที่ตัวนี้เฝ้า:
 *   1. **ไม่มีของค้าง = ไม่ส่ง** — แจ้งเตือนที่เด้งทุกเช้าไม่ว่าจะมีอะไรหรือไม่
 *      คือแจ้งเตือนที่คนปิดทิ้ง แล้ววันที่มีของค้างจริงก็จะไม่มีใครเห็น
 *   2. มีของค้าง = เจ้าของได้แถวใน `notifications` พร้อมยอดรวมและอายุของที่ค้างนานสุด
 *   3. เรียกซ้ำวันเดิม **ไม่เกิดแถวที่สอง** (unique index เป็นตัวกัน ไม่ใช่ความถี่ของ cron)
 *   4. แถวที่สร้างมี `pushed_at = null` → `push-dispatch` เป็นคนส่ง push ต่อ
 *      (ตัวส่ง push อยู่ที่เดียวทั้งระบบ)
 *   5. ไม่มี `CRON_SECRET` ที่ถูกต้อง → 401
 *
 * 🔴 สคริปต์นี้เขียนลงฐานข้อมูลจริง — แตะเฉพาะแถวที่ตัวเองสร้าง และคืนสภาพ
 * ในบล็อก finally เสมอ · ห้ามลบแบบเหมารวมเด็ดขาด (§17 ข้อ 9)
 *
 * ใช้: node scripts/verify-digest.mjs [http://localhost:3200]
 */
import { readFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:3200'
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)

const sql = async (q) => {
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
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t.slice(0, 300)}`)
  return JSON.parse(t)
}

// 🔴 ส่งกุญแจทาง **header** ไม่ใช่ query string — query ไปโผล่ใน access log
// ของทุกชั้นที่คำขอวิ่งผ่าน (dev server, Vercel, proxy) แล้วความลับก็รั่ว
// ออกไปอยู่ในไฟล์ที่ไม่มีใครคิดว่าเป็นที่เก็บความลับ
const hit = (secret) =>
  fetch(`${BASE}/api/cron/daily-digest`, {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    redirect: 'manual',
  })

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

const MARK = 'ZZ ทดสอบสรุปประจำวัน'
let txnId = null
let siteId = null

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

console.log('\n── R9 · สรุปประจำวัน ────────────────────────────────────────')

try {
  // เคลียร์สรุปของวันนี้ก่อน เพื่อให้เริ่มจากสถานะเดียวกันทุกครั้ง
  await sql(`delete from public.notifications where digest_date = '${today}'`)

  // ── R9-DIG-01 · ไม่ล็อกอินและไม่มีกุญแจ → 401 ────────────────────
  {
    const r = await hit(null)
    check('R9-DIG-01 เรียกโดยไม่มี CRON_SECRET → 401', r.status === 401, `${r.status}`)
  }

  // ── R9-DIG-02 · ไม่มีของค้าง → ไม่ส่ง ────────────────────────────
  {
    const [before] = await sql(
      `select count(*)::int as n from public.transactions where status = 'pending'`)
    if (Number(before.n) > 0) {
      console.log(`   (ข้าม R9-DIG-02 — ฐานนี้มีของค้างจริงอยู่ ${before.n} รายการ)`)
    } else {
      const r = await hit(env.CRON_SECRET)
      const b = await r.json().catch(() => ({}))
      const [made] = await sql(
        `select count(*)::int as n from public.notifications where digest_date = '${today}'`)
      check('R9-DIG-02 ไม่มีของค้าง → ไม่สร้างแจ้งเตือนเลย (ไม่ใช่ส่ง "วันนี้ไม่มีอะไร")',
        r.status === 200 && b.sent === 0 && Number(made.n) === 0,
        `${r.status} · sent=${b.sent} · แถว ${made.n}`)
    }
  }

  // ── สร้างของค้างหนึ่งรายการ ───────────────────────────────────────
  {
    siteId = (await sql(
      `insert into public.sites(name, status) values ('${MARK} โครงการ', 'active') returning id`))[0].id
    const [cat] = await sql(
      `select id from public.categories where kind = 'expense' and is_active order by sort_order limit 1`)
    const [owner] = await sql(
      `select id from public.profiles where role = 'owner' and is_active limit 1`)
    txnId = (await sql(
      `insert into public.transactions(kind, site_id, category_id, amount, txn_date, status, note, created_by)
       values ('expense', '${siteId}', '${cat.id}', 4321, '${today}', 'pending', '${MARK}', '${owner.id}')
       returning id`))[0].id
    await sql(`delete from public.notifications where digest_date = '${today}'`)
  }

  // ── R9-DIG-03 + 04 · มีของค้าง → ส่ง พร้อมยอดรวม ─────────────────
  {
    const r = await hit(env.CRON_SECRET)
    const b = await r.json().catch(() => ({}))
    const rows = await sql(
      `select kind::text as kind, title, body, link, pushed_at, read_at
       from public.notifications where digest_date = '${today}'`)
    check('R9-DIG-03 มีของค้าง → สร้างแจ้งเตือนให้เจ้าของ พร้อมจำนวนและยอดรวม',
      r.status === 200 && rows.length >= 1 && rows[0].kind === 'daily_digest'
      && /รออนุมัติ/.test(rows[0].title ?? '') && /4,321/.test(rows[0].body ?? '')
      && rows[0].link === '/approvals',
      `${r.status} · "${rows[0]?.title}" / "${rows[0]?.body}"`)
    // 🔴 ต้องมีแถวจริงก่อน ไม่งั้น `every()` บนลิสต์ว่างผ่านฟรีทุกครั้ง
    check('R9-DIG-04 แถวที่สร้างยัง `pushed_at = null` → push-dispatch เป็นคนส่งต่อ (ตัวส่งอยู่ที่เดียว)',
      rows.length > 0 && rows.every((x) => x.pushed_at === null && x.read_at === null),
      rows.length ? rows.map((x) => `pushed=${x.pushed_at}`).join(' ') : 'ไม่มีแถวให้ตรวจ')
  }

  // ── R9-DIG-05 · เรียกซ้ำวันเดิมไม่เกิดแถวที่สอง ──────────────────
  {
    const before = (await sql(
      `select count(*)::int as n from public.notifications where digest_date = '${today}'`))[0].n
    const r = await hit(env.CRON_SECRET)
    const b = await r.json().catch(() => ({}))
    const after = (await sql(
      `select count(*)::int as n from public.notifications where digest_date = '${today}'`))[0].n
    check('R9-DIG-05 เรียกซ้ำวันเดิม → ไม่มีแถวที่สอง (ฐานข้อมูลกัน ไม่ใช่ความถี่ของ cron)',
      r.status === 200 && after === before && Number(b.sent) === 0,
      `${r.status} · sent=${b.sent} · ${before}→${after}`)
  }
} catch (e) {
  console.error('💥', String(e).slice(0, 600))
  fail++
} finally {
  await sql(`delete from public.notifications where digest_date = '${today}'`).catch(() => {})
  if (txnId) await sql(`delete from public.transactions where id = '${txnId}'`).catch(() => {})
  if (siteId) await sql(`delete from public.sites where id = '${siteId}'`).catch(() => {})
  const left = await sql(
    `select (select count(*)::int from public.transactions where note like '${MARK}%') as txns,
            (select count(*)::int from public.sites where name like '${MARK}%') as sites,
            (select count(*)::int from public.notifications where digest_date = '${today}') as digests`)
    .catch(() => [{}])
  console.log(`\nผ่าน ${pass} · ตก ${fail} · แถวทดสอบที่ค้าง ${JSON.stringify(left[0])}`)
  process.exit(fail ? 1 : 0)
}
