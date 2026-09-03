#!/usr/bin/env node
/**
 * verify-slips.mjs — ปิดแถว P2-R2-* ใน docs/test-plan/P2.md
 *
 * 🔴 แถวที่สำคัญที่สุดสองแถว:
 *  - `P2-R2-08` ถ้า URL ที่ตัดลายเซ็นออกยังเปิดได้ แปลว่า bucket เป็นสาธารณะ
 *    และสลิปทุกใบ (มีชื่อคน เลขบัญชี ยอดเงินอยู่ในภาพ) เปิดดูได้จากทั้งอินเทอร์เน็ต
 *    ทั้งที่ทุกหน้าจอในระบบดูปกติทุกประการ
 *  - `P2-R2-09` ตัวกวาดต้องลบเฉพาะไฟล์กำพร้า และ **ต้องไม่แตะ**ไฟล์ที่ถูกใช้แล้ว
 *    ตัวกวาดที่ลบเกินคือตัวที่ทำให้สลิปของจริงหายโดยไม่มีใครรู้จนกว่าจะกดดู
 *
 * fixture ทุกตัวคืนค่าใน finally
 */
import { readFileSync } from 'node:fs'
import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

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

const s3 = new S3Client({
  region: 'auto',
  endpoint: env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
})
const exists = async (key) => {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
}

const req = (method, path, body, headers = {}) =>
  fetch(`${BASE}${path}`, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const jarOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

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
  if (!r.ok) return { error: t }
  return { rows: JSON.parse(t) }
}

/** PNG 1x1 จริง ๆ เพื่อให้เป็นไฟล์ที่ถูกชนิด */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

console.log('\n── P2-R2 · สลิป: อัปโหลด · อ่าน · ไฟล์กำพร้า ───────────────')

const ownerJar = jarOf(await req('POST', '/api/auth/login', {
  email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }))
const supJar = jarOf(await req('POST', '/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN }))
if (!ownerJar || !supJar) throw new Error('ล็อกอินไม่สำเร็จ — dev server รันอยู่ไหม')

const [sup1] = (await sql(
  `select id from public.profiles where full_name = '${env.SEED_SUPERVISOR1_NAME}'`)).rows
const [expCat] = (await sql(
  "select id from public.categories where kind='expense' order by sort_order limit 1")).rows
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

let mineId = null
let othersId = null
const keysToClean = []
try {
  ;[{ id: mineId }] = (await sql(
    `insert into public.sites(name) values ('ทดสอบ SLIP โครงการของหัวหน้า') returning id`)).rows
  ;[{ id: othersId }] = (await sql(
    `insert into public.sites(name) values ('ทดสอบ SLIP โครงการคนอื่น') returning id`)).rows
  await sql(`insert into public.site_supervisors(site_id, profile_id)
             values ('${mineId}','${sup1.id}')`)

  const intentCount = async () =>
    (await sql('select count(*)::int as n from public.upload_intents')).rows[0].n

  const sign = (jar, body) =>
    req('POST', '/api/uploads/sign', { purpose: 'slip', contentType: 'image/png', ...body }, { cookie: jar })

  // ── P2-R2-01 · ขอลิงก์ของโครงการที่ไม่ได้ดูแล ────────────────────────
  {
    const before = await intentCount()
    const r = await sign(supJar, { siteId: othersId })
    const b = await r.json().catch(() => ({}))
    const after = await intentCount()
    check('P2-R2-01 หัวหน้าโครงการขอลิงก์อัปโหลดของโครงการที่ไม่ได้ดูแล → 403 · ไม่มี intent ใหม่',
      r.status === 403 && b.error === 'FORBIDDEN' && after === before,
      `${r.status} ${b.error} · ${before}→${after}`)
  }

  // ── P2-R2-11 · ชนิดไฟล์และขนาด ───────────────────────────────────
  {
    const before = await intentCount()
    const bad = await req('POST', '/api/uploads/sign',
      { purpose: 'slip', contentType: 'application/pdf', siteId: mineId }, { cookie: supJar })
    const big = await sign(supJar, { siteId: mineId, byteSize: 99 * 1024 * 1024 })
    const after = await intentCount()
    check('P2-R2-11 ชนิดไฟล์ที่ไม่รองรับ → 415 · ไฟล์ใหญ่เกิน → 413 · ไม่มี intent ใหม่',
      bad.status === 415 && big.status === 413 && after === before,
      `${bad.status} / ${big.status} · ${before}→${after}`)
  }

  // ── P2-R2-02 · ขอลิงก์ของโครงการตัวเอง ──────────────────────────────
  let signed = null
  {
    const before = await intentCount()
    const r = await sign(supJar, { siteId: mineId, byteSize: PNG.length })
    signed = await r.json().catch(() => ({}))
    if (signed.key) keysToClean.push(signed.key, signed.thumbKey)
    const after = await intentCount()
    const { rows } = await sql(
      `select expires_at > now() as future, consumed_at is null as unused
       from public.upload_intents where object_key = '${signed.key}'`)
    check('P2-R2-02 ขอลิงก์ของโครงการตัวเอง → 200 · presigned 2 อัน · intent +1 ยังไม่ถูกใช้',
      r.status === 200 && Boolean(signed.url) && Boolean(signed.thumbUrl)
      && after === before + 1 && rows[0]?.future === true && rows[0]?.unused === true,
      `${r.status} · ${before}→${after} · หมดอายุในอนาคต=${rows[0]?.future}`)
  }

  // ── P2-R2-03 · PUT ตรงเข้า R2 ────────────────────────────────────
  {
    const put = async (url) => fetch(url, {
      method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: PNG })
    const [a, b] = await Promise.all([put(signed.url), put(signed.thumbUrl)])
    const okFull = await exists(signed.key)
    const okThumb = await exists(signed.thumbKey)
    check('P2-R2-03 PUT ตรงเข้า R2 ด้วยลิงก์ที่เซ็นมา → 200 · ไฟล์อยู่ใน bucket ทั้งคู่',
      a.ok && b.ok && okFull && okThumb, `${a.status}/${b.status} · เต็ม=${okFull} ย่อ=${okThumb}`)
  }

  // ── P2-R2-05 · อ้างคีย์ที่ไม่มี intent ของตัวเอง ──────────────────
  let txnId = null
  {
    const r = await req('POST', '/api/transactions', {
      kind: 'expense', siteId: mineId, categoryId: expCat.id, amount: 100,
      txnDate: today, payMethod: 'cash',
      attachments: [{ objectKey: 'slips/ไม่มีจริง.png', thumbKey: 'slips/thumb/ไม่มีจริง.png' }],
    }, { cookie: supJar })
    const b = await r.json().catch(() => ({}))
    if (b.transaction?.id) txnId = b.transaction.id
    const { rows } = await sql(
      `select count(*)::int as n from public.attachments where transaction_id = '${txnId}'`)
    check('P2-R2-05 อ้าง object_key ที่ไม่มี intent → attachError=INTENT_NOT_FOUND · ไม่มีสลิปถูกแนบ',
      b.attachError === 'INTENT_NOT_FOUND' && rows[0].n === 0,
      `attachError=${b.attachError} · สลิป ${rows[0].n}`)
    if (txnId) await sql(`delete from public.transactions where id='${txnId}'`)
  }

  // ── P2-R2-12 · แนบเกินเพดาน ──────────────────────────────────────
  {
    const many = Array.from({ length: 5 }, () => ({
      objectKey: signed.key, thumbKey: signed.thumbKey,
    }))
    const r = await req('POST', '/api/transactions', {
      kind: 'expense', siteId: mineId, categoryId: expCat.id, amount: 100,
      txnDate: today, payMethod: 'cash', attachments: many,
    }, { cookie: supJar })
    const b = await r.json().catch(() => ({}))
    check('P2-R2-12 แนบ 5 รูป (เกินเพดาน 4) → 400 TOO_MANY_ATTACHMENTS',
      r.status === 400 && b.error === 'TOO_MANY_ATTACHMENTS', `${r.status} ${b.error}`)
  }

  // ── P2-R2-04 · บันทึกรายการพร้อมสลิป ─────────────────────────────
  let attachmentId = null
  {
    const r = await req('POST', '/api/transactions', {
      kind: 'expense', siteId: mineId, categoryId: expCat.id, amount: 1500,
      txnDate: today, payMethod: 'cash', note: 'ค่าวัสดุพร้อมสลิป',
      attachments: [{ objectKey: signed.key, thumbKey: signed.thumbKey }],
    }, { cookie: supJar })
    const b = await r.json().catch(() => ({}))
    txnId = b.transaction?.id ?? null
    const { rows } = await sql(
      `select a.id, a.byte_size, a.content_type from public.attachments a
       where a.transaction_id = '${txnId}'`)
    attachmentId = rows[0]?.id ?? null
    const { rows: intent } = await sql(
      `select consumed_at is not null as used from public.upload_intents
       where object_key = '${signed.key}'`)
    check('P2-R2-04 บันทึกพร้อมสลิป → 201 · attachments +1 ขนาดจริงจาก R2 · intent ถูกปิด',
      r.status === 201 && rows.length === 1 && rows[0].byte_size === PNG.length
      && rows[0].content_type === 'image/png' && intent[0]?.used === true,
      `${r.status} · สลิป ${rows.length} · ${rows[0]?.byte_size}B · ปิด intent=${intent[0]?.used}`)
  }

  // ── P2-R2-07 · เปิดสลิปของโครงการตัวเอง ─────────────────────────────
  let signedGetUrl = null
  {
    const r = await fetch(`${BASE}/api/uploads/${attachmentId}`, {
      headers: { cookie: supJar }, redirect: 'manual' })
    signedGetUrl = r.headers.get('location')
    const got = signedGetUrl ? await fetch(signedGetUrl) : null
    const bytes = got?.ok ? (await got.arrayBuffer()).byteLength : -1
    check('P2-R2-07 เปิดสลิปของโครงการตัวเอง → 302 ไป presigned GET · ไบต์เท่าที่อัปไป',
      r.status === 302 && Boolean(signedGetUrl?.includes('X-Amz-Signature')) && bytes === PNG.length,
      `${r.status} · มีลายเซ็น=${Boolean(signedGetUrl?.includes('X-Amz-Signature'))} · ${bytes}B`)
  }

  // ── P2-R2-08 · ตัดลายเซ็นออกแล้วต้องเปิดไม่ได้ ───────────────────
  {
    const bare = signedGetUrl ? signedGetUrl.split('?')[0] : ''
    const r = bare ? await fetch(bare) : { status: 0, ok: true }
    check('P2-R2-08 URL เดียวกันแต่ตัดลายเซ็นออก → เปิดไม่ได้ (bucket เป็นส่วนตัวจริง)',
      Boolean(bare) && !r.ok, `${r.status}`)
  }

  // ── P2-R2-06 · เปิดสลิปของโครงการที่ไม่ได้ดูแล ──────────────────────
  // ครึ่งบวกอยู่ที่ P2-R2-07 ซึ่งพิสูจน์ว่า endpoint นี้ทำงานได้จริง
  {
    const other = await sign(ownerJar, { siteId: othersId, byteSize: PNG.length })
    const ob = await other.json()
    keysToClean.push(ob.key, ob.thumbKey)
    await Promise.all([ob.url, ob.thumbUrl].map((u) =>
      fetch(u, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: PNG })))
    const made = await req('POST', '/api/transactions', {
      kind: 'expense', siteId: othersId, categoryId: expCat.id, amount: 250,
      txnDate: today, payMethod: 'cash',
      attachments: [{ objectKey: ob.key, thumbKey: ob.thumbKey }],
    }, { cookie: ownerJar })
    const mb = await made.json()
    const { rows } = await sql(
      `select id from public.attachments where transaction_id = '${mb.transaction.id}'`)
    const r = await fetch(`${BASE}/api/uploads/${rows[0].id}`, {
      headers: { cookie: supJar }, redirect: 'manual' })
    check('P2-R2-06 หัวหน้าโครงการเปิดสลิปของโครงการที่ไม่ได้ดูแล → 403 ไม่ใช่ 302',
      r.status === 403, `${r.status}`)
  }

  // ── P2-R2-10 · เรียกตัวกวาดโดยไม่มีความลับ ───────────────────────
  {
    const r = await fetch(`${BASE}/api/cron/sweep-orphans`)
    const still = await exists(signed.key)
    check('P2-R2-10 เรียก sweep โดยไม่มี CRON_SECRET → 401 · ไม่มีไฟล์ถูกลบ',
      r.status === 401 && still, `${r.status} · ไฟล์ยังอยู่=${still}`)
  }

  // ── P2-R2-09 · ตัวกวาดลบเฉพาะไฟล์กำพร้า ─────────────────────────
  // 🔴 ครึ่งที่สำคัญกว่าคือ **ไฟล์ที่ถูกใช้แล้วต้องยังอยู่** — ตัวกวาดที่ลบเกิน
  // ทำให้สลิปของจริงหายโดยไม่มีใครรู้จนกว่าจะกดดู ซึ่งอาจเป็นเดือนถัดไป
  {
    const orphan = await sign(ownerJar, { siteId: mineId, byteSize: PNG.length })
    const ob = await orphan.json()
    keysToClean.push(ob.key, ob.thumbKey)
    await Promise.all([ob.url, ob.thumbUrl].map((u) =>
      fetch(u, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: PNG })))
    // ทำให้หมดอายุแล้ว โดยไม่ต้องรอ 30 นาที
    // 🔴 ทำให้ intent ของไฟล์ที่ **ถูกใช้แล้ว** หมดอายุด้วย — ไม่งั้นมันรอด
    // เพราะยังไม่หมดอายุ ไม่ใช่เพราะตัวกวาดเคารพ consumed_at
    // ซึ่งจะทำให้แถวนี้เขียวต่อให้ลบเงื่อนไข consumed_at ออกทั้งอัน
    await sql(`update public.upload_intents set expires_at = now() - interval '1 hour'
               where object_key in ('${ob.key}', '${signed.key}')`)

    const before = { orphan: await exists(ob.key), used: await exists(signed.key) }
    const r = await fetch(`${BASE}/api/cron/sweep-orphans?secret=${env.CRON_SECRET}`)
    const b = await r.json().catch(() => ({}))
    const after = { orphan: await exists(ob.key), used: await exists(signed.key) }
    const { rows } = await sql(
      `select count(*)::int as n from public.upload_intents where object_key = '${ob.key}'`)
    check('P2-R2-09 ตัวกวาดลบไฟล์กำพร้าที่หมดอายุ + แถว intent · ไฟล์ที่ใช้แล้วยังอยู่ครบ',
      r.status === 200 && before.orphan && !after.orphan && rows[0].n === 0
      && before.used && after.used,
      `กำพร้า ${before.orphan}→${after.orphan} · ที่ใช้แล้ว ${before.used}→${after.used} · ลบ ${b.deletedFiles} ไฟล์`)
  }
} finally {
  for (const id of [mineId, othersId]) {
    if (id) {
      await sql(`delete from public.attachments a using public.transactions t
                 where a.transaction_id = t.id and t.site_id = '${id}'`)
      await sql(`delete from public.transactions where site_id = '${id}'`)
      await sql(`delete from public.upload_intents where site_id = '${id}'`)
      await sql(`delete from public.sites where id = '${id}'`)
    }
  }
  for (const key of keysToClean) {
    if (key) await s3.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key })).catch(() => {})
  }
  console.log(`  (ลบไฟล์ทดสอบ ${keysToClean.length} ไฟล์ และข้อมูลทดสอบแล้ว)`)
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
