#!/usr/bin/env node
/**
 * verify-notify.mjs — ปิดแถว P3-DB-* ใน docs/test-plan/P3.md
 *
 * ยิง PostgREST **ในนามของแต่ละ role จริง ๆ** ไม่ใช่ผ่าน Management API
 * เพราะ trigger ทั้งชุดอ่าน `auth.uid()` — คำสั่งที่รันด้วย service role
 * จะได้ `null` แล้วเส้นทางที่อยากทดสอบจะไม่เคยถูกเดินเลย
 *
 * 🔴 ทุกแถวที่ตรวจ "มองไม่เห็น" ต้องมีฝั่ง "มองเห็น > 0" ในการตรวจเดียวกัน
 * ไม่งั้น 0 แถวอาจแปลว่าไม่มีข้อมูลตั้งแต่แรก ซึ่งผ่านเหมือนกันแต่ไม่ได้พิสูจน์อะไร
 *
 * fixture ทุกตัวคืนค่าใน finally
 */
import { readFileSync } from 'node:fs'
import { derivePassword, syntheticEmail } from '../src/lib/pin-core.ts'

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

async function signIn(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: PUB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`sign-in ล้มเหลว ${email}: ${JSON.stringify(j).slice(0, 200)}`)
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
const asService = (path, init = {}) =>
  db(SECRET, path, { ...init, headers: { apikey: SECRET, ...init.headers } })

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

console.log('\n── P3-DB · แจ้งเตือนในแอป ──────────────────────────────────')

const ownerTok = await signIn(env.SEED_OWNER_EMAIL, env.SEED_OWNER_PASSWORD)
const supTok = await signIn(
  syntheticEmail('sup1'),
  derivePassword(env.PIN_PEPPER, env.SEED_SUPERVISOR1_PIN),
)

const [owner] = (await asService('/profiles?select=id&role=eq.owner')).body
const [sup1] = (await asService(
  `/profiles?select=id&full_name=eq.${encodeURIComponent(env.SEED_SUPERVISOR1_NAME)}`)).body
const [expCat] = (await asService('/categories?select=id&kind=eq.expense&order=sort_order&limit=1')).body
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

/**
 * จำนวนแจ้งเตือนของคนหนึ่ง — นับด้วย `count=exact` ในฐานข้อมูล
 * ไม่ใช่ดึงแถวมานับใน JS ซึ่งจะเพี้ยนเงียบ ๆ ที่ 1,000 แถว
 */
const countFor = async (userId, extra = '') => {
  const r = await fetch(
    `${URL}/rest/v1/notifications?select=id&user_id=eq.${userId}${extra}`,
    { headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, Prefer: 'count=exact', Range: '0-0' } },
  )
  return Number(/\/(\d+)$/.exec(r.headers.get('content-range') ?? '')?.[1] ?? -1)
}
/**
 * แจ้งเตือนของรายการนี้ — ผูกด้วย `txn_id` ไม่ใช่จับสตริงยอดเงินในข้อความ
 * สองรายการยอดเท่ากันมีได้ทุกวัน ตัวตรวจที่จับสตริงจะสับสนทันทีที่เกิดขึ้น
 */
const byTxn = async (userId, txnId, kind) => {
  const r = await asService(
    `/notifications?select=id,kind,title,body,link,read_at,txn_id&user_id=eq.${userId}` +
    `&txn_id=eq.${txnId}` + (kind ? `&kind=eq.${kind}` : ''))
  return r.body ?? []
}

const since = new Date(Date.now() - 5000).toISOString()
let siteId = null
const made = []

const mkTxn = async (token, amount, note) => {
  const r = await db(token, '/transactions', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      kind: 'expense', site_id: siteId, category_id: expCat.id,
      amount, txn_date: today, pay_method: 'cash', note,
    }),
  })
  const row = Array.isArray(r.body) ? r.body[0] : null
  if (row) made.push(row.id)
  return { r, row }
}

try {
  ;[{ id: siteId }] = (await sql(
    "insert into public.sites(name, status) values ('ทดสอบแจ้งเตือน ไซต์ก', 'active') returning id")).rows
  await sql(`insert into public.site_supervisors(site_id, profile_id)
             values ('${siteId}','${sup1.id}')`)

  // ── P3-DB-01 · หัวหน้าไซต์คีย์ → เจ้าของได้แจ้งเตือน ──────────────
  {
    const before = await countFor(owner.id)
    const { row } = await mkTxn(supTok, 11111, 'ค่าปูนทดสอบแจ้งเตือน')
    const after = await countFor(owner.id)
    const notes = await byTxn(owner.id, row.id, 'txn_pending')
    check('P3-DB-01 หัวหน้าไซต์คีย์รายจ่าย → เจ้าของได้แจ้งเตือน txn_pending 1 ใบ ลิงก์ /approvals',
      Boolean(row) && after - before === 1 && notes.length === 1
      && notes[0].link === '/approvals' && notes[0].title.includes('รออนุมัติ'),
      `+${after - before} ใบ · link=${notes[0]?.link}`)
  }

  // ── P3-DB-02 · เจ้าของคีย์เอง → ไม่มีแจ้งเตือนใคร ──────────────────
  // 🔴 ต้องมีฝั่งบวกในบล็อกเดียวกัน ไม่งั้น "ไม่เพิ่ม" อาจแปลว่า trigger ตายไปแล้ว
  {
    const beforeO = await countFor(owner.id)
    const beforeS = await countFor(sup1.id)
    await mkTxn(ownerTok, 22222, 'ค่าน้ำมันเจ้าของคีย์เอง')
    const midO = await countFor(owner.id)
    const midS = await countFor(sup1.id)
    await mkTxn(supTok, 33333, 'ค่าเหล็กทดสอบแจ้งเตือน')
    const afterO = await countFor(owner.id)
    check('P3-DB-02 เจ้าของคีย์เอง (เข้าเป็น approved ทันที) → ไม่มีแจ้งเตือนใหม่เลย · ของหัวหน้าไซต์ยังเพิ่มปกติ',
      midO === beforeO && midS === beforeS && afterO === midO + 1,
      `เจ้าของคีย์ +${midO - beforeO} · หัวหน้าไซต์คีย์ +${afterO - midO}`)
  }

  // ── P3-DB-03 · อนุมัติ → คนคีย์ได้แจ้งเตือน ───────────────────────
  {
    const beforeO = await countFor(owner.id)
    const r = await db(ownerTok, `/transactions?id=eq.${made[0]}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'approved' }),
    })
    const notes = await byTxn(sup1.id, made[0], 'txn_approved')
    const afterO = await countFor(owner.id)
    check('P3-DB-03 เจ้าของอนุมัติ → คนคีย์ได้ txn_approved 1 ใบ · เจ้าของไม่ได้แจ้งเตือนตัวเอง',
      r.status === 200 && notes.length === 1 && afterO === beforeO,
      `${r.status} · ถึงคนคีย์ ${notes.length} ใบ · ถึงเจ้าของ +${afterO - beforeO}`)
  }

  // ── P3-DB-15 · กดอนุมัติซ้ำ ต้องไม่สแปมใบที่สอง ────────────────────
  {
    await db(ownerTok, `/transactions?id=eq.${made[0]}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'approved' }),
    })
    const notes = await byTxn(sup1.id, made[0], 'txn_approved')
    check('P3-DB-15 อนุมัติรายการเดิมซ้ำ → แจ้งเตือน txn_approved ของรายการนั้นยังมีใบเดียว',
      notes.length === 1, `${notes.length} ใบ`)
  }

  // ── P3-DB-04 · ตีกลับ → เหตุผลจริงอยู่ในข้อความ ───────────────────
  const REASON = 'สลิปเบลอ อ่านยอดไม่ออก'
  {
    const r = await db(ownerTok, `/transactions?id=eq.${made[2]}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'rejected', rejected_reason: REASON }),
    })
    const notes = await byTxn(sup1.id, made[2], 'txn_rejected')
    check('P3-DB-04 เจ้าของตีกลับ → คนคีย์ได้ txn_rejected ที่ body มีเหตุผลจริง ไม่ใช่ข้อความลอย ๆ',
      r.status === 200 && notes.length === 1 && (notes[0]?.body ?? '').includes(REASON),
      `${r.status} · body=${(notes[0]?.body ?? '').slice(0, 40)}`)
  }

  // ── P3-DB-16 · ครบทั้งสามชนิด ─────────────────────────────────────
  {
    const { rows } = await sql(
      `select kind, count(*)::int c from public.notifications where created_at >= '${since}' group by kind`)
    const got = new Set(rows.map((r) => r.kind))
    check('P3-DB-16 เกิดแจ้งเตือนครบทั้งสามชนิดจริง (txn_pending · txn_approved · txn_rejected)',
      ['txn_pending', 'txn_approved', 'txn_rejected'].every((k) => got.has(k)),
      [...got].join(', '))
  }

  // ── P3-DB-05 · หัวหน้าไซต์เห็นเฉพาะของตัวเอง ──────────────────────
  {
    const mine = await db(supTok, `/notifications?select=id,user_id&user_id=eq.${sup1.id}`)
    const others = await db(supTok, `/notifications?select=id,user_id&user_id=eq.${owner.id}`)
    check('P3-DB-05 หัวหน้าไซต์เห็นแจ้งเตือนของตัวเอง > 0 และเห็นของเจ้าของ 0 แถว',
      (mine.body?.length ?? 0) > 0 && (others.body?.length ?? 0) === 0,
      `ของตัวเอง ${mine.body?.length} · ของเจ้าของ ${others.body?.length}`)
  }

  // ── P3-DB-06 · anon ───────────────────────────────────────────────
  {
    const a = await db('anon', '/notifications?select=id')
    const o = await db(ownerTok, '/notifications?select=id')
    check('P3-DB-06 anon อ่านแจ้งเตือนได้ 0 แถว และเจ้าของอ่านได้ > 0',
      (Array.isArray(a.body) ? a.body.length : 0) === 0 && (o.body?.length ?? 0) > 0,
      `anon ${a.status}/${Array.isArray(a.body) ? a.body.length : 'ไม่ใช่ลิสต์'} · owner ${o.body?.length}`)
  }

  // ── P3-DB-07 · client เขียนแจ้งเตือนเองไม่ได้ ─────────────────────
  {
    const before = await countFor(owner.id)
    const r = await db(supTok, '/notifications', {
      method: 'POST',
      body: JSON.stringify({
        user_id: owner.id, kind: 'txn_pending', title: 'แจ้งเตือนปลอม', link: '/',
      }),
    })
    const after = await countFor(owner.id)
    // ฝั่งบวก: trigger ยังเขียนได้ในคำสั่งถัดไป
    await mkTxn(supTok, 44444, 'ค่าไม้แบบทดสอบแจ้งเตือน')
    const viaTrigger = await countFor(owner.id)
    check('P3-DB-07 client ยิง insert เข้า notifications ตรง ๆ ไม่ผ่าน · trigger ยังเขียนได้',
      r.status >= 400 && after === before && viaTrigger === after + 1,
      `${r.status} · client +${after - before} · trigger +${viaTrigger - after}`)
  }

  // ── P3-DB-08 · แก้ได้เฉพาะ read_at ────────────────────────────────
  {
    const [mine] = (await db(supTok, `/notifications?select=id&user_id=eq.${sup1.id}&limit=1`)).body
    const bad = await db(supTok, `/notifications?id=eq.${mine.id}`, {
      method: 'PATCH', body: JSON.stringify({ title: 'แก้หัวข้อเอง' }),
    })
    const good = await db(supTok, `/notifications?id=eq.${mine.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ read_at: new Date().toISOString() }),
    })
    const readAt = Array.isArray(good.body) ? good.body[0]?.read_at : null
    check('P3-DB-08 แก้ title ถูกปฏิเสธด้วย NOTIFICATION_READONLY · แก้ read_at สำเร็จจริง',
      /NOTIFICATION_READONLY/.test(bad.raw ?? '') && good.status === 200 && Boolean(readAt),
      `bad ${bad.status} · good ${good.status} read_at=${Boolean(readAt)}`)
  }

  // ── P3-DB-09 · ลบไม่ได้ ───────────────────────────────────────────
  {
    const before = await countFor(sup1.id)
    const r = await db(supTok, `/notifications?user_id=eq.${sup1.id}`, { method: 'DELETE' })
    const after = await countFor(sup1.id)
    check('P3-DB-09 หัวหน้าไซต์ลบแจ้งเตือนตัวเองไม่ได้ · จำนวนเท่าเดิม',
      after === before && before > 0, `${before} → ${after} (สถานะ ${r.status})`)
  }

  // ── P3-DB-12 · broadcast ลง realtime.messages ─────────────────────
  // 🔴 `realtime.send()` กลืน error ทุกชนิดเป็นแค่ WARNING (ดูตัวฟังก์ชันได้ใน
  // `pg_proc`) · ถ้า partition ของ `realtime.messages` สำหรับวันนี้ยังไม่ถูกสร้าง
  // insert จะล้มเหลวเงียบ ๆ แล้วแจ้งเตือนจะ**ไม่ถูกส่งเลย** โดยไม่มี error ที่ไหน
  // — trigger รัน · transaction commit · ทุกอย่างดูปกติ · แถวนี้คือตัวที่จับได้
  {
    const { rows } = await sql(
      `select topic, event from realtime.messages
       where inserted_at >= '${since}' and topic = 'notif:${sup1.id}' and event = 'new'`)
    const { rows: parts } = await sql(
      `select count(*)::int n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'realtime' and c.relkind = 'r' and c.relname like 'messages\\_%'`)
    check('P3-DB-12 มีแจ้งเตือนใหม่ → realtime.messages ได้ข้อความ topic notif:<user_id> event new',
      rows.length > 0, `${rows.length} ข้อความ · partition ที่มีอยู่ ${parts[0]?.n} วัน`)
  }

  // ── P3-DB-13 · index ──────────────────────────────────────────────
  {
    const { rows } = await sql(
      "select indexdef from pg_indexes where schemaname='public' and tablename='notifications'")
    const defs = rows.map((r) => r.indexdef).join('\n')
    const hasList = /\(user_id, created_at DESC\)/i.test(defs)
    const hasUnread = /\(user_id\)[\s\S]*WHERE \(read_at IS NULL\)/i.test(defs)
    check('P3-DB-13 index (user_id, created_at desc) และ partial index ของที่ยังไม่อ่าน มีจริง',
      hasList && hasUnread, `list=${hasList} unread=${hasUnread}`)
  }

  // ── P3-DB-18 · ลบรายการ → แจ้งเตือนของรายการนั้นหายตาม ────────────
  // แจ้งเตือนที่ชี้ไปหาของที่ถูกลบไปแล้วคือกระดิ่งที่โกหก — กดแล้วไม่เจออะไร
  {
    const { row } = await mkTxn(supTok, 55555, 'ค่าทรายทดสอบลบแล้วแจ้งเตือนต้องหาย')
    const before = await byTxn(owner.id, row.id, null)
    await db(supTok, `/transactions?id=eq.${row.id}`, { method: 'DELETE' })
    const after = await byTxn(owner.id, row.id, null)
    check('P3-DB-18 ลบรายการที่ยังไม่อนุมัติ → แจ้งเตือนของรายการนั้นหายตามไปด้วย',
      before.length === 1 && after.length === 0,
      `ก่อนลบ ${before.length} ใบ → หลังลบ ${after.length} ใบ`)
  }

  // ── P3-DB-17 · audit trigger ──────────────────────────────────────
  {
    const { rows } = await sql(
      `select tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where c.relname = 'notifications' and not t.tgisinternal`)
    const names = rows.map((r) => r.tgname)
    check('P3-DB-17 notifications มี trigger ครบ: audit · guard · broadcast',
      names.includes('notifications_audit') && names.includes('notifications_guard')
      && names.includes('notifications_broadcast'),
      names.join(', '))
  }
} finally {
  if (siteId) {
    await sql(`delete from public.transactions where site_id = '${siteId}'`)
    await sql(`delete from public.site_supervisors where site_id = '${siteId}'`)
    await sql(`delete from public.site_finance where site_id = '${siteId}'`)
    await sql(`delete from public.sites where id = '${siteId}'`)
  }
  await sql(`delete from public.transactions where note = 'ค่าน้ำมันเจ้าของคีย์เอง'`)
  // แจ้งเตือนหายไปเองกับ `on delete cascade` ของ `txn_id` — เหลือแค่ใบที่ไม่ผูก
  // รายการใด ซึ่งมีได้เฉพาะตอน red-test ที่เปิด insert policy ทิ้งไว้
  await sql(`delete from public.notifications where txn_id is null and created_at >= '${since}'`)
  console.log('  (ลบข้อมูลทดสอบแล้ว)')
}

// ── P3-DB-10 · RLS เปิดทุกตาราง ─────────────────────────────────────
{
  const { rows } = await sql(
    "select count(*)::int off from pg_tables where schemaname='public' and not rowsecurity")
  const { rows: all } = await sql(
    "select count(*)::int n from pg_tables where schemaname='public'")
  check('P3-DB-10 ทุกตารางใน public เปิด RLS · ไม่มีตารางไหนหลุด',
    Number(rows[0].off) === 0 && Number(all[0].n) >= 14,
    `ปิดอยู่ ${rows[0].off} จาก ${all[0].n} ตาราง`)
}

// ── P3-DB-11 · advisors ─────────────────────────────────────────────
{
  const get = async (kind) => {
    const r = await fetch(
      `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/advisors/${kind}`,
      { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })
    const j = await r.json()
    return (j.lints ?? []).filter((l) => l.level === 'ERROR').length
  }
  const [sec, perf] = [await get('security'), await get('performance')]
  check('P3-DB-11 advisors ไม่มี ERROR ทั้ง security และ performance',
    sec === 0 && perf === 0, `security ${sec} · performance ${perf}`)
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
