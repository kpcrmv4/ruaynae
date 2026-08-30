'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { SITE_STATUSES, SITE_STATUS_LABEL, type SiteStatus } from '@/lib/sites'

export const SITE_ERRORS: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่เพิ่มหรือแก้ไซต์งานได้',
  NAME_REQUIRED: 'กรุณากรอกชื่อไซต์งาน',
  AMOUNT_INVALID: 'ค่างานต้องเป็นตัวเลขที่ไม่ติดลบ',
  DATE_INVALID: 'รูปแบบวันที่ไม่ถูกต้อง',
  DATE_BUDDHIST_ERA: 'ปีที่กรอกเป็น พ.ศ. — ระบบเก็บเป็น ค.ศ. กรุณาเลือกวันจากปฏิทิน',
  DATE_RANGE_INVALID: 'วันสิ้นสุดต้องไม่มาก่อนวันเริ่ม',
  STATUS_INVALID: 'สถานะไม่ถูกต้อง',
  NOT_FOUND: 'ไม่พบไซต์งานนี้',
  OVERLAP: 'ช่วงเวลาทับกับไซต์อื่นที่คนนี้ดูแลอยู่',
  CREATE_FAILED: 'บันทึกไม่สำเร็จ กรุณาลองใหม่',
}
export const siteError = (code?: string) => SITE_ERRORS[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'

const EMPTY = {
  name: '',
  clientName: '',
  clientPhone: '',
  address: '',
  contractAmount: '',
  startDate: '',
  endDate: '',
  status: 'active' as SiteStatus,
}

export function NewSiteButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [fieldError, setFieldError] = useState('')

  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  async function submit() {
    // 🔴 กันกดซ้ำสองชั้น: ปุ่ม disabled *และ* ธงตรงนี้ — ปุ่มอย่างเดียวไม่พอ
    // เพราะการกดรัว ๆ ยิง onClick ได้ก่อนที่ React จะ re-render ปุ่มเป็น disabled
    if (busy) return
    if (!form.name.trim()) {
      setFieldError('กรุณากรอกชื่อไซต์งาน')
      return
    }
    setFieldError('')
    setBusy(true)
    try {
      const r = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        setFieldError(siteError(b.error))
        toast.error(siteError(b.error))
        return
      }
      toast.success('เพิ่มไซต์งานแล้ว')
      setForm(EMPTY)
      setOpen(false)
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (busy) return
        setOpen(v)
        if (!v) setFieldError('')
      }}
    >
      <Dialog.Trigger className="btn-primary shrink-0">
        <Plus className="size-4" />
        เพิ่มไซต์งาน
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90svh] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
          <Dialog.Title className="text-lg font-bold text-ink">เพิ่มไซต์งาน</Dialog.Title>
          <Dialog.Description className="mt-0.5 text-sm text-muted-token">
            กรอกแค่ชื่อก็บันทึกได้ ค่างานและช่วงเวลาเติมทีหลังได้ในหน้าไซต์
          </Dialog.Description>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="site-name" className="label-base">ชื่อไซต์งาน</label>
              <input
                id="site-name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                aria-invalid={fieldError ? 'true' : undefined}
                className="input-base"
                autoFocus
              />
              {fieldError && <p className="mt-1 text-sm text-urgent">{fieldError}</p>}
            </div>

            <div>
              <label htmlFor="site-client" className="label-base">ชื่อลูกค้า</label>
              <input
                id="site-client"
                value={form.clientName}
                onChange={(e) => set('clientName', e.target.value)}
                className="input-base"
              />
            </div>
            <div>
              <label htmlFor="site-phone" className="label-base">เบอร์ติดต่อ</label>
              <input
                id="site-phone"
                type="tel"
                inputMode="tel"
                value={form.clientPhone}
                onChange={(e) => set('clientPhone', e.target.value)}
                className="input-base"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="site-address" className="label-base">ที่ตั้งหน้างาน</label>
              <input
                id="site-address"
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                className="input-base"
              />
            </div>

            <div>
              <label htmlFor="site-amount" className="label-base">ค่างานตามสัญญา (บาท)</label>
              <input
                id="site-amount"
                type="text"
                inputMode="decimal"
                value={form.contractAmount}
                onChange={(e) => set('contractAmount', e.target.value)}
                placeholder="0"
                className="input-base tnum"
              />
            </div>
            <div>
              <label htmlFor="site-status" className="label-base">สถานะ</label>
              <select
                id="site-status"
                value={form.status}
                onChange={(e) => set('status', e.target.value as SiteStatus)}
                className="input-base"
              >
                {SITE_STATUSES.map((s) => (
                  <option key={s} value={s}>{SITE_STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>

            {/* 🔴 input type=date แสดงปี พ.ศ. บนเครื่องที่ตั้งภาษาไทย
                แต่ค่าที่อ่านได้เป็น ค.ศ. เสมอ — ส่งลงฐานข้อมูลได้ตรง ๆ
                ห้ามแปลงปีเองที่ฝั่งนี้เด็ดขาด */}
            <div>
              <label htmlFor="site-start" className="label-base">วันเริ่มงาน</label>
              <input
                id="site-start"
                type="date"
                value={form.startDate}
                onChange={(e) => set('startDate', e.target.value)}
                className="input-base"
              />
            </div>
            <div>
              <label htmlFor="site-end" className="label-base">กำหนดส่งมอบ</label>
              <input
                id="site-end"
                type="date"
                value={form.endDate}
                onChange={(e) => set('endDate', e.target.value)}
                className="input-base"
              />
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close disabled={busy} className="btn-secondary">ยกเลิก</Dialog.Close>
            <button onClick={submit} disabled={busy} className="btn-primary">
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
