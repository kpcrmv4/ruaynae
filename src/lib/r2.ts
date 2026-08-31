import 'server-only'

import {
  DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command,
  PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3'
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
 * ถามขนาดและชนิดจริงของไฟล์ที่อยู่ใน R2 · คืน `null` ถ้าไม่มีไฟล์นั้น
 *
 * 🔴 ขนาดที่ client บอกมาเป็นแค่คำกล่าวอ้าง — ตอนบันทึกแถว `attachments`
 * ต้องถาม R2 เองว่าไฟล์มีจริงและใหญ่เท่าไร ไม่งั้นได้แถวที่ชี้ไปยังไฟล์
 * ที่ไม่เคยถูกอัปโหลด (รูปที่กดดูแล้วพังตลอดกาล) หรือขนาดที่ไม่ตรงความจริง
 */
export async function headObject(
  key: string,
): Promise<{ size: number; contentType: string } | null> {
  try {
    const r = await r2().send(new HeadObjectCommand({ Bucket: r2Bucket(), Key: key }))
    return {
      size: Number(r.ContentLength ?? 0),
      contentType: r.ContentType ?? 'application/octet-stream',
    }
  } catch {
    return null
  }
}

/** หมวดของไฟล์ ตัดสินจากคีย์ — `slips/thumb/…` ต้องเช็คก่อน `slips/…` */
export type UsageGroup = 'slips' | 'thumbs' | 'branding' | 'other'

export type BucketUsage = {
  totalBytes: number
  totalFiles: number
  groups: Record<UsageGroup, { bytes: number; files: number }>
  /** จริงเมื่อไฟล์เยอะเกินเพดานหน้า — ตัวเลขที่ได้เป็น "อย่างน้อยเท่านี้" */
  truncated: boolean
}

/** กี่หน้าอย่างมาก · หน้าละ 1,000 คีย์ = ครอบได้ 20,000 ไฟล์ */
const USAGE_MAX_PAGES = 20

const groupOf = (key: string): UsageGroup =>
  key.startsWith('slips/thumb/') ? 'thumbs'
    : key.startsWith('slips/') ? 'slips'
      : key.startsWith('branding/') ? 'branding'
        : 'other'

/**
 * พื้นที่ที่ใช้จริงใน bucket
 *
 * 🔴 นับจาก R2 ไม่ใช่จาก `sum(attachments.byte_size)` — เพราะสองตัวเลขนี้
 * ไม่เท่ากันโดยตั้งใจ: ไฟล์ที่อัปสำเร็จแต่ผู้ใช้กดยกเลิกก่อนบันทึกรายการ
 * ไม่มีแถวใน `attachments` เลย แต่**กินโควตาเต็ม ๆ** · หน้าที่ชื่อว่า
 * "พื้นที่เก็บรูป" ต้องตอบว่าคลาวด์คิดเงินจากอะไร ไม่ใช่ว่าฐานข้อมูลจำอะไรได้
 *
 * R2 ไม่มี API ถามยอดรวม ต้องไล่ list เอง — หน้าละ 1,000 คีย์ · ที่ปริมาณ
 * ของงานจริง (หลักพันไฟล์ต่อปี) คือไม่กี่ request ต่อการเปิดหน้าตั้งค่าหนึ่งครั้ง
 */
export async function bucketUsage(): Promise<BucketUsage> {
  const groups: BucketUsage['groups'] = {
    slips: { bytes: 0, files: 0 },
    thumbs: { bytes: 0, files: 0 },
    branding: { bytes: 0, files: 0 },
    other: { bytes: 0, files: 0 },
  }
  let totalBytes = 0
  let totalFiles = 0
  let token: string | undefined
  let pages = 0
  let truncated = false

  do {
    const r = await r2().send(
      new ListObjectsV2Command({ Bucket: r2Bucket(), ContinuationToken: token }),
    )
    for (const o of r.Contents ?? []) {
      const size = Number(o.Size ?? 0)
      const g = groups[groupOf(o.Key ?? '')]
      g.bytes += size
      g.files += 1
      totalBytes += size
      totalFiles += 1
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined
    pages += 1
    if (token && pages >= USAGE_MAX_PAGES) {
      truncated = true
      break
    }
  } while (token)

  return { totalBytes, totalFiles, groups, truncated }
}

/**
 * คีย์ของไฟล์ — สุ่มเสมอ ไม่เอาชื่อไฟล์เดิมของผู้ใช้
 * ชื่อไฟล์จากผู้ใช้พาทั้ง path traversal และอักขระที่ทำให้ URL เพี้ยนมาด้วย
 */
export function objectKey(prefix: string, ext: string) {
  return `${prefix}/${crypto.randomUUID()}.${ext.replace(/[^a-z0-9]/gi, '').toLowerCase()}`
}
