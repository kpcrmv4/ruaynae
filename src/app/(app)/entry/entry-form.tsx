'use client'

import { Banknote, Camera, Check, ImagePlus, Loader2, Wallet, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Role } from '@/lib/auth/current-user'
import { IMAGE, MAX_ATTACHMENTS } from '@/lib/constants'
import { fmtBaht } from '@/lib/format'
import {
  INCOME_KINDS, INCOME_KIND_LABEL, PAY_METHODS, PAY_METHOD_LABEL, txnError,
  type IncomeKind, type PayMethod, type TxnKind,
} from '@/lib/transactions'

type Site = { id: string; name: string }
type Slip = { objectKey: string; thumbKey: string; preview: string; size: number }
type Category = { id: string; name: string; kind: TxnKind }

const fail = txnError


const CENTRAL = '__central__'

export function EntryForm({
  role, today, sites, categories,
}: {
  role: Role
  /** วันนี้ตามเวลาไทย คำนวณฝั่งเซิร์ฟเวอร์ — ห้ามใช้ new Date() ที่นี่
   *  เครื่องผู้ใช้ตั้งเขตเวลาอะไรก็ได้ และค่านั้นจะไม่ตรงกับที่เซิร์ฟเวอร์ตรวจ */
  today: string
  sites: Site[]
  categories: Category[]
}) {
  const router = useRouter()
  const isOwner = role === 'owner'

  const [kind, setKind] = useState<TxnKind>('expense')
  const [busy, setBusy] = useState(false)
  const [fieldError, setFieldError] = useState<{ field: string; text: string } | null>(null)
  const [slips, setSlips] = useState<Slip[]>([])
  const [uploading, setUploading] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({
    siteId: sites[0]?.id ?? (isOwner ? CENTRAL : ''),
    categoryId: '',
    amount: '',
    txnDate: today,
    payMethod: 'cash' as PayMethod,
    incomeKind: 'installment' as IncomeKind,
    installmentNo: '',
    note: '',
  })

  // หมวดกรองตามชนิดที่เลือกอยู่ — เลือกรายรับแล้วต้องไม่เห็นหมวดของรายจ่าย
  const visibleCategories = useMemo(
    () => categories.filter((c) => c.kind === kind),
    [categories, kind],
  )

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setFieldError(null)
  }

  const switchKind = (next: TxnKind) => {
    setKind(next)
    // หมวดของอีกชนิดใช้ไม่ได้ — ล้างทิ้งแทนที่จะปล่อยให้ส่งไปแล้วโดนปฏิเสธ
    setForm((f) => ({ ...f, categoryId: '', siteId: next === 'income' ? (sites[0]?.id ?? '') : f.siteId }))
    setFieldError(null)
  }

  const amountNumber = Number(form.amount.replace(/,/g, ''))
  const amountValid = Number.isFinite(amountNumber) && amountNumber > 0

  /**
   * บีบรูปแล้วอัปตรงเข้า R2 · ไบต์ไม่ผ่านเซิร์ฟเวอร์ของเราเลย
   *
   * 🔴 นำเข้าไลบรารีบีบรูปแบบ dynamic — มันหนักกว่าโค้ดทั้งหน้ารวมกัน
   * และคนส่วนใหญ่เปิดหน้านี้เพื่อกรอกตัวเลข ไม่ได้แนบรูปทุกครั้ง
   */
  async function addFile(file: File) {
    if (slips.length >= MAX_ATTACHMENTS) {
      toast.error('แนบได้ไม่เกิน ' + MAX_ATTACHMENTS + ' รูปต่อรายการ')
      return
    }
    if (!file.type.startsWith('image/')) {
      toast.error('รองรับเฉพาะไฟล์รูปภาพ')
      return
    }
    setUploading(true)
    try {
      const { default: compress } = await import('browser-image-compression')
      const [full, thumb] = await Promise.all([
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

      const signRes = await fetch('/api/uploads/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose: 'slip',
          contentType: IMAGE.type,
          siteId: form.siteId === CENTRAL ? null : form.siteId,
          byteSize: full.size,
        }),
      })
      const sign = await signRes.json().catch(() => ({}))
      if (!signRes.ok) {
        toast.error(fail(sign.error))
        return
      }

      const put = async (url: string, blob: Blob) => {
        const r = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': IMAGE.type },
          body: blob,
        })
        if (!r.ok) throw new Error('อัปโหลดไม่สำเร็จ (' + r.status + ')')
      }
      await Promise.all([put(sign.url, full), put(sign.thumbUrl, thumb)])

      setSlips((cur) => [
        ...cur,
        {
          objectKey: sign.key,
          thumbKey: sign.thumbKey,
          preview: URL.createObjectURL(thumb),
          size: full.size,
        },
      ])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'แนบรูปไม่สำเร็จ')
    } finally {
      setUploading(false)
    }
  }

  /**
   * เอารูปออกจากรายการที่กำลังจะบันทึก
   *
   * ไฟล์ที่อัปไปแล้วยังอยู่ใน R2 — ปล่อยให้ตัวกวาด (sweep-orphans) จัดการ
   * เมื่อ upload_intents หมดอายุ · ลบทันทีที่นี่จะต้องมี endpoint ลบไฟล์
   * ซึ่งเป็นปุ่มที่ใครก็ยิงได้ถ้าเดาคีย์ถูก และเราไม่ได้ต้องการมัน
   */
  const removeSlip = (key: string) => {
    setSlips((cur) => {
      const gone = cur.find((s) => s.objectKey === key)
      if (gone) URL.revokeObjectURL(gone.preview)
      return cur.filter((s) => s.objectKey !== key)
    })
  }

  async function submit() {
    if (busy) return
    if (!amountValid) return setFieldError({ field: 'amount', text: 'จำนวนเงินต้องมากกว่า 0' })
    if (!form.categoryId) return setFieldError({ field: 'category', text: 'กรุณาเลือกหมวด' })
    if (!isOwner && !form.siteId) return setFieldError({ field: 'site', text: 'กรุณาเลือกไซต์งาน' })

    setBusy(true)
    try {
      const r = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          siteId: form.siteId === CENTRAL ? null : form.siteId,
          categoryId: form.categoryId,
          amount: amountNumber,
          txnDate: form.txnDate,
          payMethod: form.payMethod,
          note: form.note,
          ...(kind === 'income'
            ? {
                incomeKind: form.incomeKind,
                ...(form.incomeKind === 'installment' ? { installmentNo: form.installmentNo } : {}),
              }
            : {}),
          // 🔴 หนึ่งค่าต่อ "หนึ่งครั้งที่ตั้งใจบันทึก" — ยิงซ้ำด้วยค่าเดิม
          // ฐานข้อมูลจะปฏิเสธแถวที่สอง · ปุ่ม disabled กันได้แค่กรณีปกติ
          // เน็ตช้าแล้วกดซ้ำ หรือเปิดสองแท็บ ยังผ่านมาได้
          clientRef: crypto.randomUUID(),
          attachments: slips.map((s) => ({ objectKey: s.objectKey, thumbKey: s.thumbKey })),
        }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(fail(b.error))
        return
      }
      // แนบไม่ติดแต่ตัวเลขบันทึกแล้ว — ต้องบอกให้ชัด ไม่ใช่ขึ้น "สำเร็จ" เฉย ๆ
      // แล้วผู้ใช้เชื่อว่าสลิปอยู่ในระบบทั้งที่ไม่มี
      if (b.attachError) toast.error(fail(b.attachError))
      else toast.success(isOwner ? 'บันทึกแล้ว' : 'บันทึกแล้ว รอเจ้าของอนุมัติ')
      for (const s of slips) URL.revokeObjectURL(s.preview)
      setSlips([])
      setForm((f) => ({ ...f, amount: '', note: '', installmentNo: '' }))
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  const err = (field: string) => (fieldError?.field === field ? fieldError.text : null)

  return (
    <div className="mx-auto w-full max-w-xl">
      <h1 className="mb-1 text-2xl font-bold text-ink">
        {isOwner ? 'บันทึกรายรับ-รายจ่าย' : 'บันทึกรายจ่าย'}
      </h1>
      <p className="mb-5 text-sm text-muted-token">
        {isOwner
          ? 'รายการที่คุณคีย์เองจะถูกอนุมัติทันที'
          : 'รายการที่คีย์จะเข้าคิวรอเจ้าของอนุมัติ'}
      </p>

      {/* ── สลับรายรับ/รายจ่าย — เจ้าของเท่านั้น ─────────────────────
          หัวหน้าไซต์ไม่มีปุ่มนี้เลย ไม่ใช่มีแล้วกดไม่ได้ · ปุ่มที่กดแล้วถูก
          ปฏิเสธทุกครั้งคือปุ่มที่ไม่ควรมี */}
      {isOwner && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          {(['expense', 'income'] as const).map((k) => {
            const active = kind === k
            const Icon = k === 'income' ? Banknote : Wallet
            return (
              <button
                key={k}
                type="button"
                onClick={() => switchKind(k)}
                aria-pressed={active}
                className={`flex items-center justify-center gap-2 rounded-md border px-4 py-3 text-base font-semibold transition-colors duration-150 ${
                  active
                    ? k === 'income'
                      ? 'border-income bg-income-bg text-income'
                      : 'border-expense bg-expense-bg text-expense'
                    : 'border-line-strong bg-surface text-ink-2 hover:border-ink-2'
                }`}
              >
                <Icon className="size-4.5" />
                {k === 'income' ? 'รายรับ' : 'รายจ่าย'}
              </button>
            )
          })}
        </div>
      )}

      <div className="panel space-y-4 p-4">
        {/* จำนวนเงินอยู่บนสุดและตัวใหญ่ที่สุด — เป็นสิ่งที่คนมาที่หน้านี้เพื่อกรอก */}
        <div>
          <label htmlFor="amount" className="label-base">จำนวนเงิน (บาท)</label>
          <input
            id="amount"
            type="text"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => set('amount', e.target.value)}
            placeholder="0"
            aria-invalid={err('amount') ? 'true' : undefined}
            className="input-base py-3 text-2xl font-bold tnum"
            autoFocus
          />
          {err('amount') ? (
            <p className="mt-1 text-sm text-urgent">{err('amount')}</p>
          ) : (
            amountValid && (
              <p className="mt-1 text-sm text-muted-token tnum">{fmtBaht(amountNumber)}</p>
            )
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="site" className="label-base">ไซต์งาน</label>
            <select
              id="site"
              value={form.siteId}
              onChange={(e) => set('siteId', e.target.value)}
              aria-invalid={err('site') ? 'true' : undefined}
              className="input-base"
            >
              {sites.length === 0 && <option value="">— ยังไม่มีไซต์ที่คุณดูแล —</option>}
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
              {/* ส่วนกลาง = ค่าน้ำมัน ค่าทางด่วน ค่าออฟฟิศ ที่ไม่ใช่ต้นทุนของไซต์ไหน
                  หัวหน้าไซต์ไม่มีตัวเลือกนี้ — เป็นค่าใช้จ่ายของเจ้าของ */}
              {isOwner && kind === 'expense' && (
                <option value={CENTRAL}>ส่วนกลาง (ไม่ผูกไซต์)</option>
              )}
            </select>
            {err('site') && <p className="mt-1 text-sm text-urgent">{err('site')}</p>}
          </div>

          <div>
            <label htmlFor="category" className="label-base">หมวด</label>
            <select
              id="category"
              value={form.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
              aria-invalid={err('category') ? 'true' : undefined}
              className="input-base"
            >
              <option value="">— เลือกหมวด —</option>
              {visibleCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {err('category') && <p className="mt-1 text-sm text-urgent">{err('category')}</p>}
          </div>

          <div>
            {/* 🔴 input type=date แสดงปี พ.ศ. บนเครื่องที่ตั้งภาษาไทย
                แต่ค่าที่อ่านได้เป็น ค.ศ. เสมอ — ส่งลงฐานข้อมูลได้ตรง ๆ */}
            <label htmlFor="date" className="label-base">วันที่</label>
            <input
              id="date"
              type="date"
              max={today}
              value={form.txnDate}
              onChange={(e) => set('txnDate', e.target.value)}
              className="input-base"
            />
          </div>

          <div>
            <label htmlFor="pay" className="label-base">จ่ายด้วย</label>
            <select
              id="pay"
              value={form.payMethod}
              onChange={(e) => set('payMethod', e.target.value as PayMethod)}
              className="input-base"
            >
              {PAY_METHODS.map((m) => (
                <option key={m} value={m}>{PAY_METHOD_LABEL[m]}</option>
              ))}
            </select>
          </div>

          {kind === 'income' && (
            <>
              <div>
                <label htmlFor="incomeKind" className="label-base">รับเป็นค่าอะไร</label>
                <select
                  id="incomeKind"
                  value={form.incomeKind}
                  onChange={(e) => set('incomeKind', e.target.value as IncomeKind)}
                  className="input-base"
                >
                  {INCOME_KINDS.map((k) => (
                    <option key={k} value={k}>{INCOME_KIND_LABEL[k]}</option>
                  ))}
                </select>
              </div>
              {form.incomeKind === 'installment' && (
                <div>
                  <label htmlFor="installment" className="label-base">งวดที่</label>
                  <input
                    id="installment"
                    type="text"
                    inputMode="numeric"
                    value={form.installmentNo}
                    onChange={(e) => set('installmentNo', e.target.value)}
                    placeholder="เช่น 2"
                    className="input-base tnum"
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <label htmlFor="note" className="label-base">รายละเอียด (ไม่บังคับ)</label>
          <input
            id="note"
            value={form.note}
            onChange={(e) => set('note', e.target.value)}
            placeholder="เช่น ปูนซีเมนต์ 20 ถุง ร้านเจริญค้าวัสดุ"
            className="input-base"
          />
        </div>

        {/* ── แนบสลิป ─────────────────────────────────────────────────
            🔴 **สองปุ่มแยกกัน** ไม่ใช่ปุ่มเดียวแล้วให้ระบบถาม —
            คนกลางไซต์ที่ถือมือถือเปื้อนปูนรู้อยู่แล้วว่าจะถ่ายใหม่หรือหยิบรูปเก่า
            การถามซ้ำคือการเพิ่มขั้นตอนให้คนที่ตัดสินใจไปแล้ว
            · capture="environment" เปิดกล้องหลังตรง ๆ ไม่ผ่านตัวเลือกไฟล์ */}
        <div>
          <span className="label-base">สลิป / บิล (ไม่บังคับ)</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={uploading || slips.length >= MAX_ATTACHMENTS}
              className="btn-secondary"
            >
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
              ถ่ายรูป
            </button>
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              disabled={uploading || slips.length >= MAX_ATTACHMENTS}
              className="btn-secondary"
            >
              <ImagePlus className="size-4" />
              เลือกจากแกลอรี่
            </button>
          </div>

          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void addFile(f)
            }}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void addFile(f)
            }}
          />

          {slips.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {slips.map((s) => (
                <li key={s.objectKey} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.preview}
                    alt="สลิปที่แนบ"
                    className="size-20 rounded-md border border-line object-cover animate-pop-in"
                  />
                  <button
                    type="button"
                    onClick={() => removeSlip(s.objectKey)}
                    aria-label="เอารูปนี้ออก"
                    className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full border-2 border-surface bg-urgent-solid text-white transition-transform active:scale-90"
                  >
                    <X className="size-3.5" strokeWidth={2.5} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-xs text-muted-token">
            แนบได้สูงสุด {MAX_ATTACHMENTS} รูป · ระบบย่อรูปให้อัตโนมัติก่อนอัปโหลด
          </p>
        </div>

        <button onClick={submit} disabled={busy || uploading} className="btn-primary w-full py-3 text-lg">
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />}
          {busy ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </div>
    </div>
  )
}
