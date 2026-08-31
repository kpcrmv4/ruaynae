#!/usr/bin/env node
/**
 * remove-demo-data.mjs — เอาชุดข้อมูลเดโม่ของ `seed-demo.mjs` ออก
 *
 * มีไว้แก้ปัญหาที่เกิดจริง: `verify-ship` (ซึ่งอยู่ใน `npm run verify:all`)
 * เรียก `seed-demo.mjs` เมื่อฐานข้อมูลยังไม่มีข้อมูล แล้ว **ไม่เคยเก็บกวาด** ·
 * แถว `site_supervisors` ที่มันทิ้งไว้เป็นช่วงเปิด (`[วันนี้, ∞)`) ไปชน
 * exclusion constraint กับแถว `[2000-01-01, ∞)` ที่สคริปต์ตรวจตัวอื่นต้อง
 * insert ให้หัวหน้าไซต์คนเดียวกัน → มอบหมายไม่สำเร็จ → หัวหน้าไซต์ไม่มีสิทธิ์
 * ในไซต์ทดสอบ → **ทุกแถวที่ต้องใช้สิทธิ์หัวหน้าไซต์ตกยกชุด (30 แถว)**
 * โดยที่โค้ดแอปไม่ได้ผิดอะไรเลย
 *
 * 🔴 ลบตาม **ชื่อที่ seed-demo.mjs สร้าง** เท่านั้น ไม่ใช่ตามช่วงเวลา —
 * ข้อมูลจริงของลูกค้าที่บังเอิญถูกสร้างในนาทีเดียวกันต้องไม่หาย
 * · รายการส่วนกลาง (`site_id is null`) ไม่มีไซต์ให้ยึด จึงยึดจาก `note`
 *   ซึ่งเป็นคีย์ idempotent ที่ seed ใช้เองอยู่แล้ว
 *
 * ใช้:
 *   node scripts/remove-demo-data.mjs           ← แสดงว่าจะลบอะไร (ไม่ลบจริง)
 *   node scripts/remove-demo-data.mjs --confirm ← ลบจริง
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)

const REF = env.SUPABASE_PROJECT_REF
// ตรึงเป้าหมายเหมือน db.mjs — ref ต้องตรงกับ URL ที่แอปใช้จริง
const hostRef = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
if (hostRef !== REF) {
  throw new Error(`เป้าหมายไม่ตรงกัน: PROJECT_REF=${REF} แต่ URL ชี้ไป ${hostRef} — หยุดก่อนลบผิดฐาน`)
}

const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`SQL ล้มเหลว: ${t.slice(0, 400)}`)
  return JSON.parse(t)
}

/** ชื่อที่ `seed-demo.mjs` สร้าง — ต้องตรงกับไฟล์นั้นเป๊ะ */
const SITES = [
  'บ้านคุณสมศักดิ์ ซ.รามอินทรา 65',
  'โกดังโรงงานไทยพลาสติก',
  'รีโนเวทตึกแถว 2 คูหา ตลาดพลู',
  'ต่อเติมครัวหลังบ้าน ลาดพร้าว 71',
  'บ้านแฝดสองชั้น บางบัวทอง (รอเซ็นสัญญา)',
]
const EMPLOYEES = [
  'สมพงษ์ ใจดี', 'บุญมี แซ่ลิ้ม', 'วิชัย ทองสุข',
  'สมหมาย เพ็ชรดี', 'ประเสริฐ มั่นคง', 'จำลอง หายไป',
]
/** รายจ่ายส่วนกลางของชุดเดโม่ — ไม่มีไซต์ให้ยึด จึงยึดจาก note */
const CENTRAL_NOTES = ['ค่าน้ำมันรถกระบะเดือนนี้', 'ค่าเช่าออฟฟิศและอินเทอร์เน็ต']

const list = (xs) => xs.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ')

const SITE_FILTER = `select id from public.sites where name in (${list(SITES)})`
const EMP_FILTER = `select id from public.employees where full_name in (${list(EMPLOYEES)})`

const counts = async () => (await sql(`
  select
    (select count(*) from public.sites where name in (${list(SITES)}))::int sites,
    (select count(*) from public.employees where full_name in (${list(EMPLOYEES)}))::int employees,
    (select count(*) from public.transactions
       where site_id in (${SITE_FILTER}) or note in (${list(CENTRAL_NOTES)}))::int transactions,
    (select count(*) from public.attendance where site_id in (${SITE_FILTER}))::int attendance,
    (select count(*) from public.advances
       where employee_id in (${EMP_FILTER}) or site_id in (${SITE_FILTER}))::int advances,
    (select count(*) from public.site_supervisors where site_id in (${SITE_FILTER}))::int supervisors,
    (select count(*) from public.site_milestones where site_id in (${SITE_FILTER}))::int milestones,
    (select count(*) from public.attachments a join public.transactions t on t.id = a.transaction_id
       where t.site_id in (${SITE_FILTER}))::int attachments
`))[0]

const before = await counts()
console.log('\nจะลบ:')
for (const [k, v] of Object.entries(before)) console.log(`  ${k.padEnd(14)} ${v}`)

const keep = await sql(`select name from public.sites where name not in (${list(SITES)}) order by name`)
console.log('\nไซต์ที่ **เก็บไว้**:', keep.length ? keep.map((r) => r.name).join(' · ') : '(ไม่มี)')

if (before.attachments > 0) {
  // ไฟล์ใน R2 ไม่ได้ถูกลบตาม cascade — ต้องรู้ตัวก่อน ไม่ใช่ค้นพบทีหลังว่ามีไฟล์กำพร้า
  console.log('\n⚠️  มี attachments ที่ผูกอยู่ — ไฟล์ใน R2 จะกลายเป็นไฟล์กำพร้า ต้องกวาดแยก')
}

if (!process.argv.includes('--confirm')) {
  console.log('\n(ยังไม่ลบ — ใส่ --confirm เพื่อลบจริง)')
  process.exit(0)
}

// ลบจากใบไปหาราก · `sites` มี cascade อยู่แล้วบางส่วน แต่สั่งชัด ๆ อ่านง่ายกว่า
await sql(`delete from public.attendance where site_id in (${SITE_FILTER})`)
await sql(`delete from public.advances where employee_id in (${EMP_FILTER}) or site_id in (${SITE_FILTER})`)
await sql(`delete from public.transactions
           where site_id in (${SITE_FILTER}) or note in (${list(CENTRAL_NOTES)})`)
await sql(`delete from public.site_supervisors where site_id in (${SITE_FILTER})`)
await sql(`delete from public.site_milestones where site_id in (${SITE_FILTER})`)
await sql(`delete from public.employees where full_name in (${list(EMPLOYEES)})`)
await sql(`delete from public.sites where name in (${list(SITES)})`)

const after = await counts()
const leftover = Object.entries(after).filter(([, v]) => v > 0)
console.log('\nหลังลบ:', leftover.length ? JSON.stringify(after) : 'ไม่เหลือแถวของชุดเดโม่แล้ว')
process.exit(leftover.length ? 1 : 0)
