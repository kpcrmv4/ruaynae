'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Check, FileSearch, Loader2, Undo2, X } from 'lucide-react'
import { useState } from 'react'
import { fmtBaht } from '@/lib/format'
import { MAX_NOTE } from '@/lib/transactions'
import { SlipGallery } from '@/components/ui/slip-gallery'
import { useApproval } from './use-approval'

/**
 * รายละเอียดหนึ่งรายการในคิวอนุมัติ — ค่าถูกจัดรูปแบบมาจาก Server Component แล้ว
 *
 * 🔴 วันที่/เวลาเป็น **ข้อความสำเร็จรูป** ไม่ใช่ ISO ให้ client จัดเอง —
 * เบราว์เซอร์ของคนดูอาจตั้งโซนเวลาอื่น แล้ว "คีย์เมื่อ 21:30" จะกลายเป็นคนละวัน
 */
export type ApprovalDetailData = {
  id: string
  amount: number
  categoryName: string | null
  siteName: string | null
  dateLabel: string
  payMethodLabel: string
  incomeKindLabel: string | null
  note: string | null
  createdByName: string
  createdAtLabel: string
  ageDays: number
  attachments: { id: string }[]
}

/**
 * ปุ่ม "ดูรายละเอียด" + กล่องรายละเอียด
 *
 * ทำไมต้องมี ทั้งที่แถวในคิวก็บอกยอดกับโครงการอยู่แล้ว:
 * แถวในคิวถูกบีบให้สั้นเพื่อให้กวาดตาได้เร็ว — รายละเอียดยาว ๆ กับสลิปขนาดอ่านออก
 * จึงตกหล่น · คนอนุมัติที่ต้องตัดสินใจเรื่องเงินต้องเห็นของครบก่อนกด ไม่ใช่
 * เดาจากบรรทัดเดียวหรือรูปย่อขนาดนิ้วหัวแม่มือ
 *
 * 🔴 กล่องตีกลับเป็น "แผงในกล่องเดิม" ไม่ใช่ Dialog ซ้อน Dialog — Radix ซ้อนได้ก็จริง
 * แต่บนมือถือมันกลายเป็นสองชั้นที่ปุ่มย้อนกลับของเครื่องปิดผิดชั้น
 */
export function ApprovalDetailButton({ txn }: { txn: ApprovalDetailData }) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="btn-secondary w-full sm:w-auto">
        <FileSearch className="size-4" />
        ดูรายละเอียด
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90svh] w-[min(34rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-e3 animate-pop-in">
          {/* key = สถานะภายใน (รูปที่เลือก / ช่องเหตุผล) เริ่มใหม่ทุกครั้งที่เปิด */}
          {open && <DetailBody txn={txn} onDone={() => setOpen(false)} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function DetailBody({ txn, onDone }: { txn: ApprovalDetailData; onDone: () => void }) {
  const { busy, send } = useApproval(txn.id)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [fieldError, setFieldError] = useState('')

  async function approve() {
    const r = await send('approve')
    if (r.ok) onDone()
  }

  async function reject() {
    if (!reason.trim()) {
      setFieldError('กรุณาบอกเหตุผลที่ตีกลับ')
      return
    }
    const r = await send('reject', reason)
    if (r.ok) onDone()
    else if (r.error) setFieldError(r.error)
  }

  return (
    <>
      <div className="flex items-start gap-3 border-b border-line-soft px-4 py-3">
        <div className="min-w-0 flex-1">
          <Dialog.Title className="flex flex-wrap items-baseline gap-x-2 text-lg font-bold text-ink">
            <span className="tnum text-expense">−{fmtBaht(txn.amount)}</span>
            <span className="truncate">{txn.categoryName ?? 'ไม่มีหมวด'}</span>
          </Dialog.Title>
          <Dialog.Description className="mt-0.5 text-sm text-muted-token">
            รออนุมัติ · {txn.siteName ?? 'ส่วนกลาง (ไม่ผูกโครงการ)'}
          </Dialog.Description>
        </div>
        <Dialog.Close
          aria-label="ปิด"
          className="grid size-9 shrink-0 place-items-center rounded-md border border-line-strong bg-surface text-ink-2 transition-colors hover:border-ink-2 hover:text-ink"
        >
          <X className="size-4" strokeWidth={2} />
        </Dialog.Close>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
        {/* ── สลิป — ใหญ่พอให้อ่านยอดในรูปออก ─────────────────────────
            รูปย่อในแถวมีไว้ให้รู้ว่า "มีสลิป" · ตรงนี้คือที่ที่ใช้ตรวจจริง */}
        <div className="mb-4">
          <SlipGallery
            attachments={txn.attachments}
            emptyMessage="รายการนี้ไม่ได้แนบสลิป — ถ้าต้องมีหลักฐาน ให้ตีกลับพร้อมบอกว่าขอสลิปเพิ่ม"
          />
        </div>

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <Row label="วันที่" value={txn.dateLabel} />
          <Row label="โครงการ" value={txn.siteName ?? 'ส่วนกลาง (ไม่ผูกโครงการ)'} />
          <Row label="หมวด" value={txn.categoryName ?? 'ไม่มีหมวด'} />
          <Row label="วิธีจ่าย" value={txn.payMethodLabel} />
          {txn.incomeKindLabel && <Row label="ประเภท" value={txn.incomeKindLabel} />}
          <Row label="คีย์โดย" value={txn.createdByName} />
          <Row
            label="คีย์เมื่อ"
            value={
              <>
                {txn.createdAtLabel}
                {txn.ageDays >= 1 && (
                  <span className={txn.ageDays >= 2 ? ' font-semibold text-urgent' : ''}>
                    {' · '}ค้าง {txn.ageDays} วัน
                  </span>
                )}
              </>
            }
          />
          <Row label="รายละเอียด" value={txn.note?.trim() || '— ไม่ได้ระบุ —'} />
        </dl>
      </div>

      {/* ── ตัดสินใจได้จากในกล่องเลย ไม่ต้องปิดแล้วไปหาแถวเดิมอีกรอบ ───── */}
      <div className="border-t border-line-soft bg-surface px-4 py-3">
        {rejecting && (
          <div className="mb-3">
            <label htmlFor={`detail-reason-${txn.id}`} className="label-base">
              เหตุผลที่ตีกลับ
            </label>
            <textarea
              id={`detail-reason-${txn.id}`}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                if (fieldError) setFieldError('')
              }}
              maxLength={MAX_NOTE}
              rows={2}
              placeholder="เช่น สลิปเบลอ อ่านยอดไม่ออก"
              aria-invalid={fieldError ? 'true' : undefined}
              className="input-base"
              autoFocus
            />
            {fieldError && <p className="mt-1 text-sm text-urgent">{fieldError}</p>}
            <p className="mt-1 text-xs text-muted-token">
              คนที่คีย์จะได้รับแจ้งเตือนพร้อมเหตุผลนี้ เพื่อให้แก้แล้วส่งใหม่ได้
            </p>
          </div>
        )}

        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          {rejecting ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setRejecting(false)
                  setFieldError('')
                }}
                disabled={busy !== null}
                className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={reject}
                disabled={busy !== null || reason.trim() === ''}
                className="btn-danger disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === 'reject' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Undo2 className="size-4" />
                )}
                ยืนยันตีกลับ
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setRejecting(true)}
                disabled={busy !== null}
                className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Undo2 className="size-4" />
                ตีกลับ
              </button>
              <button
                type="button"
                onClick={approve}
                disabled={busy !== null}
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === 'approve' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                อนุมัติ
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-token">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </>
  )
}
