'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Check, HandCoins, Loader2, Pencil, Trash2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/states'
import { fmtBaht, fmtDate } from '@/lib/format'
import { MAX_NOTE } from '@/lib/transactions'
import {
  ADVANCE_STATUS_LABEL, ADVANCE_STATUS_TONE, advanceError, type AdvanceStatus,
} from '@/lib/advances'

type Site = { id: string; name: string }
type Worker = { id: string; full_name: string; job_title: string | null }

export type RequestRow = {
  id: string
  amount: number
  advance_date: string
  status: AdvanceStatus
  rejected_reason: string | null
  note: string | null
  site_id: string | null
  site_name: string | null
  employee_id: string
  employee_name: string
  /** > 0 = ถูกหักคืนจากค่าแรงไปแล้วบางส่วน — แก้และลบไม่ได้อีก */
  deducted_amount: number
}

/**
 * ฟอร์มยื่นคำขอ + รายการคำขอของตัวเอง
 *
 * 🔴 ฟอร์มเดียวทำทั้ง "ยื่นใหม่" และ "แก้แล้วส่งใหม่" — คำขอที่ถูกตีกลับ
 * แก้ในฟอร์มเดิมแล้วกดส่ง ฐานข้อมูลดันสถานะกลับเป็นรออนุมัติให้เอง
 * · ถ้าหน้าจอบอกว่า "แก้แล้วส่งใหม่ได้" แต่ไม่มีปุ่มที่ทำได้จริง
 *   นั่นคือกับดัก §17 ข้อ 18 ซ้ำรอบที่สอง
 */
export function AdvanceRequestBoard({
  today, sites, workers, rows,
}: {
  today: string
  sites: Site[]
  workers: Worker[]
  rows: RequestRow[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<RequestRow | null>(null)

  /** กำลังแก้คำขอใบไหนอยู่ · null = กำลังยื่นใบใหม่ */
  const [editing, setEditing] = useState<RequestRow | null>(null)
  const [employeeId, setEmployeeId] = useState('')
  // โครงการเดียวก็ไม่ต้องให้เลือก — เลือกให้เลย (หัวหน้าส่วนใหญ่ดูแลที่เดียว)
  const [siteId, setSiteId] = useState(sites.length === 1 ? sites[0].id : '')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')

  const resetForm = () => {
    setEditing(null)
    setEmployeeId('')
    setSiteId(sites.length === 1 ? sites[0].id : '')
    setAmount('')
    setDate(today)
    setNote('')
    setFieldError('')
  }

  const startEdit = (r: RequestRow) => {
    setEditing(r)
    setEmployeeId(r.employee_id)
    setSiteId(r.site_id ?? (sites.length === 1 ? sites[0].id : ''))
    setAmount(String(r.amount))
    setDate(r.advance_date)
    setNote(r.note ?? '')
    setFieldError('')
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function send(key: string, url: string, method: string, body?: unknown) {
    // กันกดซ้ำสองชั้น: ปุ่ม disabled *และ* ธงตรงนี้
    if (busy) return false
    setBusy(key)
    setFieldError('')
    try {
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const b = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) {
        const msg = advanceError(b.error)
        setFieldError(msg)
        toast.error(msg)
        return false
      }
      router.refresh()
      return true
    } catch {
      // 🔴 ข้อความของเบราว์เซอร์เป็นอังกฤษ ("Failed to fetch") — ห้ามขึ้นจอ
      const msg = 'เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่'
      setFieldError(msg)
      toast.error(msg)
      return false
    } finally {
      setBusy(null)
    }
  }

  const submit = async () => {
    const payload = {
      employeeId,
      siteId,
      amount,
      advanceDate: date,
      note,
    }
    const ok = editing
      ? await send('form', `/api/advances/${editing.id}`, 'PATCH', payload)
      : await send('form', '/api/advances', 'POST', payload)
    if (!ok) return
    toast.success(editing ? 'แก้แล้วส่งใหม่ให้เจ้าของอนุมัติ' : 'ส่งคำขอแล้ว รอเจ้าของอนุมัติ')
    resetForm()
  }

  const canSubmit =
    employeeId !== '' && siteId !== '' && amount.trim() !== '' && date !== '' && busy === null

  return (
    <>
      <section className="panel mb-5 p-4">
        <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-ink">
          <HandCoins className="size-4 text-brand" />
          {editing ? 'แก้คำขอแล้วส่งใหม่' : 'ยื่นคำขอเบิกให้ลูกน้อง'}
        </h2>

        <div className="space-y-3">
          <div>
            <label htmlFor="adv-worker" className="label-base">คนงาน</label>
            <select
              id="adv-worker"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="input-base"
            >
              <option value="">— เลือกคนงาน —</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.full_name}
                  {w.job_title ? ` · ${w.job_title}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="adv-site" className="label-base">โครงการ</label>
            <select
              id="adv-site"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="input-base"
            >
              <option value="">— เลือกโครงการ —</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="adv-amount" className="label-base">จำนวนเงินที่ขอเบิก (บาท)</label>
              <input
                id="adv-amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                aria-invalid={fieldError ? 'true' : undefined}
                className="input-base tnum"
              />
            </div>
            <div>
              <label htmlFor="adv-date" className="label-base">วันที่ขอเบิก</label>
              {/* `max` กันวันในอนาคตตั้งแต่บนหน้าจอ · route และ trigger กันซ้ำอีกสองชั้น
                  · `<input type="date">` ส่งค่าเป็น ค.ศ. เสมอ ห้ามแปลงก่อนส่ง */}
              <input
                id="adv-date"
                type="date"
                value={date}
                max={today}
                onChange={(e) => setDate(e.target.value)}
                className="input-base tnum"
              />
            </div>
          </div>

          <div>
            <label htmlFor="adv-note" className="label-base">เหตุผล / หมายเหตุ (ไม่บังคับ)</label>
            <input
              id="adv-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={MAX_NOTE}
              placeholder="เช่น ขอเบิกไปจ่ายค่ารถกลับบ้าน"
              className="input-base"
            />
          </div>

          {fieldError && <p className="text-sm text-urgent">{fieldError}</p>}

          <p className="text-xs text-muted-token">
            คำขอนี้ยังไม่ใช่การจ่ายเงิน — เจ้าของจะเป็นคนกดอนุมัติว่าให้เบิกหรือไม่ให้
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="btn-primary flex-1 py-2.5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === 'form' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              {editing ? 'ส่งใหม่' : 'ส่งคำขอ'}
            </button>
            {editing && (
              <button
                type="button"
                onClick={resetForm}
                disabled={busy !== null}
                className="btn-secondary shrink-0 py-2.5"
              >
                <X className="size-4" />
                ยกเลิกการแก้
              </button>
            )}
          </div>
        </div>
      </section>

      {rows.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          message="ยังไม่เคยยื่นคำขอเบิก — กรอกแบบฟอร์มด้านบนแล้วคำขอจะมารออยู่ตรงนี้"
        />
      ) : (
        <div className="panel">
          <div className="panel-head">คำขอของฉัน {rows.length} รายการ</div>
          <ul>
            {rows.map((r) => {
              const editable = r.status !== 'approved' && r.deducted_amount === 0
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-line-soft px-3.5 py-3 last:border-b-0 md:px-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-base font-bold tnum text-ink">{fmtBaht(r.amount)}</span>
                      <span className="truncate font-semibold text-ink-2">{r.employee_name}</span>
                      <Badge tone={ADVANCE_STATUS_TONE[r.status]}>
                        {ADVANCE_STATUS_LABEL[r.status]}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-sm text-muted-token">
                      {fmtDate(r.advance_date)}
                      {r.site_name && ` · ${r.site_name}`}
                    </div>
                    {r.note && <div className="mt-0.5 text-sm text-ink-2">{r.note}</div>}
                    {r.status === 'rejected' && (
                      <div className="mt-1 rounded-xs bg-urgent-bg px-2.5 py-1.5 text-sm text-urgent">
                        เจ้าของตีกลับ: {r.rejected_reason?.trim() || 'ไม่ได้ระบุเหตุผล'}
                      </div>
                    )}
                  </div>

                  {editable && (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(r)}
                        disabled={busy !== null}
                        aria-label={`แก้คำขอ ${fmtBaht(r.amount)} ของ ${r.employee_name}`}
                        className="btn-secondary px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Pencil className="size-4" />
                        {r.status === 'rejected' ? 'แก้แล้วส่งใหม่' : 'แก้'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(r)}
                        disabled={busy !== null}
                        aria-label={`ลบคำขอ ${fmtBaht(r.amount)} ของ ${r.employee_name}`}
                        className="btn-secondary px-3 py-2 text-urgent disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* ── ยืนยันก่อนลบ — radix ไม่ใช่ confirm() ของเบราว์เซอร์ ────────── */}
      <Dialog.Root
        open={confirmDelete !== null}
        onOpenChange={(v) => {
          if (busy) return
          if (!v) setConfirmDelete(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
            <Dialog.Title className="text-lg font-bold text-ink">ลบคำขอนี้</Dialog.Title>
            <Dialog.Description className="mt-0.5 text-sm text-muted-token">
              {confirmDelete
                ? `${confirmDelete.employee_name} · ${fmtBaht(confirmDelete.amount)} · ${fmtDate(confirmDelete.advance_date)}`
                : ''}
            </Dialog.Description>
            <p className="mt-3 text-sm text-ink-2">
              ลบแล้วคำขอจะหายจากคิวของเจ้าของ · ยื่นใหม่ได้ตลอด
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close disabled={busy !== null} className="btn-secondary">ยกเลิก</Dialog.Close>
              <button
                type="button"
                onClick={async () => {
                  if (!confirmDelete) return
                  const ok = await send('del', `/api/advances/${confirmDelete.id}`, 'DELETE')
                  if (ok) {
                    toast.success('ลบคำขอแล้ว')
                    if (editing?.id === confirmDelete.id) resetForm()
                    setConfirmDelete(null)
                  }
                }}
                disabled={busy !== null}
                className="btn-danger disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === 'del' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                ยืนยันลบ
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
