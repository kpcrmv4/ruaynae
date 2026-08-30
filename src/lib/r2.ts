import 'server-only'

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { SIGNED_URL_TTL_SECONDS } from '@/lib/constants'

/**
 * Cloudflare R2 — ที่เก็บรูปสลิปและโลโก้
 *
 * bucket เป็น **ส่วนตัว** ทุกการเข้าถึงผ่าน presigned URL ที่เซ็นในเครื่องเรา
 * (HMAC ล้วน ไม่ได้ยิงไปถาม Cloudflare) จึงไม่ช้าและไม่มีค่าใช้จ่ายเพิ่ม
 *
 * 🔴 R2 ไม่มี RLS — คีย์ที่เดายากไม่ใช่การควบคุมสิทธิ์
 * ทุก route ที่เซ็น URL ต้องเช็คเองว่าคนเรียกมีสิทธิ์กับไฟล์นั้นจริง
 */
const ACCOUNT = process.env.R2_ACCOUNT_ID
const BUCKET = process.env.R2_BUCKET
const KEY_ID = process.env.R2_ACCESS_KEY_ID
const SECRET = process.env.R2_SECRET_ACCESS_KEY

function must(name: string, v: string | undefined): string {
  if (!v) throw new Error(`${name} is not configured`)
  return v
}

export const r2Bucket = () => must('R2_BUCKET', BUCKET)

export const r2Endpoint = () =>
  process.env.R2_ENDPOINT?.trim() || `https://${must('R2_ACCOUNT_ID', ACCOUNT)}.r2.cloudflarestorage.com`

let client: S3Client | undefined
export function r2(): S3Client {
  if (!client) {
    client = new S3Client({
      // R2 ไม่มีแนวคิดเรื่อง region — ต้องใส่ 'auto' เสมอ
      region: 'auto',
      endpoint: r2Endpoint(),
      credentials: {
        accessKeyId: must('R2_ACCESS_KEY_ID', KEY_ID),
        secretAccessKey: must('R2_SECRET_ACCESS_KEY', SECRET),
      },
    })
  }
  return client
}

/** ลิงก์อัปโหลด — เบราว์เซอร์ PUT ตรงเข้า R2 ไบต์ไม่ผ่าน Vercel */
export function presignPut(key: string, contentType: string, ttl = 600) {
  return getSignedUrl(
    r2(),
    new PutObjectCommand({ Bucket: r2Bucket(), Key: key, ContentType: contentType }),
    { expiresIn: ttl },
  )
}

/** ลิงก์ดูรูป — อายุสั้น ลิงก์ที่หลุดออกไปจะหมดอายุเอง */
export function presignGet(key: string, ttl = SIGNED_URL_TTL_SECONDS) {
  return getSignedUrl(r2(), new GetObjectCommand({ Bucket: r2Bucket(), Key: key }), {
    expiresIn: ttl,
  })
}

export async function deleteObject(key: string) {
  await r2().send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: key }))
}

/**
 * คีย์ของไฟล์ — สุ่มเสมอ ไม่เอาชื่อไฟล์เดิมของผู้ใช้
 * ชื่อไฟล์จากผู้ใช้พาทั้ง path traversal และอักขระที่ทำให้ URL เพี้ยนมาด้วย
 */
export function objectKey(prefix: string, ext: string) {
  return `${prefix}/${crypto.randomUUID()}.${ext.replace(/[^a-z0-9]/gi, '').toLowerCase()}`
}
