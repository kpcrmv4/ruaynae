#!/usr/bin/env node
/**
 * setup-r2-cors.mjs — ตั้ง CORS ของ bucket R2 (รันครั้งเดียว รันซ้ำได้)
 *
 * ถ้าไม่ตั้ง เบราว์เซอร์จะ PUT ตรงเข้า R2 ไม่ได้เลย และ error ที่ได้คือ
 * "CORS policy" ซึ่งดูเหมือนโค้ดฝั่งเราผิด ทั้งที่เป็นการตั้งค่าฝั่ง bucket
 *
 * origin ที่อนุญาตต้องระบุให้แคบ — `*` แปลว่าเว็บไซต์ไหนก็ยิงเข้า bucket เราได้
 * ถ้ามันได้ presigned URL ไป
 */
import { readFileSync } from 'node:fs'
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)

const BUCKET = env.R2_BUCKET
const client = new S3Client({
  region: 'auto',
  endpoint: env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
})

// เพิ่มโดเมน production ตอน deploy — อย่าใส่ '*'
const ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3100',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3100',
  ...(process.argv.slice(2)),
]

await client.send(
  new PutBucketCorsCommand({
    Bucket: BUCKET,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: ORIGINS,
          AllowedMethods: ['PUT', 'GET', 'HEAD'],
          AllowedHeaders: ['content-type'],
          ExposeHeaders: ['etag'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
)

const now = await client.send(new GetBucketCorsCommand({ Bucket: BUCKET }))
console.log(`ตั้ง CORS ของ bucket "${BUCKET}" แล้ว`)
for (const r of now.CORSRules ?? []) {
  console.log('  origins :', r.AllowedOrigins.join(', '))
  console.log('  methods :', r.AllowedMethods.join(', '))
  console.log('  headers :', (r.AllowedHeaders ?? []).join(', '))
}
