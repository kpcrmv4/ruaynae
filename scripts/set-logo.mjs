#!/usr/bin/env node
/**
 * set-logo.mjs — อัปโหลดโลโก้บริษัทเข้า R2 แล้วผูกกับแถว `branding`
 *
 * เส้นทางเดียวกับปุ่ม "เปลี่ยนโลโก้" ใน /settings ทุกประการ (คีย์ขึ้นต้นด้วย
 * `branding/` · เก็บใน DB แค่ `object_key` ไม่เก็บ URL เต็ม · หน้าเว็บเซ็น
 * ลิงก์ดูเองตอนเรนเดอร์) — มีไว้เพื่อตั้งค่าตอนติดตั้งครั้งแรกโดยไม่ต้อง
 * เปิดเบราว์เซอร์
 *
 *   node scripts/set-logo.mjs public/icons/logo.png
 *
 * 🔴 ไม่ลบไฟล์เก่าออกจาก R2 — ถ้าคีย์เดิมยังถูกอ้างอยู่ที่อื่น (แคช, ลิงก์
 * ที่เซ็นไว้แล้วและยังไม่หมดอายุ) การลบทันทีทำให้รูปหายกลางคัน · ปล่อยให้
 * เป็นไฟล์กำพร้าแล้วเก็บกวาดทีหลังปลอดภัยกว่า
 */
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const file = process.argv[2]
if (!file) {
  console.error('ใช้: node scripts/set-logo.mjs <ไฟล์รูป>')
  process.exit(1)
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)

const CONTENT_TYPE = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
}
const ext = extname(file).toLowerCase()
const contentType = CONTENT_TYPE[ext]
if (!contentType) {
  console.error(`นามสกุล ${ext} ไม่รองรับ — รองรับ: ${Object.keys(CONTENT_TYPE).join(' ')}`)
  process.exit(1)
}

const body = readFileSync(file)
const key = `branding/${randomUUID()}${ext}`

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
})

await s3.send(new PutObjectCommand({
  Bucket: env.R2_BUCKET,
  Key: key,
  Body: body,
  ContentType: contentType,
}))

const r = await fetch(
  `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `update public.branding
              set logo_object_key = '${key}', updated_at = now()
              returning logo_object_key`,
    }),
  },
)
const out = await r.json().catch(() => null)
if (!r.ok) {
  console.error('อัปโหลดขึ้น R2 แล้ว แต่บันทึกลงฐานข้อมูลไม่สำเร็จ:', JSON.stringify(out))
  console.error(`คีย์ที่ค้างอยู่: ${key}`)
  process.exit(1)
}

console.log(`✅ ตั้งโลโก้จาก ${basename(file)} (${(body.length / 1024).toFixed(0)} KB)`)
console.log(`   object_key = ${out[0]?.logo_object_key}`)
