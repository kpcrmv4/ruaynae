'use client'

import { Check, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { DOC_KIND_SHORT, nextDocNoPreview, parseDocNo } from '@/lib/documents'
import { BackButton } from '@/components/ui/back-button'

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่ทำได้',
  DOC_NO_FORMAT: 'ต้องลงท้ายด้วยตัวเลข เช่น RC1140',
  UPDATE_FAILED: 'บันทึกไม่สำเร็จ กรุณาลองใหม่',
}

/**
 * ตั้งเลขที่เอกสาร + ข้อมูลผู้ขายที่ขึ้นกระดาษ
 *
 * 🔴 ช่องเลขคือ **"เลขล่าสุดที่ออกไปแล้ว"** ไม่ใช่ "เลขถัดไป"
 * (คำสั่งเจ้าของ 20 ก.ย. 2569) — เจ้าของเปิดแฟ้มเก่าดูใบสุดท้ายแล้วพิมพ์ตามนั้น
 * ไม่ต้องบวกเอง · หน้าจอโชว์ให้เห็นทันทีว่าใบต่อไปจะเป็นเลขอะไร
 */
export function DocSettingsClient({
  quotationLastNo,
  receiptLastNo,
  phone,
  email,
  branchLabel,
  bankAccount,
  docFooter,
}: {
  quotationLastNo: string
  receiptLastNo: string
  phone: string
  email: string
  branchLabel: string
  bankAccount: string
  docFooter: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [f, setF] = useState({
    quotationLastNo, receiptLastNo, phone, email, branchLabel, bankAccount, docFooter,
  })

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  const preview = (raw: string) => {
    if (raw.trim() === '') return null
    const parts = parseDocNo(raw)
    return parts ? nextDocNoPreview(parts) : false
  }

  async function save() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const r = await fetch('/api/settings/documents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        const msg =
          b.error === 'DOC_NO_BEHIND'
            ? `เลขที่กรอกต่ำกว่าใบที่ออกไปแล้ว (ล่าสุดคือเลข ${b.highest}) — ตั้งย้อนหลังจะทำให้เลขชนกัน`
            : (MESSAGES[b.error ?? ''] ?? 'บันทึกไม่สำเร็จ กรุณาลองใหม่')
        setError(msg)
        toast.error(msg)
        return
      }
      toast.success('บันทึกแล้ว')
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink">ตั้งค่าเอกสาร</h1>
          <p className="mt-0.5 text-sm text-muted-token">
            เลขที่เอกสาร และข้อมูลผู้ขายที่จะถูกพิมพ์ลงบนใบเสนอราคา/ใบเสร็จ
          </p>
        </div>
        <BackButton fallbackHref="/settings" />
      </div>

      <section className="panel p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink">เลขที่เอกสาร</h2>
        <p className="mb-3 text-xs text-muted-token">
          กรอก<span className="font-semibold text-ink-2">เลขล่าสุดที่ออกไปแล้ว</span> เช่น{' '}
          <span className="tnum">RC1140</span> แล้วใบถัดไปจะเป็น <span className="tnum">RC1141</span>
          {' '}· จำนวนหลักมาจากที่พิมพ์ (<span className="tnum">CM011</span> → <span className="tnum">CM012</span>)
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {([['quotationLastNo', 'quotation'], ['receiptLastNo', 'receipt']] as const).map(
            ([key, kind]) => {
              const p = preview(f[key])
              return (
                <div key={key}>
                  <label htmlFor={key} className="label-base">
                    {DOC_KIND_SHORT[kind]} — เลขล่าสุด
                  </label>
                  <input
                    id={key}
                    value={f[key]}
                    onChange={(e) => set(key, e.target.value)}
                    placeholder={kind === 'receipt' ? 'RC1140' : 'QT0000'}
                    className="input-base tnum"
                  />
                  <p className="mt-1 text-xs">
                    {p === null ? (
                      <span className="text-muted-token">ยังไม่ได้ตั้ง — ออกเอกสารชนิดนี้ไม่ได้</span>
                    ) : p === false ? (
                      <span className="text-urgent">ต้องลงท้ายด้วยตัวเลข เช่น RC1140</span>
                    ) : (
                      <span className="text-muted-token">
                        ใบถัดไปจะเป็น <span className="font-semibold tnum text-ink-2">{p}</span>
                      </span>
                    )}
                  </p>
                </div>
              )
            },
          )}
        </div>
      </section>

      <section className="panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">ข้อมูลผู้ขายบนกระดาษ</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="s-phone" className="label-base">โทรศัพท์</label>
            <input id="s-phone" value={f.phone} onChange={(e) => set('phone', e.target.value)} className="input-base" />
          </div>
          <div>
            <label htmlFor="s-email" className="label-base">อีเมล</label>
            <input id="s-email" value={f.email} onChange={(e) => set('email', e.target.value)} className="input-base" />
          </div>
          <div>
            <label htmlFor="s-branch" className="label-base">สำนักงานใหญ่ / สาขา</label>
            <input
              id="s-branch"
              value={f.branchLabel}
              onChange={(e) => set('branchLabel', e.target.value)}
              placeholder="(สำนักงานใหญ่)"
              className="input-base"
            />
            <p className="mt-1 text-xs text-muted-token">
              ใบกำกับภาษีเต็มรูปต้องระบุของผู้ขายด้วย ไม่ใช่แค่ของผู้ซื้อ
            </p>
          </div>
          <div>
            <label htmlFor="s-bank" className="label-base">บัญชีรับเงิน (พิมพ์ท้ายใบ)</label>
            <input
              id="s-bank"
              value={f.bankAccount}
              onChange={(e) => set('bankAccount', e.target.value)}
              placeholder="สั่งจ่ายเช็คในนาม …"
              className="input-base"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="s-footer" className="label-base">ข้อความท้ายกระดาษ</label>
            <input
              id="s-footer"
              value={f.docFooter}
              onChange={(e) => set('docFooter', e.target.value)}
              placeholder="* ใบเสร็จรับเงินฉบับนี้จะสมบูรณ์เมื่อเช็คเรียกเก็บเงินได้แล้ว"
              className="input-base"
            />
          </div>
        </div>
      </section>

      {error && <p className="text-sm text-urgent">{error}</p>}

      <button type="button" onClick={save} disabled={busy} className="btn-primary w-full disabled:opacity-60 sm:w-auto">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        บันทึก
      </button>
    </div>
  )
}
