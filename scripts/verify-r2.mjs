#!/usr/bin/env node
/**
 * verify-r2.mjs — พิสูจน์ท่ออัปโหลดทั้งเส้น ก่อนจะสร้าง UI วางทับ
 *
 * ถ้าสร้าง UI ก่อนแล้วอัปโหลดไม่ขึ้น จะแยกไม่ออกว่าพังที่ปุ่ม ที่การบีบรูป
 * ที่ CORS ที่ลายเซ็น หรือที่สิทธิ์ — ห้าจุดที่อาการเหมือนกันหมด
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

const post = (path, body, headers = {}) =>
  fetch(`${BASE}${path}`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
  })
const jarOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

console.log('\n── P05-R2 · ท่ออัปโหลด ─────────────────────────────────────')

// สิทธิ์: ยังไม่ล็อกอิน
{
  const r = await post('/api/uploads/sign', { purpose: 'logo', contentType: 'image/webp' })
  const b = await r.json().catch(() => ({}))
  check('P05-R2-01 ขอลิงก์อัปโหลดตอนยังไม่ล็อกอิน → 401 JSON (ไม่ใช่ 307)',
    r.status === 401 && b.error === 'UNAUTHENTICATED', `${r.status} ${b.error}`)
}

const ownerJar = jarOf(
  await post('/api/auth/login', { email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }),
)
const supJar = jarOf(await post('/api/auth/pin', { pin: env.SEED_SUPERVISOR1_PIN }))

// สิทธิ์: หัวหน้าไซต์เปลี่ยนโลโก้บริษัทไม่ได้ — และต้องได้ "เหตุผล" ไม่ใช่แค่ไม่ 200
{
  const r = await post('/api/uploads/sign', { purpose: 'logo', contentType: 'image/webp' }, { cookie: supJar })
  const b = await r.json().catch(() => ({}))
  check('P05-R2-02 หัวหน้าไซต์ขอลิงก์อัปโหลดโลโก้ → 403 FORBIDDEN',
    r.status === 403 && b.error === 'FORBIDDEN', `${r.status} ${b.error}`)
}

// ชนิดไฟล์ที่ไม่รับ
{
  const r = await post('/api/uploads/sign', { purpose: 'logo', contentType: 'application/pdf' }, { cookie: ownerJar })
  const b = await r.json().catch(() => ({}))
  check('P05-R2-03 ชนิดไฟล์ที่ไม่รองรับ → 415 UNSUPPORTED_TYPE',
    r.status === 415 && b.error === 'UNSUPPORTED_TYPE', `${r.status} ${b.error}`)
}

// ทางที่ถูก: ขอลิงก์ → PUT → ไฟล์ลงจริง → เซ็นลิงก์ดู → ลบ
let key = null
try {
  const r = await post('/api/uploads/sign', { purpose: 'logo', contentType: 'image/png' }, { cookie: ownerJar })
  const b = await r.json()
  key = b.key
  check('P05-R2-04 เจ้าของขอลิงก์อัปโหลดได้ · คีย์สุ่มไม่ใช่ชื่อไฟล์เดิม',
    r.status === 200 && /^branding\/[0-9a-f-]{36}\.png$/.test(b.key ?? ''), b.key)

  // PNG 1x1 จริง ๆ เพื่อให้เป็นไฟล์ที่ถูกชนิด
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const put = await fetch(b.url, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: png,
  })
  check('P05-R2-05 PUT ตรงเข้า R2 ด้วยลิงก์ที่เซ็นมา → 200 (ไบต์ไม่ผ่าน Vercel)',
    put.ok, `${put.status}`)

  const head = await s3.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }))
  check('P05-R2-06 ไฟล์อยู่ใน bucket จริง ขนาดตรงกับที่ส่งไป',
    head.ContentLength === png.length && head.ContentType === 'image/png',
    `${head.ContentLength} ไบต์ · ${head.ContentType}`)

  // เซ็นลิงก์ดูรูป แล้วต้องโหลดได้จริง
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
  const { GetObjectCommand } = await import('@aws-sdk/client-s3')
  const getUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }), {
    expiresIn: 60,
  })
  const got = await fetch(getUrl)
  check('P05-R2-07 ลิงก์ดูรูปที่เซ็นแล้วโหลดได้ และได้ไบต์เท่าเดิม',
    got.ok && (await got.arrayBuffer()).byteLength === png.length, `${got.status}`)

  // ไม่มีลายเซ็น = เข้าไม่ได้ (พิสูจน์ว่า bucket เป็นส่วนตัวจริง)
  const naked = await fetch(getUrl.split('?')[0])
  check('P05-R2-08 URL เดียวกันแต่ตัดลายเซ็นออก → เข้าไม่ได้ (bucket เป็นส่วนตัวจริง)',
    !naked.ok, `${naked.status}`)
} finally {
  if (key) {
    await s3.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key })).catch(() => {})
    console.log(`  (ลบไฟล์ทดสอบ ${key} แล้ว)`)
  }
}

// เปลี่ยนโลโก้ → ไฟล์เก่าต้องถูกลบ ไม่ใช่ทิ้งกำพร้าไว้ใน bucket ตลอดกาล
{
  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3')
  const listBranding = async () => {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: env.R2_BUCKET, Prefix: 'branding/' }))
    return (r.Contents ?? []).map((o) => o.Key)
  }
  const patch = (body) =>
    fetch(`${BASE}/api/settings/branding`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: ownerJar },
      body: JSON.stringify(body),
    })

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const uploadLogo = async () => {
    const sign = await (
      await post('/api/uploads/sign', { purpose: 'logo', contentType: 'image/png' }, { cookie: ownerJar })
    ).json()
    const put = await fetch(sign.url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png })
    if (!put.ok) throw new Error(`PUT ล้มเหลว ${put.status}`)
    const save = await patch({ logoObjectKey: sign.key })
    if (!save.ok) throw new Error(`บันทึกคีย์ล้มเหลว ${save.status} ${await save.text()}`)
    return sign.key
  }

  // ล้างของค้างก่อน เพื่อให้แถวนี้วัดพฤติกรรมจริง ไม่ใช่วัดขยะจากรอบก่อน
  const { DeleteObjectCommand: Del } = await import('@aws-sdk/client-s3')
  for (const k of await listBranding()) {
    await s3.send(new Del({ Bucket: env.R2_BUCKET, Key: k })).catch(() => {})
  }
  await patch({ logoObjectKey: null })

  const first = await uploadLogo()
  const afterFirst = await listBranding()
  const second = await uploadLogo()
  const afterSecond = await listBranding()

  check('P05-R2-09 เปลี่ยนโลโก้แล้วไฟล์เก่าถูกลบ — เหลือไฟล์เดียว และเป็นไฟล์ใหม่',
    afterFirst.length === 1 && afterFirst[0] === first &&
      afterSecond.length === 1 && afterSecond[0] === second,
    `หลังรอบแรก ${afterFirst.length} ไฟล์ · หลังรอบสอง ${afterSecond.length} ไฟล์`)

  const wrong = await post('/api/settings/branding', { companyName: 'x' }, { cookie: ownerJar })
  check('P05-R2-10 POST ไปที่ endpoint ที่รองรับแค่ PATCH → 405', wrong.status === 405, `${wrong.status}`)
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
