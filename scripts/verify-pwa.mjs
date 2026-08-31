#!/usr/bin/env node
/**
 * verify-pwa.mjs — ปิดแถว P7-INF-* · P7-DB-* · P7-API-* · P7-UI-01..04
 *
 * 🔴 ทุกอย่างในเฟสนี้พังเงียบ — `sw.js` ที่โดน 307 ไม่ทำให้หน้าไหนพัง
 * แค่ทำให้ติดตั้งแอปไม่ได้และ push ตายทั้งระบบ · ตรวจตอนไม่ล็อกอินเสมอ
 * เพราะตอนพัฒนาเราล็อกอินอยู่ตลอด จึงไม่มีวันเจอด้วยตัวเอง
 */
import { readFileSync } from 'node:fs'
import { derivePassword, syntheticEmail } from '../src/lib/pin-core.ts'

const BASE = process.argv[2] ?? 'http://localhost:3100'
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
const countSubs = async (filter = '') =>
  Number((await sql(`select count(*)::int n from public.push_subscriptions ${filter}`)).rows[0].n)

console.log('\n── P7 · PWA + web push ──────────────────────────────────────')

// ── P7-INF-01 · sw.js ตอนยังไม่ล็อกอิน ──────────────────────────────
{
  const r = await fetch(`${BASE}/sw.js`, { redirect: 'manual' })
  const ct = r.headers.get('content-type') ?? ''
  check('P7-INF-01 GET /sw.js ตอนยังไม่ล็อกอิน → 200 ไม่ใช่ 307 (spec ห้าม SW ถูกเสิร์ฟผ่าน redirect)',
    r.status === 200 && /javascript/.test(ct), `${r.status} ${ct.split(';')[0]}`)
}

// ── P7-INF-04 · header ของ sw.js ────────────────────────────────────
{
  const r = await fetch(`${BASE}/sw.js`, { redirect: 'manual' })
  const cc = r.headers.get('cache-control') ?? ''
  check('P7-INF-04 /sw.js มี Cache-Control no-cache/no-store — SW ที่ถูกแคชทำให้ค้างตัวเก่าตลอดไป',
    /no-cache|no-store/.test(cc), cc || '(ไม่มี header)')
}

// ── P7-INF-02 + P7-INF-03 · manifest ────────────────────────────────
{
  const r = await fetch(`${BASE}/manifest.webmanifest`, { redirect: 'manual' })
  const ct = r.headers.get('content-type') ?? ''
  const j = await r.json().catch(() => ({}))
  check('P7-INF-02 GET /manifest.webmanifest ตอนยังไม่ล็อกอิน → 200 · content-type ถูกต้อง',
    r.status === 200 && ct.includes('manifest+json'), `${r.status} ${ct.split(';')[0]}`)

  const [{ company_name: real }] = (await sql('select company_name from public.branding')).rows
  check('P7-INF-03 ชื่อในไฟล์ manifest = ชื่อบริษัทในฐานข้อมูล ไม่ใช่ค่าคงที่ในโค้ด',
    typeof j.name === 'string' && j.name === real && j.display === 'standalone',
    `manifest="${j.name}" · ฐานข้อมูล="${real}"`)

  // 🔴 ป้ายใต้ไอคอนบนหน้าจอโฮม — `slice(0, 12)` ตรง ๆ ทำให้
  // "บริษัท คอสซี่ คอนสตรัคชั่น จำกัด" กลายเป็น "บริษัท คอสซี" คือเสียที่ไป
  // กับคำว่า "บริษัท" แล้วตัดคาคำ · ต้องไม่ขึ้นต้นด้วยคำนำหน้าทางกฎหมาย
  // และต้องไม่ตัดกลางคำ (คำสุดท้ายที่เหลือต้องเป็นคำเต็มของชื่อจริง)
  const short = typeof j.short_name === 'string' ? j.short_name : ''
  const startsWithLegalPrefix = /^(บริษัท|บมจ|หจก|ห้าง|ร้าน)\b/u.test(short)
  const wholeWords = short.length > 0
    && short.split(/\s+/).every((w) => real.split(/\s+/).includes(w))
  check('P7-INF-03b short_name ของ manifest ไม่ขึ้นต้นด้วย "บริษัท" และไม่ตัดคาคำ',
    short.length > 0 && short.length <= 12 && !startsWithLegalPrefix && wholeWords,
    `short_name="${short}" (${short.length} ตัว) จาก "${real}"`)
}

// ── P7-INF-05 · ไอคอนเป็น PNG จริง ──────────────────────────────────
{
  const files = ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png']
  const bad = []
  for (const f of files) {
    const r = await fetch(`${BASE}${f}`, { redirect: 'manual' })
    const buf = Buffer.from(await r.arrayBuffer())
    // ลายเซ็น PNG · เปลี่ยนนามสกุลไฟล์ SVG เป็น .png แล้วเบราว์เซอร์จะไม่แสดงเลย
    const isPng = buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
    if (r.status !== 200 || !isPng) bad.push(`${f}(${r.status})`)
  }
  check('P7-INF-05 ไอคอนทั้งสามไฟล์ตอบ 200 และเป็น PNG จริง (ตรวจลายเซ็นไฟล์)',
    bad.length === 0, bad.length ? bad.join(' ') : `${files.length}/${files.length}`)
}

// ── P7-INF-06 · หน้า offline ────────────────────────────────────────
{
  const r = await fetch(`${BASE}/offline.html`, { redirect: 'manual' })
  const html = await r.text()
  check('P7-INF-06 GET /offline.html → 200 · มีข้อความภาษาไทยบอกว่าออฟไลน์',
    r.status === 200 && html.includes('ออฟไลน์'), `${r.status}`)
}

// ── P7-INF-08 + P7-INF-09 · เนื้อใน sw.js ───────────────────────────
{
  const src = await (await fetch(`${BASE}/sw.js`)).text()
  const handlers = ['push', 'notificationclick', 'fetch', 'install', 'activate']
    .filter((h) => src.includes(`addEventListener('${h}'`))
  check('P7-INF-08 sw.js มี handler ครบ: install · activate · fetch · push · notificationclick',
    handlers.length === 5, handlers.join(', '))

  // ตัดคอมเมนต์ก่อน — คอมเมนต์ที่อธิบายว่า "ห้ามแคช /api" จะทำให้ตัวตรวจแดงเอง
  const code = src.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  check('P7-INF-09 sw.js ไม่แคชคำตอบของ /api หรือหน้าที่มีข้อมูล — ตัวเลขเงินเก่าที่ดูเหมือนใหม่แย่กว่าโหลดไม่ขึ้น',
    !/cache\.put|caches\.open\([^)]*\)\.then\([^)]*put/.test(code) && !code.includes("'/api"),
    'แคชเฉพาะ shell กับหน้า offline')
}

const ownerJar = jarOf(await req('POST', '/api/auth/login', {
  email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }))
const supJar = jarOf(await req('POST', '/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN }))
if (!ownerJar || !supJar) throw new Error('ล็อกอินไม่สำเร็จ — dev server รันอยู่ไหม')
const ownerTok = await signIn(env.SEED_OWNER_EMAIL, env.SEED_OWNER_PASSWORD)
const supTok = await signIn(
  syntheticEmail('sup1'), derivePassword(env.PIN_PEPPER, env.SEED_SUPERVISOR1_PIN))

const ENDPOINT = 'https://fcm.googleapis.com/wp/ทดสอบ-pwa-endpoint-1'
const OTHER = 'https://fcm.googleapis.com/wp/ทดสอบ-pwa-endpoint-2'

try {
  // ── P7-INF-07 · <head> ──────────────────────────────────────────
  {
    const html = await page('/', ownerJar)
    check('P7-INF-07 <head> มี rel="manifest" และ apple-touch-icon (Safari ไม่อ่านไอคอนจาก manifest)',
      html.includes('rel="manifest"') && html.includes('apple-touch-icon'),
      `manifest=${html.includes('rel="manifest"')} · apple=${html.includes('apple-touch-icon')}`)
  }

  // ── P7-API-01 · /api/branding ตอนไม่ล็อกอิน ─────────────────────
  {
    const r = await fetch(`${BASE}/api/branding`, { redirect: 'manual' })
    const j = await r.json().catch(() => ({}))
    check('P7-API-01 GET /api/branding ตอนยังไม่ล็อกอิน → 200 + ชื่อบริษัท (ไม่ใช่ 307)',
      r.status === 200 && typeof j.companyName === 'string' && j.companyName.length > 0,
      `${r.status} "${j.companyName}"`)
  }

  // ── P7-API-02 · subscribe ตอนไม่ล็อกอิน ─────────────────────────
  {
    const before = await countSubs()
    const r = await req('POST', '/api/push/subscribe', {
      endpoint: ENDPOINT, keys: { p256dh: 'x', auth: 'y' } })
    const ct = r.headers.get('content-type') ?? ''
    const after = await countSubs()
    check('P7-API-02 subscribe ตอนไม่ล็อกอิน → 401 JSON · ไม่มีแถวใหม่',
      r.status === 401 && ct.startsWith('application/json') && after === before,
      `${r.status} · ${before}→${after}`)
  }

  // ── P7-API-05 · payload ไม่ครบ ──────────────────────────────────
  {
    const before = await countSubs()
    const bad = []
    for (const body of [
      { endpoint: ENDPOINT },
      { endpoint: 'ไม่ใช่ url', keys: { p256dh: 'x', auth: 'y' } },
      { keys: { p256dh: 'x', auth: 'y' } },
    ]) {
      const r = await req('POST', '/api/push/subscribe', body, ownerJar)
      bad.push(r.status)
    }
    const after = await countSubs()
    check('P7-API-05 subscribe ด้วย payload ที่ไม่ครบ → 400 ทุกแบบ · ไม่มีแถวใหม่',
      bad.every((s) => s === 400) && after === before, bad.join(' '))
  }

  // ── P7-API-03 + P7-API-04 · subscribe และ subscribe ซ้ำ ─────────
  {
    const before = await countSubs()
    const r1 = await req('POST', '/api/push/subscribe', {
      endpoint: ENDPOINT, keys: { p256dh: 'key-p256', auth: 'key-auth' } }, ownerJar)
    const mid = await countSubs()
    const r2 = await req('POST', '/api/push/subscribe', {
      endpoint: ENDPOINT, keys: { p256dh: 'key-p256', auth: 'key-auth' } }, ownerJar)
    const after = await countSubs()
    const [{ id: ownerId }] = (await sql("select id from public.profiles where role='owner' limit 1")).rows
    const [row] = (await sql(
      `select user_id from public.push_subscriptions where endpoint = '${ENDPOINT}'`)).rows
    check('P7-API-03 subscribe → 201 · push_subscriptions +1 · user_id เป็นตัวเอง',
      r1.status === 201 && mid === before + 1 && row?.user_id === ownerId,
      `${r1.status} · +${mid - before}`)
    check('P7-API-04 subscribe ซ้ำ endpoint เดิม → 201 และยังมีแถวเดียว (เบราว์เซอร์คืนตัวเดิมทุกครั้ง)',
      r2.status === 201 && after === mid, `${r2.status} · ${mid}→${after}`)
  }

  // ── P7-DB-01 + P7-DB-02 · สิทธิ์ ────────────────────────────────
  {
    // หัวหน้าไซต์มี subscription ของตัวเองด้วย เพื่อให้ฝั่งบวกมีของจริง
    await req('POST', '/api/push/subscribe', {
      endpoint: OTHER, keys: { p256dh: 'k', auth: 'a' } }, supJar)
    const supOwn = await db(supTok, '/push_subscriptions?select=id,endpoint')
    const ownerOwn = await db(ownerTok, '/push_subscriptions?select=id,endpoint')
    const supSeesOthers = (supOwn.body ?? []).some((s) => s.endpoint === ENDPOINT)
    check('P7-DB-01 แต่ละคนเห็นเฉพาะ subscription ของตัวเอง — ไม่เห็นของอีกคนในการตรวจเดียวกัน',
      (supOwn.body?.length ?? 0) > 0 && (ownerOwn.body?.length ?? 0) > 0 && !supSeesOthers,
      `หัวหน้าไซต์ ${supOwn.body?.length} · เจ้าของ ${ownerOwn.body?.length} · เห็นของกันและกัน=${supSeesOthers}`)

    const anon = await db('anon', '/push_subscriptions?select=id')
    check('P7-DB-02 anon อ่าน push_subscriptions ได้ 0 แถว',
      (Array.isArray(anon.body) ? anon.body.length : -1) === 0,
      `${anon.status}/${Array.isArray(anon.body) ? anon.body.length : '?'}`)
  }

  // ── P7-DB-03 · endpoint unique ──────────────────────────────────
  {
    const r = await sql(
      `insert into public.push_subscriptions(user_id, endpoint, p256dh, auth)
       select user_id, '${ENDPOINT}', 'x', 'y' from public.push_subscriptions
       where endpoint = '${ENDPOINT}'`)
    check('P7-DB-03 endpoint ซ้ำถูกปฏิเสธ (unique) — เครื่องเดียวสองแถวคือแจ้งเตือนซ้ำสองครั้ง',
      Boolean(r.error) && /duplicate key|unique/.test(r.error ?? ''),
      r.error ? 'unique ทำงาน' : 'ซ้ำได้ — ผิด')
  }

  // ── P7-DB-04 + P7-DB-05 · คอลัมน์ index trigger ─────────────────
  {
    const { rows: cols } = await sql(`
      select column_name from information_schema.columns
      where table_schema='public' and table_name='notifications'
        and column_name in ('pushed_at','read_at')`)
    const { rows: idx } = await sql(
      "select indexdef from pg_indexes where schemaname='public' and tablename='notifications'")
    const hasIdx = idx.some((i) => /pushed_at IS NULL/i.test(i.indexdef))
    check('P7-DB-04 notifications.pushed_at มีจริง แยกจาก read_at · มี partial index ของที่ยังไม่ส่ง',
      cols.length === 2 && hasIdx, `คอลัมน์ ${cols.length}/2 · index=${hasIdx}`)

    const { rows: tg } = await sql(
      `select t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where c.relname = 'push_subscriptions' and not t.tgisinternal`)
    const { rows: rls } = await sql(
      "select rowsecurity from pg_tables where schemaname='public' and tablename='push_subscriptions'")
    check('P7-DB-05 push_subscriptions มี audit trigger และเปิด RLS',
      tg.some((t) => t.tgname === 'push_subscriptions_audit') && rls[0]?.rowsecurity === true,
      tg.map((t) => t.tgname).join(', '))
  }

  // ── P7-API-07 · dispatch ไม่มี secret ───────────────────────────
  {
    const r = await fetch(`${BASE}/api/cron/push-dispatch`, { redirect: 'manual' })
    const b = await r.json().catch(() => ({}))
    check('P7-API-07 dispatch โดยไม่มี CRON_SECRET → 401',
      r.status === 401 && b.error === 'UNAUTHENTICATED', `${r.status} ${b.error}`)
  }

  // ── P7-API-08 + P7-API-09 · dispatch จริง ───────────────────────
  {
    // สร้างแจ้งเตือนที่ยังไม่ถูกส่งขึ้นมาจริง — ห้ามให้แถวนี้ผ่านบนคิวว่าง
    const [{ id: ownerId }] = (await sql("select id from public.profiles where role='owner' limit 1")).rows
    await sql(`insert into public.notifications(user_id, kind, title, body, link)
               values ('${ownerId}', 'txn_pending', 'ทดสอบ push', 'ทดสอบ', '/approvals')`)
    const pendingBefore = Number((await sql(
      'select count(*)::int n from public.notifications where pushed_at is null')).rows[0].n)

    const r = await fetch(
      `${BASE}/api/cron/push-dispatch?secret=${encodeURIComponent(env.CRON_SECRET)}`,
      { redirect: 'manual' })
    const b = await r.json().catch(() => ({}))
    const pendingAfter = Number((await sql(
      'select count(*)::int n from public.notifications where pushed_at is null')).rows[0].n)

    check('P7-API-08 dispatch พร้อม secret → 200 · แจ้งเตือนที่ค้างถูกมาร์คว่าส่งแล้ว แม้ปลายทางส่งไม่ผ่าน',
      r.status === 200 && pendingBefore > 0 && pendingAfter === 0 && Number(b.marked) === pendingBefore,
      `${r.status} · ค้าง ${pendingBefore}→${pendingAfter} · marked=${b.marked} · removed=${b.removed}`)

    const r2 = await fetch(
      `${BASE}/api/cron/push-dispatch?secret=${encodeURIComponent(env.CRON_SECRET)}`,
      { redirect: 'manual' })
    const b2 = await r2.json().catch(() => ({}))
    check('P7-API-09 dispatch รอบที่สอง → marked = 0 · ไม่ส่งซ้ำของเดิม',
      r2.status === 200 && Number(b2.marked) === 0, `marked=${b2.marked}`)
  }

  // ── P7-API-06 · unsubscribe ─────────────────────────────────────
  {
    const before = await countSubs(`where endpoint = '${ENDPOINT}'`)
    const r = await req('DELETE', '/api/push/subscribe', { endpoint: ENDPOINT }, ownerJar)
    const after = await countSubs(`where endpoint = '${ENDPOINT}'`)
    check('P7-API-06 DELETE /api/push/subscribe → 200 · แถวหายไปจริง',
      r.status === 200 && before === 1 && after === 0, `${r.status} · ${before}→${after}`)
  }

  // ── P7-UI-01 + P7-UI-02 · การ์ดในหน้าตั้งค่า ────────────────────
  {
    const ownerHtml = await page('/settings', ownerJar)
    const supHtml = await page('/settings', supJar)
    check('P7-UI-01 หน้า /settings ของเจ้าของมีการ์ด "แจ้งเตือนบนเครื่องนี้"',
      ownerHtml.includes('แจ้งเตือนบนเครื่องนี้') && ownerHtml.includes('data-push-state'),
      'มีการ์ดและจุดยึดสถานะ')
    check('P7-UI-02 หัวหน้าไซต์ก็เห็นการ์ดเดียวกัน — แจ้งเตือนไม่ใช่เรื่องเงิน',
      supHtml.includes('แจ้งเตือนบนเครื่องนี้'), 'เห็นเหมือนกัน')
  }

  // ── P7-UI-03 + P7-UI-04 · ลงทะเบียน SW และ badge ────────────────
  {
    const src = readFileSync('src/components/shell/pwa-register.tsx', 'utf8')
      .replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    const sw = (await (await fetch(`${BASE}/sw.js`)).text())
      .replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    check('P7-UI-03 แอปลงทะเบียน service worker จริง (มี serviceWorker.register ในซอร์สที่ถูกเรนเดอร์)',
      src.includes('serviceWorker.register'), 'มีการลงทะเบียน')
    check('P7-UI-04 ตัวเลขบนไอคอนแอปถูกตั้งจากสองที่: ในแอป และใน push handler ของ SW',
      src.includes('setAppBadge') && sw.includes('setAppBadge'),
      `แอป=${src.includes('setAppBadge')} · SW=${sw.includes('setAppBadge')}`)
  }
} finally {
  await sql(`delete from public.push_subscriptions
             where endpoint in ('${ENDPOINT}', '${OTHER}')`)
  await sql("delete from public.notifications where title = 'ทดสอบ push'")
  console.log('  (ลบข้อมูลทดสอบแล้ว)')
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
