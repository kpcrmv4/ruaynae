'use client'

import imageCompression from 'browser-image-compression'
import { ImageIcon, Loader2, Save, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { IMAGE_UPLOAD_ACCEPT, IMAGE_UPLOAD_TYPES } from '@/lib/constants'
import { fmtBytes } from '@/lib/format'

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่แก้ได้',
  UNSUPPORTED_TYPE: 'รองรับเฉพาะไฟล์ PNG, JPG และ WebP',
  FILE_TOO_LARGE: 'ไฟล์ใหญ่เกินไป ลองย่อรูปก่อนแล้วอัปใหม่',
  UPDATE_FAILED: 'บันทึกไม่สำเร็จ กรุณาลองใหม่',
  READ_FAILED: 'อ่านค่าเดิมไม่ได้ กรุณาลองใหม่',
}
const fail = (code?: string) => MESSAGES[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'

/** โลโก้ไม่ต้องใหญ่ — 512px พอสำหรับทุกที่ที่ใช้ รวมไอคอน PWA */
const LOGO = { maxWidthOrHeight: 512, maxSizeMB: 0.15, useWebWorker: true }

/** นามสกุล → ชนิดไฟล์ · พลิกจากรายการกลาง จะได้ไม่มีวันไม่ตรงกัน */
const TYPE_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(IMAGE_UPLOAD_TYPES).map(([mime, ext]) => [ext, mime]),
)

/**
 * ชนิดไฟล์ที่เชื่อถือได้ของไฟล์นี้ · คืน `null` ถ้าไม่ใช่ชนิดที่เรารับ
 *
 * 🔴 ต้องเช็ค **ก่อน** เรียกตัวบีบรูป · `accept` ของช่องเลือกไฟล์กันได้แค่
 * ค่าเริ่มต้นของกล่องเลือกไฟล์ ผู้ใช้สลับไป "ไฟล์ทั้งหมด" แล้วหยิบ HEIC
 * จากไอโฟนได้เสมอ — และตัวบีบรูปจะ throw ทันทีเพราะเบราว์เซอร์ decode ไม่ได้
 * ทำให้ข้อความ "รองรับเฉพาะ PNG, JPG, WebP" ที่เขียนไว้แล้วไปไม่ถึงตาผู้ใช้
 */
function imageTypeOf(file: File): string | null {
  if (file.type in IMAGE_UPLOAD_TYPES) return file.type
  // ⚠️ ตัวเลือกไฟล์บางตัวส่ง `type` ว่าง และบางตัวส่งค่าที่ไม่มีอยู่ในสเปกเลย
  // (`image/jpg` — ของจริงคือ `image/jpeg`) · ถ้าตัดจบแค่ `type` ผู้ใช้ที่ถือ
  // เครื่องพวกนั้นจะอัปรูป .jpg ธรรมดาไม่ได้เลย · นามสกุลเป็นแหล่งที่สอง
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return TYPE_BY_EXT[ext] ?? null
}

export function BrandingForm({
  initialName,
  initialLogoUrl,
}: {
  initialName: string
  initialLogoUrl: string | null
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(initialName)
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl)
  const [busy, setBusy] = useState<'name' | 'logo' | 'remove' | null>(null)

  async function saveName() {
    if (busy) return
    setBusy('name')
    try {
      const r = await fetch('/api/settings/branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: name }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) return void toast.error(fail(b.error))
      toast.success('บันทึกชื่อบริษัทแล้ว')
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  /**
   * เลือกไฟล์ → บีบ → PUT เข้า R2 → บันทึกคีย์
   *
   * 🔴 สามขั้นนี้พังคนละสาเหตุกันสิ้นเชิง และเคยรวบเป็นข้อความเดียวว่า
   * "อัปโหลดไม่สำเร็จ กรุณาลองใหม่" — ซึ่งแปลว่าเจ้าของที่เจอปัญหาบอกช่างไม่ได้
   * ว่าเกิดอะไรขึ้น และช่างก็ไล่ไม่ได้เพราะไม่มีอะไรตกถึงฝั่งเซิร์ฟเวอร์เลย
   * (เจอจริง 31 ส.ค. 2569: bucket ไม่ได้อนุญาต origin ของ production
   * → อัปโหลดตายทุกครั้งบนเว็บจริง โดย log ของ Vercel ว่างเปล่า)
   */
  async function uploadLogo(file: File) {
    if (busy) return

    // ตรวจชนิดไฟล์ก่อนแตะตัวบีบรูป ไม่งั้นข้อความจะกลายเป็น "ไม่สำเร็จ" ลอย ๆ
    const sourceType = imageTypeOf(file)
    if (!sourceType) return void toast.error(MESSAGES.UNSUPPORTED_TYPE)

    setBusy('logo')
    try {
      // บีบก่อนอัปเสมอ — รูปจากมือถือ 3-4 MB ไม่มีเหตุผลให้ขึ้นไปทั้งก้อน
      let small: File
      try {
        small = await imageCompression(file, LOGO)
      } catch {
        return void toast.error('เปิดไฟล์รูปนี้ไม่ได้ ลองบันทึกเป็น PNG หรือ JPG แล้วอัปใหม่')
      }
      const contentType = small.type || sourceType

      const signRes = await fetch('/api/uploads/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'logo', contentType, byteSize: small.size }),
      })
      const sign = await signRes.json().catch(() => ({}))
      if (!signRes.ok) return void toast.error(fail(sign.error))

      // PUT ตรงเข้า R2 — ไบต์ไม่ผ่านเซิร์ฟเวอร์ของเรา
      //
      // 🔴 ถ้า CORS ของ bucket ไม่ได้อนุญาต origin นี้ เบราว์เซอร์จะบล็อกตั้งแต่
      // preflight แล้ว `fetch` โยน TypeError — แยกจาก "เน็ตหลุด" ไม่ได้เลยตาม
      // การออกแบบของเบราว์เซอร์ · จึงต้องบอกผู้ใช้ทั้งสองทางที่เป็นไปได้
      let put: Response
      try {
        put = await fetch(sign.url, {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body: small,
        })
      } catch {
        return void toast.error('ต่อกับที่เก็บรูปไม่ได้ — ถ้าอินเทอร์เน็ตปกติ กรุณาแจ้งผู้ดูแลระบบ')
      }
      if (!put.ok) return void toast.error(`ที่เก็บรูปปฏิเสธไฟล์นี้ (${put.status}) กรุณาลองใหม่`)

      // บันทึกคีย์หลังอัปสำเร็จเท่านั้น — บันทึกก่อนแล้วอัปพลาด = ชี้ไปไฟล์ที่ไม่มีอยู่
      const save = await fetch('/api/settings/branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logoObjectKey: sign.key }),
      })
      const sb = await save.json().catch(() => ({}))
      if (!save.ok) return void toast.error(fail(sb.error))

      setLogoUrl(URL.createObjectURL(small))
      toast.success(`อัปโหลดโลโก้แล้ว (${fmtBytes(small.size)})`)
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function removeLogo() {
    if (busy) return
    setBusy('remove')
    try {
      const r = await fetch('/api/settings/branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logoObjectKey: null }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) return void toast.error(fail(b.error))
      setLogoUrl(null)
      toast.success('เอาโลโก้ออกแล้ว')
      router.refresh()
    } catch {
      toast.error('ทำรายการไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="p-4">
      <div className="mb-4">
        <label htmlFor="companyName" className="label-base">
          ชื่อบริษัท
        </label>
        <div className="flex gap-2">
          <input
            id="companyName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="เช่น ส.รุ่งเรืองก่อสร้าง"
            className="input-base"
          />
          <button
            onClick={saveName}
            disabled={busy !== null || name.trim() === initialName.trim()}
            className="btn-primary shrink-0"
          >
            {busy === 'name' ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            บันทึก
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted-token">
          ปล่อยว่างได้ — ระบบจะใช้ชื่อสำรองแทน ไม่ขึ้นเป็นช่องว่าง
        </p>
      </div>

      <div>
        <span className="label-base">โลโก้</span>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2">
            {logoUrl ? (
              // ไม่ใช้ next/image — โควตา Image Optimization ของ Vercel แยกต่างหาก
              // และบานปลายง่าย · รูปถูกบีบมาแล้วตั้งแต่ฝั่ง client
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="โลโก้บริษัท" className="size-full object-contain" />
            ) : (
              <ImageIcon className="size-6 text-muted-token" strokeWidth={1.5} />
            )}
          </span>

          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_UPLOAD_ACCEPT}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void uploadLogo(f)
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null}
            className="btn-secondary"
          >
            {busy === 'logo' ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
            {logoUrl ? 'เปลี่ยนโลโก้' : 'เลือกไฟล์'}
          </button>

          {logoUrl && (
            <button onClick={removeLogo} disabled={busy !== null} className="btn-danger">
              {busy === 'remove' ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              เอาออก
            </button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-muted-token">
          PNG, JPG หรือ WebP · ย่อเหลือกว้าง 512px ก่อนอัปโหลดอัตโนมัติ
        </p>
      </div>
    </div>
  )
}
