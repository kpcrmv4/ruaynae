'use client'

import imageCompression from 'browser-image-compression'
import { ImageIcon, Loader2, Save, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่แก้ได้',
  UNSUPPORTED_TYPE: 'รองรับเฉพาะไฟล์ PNG, JPG และ WebP',
  UPDATE_FAILED: 'บันทึกไม่สำเร็จ กรุณาลองใหม่',
  READ_FAILED: 'อ่านค่าเดิมไม่ได้ กรุณาลองใหม่',
}
const fail = (code?: string) => MESSAGES[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'

/** โลโก้ไม่ต้องใหญ่ — 512px พอสำหรับทุกที่ที่ใช้ รวมไอคอน PWA */
const LOGO = { maxWidthOrHeight: 512, maxSizeMB: 0.15, useWebWorker: true }

/**
 * ไฟล์ที่เล็กกว่า 1 KB ปัดเป็น KB แล้วได้ "0 KB" ซึ่งอ่านเหมือนอัปโหลดไม่สำเร็จ
 * บอกเป็นไบต์ไปเลยเมื่อมันเล็กจริง
 */
const formatBytes = (n: number) =>
  n < 1024 ? `${n} ไบต์` : `${(n / 1024).toLocaleString('th-TH', { maximumFractionDigits: 0 })} KB`

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

  async function uploadLogo(file: File) {
    if (busy) return
    setBusy('logo')
    try {
      // บีบก่อนอัปเสมอ — รูปจากมือถือ 3-4 MB ไม่มีเหตุผลให้ขึ้นไปทั้งก้อน
      const small = await imageCompression(file, LOGO)
      const contentType = small.type || file.type

      const signRes = await fetch('/api/uploads/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'logo', contentType }),
      })
      const sign = await signRes.json().catch(() => ({}))
      if (!signRes.ok) return void toast.error(fail(sign.error))

      // PUT ตรงเข้า R2 — ไบต์ไม่ผ่านเซิร์ฟเวอร์ของเรา
      const put = await fetch(sign.url, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: small,
      })
      if (!put.ok) return void toast.error('อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่')

      // บันทึกคีย์หลังอัปสำเร็จเท่านั้น — บันทึกก่อนแล้วอัปพลาด = ชี้ไปไฟล์ที่ไม่มีอยู่
      const save = await fetch('/api/settings/branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logoObjectKey: sign.key }),
      })
      const sb = await save.json().catch(() => ({}))
      if (!save.ok) return void toast.error(fail(sb.error))

      setLogoUrl(URL.createObjectURL(small))
      toast.success(`อัปโหลดโลโก้แล้ว (${formatBytes(small.size)})`)
      router.refresh()
    } catch {
      toast.error('อัปโหลดไม่สำเร็จ กรุณาลองใหม่')
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
            accept="image/png,image/jpeg,image/webp"
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
