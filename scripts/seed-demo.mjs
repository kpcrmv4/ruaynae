#!/usr/bin/env node
/**
 * seed-demo.mjs — ข้อมูลตัวอย่างที่ครอบ **ทุกสถานะที่หน้าจอเรนเดอร์ได้จริง**
 *
 * ใช้:
 *   node scripts/seed-demo.mjs          เพิ่มข้อมูลตัวอย่าง (idempotent)
 *   node scripts/seed-demo.mjs --reset  ล้างของเดิมก่อน แล้วเพิ่มใหม่
 *
 * 🔴 **ยอดที่ seed ไว้ต้องเท่ากับยอดที่แอปคำนวณเอง** (CLAUDE.md §13 ข้อ 6)
 * ถ้าเดโม่โชว์สองตัวเลขที่ขัดกัน คนดูจะเลิกเชื่อทั้งหน้า · สคริปต์นี้จึง
 * **ไม่เขียนยอดรวมลงไปเลย** — เขียนแต่รายการดิบ แล้วให้ RPC เดียวกับที่
 * หน้าจอใช้เป็นคนบวก · ตอนท้ายมีการตรวจว่ายอดที่ได้ตรงกับที่ตั้งใจ
 *
 * 🔴 รหัสผ่านและ PIN มาจาก env ไม่ใช่ฝังในไฟล์ — ฝังแล้ว commit
 * = รหัสติดอยู่ในประวัติ git ตลอดไป ลบไฟล์ทีหลังก็ยังอยู่
 *
 * 🔴 idempotent: รันซ้ำได้ไม่พัง · deterministic: ได้ผลเหมือนเดิมทุกครั้ง
 * (วันที่อ้างจาก "วันนี้" ตามเวลาไทย ไม่ใช่ค่าคงที่ที่จะเก่าลงทุกวัน)
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)

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
  if (!r.ok) throw new Error(`SQL ล้มเหลว:\n${q.slice(0, 200)}\n${t.slice(0, 400)}`)
  return JSON.parse(t)
}

const day = (offset) => {
  const d = new Date(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()) + 'T00:00:00Z',
  )
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`

if (process.argv.includes('--reset')) {
  console.log('  ล้างข้อมูลเดิมก่อน…')
  await sql(readFileSync('supabase/reset.sql', 'utf8'))
}

console.log('\n── ข้อมูลตัวอย่าง ───────────────────────────────────────────')

const [owner] = await sql("select id from public.profiles where role = 'owner' limit 1")
const sups = await sql(
  "select id, full_name from public.profiles where role = 'site_supervisor' order by created_at")
if (!owner) throw new Error('ยังไม่มีบัญชีเจ้าของ — รัน `node scripts/seed-users.mjs` ก่อน')
if (sups.length < 2) throw new Error('ต้องมีหัวหน้าโครงการอย่างน้อยสองคน — รัน `node scripts/seed-users.mjs` ก่อน')

const [expCat] = await sql(
  "select id from public.categories where kind='expense' and name like 'ค่าวัสดุ%' limit 1")
const [laborCat] = await sql(
  "select id from public.categories where kind='expense' order by sort_order offset 1 limit 1")
const [incCat] = await sql(
  "select id from public.categories where kind='income' order by sort_order limit 1")

/**
 * สร้างโครงการทั้งชุดในคำสั่งเดียว
 *
 * 🔴 หนึ่งแถวหนึ่ง request ไม่ได้ — Management API มี rate limit
 * และ seed ที่ยิงแปดสิบครั้งจะโดน `ThrottlerException` กลางทาง
 * แล้วทิ้งฐานข้อมูลไว้ครึ่ง ๆ กลาง ๆ ซึ่งแย่กว่าไม่ seed เลย
 * · ทุกส่วนของสคริปต์นี้จึงยัดเป็นคำสั่งเดียวต่อหนึ่งชุดข้อมูล
 */
/*
 * 🔴 **แถวที่ CTE เพิ่งเขียน ยังมองไม่เห็นในคำสั่งเดียวกัน**
 *
 * เวอร์ชันแรกยัด insert · update · select ไว้ในคำสั่งเดียวโดยใช้ CTE แล้วจบด้วย
 * `select ... from public.sites join wanted` — ทุกส่วนของคำสั่งเดียวกันเห็น
 * snapshot เดียวกัน (ตอนคำสั่งเริ่ม) แถวที่ `insert` เพิ่งสร้างจึงไม่อยู่ใน
 * `public.sites` ที่ท้ายคำสั่งอ่าน · ผลคือ **บนฐานข้อมูลที่ว่างจริง ๆ แผนที่ id
 * ออกมาว่างเปล่า** แล้ว `siteA` เป็น `undefined` ไปโผล่เป็น `'undefined'::uuid`
 *
 * ที่ร้ายคือมัน **ผ่านตลอด** ตราบใดที่รันบนฐานที่เคย seed ไว้แล้ว — แถวมีอยู่ก่อน
 * จึงอ่านเจอ · บั๊กโผล่ครั้งแรกตอนรันบนฐานที่ล้างใหม่หมด ซึ่งคือสภาพของเครื่องลูกค้า
 *
 * แก้ด้วยการ **แยกเป็นสองคำสั่ง**: เขียนให้จบก่อน แล้วค่อยอ่าน · สองคำสั่งไม่ชน
 * rate limit (ปัญหาเดิมคือแปดสิบครั้ง ไม่ใช่สอง)
 */
async function seedSites(rows) {
  const values = rows.map((r) =>
    `(${q(r.name)}, ${q(r.client)}, ${q(r.phone)}, ${q(r.address)}, ` +
    `${q(r.start)}, ${q(r.end)}, ${q(r.status)}, ${r.contract})`).join(', ')
  const wanted = `wanted(name, client_name, client_phone, address, start_date, end_date, status, contract) as (
      values ${values}
    )`

  // คำสั่งที่ 1 — สร้างโครงการที่ยังไม่มี
  await sql(`
    with ${wanted}
    insert into public.sites(name, client_name, client_phone, address, start_date, end_date, status)
    select w.name, w.client_name, w.client_phone, w.address,
           w.start_date::date, w.end_date::date, w.status::public.site_status
    from wanted w
    where not exists (select 1 from public.sites s where s.name = w.name)`)

  // คำสั่งที่ 2 — ตอนนี้แถวมีจริงแล้ว จึงตั้งค่างานและอ่าน id กลับมาได้
  const out = await sql(`
    with ${wanted},
    upd as (
      update public.site_finance f set contract_amount = w.contract
      from wanted w
      join public.sites s on s.name = w.name
      where f.site_id = s.id
      returning 1
    )
    select s.id, s.name from public.sites s
    join wanted w on w.name = s.name`)
  return new Map(out.map((r) => [r.name, r.id]))
}

// ── โครงการที่ครอบทุกสถานะที่การ์ดวาดได้ ────────────────────────────────
// 1) ใกล้ครบกำหนด + กำไรดี   2) ต้นทุนแซงเงินที่เก็บได้   3) ยังไม่ได้ตั้งค่างาน
// 4) ปิดงานแล้ว              5) วางแผนไว้ ยังไม่เริ่ม
const SITES = [
  { name: 'บ้านคุณสมศักดิ์ ต.บ่อแฮ้ว', client: 'คุณสมศักดิ์ วงศ์อนันต์',
    phone: '081-234-5678', address: 'ต.บ่อแฮ้ว อ.เมืองลำปาง จ.ลำปาง',
    start: day(-150), end: day(20), status: 'active', contract: 2850000 },
  { name: 'โกดังโรงงานเซรามิกลำปาง', client: 'บจก. ลำปางเซรามิกอุตสาหกรรม',
    phone: '054-231-880', address: 'ต.ปงแสนทอง อ.เมืองลำปาง จ.ลำปาง',
    start: day(-76), end: day(107), status: 'active', contract: 4200000 },
  { name: 'รีโนเวทอาคารพาณิชย์ 2 คูหา กาดกองต้า', client: 'คุณวิไล ศรีสุข',
    phone: '089-777-2211', address: 'ถ.ตลาดเก่า ต.สวนดอก อ.เมืองลำปาง จ.ลำปาง',
    start: day(-29), end: day(31), status: 'active', contract: 0 },
  { name: 'ต่อเติมครัวหลังบ้าน ต.พระบาท', client: 'คุณอนงค์ พูนสิน',
    phone: '086-321-9900', address: 'ต.พระบาท อ.เมืองลำปาง จ.ลำปาง',
    start: day(-240), end: day(-60), status: 'done', contract: 480000 },
  { name: 'บ้านแฝดสองชั้น อ.เกาะคา (รอเซ็นสัญญา)', client: 'คุณธนา เจริญพงศ์',
    phone: '', address: 'ต.ศาลา อ.เกาะคา จ.ลำปาง',
    start: day(30), end: day(210), status: 'planning', contract: 1950000 },
]
const siteIds = await seedSites(SITES)
const siteA = siteIds.get(SITES[0].name)
const siteB = siteIds.get(SITES[1].name)
const siteC = siteIds.get(SITES[2].name)

// ── หัวหน้าโครงการ ──────────────────────────────────────────────────────
// `site_supervisors` มี exclusion constraint กันแถวซ้ำของ คน×โครงการ ในช่วงเวลาซ้อนกัน
// (P1 · ตั้งแต่ 19 ก.ย. 2569 คนหนึ่งคนดูแลหลายโครงการพร้อมกันได้)
// · โครงการ C จงใจไม่มีใครดูแล — เป็นสถานะที่หน้าจอต้องวาดได้ด้วย
await sql(`
  insert into public.site_supervisors(site_id, profile_id, effective_from)
  select v.site_id::uuid, v.profile_id::uuid, v.d::date
  from (values
    (${q(siteA)}, ${q(sups[0].id)}, ${q(day(-180))}),
    (${q(siteB)}, ${q(sups[1].id)}, ${q(day(-180))})
  ) as v(site_id, profile_id, d)
  where not exists (
    select 1 from public.site_supervisors x
    where x.site_id = v.site_id::uuid and x.profile_id = v.profile_id::uuid)`)

// ── แผนงวดของโครงการ A ─────────────────────────────────────────────────
await sql(`
  insert into public.site_milestones(site_id, seq, name, planned_amount, planned_date)
  select ${q(siteA)}, v.seq, v.name, v.amount, v.d::date
  from (values
    (1, ${q('เงินมัดจำ')}, 285000, ${q(day(-150))}),
    (2, ${q('ตอกเสาเข็ม + ฐานราก')}, 570000, ${q(day(-120))}),
    (3, ${q('โครงสร้าง ค.ส.ล. ครบ')}, 570000, ${q(day(-80))}),
    (4, ${q('ก่ออิฐ + มุงหลังคา')}, 285000, ${q(day(-40))}),
    (5, ${q('งานฉาบ + วงกบ')}, 570000, ${q(day(-10))}),
    (6, ${q('ส่งมอบงาน')}, 570000, ${q(day(20))})
  ) as v(seq, name, amount, d)
  where not exists (
    select 1 from public.site_milestones m
    where m.site_id = ${q(siteA)} and m.seq = v.seq)`)

// ── รายรับและรายจ่าย ────────────────────────────────────────────────
// โครงการ A เก็บได้ ฿2,280,000 (80%) · รายจ่ายอนุมัติ ฿1,700,000 → กำไรยังบวก
// โครงการ B เก็บได้ ฿1,680,000 (40%) · ต้นทุน ฿1,970,000 (47%) → ป้ายต้นทุนแซง
const TXNS = [
  // [kind, site, amount, date, method, status, note, incomeKind, seq, reason, by]
  ['income', siteA, 285000, day(-150), 'transfer', 'approved', 'เงินมัดจำ', 'deposit', null, null, null],
  ['income', siteA, 570000, day(-118), 'transfer', 'approved', 'งวดที่ 1 ตอกเสาเข็มและฐานราก', 'installment', 1, null, null],
  ['income', siteA, 570000, day(-78), 'transfer', 'approved', 'งวดที่ 2 โครงสร้าง ค.ส.ล. ครบ', 'installment', 2, null, null],
  ['income', siteA, 285000, day(-38), 'transfer', 'approved', 'งวดที่ 3 ก่ออิฐและมุงหลังคา', 'installment', 3, null, null],
  ['income', siteA, 570000, day(-8), 'transfer', 'approved', 'งวดที่ 4 งานฉาบและวงกบ', 'installment', 4, null, null],
  ['income', siteB, 840000, day(-70), 'transfer', 'approved', 'มัดจำโกดังเซรามิกลำปาง', 'deposit', null, null, null],
  ['income', siteB, 840000, day(-30), 'transfer', 'approved', 'งวดที่ 1 งานฐานรากโกดัง', 'installment', 1, null, null],
  ['income', siteC, 294000, day(-20), 'cash', 'approved', 'มัดจำรีโนเวทอาคารพาณิชย์', 'deposit', null, null, null],

  ['expense', siteA, 980000, day(-120), 'transfer', 'approved', 'ค่าเหล็กและปูนงวดโครงสร้าง', null, null, null, sups[0].id],
  ['expense', siteA, 460000, day(-60), 'transfer', 'approved', 'ค่าอิฐมอญและกระเบื้องหลังคา', null, null, null, sups[0].id],
  ['expense', siteA, 260000, day(-15), 'cash', 'approved', 'ค่าวงกบและบานประตูไม้สัก', null, null, null, sups[0].id],
  ['expense', siteA, 24800, day(-1), 'transfer', 'pending', 'ค่าเหล็กเส้น DB12 60 เส้น', null, null, null, sups[0].id],
  ['expense', siteA, 8500, day(0), 'cash', 'pending', 'ค่าทรายหยาบ 3 คิว', null, null, null, sups[0].id],
  ['expense', siteA, 15000, day(-3), 'cash', 'rejected', 'ค่าอุปกรณ์ไม่ระบุรายการ', null, null,
    'ไม่มีสลิปแนบ และไม่บอกว่าซื้ออะไร กรุณาถ่ายบิลแล้วส่งใหม่', sups[0].id],
  ['expense', siteB, 1450000, day(-60), 'transfer', 'approved', 'ค่าโครงเหล็กโกดังสำเร็จรูป', null, null, null, sups[1].id],
  ['expense', siteB, 520000, day(-25), 'transfer', 'approved', 'ค่าเทพื้นคอนกรีตโกดัง', null, null, null, sups[1].id],
  ['expense', siteB, 88000, day(-2), 'cash', 'pending', 'ค่าเช่ารถเครนรายวัน', null, null, null, sups[1].id],
  ['expense', siteC, 221900, day(-10), 'cash', 'approved', 'ค่ารื้อถอนและวัสดุรีโนเวท', null, null, null, null],
  // ส่วนกลาง — ต้องไม่ถูกนับเข้าโครงการไหน
  ['expense', null, 12500, day(-5), 'cash', 'approved', 'ค่าน้ำมันรถกระบะเดือนนี้', null, null, null, null],
  ['expense', null, 8900, day(-4), 'transfer', 'approved', 'ค่าเช่าออฟฟิศและอินเทอร์เน็ต', null, null, null, null],
]
const catFor = (kind) => (kind === 'income' ? incCat.id : (expCat?.id ?? laborCat.id))
await sql(`
  insert into public.transactions
    (kind, site_id, category_id, amount, txn_date, pay_method, status, note,
     income_kind, installment_no, rejected_reason, created_by, approved_by, approved_at)
  select v.kind::public.txn_kind, nullif(v.site_id, '')::uuid, v.cat::uuid, v.amount,
         v.d::date, v.method::public.pay_method, v.status::public.txn_status, v.note,
         nullif(v.ik, '')::public.income_kind, v.seq, nullif(v.reason, ''),
         nullif(v.by, '')::uuid,
         case when v.status = 'approved' then ${q(owner.id)}::uuid end,
         case when v.status = 'approved' then now() end
  from (values
    ${TXNS.map((t) =>
      `(${q(t[0])}, ${q(t[1] ?? '')}, ${q(catFor(t[0]))}, ${t[2]}, ${q(t[3])}, ${q(t[4])}, ` +
      `${q(t[5])}, ${q(t[6])}, ${q(t[7] ?? '')}, ${t[8] ?? 'null'}, ${q(t[9] ?? '')}, ${q(t[10] ?? '')})`,
    ).join(', ')}
  ) as v(kind, site_id, cat, amount, d, method, status, note, ik, seq, reason, by)
  where not exists (select 1 from public.transactions t where t.note = v.note)`)

// ── คนงาน — ครบทั้งรายวัน รายเดือน และคนที่ปิดใช้งานแล้ว ────────────
const WORKERS = [
  ['สมพงษ์ ใจดี', 'ช่างปูน', 'daily', 550, null, true],
  ['บุญมี แซ่ลิ้ม', 'ช่างไม้', 'daily', 600, null, true],
  ['วิชัย ทองสุข', 'กรรมกร', 'daily', 420, null, true],
  ['สมหมาย เพ็ชรดี', 'กรรมกร', 'daily', 420, null, true],
  ['ประเสริฐ มั่นคง', 'โฟร์แมน', 'monthly', null, 22000, true],
  ['จำลอง หายไป', 'กรรมกร', 'daily', 400, null, false],
]
// สองคำสั่งด้วยเหตุผลเดียวกับ `seedSites` — ค่าแรงต้องเขียนหลังจากคนมีตัวตนแล้ว
// ถ้ายัดรวมคำสั่งเดียว `employee_wages` จะว่างเปล่าบนฐานที่ล้างใหม่ แล้วค่าแรง
// ทุกคนหายไปเงียบ ๆ โดยที่ `employees` ดูครบดี
const workerWanted = `wanted(full_name, job_title, wage_type, daily_rate, monthly_salary, is_active) as (
    values ${WORKERS.map((w) =>
      `(${q(w[0])}, ${q(w[1])}, ${q(w[2])}, ${w[3] ?? 'null'}::numeric, ` +
      `${w[4] ?? 'null'}::numeric, ${w[5]})`).join(', ')}
  )`

await sql(`
  with ${workerWanted}
  insert into public.employees(full_name, job_title, is_active)
  select w.full_name, w.job_title, w.is_active from wanted w
  where not exists (select 1 from public.employees e where e.full_name = w.full_name)`)

await sql(`
  with ${workerWanted}
  insert into public.employee_wages(employee_id, wage_type, daily_rate, monthly_salary)
  select e.id, w.wage_type::public.wage_type, w.daily_rate, w.monthly_salary
  from wanted w join public.employees e on e.full_name = w.full_name
  on conflict (employee_id) do nothing`)

const empRows = await sql(
  `select id, full_name from public.employees where full_name in (${WORKERS.map((w) => q(w[0])).join(', ')})`)
const emp = new Map(empRows.map((r) => [r.full_name, r.id]))

// ── ลงชื่อเข้าโครงการย้อนหลัง — ค่าแรงเข้าต้นทุนโครงการทันที ───────────────
// สมพงษ์ 6 วัน × ฿550 = ฿3,300 (ตัวเลขเดียวกับตัวอย่างใน DESIGN.md §5.4)
const CREW = [
  ['สมพงษ์ ใจดี', siteA, 6], ['บุญมี แซ่ลิ้ม', siteA, 5], ['วิชัย ทองสุข', siteA, 6],
  ['สมหมาย เพ็ชรดี', siteB, 4], ['ประเสริฐ มั่นคง', siteA, 6],
]
const attendanceRows = []
for (const [name, siteId, days] of CREW) {
  for (let i = 1; i <= days; i++) {
    attendanceRows.push(`(${q(day(-i))}, ${q(siteId)}, ${q(emp.get(name))})`)
  }
}
await sql(`
  insert into public.attendance(work_date, site_id, employee_id, work_units)
  select v.d::date, v.site_id::uuid, v.emp::uuid, 1
  from (values ${attendanceRows.join(', ')}) as v(d, site_id, emp)
  where not exists (
    select 1 from public.attendance a
    where a.employee_id = v.emp::uuid and a.work_date = v.d::date)`)

// ── เบิกล่วงหน้า — วิชัยเบิกเกือบเต็มเพดาน (ค่าแรง ฿2,520 เบิก ฿2,500) ──
// ให้เห็นบนหน้าจอว่าเหลือเบิกได้อีกแค่ ฿20
await sql(`
  insert into public.advances(employee_id, amount, advance_date, pay_method, site_id, status)
  -- 🔴 ต้องระบุสถานะ approved เอง — ตั้งแต่ R14 ค่าตั้งต้นของคอลัมน์คือ pending
  -- (คำขอที่หัวหน้าโครงการยื่น) · ใบเดโม่พวกนี้คือเงินที่จ่ายไปแล้ว
  select v.emp::uuid, v.amount, v.d::date, 'cash', ${q(siteA)}, 'approved'
  from (values
    (${q(emp.get('สมพงษ์ ใจดี'))}, 1000, ${q(day(-2))}),
    (${q(emp.get('วิชัย ทองสุข'))}, 2500, ${q(day(-1))})
  ) as v(emp, amount, d)
  where not exists (
    select 1 from public.advances a
    where a.employee_id = v.emp::uuid and a.amount = v.amount)`)

console.log('  ✅ โครงการ 5 แห่ง · รายรับ 8 · รายจ่าย 12 · คนงาน 6 · ลงชื่อ 27 วัน · เบิก 2 ใบ')

// ── ตรวจว่ายอดที่ได้ตรงกับที่ตั้งใจ ─────────────────────────────────
// 🔴 ไม่ได้เขียนยอดรวมลงฐานข้อมูลเลย — ให้ RPC เดียวกับที่หน้าจอใช้เป็นคนบวก
// แล้วเทียบกับตัวเลขที่ seed ตั้งใจไว้ · เดโม่ที่โชว์สองตัวเลขขัดกัน
// ทำให้คนดูเลิกเชื่อทั้งหน้า
console.log('\n── ตรวจยอด ─────────────────────────────────────────────────')
const problems = []
const money = await sql(`
  select s.name, m.contract_amount, m.income_approved, m.cost_expense, m.cost_wage, m.cost_total
  from public.sites s
  cross join lateral (
    select
      coalesce(f.contract_amount, 0) as contract_amount,
      coalesce((select sum(t.amount) from public.transactions t
                where t.site_id = s.id and t.kind='income' and t.status='approved'), 0) as income_approved,
      coalesce((select sum(t.amount) from public.transactions t
                where t.site_id = s.id and t.kind='expense' and t.status='approved'), 0) as cost_expense,
      coalesce((select sum(aw.amount) from public.attendance a
                join public.attendance_wages aw on aw.attendance_id = a.id
                where a.site_id = s.id), 0) as cost_wage,
      0 as cost_total
    from public.site_finance f where f.site_id = s.id
  ) m
  where s.name in (${q('บ้านคุณสมศักดิ์ ต.บ่อแฮ้ว')}, ${q('โกดังโรงงานเซรามิกลำปาง')})
  order by s.name`)

for (const row of money) {
  const contract = Number(row.contract_amount)
  const income = Number(row.income_approved)
  const cost = Number(row.cost_expense) + Number(row.cost_wage)
  const paidPct = Math.round((income / contract) * 100)
  const costPct = Math.round((cost / contract) * 100)
  console.log(
    `  ${row.name}\n` +
    `    ค่างาน ฿${contract.toLocaleString()} · เก็บแล้ว ฿${income.toLocaleString()} (${paidPct}%)` +
    ` · ต้นทุน ฿${cost.toLocaleString()} (${costPct}%) · กำไรคงเหลือ ฿${(contract - cost).toLocaleString()}`,
  )
  if (row.name.startsWith('บ้านคุณสมศักดิ์')) {
    if (income !== 2280000) problems.push(`โครงการ A เก็บเงินควรเป็น ฿2,280,000 แต่ได้ ฿${income}`)
    if (paidPct <= costPct) problems.push('โครงการ A ไม่ควรขึ้นป้ายต้นทุนแซง')
  }
  if (row.name.startsWith('โกดัง')) {
    if (income !== 1680000) problems.push(`โครงการ B เก็บเงินควรเป็น ฿1,680,000 แต่ได้ ฿${income}`)
    if (costPct <= paidPct) problems.push('โครงการ B ต้องขึ้นป้ายต้นทุนแซง แต่ต้นทุนยังไม่แซง')
  }
}

const [{ n: pending }] = await sql(
  "select count(*)::int n from public.transactions where status = 'pending'")
const [{ n: notif }] = await sql('select count(*)::int n from public.notifications')
console.log(`  รออนุมัติ ${pending} รายการ · แจ้งเตือนที่ trigger สร้างให้ ${notif} ใบ`)
if (Number(pending) !== 3) problems.push(`ควรมีรายการรออนุมัติ 3 รายการ แต่ได้ ${pending}`)

const [{ n: overCeiling }] = await sql(`
  select count(*)::int n from public.employees e
  cross join lateral public.employee_balance_raw(e.id) b
  where b.balance < 0`)
if (Number(overCeiling) > 0) problems.push(`มีคนที่ยอดค้างจ่ายติดลบ ${overCeiling} คน`)

console.log('\n══════════════════════════════════════════════')
if (problems.length > 0) {
  for (const p of problems) console.log(`  ❌ ${p}`)
  console.log(`  ${problems.length} จุดที่ยอดไม่ตรงกับที่ตั้งใจ`)
  process.exit(1)
}
console.log('  ✅ ยอดทุกตัวตรงกับที่ seed ตั้งใจไว้')
