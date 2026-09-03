import { IMAGE } from '@/lib/constants'
import { txnError } from '@/lib/transactions'

/**
 * บีบรูปแล้วอัปตรงเข้า R2 — ไบต์ไม่ผ่านเซิร์ฟเวอร์ของเราเลย
 *
 * ⚠️ **ไฟล์นี้ทำงานในเบราว์เซอร์เท่านั้น** (ใช้ `URL.createObjectURL` และ
 * `browser-image-compression`) · เรียกจาก Client Component เท่านั้น
 *
 * อยู่ที่นี่เพราะมีสองที่ที่แนบสลิปด้วยขั้นตอนเดียวกันเป๊ะ — ฟอร์มบันทึก
 * รายการใหม่ กับกล่องแก้ไขรายการที่บันทึกไปแล้ว · ก๊อปไปวางสองที่แล้ววันหนึ่ง
 * จะเหลือที่เดียวที่แก้ แล้วผู้ใช้จะเจอพฤติกรรมคนละอย่างจากปุ่มที่หน้าตาเหมือนกัน
 */

/**
 * error ที่ "เราเขียนข้อความเอง" — ติดป้ายไว้เพื่อให้ catch แยกออกจาก error
 * ของเบราว์เซอร์ ซึ่งเป็นภาษาอังกฤษและไม่ควรถูกโยนใส่หน้าจอผู้ใช้
 * (CLAUDE.md §17 ข้อ 13)
 */
const UPLOAD_ERROR = 'UploadError'
export const uploadError = (message: string) =>
  Object.assign(new Error(message), { name: UPLOAD_ERROR })
export const isUploadError = (e: unknown): e is Error =>
  e instanceof Error && e.name === UPLOAD_ERROR

/** ข้อความกลางสำหรับ error ที่ไม่ได้มาจากเรา — ห้ามเอา `e.message` ขึ้นจอ */
export const slipUploadError = (e: unknown) =>
  isUploadError(e) ? e.message : 'แนบรูปไม่สำเร็จ กรุณาลองใหม่'

export type UploadedSlip = {
  objectKey: string
  thumbKey: string
  /** blob URL ของรูปย่อ — ผู้เรียกต้อง `URL.revokeObjectURL` เมื่อเลิกใช้ */
  preview: string
  size: number
}

export async function uploadSlip(file: File, siteId: string | null): Promise<UploadedSlip> {
  // ตรงนี้จงใจ "หลวม" ต่างจากฟอร์มโลโก้ — สลิปถูกบีบเป็น WebP เสมอ
  // (`fileType: IMAGE.type`) เซิร์ฟเวอร์จึงได้ชนิดที่รองรับแน่นอนไม่ว่าต้นทาง
  // จะเป็นอะไร · เงื่อนไขเดียวที่แท้จริงคือ "เบราว์เซอร์ถอดรหัสรูปนี้ได้ไหม"
  // ซึ่งรู้ได้ตอนบีบเท่านั้น · เช็คชนิดให้เข้มกว่านี้จะปฏิเสธรูปที่ใช้ได้จริง
  // บนเครื่องที่ส่ง MIME แปลก ๆ มา แล้วคนคีย์ของกลางโครงการจะแนบสลิปไม่ได้เลย
  if (!file.type.startsWith('image/')) throw uploadError('รองรับเฉพาะไฟล์รูปภาพ')

  // 🔴 นำเข้าไลบรารีบีบรูปแบบ dynamic — มันหนักกว่าโค้ดทั้งหน้ารวมกัน
  // และคนส่วนใหญ่เปิดหน้านี้เพื่อกรอกตัวเลข ไม่ได้แนบรูปทุกครั้ง
  const { default: compress } = await import('browser-image-compression')
  let full: File
  let thumb: File
  try {
    ;[full, thumb] = await Promise.all([
      compress(file, {
        maxWidthOrHeight: IMAGE.full.maxWidthOrHeight,
        maxSizeMB: IMAGE.full.maxSizeMB,
        fileType: IMAGE.type,
        useWebWorker: true,
      }),
      compress(file, {
        maxWidthOrHeight: IMAGE.thumb.maxWidthOrHeight,
        maxSizeMB: IMAGE.thumb.maxSizeMB,
        fileType: IMAGE.type,
        useWebWorker: true,
      }),
    ])
  } catch {
    throw uploadError('เปิดไฟล์รูปนี้ไม่ได้ ลองถ่ายใหม่หรือเลือกรูปอื่น')
  }

  const signRes = await fetch('/api/uploads/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      purpose: 'slip',
      contentType: IMAGE.type,
      siteId,
      byteSize: full.size,
    }),
  })
  const sign = await signRes.json().catch(() => ({}))
  if (!signRes.ok) throw uploadError(txnError(sign.error))

  // 🔴 CORS ที่ไม่ครอบ origin นี้ทำให้ `fetch` โยน TypeError ซึ่งข้อความ
  // ข้างในเป็นภาษาอังกฤษของเบราว์เซอร์ ("Failed to fetch") — ห้ามให้หลุด
  // ไปถึงตาคนที่ยืนอยู่กลางโครงการ (CLAUDE.md §17 ข้อ 11)
  const put = async (url: string, blob: Blob) => {
    let r: Response
    try {
      r = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': IMAGE.type },
        body: blob,
      })
    } catch {
      throw uploadError('ต่อกับที่เก็บรูปไม่ได้ — ถ้าอินเทอร์เน็ตปกติ กรุณาแจ้งผู้ดูแลระบบ')
    }
    if (!r.ok) throw uploadError('ที่เก็บรูปปฏิเสธไฟล์นี้ (' + r.status + ')')
  }
  await Promise.all([put(sign.url, full), put(sign.thumbUrl, thumb)])

  return {
    objectKey: sign.key,
    thumbKey: sign.thumbKey,
    preview: URL.createObjectURL(thumb),
    size: full.size,
  }
}
