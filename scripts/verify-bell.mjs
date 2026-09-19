#!/usr/bin/env node
/**
 * verify-bell.mjs — ปิดแถว P3-API-05..09 · P3-UI-07..11 · P3-DB-14
 *
 * 🔴 `{ all: true }` แตะแถวของผู้ใช้จริงด้วย — สคริปต์นี้จึงจดไว้ก่อนว่า
 * แถวไหนยังไม่ได้อ่าน แล้วคืนสถานะให้ใน `finally` · fixture ที่ "เกือบจะ"
 * คืนค่าคือ fixture ที่ทำให้การรันครั้งหน้าอ่านฐานข้อมูลที่ไม่ใช่ของจริง
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const BASE = process.argv[2] ?? 'http://localhost:3200'
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

const req = (method, path, body, cookie) =>
  fetch(`${BASE}${path}`, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const jarOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '')
const page = async (path, cookie) =>
  visible(await (await fetch(`${BASE}${path}`, { headers: { cookie } })).text())

/** ตัวเลขบนกระดิ่ง — อ่านจาก data-unread ซึ่งมีที่เดียวในหน้า */
const badge = (html) => {
  const m = /data-unread="(\d+)"/.exec(html)
  return m ? Number(m[1]) : null
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

console.log('\n── P3 · กระดิ่งแจ้งเตือน ────────────────────────────────────')

const ownerJar = jarOf(await req('POST', '/api/auth/login', {
  email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }))
const supJar = jarOf(await req('POST', '/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN }))
if (!ownerJar || !supJar) throw new Error('ล็อกอินไม่สำเร็จ — dev server รันอยู่ไหม')

const [sup1] = (await sql(
  `select id from public.profiles where full_name = '${env.SEED_SUPERVISOR1_NAME}'`)).rows
const [owner] = (await sql("select id from public.profiles where role = 'owner' limit 1")).rows
const [expCat] = (await sql(
  "select id from public.categories where kind='expense' order by sort_order limit 1")).rows
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

const unreadOf = async (userId) =>
  Number((await sql(
    `select count(*)::int n from public.notifications
     where user_id = '${userId}' and read_at is null`)).rows[0].n)

// จดไว้ก่อนว่าแถวไหนของใครยังไม่ได้อ่าน — คืนให้ครบใน finally
const preUnread = (await sql(
  'select id from public.notifications where read_at is null')).rows.map((r) => r.id)

let siteId = null

try {
  ;[{ id: siteId }] = (await sql(
    "insert into public.sites(name, status) values ('ทดสอบกระดิ่ง โครงการก', 'active') returning id")).rows
  await sql(`insert into public.site_supervisors(site_id, profile_id)
             values ('${siteId}','${sup1.id}')`)

  const mk = async (amount, note) => {
    const r = await req('POST', '/api/transactions', {
      kind: 'expense', siteId, categoryId: expCat.id,
      amount: String(amount), txnDate: today, payMethod: 'cash', note,
    }, supJar)
    const b = await r.json().catch(() => ({}))
    return b.transaction?.id ?? b.id ?? null
  }

  // หัวหน้าโครงการคีย์ → เจ้าของได้แจ้งเตือน · เจ้าของตีกลับ → หัวหน้าโครงการได้แจ้งเตือน
  const idA = await mk(1200, 'ค่าปูนทดสอบกระดิ่ง')
  const idB = await mk(3400, 'ค่าเหล็กทดสอบกระดิ่ง')
  if (!idA || !idB) throw new Error('สร้างรายการทดสอบไม่สำเร็จ')
  await req('PATCH', `/api/transactions/${idB}`, {
    action: 'reject', reason: 'สลิปไม่ชัดทดสอบกระดิ่ง' }, ownerJar)

  // ── P3-UI-07 · ตัวเลขบนกระดิ่งตรงกับ SQL ──────────────────────────
  {
    const html = await page('/', ownerJar)
    const n = await unreadOf(owner.id)
    check('P3-UI-07 ตัวเลขบนกระดิ่งของเจ้าของ = จำนวนที่ยังไม่อ่านใน SQL',
      n > 0 && badge(html) === n, `จอ ${badge(html)} · SQL ${n}`)
  }

  // ── P3-UI-09 · กระดิ่งของแต่ละคนนับของตัวเอง ──────────────────────
  // 🔴 เนื้อในกล่องกระดิ่งเป็น radix Dialog ซึ่ง **ไม่เรนเดอร์จนกว่าจะเปิด**
  // ข้อความจึงไม่มีใน HTML ของเซิร์ฟเวอร์เลย — ตัวตรวจที่ไปหาข้อความจะแดง
  // ทั้งที่หน้าจอถูกต้อง · สิ่งที่ตรวจได้จริงคือ **ตัวเลข** ซึ่งมาจาก query
  // เดียวกันกับที่ป้อนเนื้อในกล่อง · จงใจให้สองคนมีตัวเลขไม่เท่ากัน
  // ถ้าเท่ากันเมื่อไหร่จะแยกไม่ออกว่า RLS ทำงานหรือแค่บังเอิญตรงกัน
  {
    const ownerN = await unreadOf(owner.id)
    const supN = await unreadOf(sup1.id)
    const ownerHtml = await page('/', ownerJar)
    const supHtml = await page('/', supJar)
    check('P3-UI-09 กระดิ่งของแต่ละคนนับเฉพาะของตัวเอง — เจ้าของกับหัวหน้าโครงการได้คนละเลข',
      ownerN !== supN && supN > 0
      && badge(ownerHtml) === ownerN && badge(supHtml) === supN,
      `เจ้าของ จอ ${badge(ownerHtml)}/SQL ${ownerN} · หัวหน้าโครงการ จอ ${badge(supHtml)}/SQL ${supN}`)
  }

  // ── P3-API-05 · ไม่ล็อกอิน ────────────────────────────────────────
  {
    const r = await req('POST', '/api/notifications/read', { all: true })
    const ct = r.headers.get('content-type') ?? ''
    const b = await r.json().catch(() => ({}))
    check('P3-API-05 ยิง read ตอนไม่ล็อกอิน → 401 JSON (ไม่ใช่ 307 ไป /login)',
      r.status === 401 && b.error === 'UNAUTHENTICATED' && ct.startsWith('application/json'),
      `${r.status} ${b.error} ${ct.split(';')[0]}`)
  }

  // ── P3-API-08 · method ที่ไม่รองรับ ───────────────────────────────
  {
    const r = await fetch(`${BASE}/api/notifications/read`, {
      method: 'GET', redirect: 'manual', headers: { cookie: ownerJar } })
    check('P3-API-08 GET /api/notifications/read → 405', r.status === 405, String(r.status))
  }

  // ── P3-API-09 · id ที่ไม่มีจริง ───────────────────────────────────
  {
    const r = await req('POST', '/api/notifications/read',
      { id: '00000000-0000-4000-8000-000000000000' }, ownerJar)
    const b = await r.json().catch(() => ({}))
    check('P3-API-09 read ด้วย id ที่ไม่มีจริง → 404 NOT_FOUND',
      r.status === 404 && b.error === 'NOT_FOUND', `${r.status} ${b.error}`)
  }

  // ── P3-API-06 · แตะของคนอื่นไม่ได้ ────────────────────────────────
  // 🔴 ฝั่งบวกอยู่ในบล็อกเดียวกัน — ถ้าไม่มี "ของตัวเองทำได้" มาคู่กัน
  // แถวนี้จะเขียวเหมือนกันตอนที่ route พังจนไม่ทำอะไรเลย
  {
    const [ownerNote] = (await sql(
      `select id from public.notifications where user_id = '${owner.id}' and read_at is null limit 1`)).rows
    const [supNote] = (await sql(
      `select id from public.notifications where user_id = '${sup1.id}' and read_at is null limit 1`)).rows

    const bad = await req('POST', '/api/notifications/read', { id: ownerNote.id }, supJar)
    const [afterBad] = (await sql(
      `select read_at from public.notifications where id = '${ownerNote.id}'`)).rows
    const good = await req('POST', '/api/notifications/read', { id: supNote.id }, supJar)
    const [afterGood] = (await sql(
      `select read_at from public.notifications where id = '${supNote.id}'`)).rows

    check('P3-API-06 หัวหน้าโครงการทำแจ้งเตือนของเจ้าของเป็นอ่านแล้วไม่ได้ (404 · read_at ยัง null) แต่ของตัวเองได้',
      bad.status === 404 && afterBad.read_at === null
      && good.status === 200 && Boolean(afterGood.read_at),
      `ของคนอื่น ${bad.status}/read_at=${afterBad.read_at} · ของตัวเอง ${good.status}/read_at=${Boolean(afterGood.read_at)}`)
  }

  // ── P3-UI-10 · รายการในกระดิ่งลิงก์ไปที่ที่ควรไป และกดแล้วอ่านแล้ว ─
  {
    const html = await page('/', ownerJar)
    const hasLink = html.includes('href="/approvals"')
    // ครึ่งที่เป็น "กดแล้วทำเป็นอ่านแล้ว" พิสูจน์ที่ตัวเชื่อมในซอร์ส —
    // ลบ onClick ออกเมื่อไหร่แถวนี้แดงทันที (การกดจริงรอ Playwright ที่ P8)
    const src = readFileSync('src/components/shell/notification-bell.tsx', 'utf8')
    const wired = /onClick=\{\(\) => \{[\s\S]*?markRead\(\{ id: n\.id \}\)/.test(src)
    check('P3-UI-10 รายการในกระดิ่งเป็นลิงก์ไป link ของตัวเอง และผูกกับการทำเป็นอ่านแล้ว',
      hasLink && wired, `ลิงก์=${hasLink} · ผูก markRead=${wired}`)
  }

  // ── P3-API-07 + P3-UI-11 · อ่านทั้งหมด ────────────────────────────
  {
    const supBefore = await unreadOf(sup1.id)
    const r = await req('POST', '/api/notifications/read', { all: true }, ownerJar)
    const b = await r.json().catch(() => ({}))
    const ownerAfter = await unreadOf(owner.id)
    const supAfter = await unreadOf(sup1.id)
    check('P3-API-07 อ่านทั้งหมด → 200 · ของตัวเองเหลือ 0 · ของอีกคนไม่เปลี่ยน',
      r.status === 200 && typeof b.updated === 'number' && b.updated > 0
      && ownerAfter === 0 && supAfter === supBefore,
      `${r.status} updated=${b.updated} · เจ้าของเหลือ ${ownerAfter} · หัวหน้าโครงการ ${supBefore}→${supAfter}`)

    // ── P3-UI-08 · ไม่มีของค้าง = ไม่มีป้าย ─────────────────────────
    const html = await page('/', ownerJar)
    check('P3-UI-08 ไม่มีแจ้งเตือนค้าง → กระดิ่งไม่มีตัวเลขเลย (ไม่ใช่ป้าย 0)',
      badge(html) === null && html.includes('แจ้งเตือน'),
      `ป้าย=${badge(html) ?? 'ไม่มี'}`)

    check('P3-UI-11 กด "อ่านทั้งหมด" แล้วตัวเลขบนกระดิ่งหายไป',
      ownerAfter === 0 && badge(html) === null, `เหลือ ${ownerAfter} · ป้าย ${badge(html) ?? 'ไม่มี'}`)
  }

  // ── P3-UI-13a · ข้อความ broadcast ถึงเบราว์เซอร์จริง ──────────────
  // 🔴 P3-DB-12 พิสูจน์แค่ว่าข้อความ **ลงตาราง** · แถวนี้พิสูจน์ว่ามัน
  // **ออกไปถึงคนฟัง** ซึ่งเป็นคนละเรื่อง — ตอนที่ partition ขาด ข้อความ
  // ลงตารางไม่ได้เลยและ subscribe ก็ล้ม โดยไม่มี error ที่ฝั่งเซิร์ฟเวอร์
  // (ครึ่งที่เหลือคือ "ตัวเลขขยับโดยไม่รีเฟรช" ซึ่งต้องมีเบราว์เซอร์ → P8)
  {
    const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    const { data: auth } = await sb.auth.signInWithPassword({
      email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD })
    let got = null
    let status = 'ไม่ได้ต่อ'
    if (auth?.session) {
      await sb.realtime.setAuth(auth.session.access_token)
      // ลองใหม่แบบเดียวกับที่กระดิ่งทำ — ครั้งแรกของโปรเจ็คใหม่จะล้มเสมอ
      for (let attempt = 0; attempt < 3 && status !== 'SUBSCRIBED'; attempt++) {
        const ch = sb.channel(`notif:${owner.id}`, { config: { private: true } })
        ch.on('broadcast', { event: 'new' }, (m) => { got = m.payload })
        status = await new Promise((res) => {
          const t = setTimeout(() => res('TIMED_OUT'), 8000)
          ch.subscribe((s) => {
            if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(s)) {
              clearTimeout(t)
              res(s)
            }
          })
        })
        if (status !== 'SUBSCRIBED') await sb.removeChannel(ch)
      }
      if (status === 'SUBSCRIBED') {
        // 🔴 `SUBSCRIBED` แปลว่า "ฝั่งเราได้รับตอบรับแล้ว" ไม่ได้แปลว่า
        // ฝั่งเซิร์ฟเวอร์พร้อมส่งให้แล้ว · ยิงทันทีแล้วบางครั้งข้อความแรกหาย
        // — แถวนี้เคยแดงสลับเขียวเพราะเหตุนี้ · หน่วงสักครู่ แล้วถ้ายังไม่มา
        // ลองยิงอีกครั้ง · ถ้า broadcast พังจริง จะไม่มาทั้งสองครั้ง แถวก็ยังแดงได้
        for (let attempt = 0; attempt < 2 && !got; attempt++) {
          await new Promise((r) => setTimeout(r, 750))
          await mk(6700 + attempt, `ค่าทรายทดสอบ realtime ${attempt}`)
          for (let i = 0; i < 24 && !got; i++) await new Promise((r) => setTimeout(r, 250))
        }
      }
    }
    await sb.removeAllChannels()
    check('P3-UI-13a แจ้งเตือนใหม่เดินทางถึงคนที่ subscribe อยู่จริง (private channel ต่อคน)',
      status === 'SUBSCRIBED' && got !== null,
      `subscribe=${status} · ได้รับ=${got ? JSON.stringify(got).slice(0, 60) : 'ไม่ได้รับ'}`)
  }

  // ── P3-DB-14 · ทุกคอลัมน์มีคนเขียน ────────────────────────────────
  {
    const mig = readFileSync('supabase/migrations/20260830220000_p3_notification_txn_link.sql', 'utf8')
      + readFileSync('supabase/migrations/20260830210000_p3_notifications.sql', 'utf8')
    const route = readFileSync('src/app/api/notifications/read/route.ts', 'utf8')
    const strip = (s) => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    const wrote = strip(mig) + strip(route)
    const cols = ['user_id', 'kind', 'title', 'body', 'link', 'txn_id', 'read_at']
    const missing = cols.filter((c) => !wrote.includes(c))
    check('P3-DB-14 ทั้ง 7 คอลัมน์ของ notifications มีโค้ดหรือ trigger ที่เขียนจริง',
      missing.length === 0, missing.length ? `ไม่มีใครเขียน: ${missing.join(', ')}` : '7/7')
  }
} finally {
  if (siteId) {
    await sql(`delete from public.transactions where site_id = '${siteId}'`)
    await sql(`delete from public.site_supervisors where site_id = '${siteId}'`)
    await sql(`delete from public.site_finance where site_id = '${siteId}'`)
    await sql(`delete from public.sites where id = '${siteId}'`)
  }
  if (preUnread.length > 0) {
    await sql(`update public.notifications set read_at = null
               where id in (${preUnread.map((i) => `'${i}'`).join(',')})`)
  }
  console.log('  (ลบข้อมูลทดสอบและคืนสถานะอ่านแล้ว)')
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
