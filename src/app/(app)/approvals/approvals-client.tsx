'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Check, Loader2, Undo2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { fmtBaht } from '@/lib/format'
import { MAX_NOTE, txnError } from '@/lib/transactions'

/**
 * ปุ่มอนุมัติ / ตีกลับ ของหนึ่งรายการ
 *
 * 🔴 การตีกลับ **ต้องมีเหตุผล** — ทั้งฐานข้อมูล (check constraint) และ API
 * บังคับอยู่แล้ว · ตรงนี้บังคับอีกชั้นเพื่อไม่ให้ผู้ใช้เสียเวลายิงไปแล้วโดนปฏิเสธ
 * ส่งงานกลับโดยไม่บอกว่าต้องแก้อะไรคือการโยนงานทิ้ง ไม่ใช่การตรวจงาน
 */
export function ApprovalActions({ id, amount }: { id: string; amount: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [fieldError, setFieldError] = useState('')

  async function send(action: 'approve' | 'reject') {
    // 🔴 กันกดซ้ำสองชั้น: ปุ่ม disabled *และ* ธงตรงนี้ — การกดรัว ๆ ยิง onClick
    // ได้ก่อนที่ React จะ re-render ปุ่มเป็น disabled
    if (busy) return
    if (action === 'reject' && !reason.trim()) {
      setFieldError('กรุณาบอกเหตุผลที่ตีกลับ')
      return
    }
    setBusy(action)
    try {
      const r = await fetch(`/api/transactions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'approve' ? { action } : { action, reason: reason.trim() },
        ),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        const msg = txnError(b.error)
        setFieldError(msg)
        toast.error(msg)
        return
      }
      toast.success(action === 'approve' ? 'อนุมัติแล้ว' : 'ตีกลับแล้ว')
      setOpen(false)
      setReason('')
      setFieldError('')
      // แถวหายจากคิวเพราะ query กรอง `pending` — refresh ให้เซิร์ฟเวอร์คำนวณใหม่
      // ไม่ใช่ลบออกจาก state เอง ซึ่งจะเพี้ยนทันทีที่มีคนอื่นกดพร้อมกัน
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  return (
    // บนจอเล็กปุ่มขยายเต็มแถวและ "อนุมัติ" ได้ช่องใหญ่กว่า — งานหลักของหน้านี้
    // คือกดอนุมัติทีละใบด้วยนิ้วโป้ง ปุ่มเล็กชิดกันคือปุ่มที่กดพลาด
    <div className="grid w-full shrink-0 grid-cols-[1fr_1.4fr] items-center gap-2 sm:flex sm:w-auto">
      <Dialog.Root
        open={open}
        onOpenChange={(v) => {
          if (busy) return
          setOpen(v)
          if (!v) setFieldError('')
        }}
      >
        <Dialog.Trigger
          disabled={busy !== null}
          className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Undo2 className="size-4" />
          ตีกลับ
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90svh] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
            <Dialog.Title className="text-lg font-bold text-ink">
              ตีกลับรายการ {fmtBaht(amount)}
            </Dialog.Title>
            <Dialog.Description className="mt-0.5 text-sm text-muted-token">
              คนที่คีย์จะได้รับแจ้งเตือนพร้อมเหตุผลนี้ เพื่อให้แก้แล้วส่งใหม่ได้
            </Dialog.Description>

            <div className="mt-4">
              <label htmlFor={`reason-${id}`} className="label-base">
                เหตุผลที่ตีกลับ
              </label>
              <textarea
                id={`reason-${id}`}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value)
                  if (fieldError) setFieldError('')
                }}
                maxLength={MAX_NOTE}
                rows={3}
                placeholder="เช่น สลิปเบลอ อ่านยอดไม่ออก"
                aria-invalid={fieldError ? 'true' : undefined}
                className="input-base"
                autoFocus
              />
              {fieldError && <p className="mt-1 text-sm text-urgent">{fieldError}</p>}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close disabled={busy !== null} className="btn-secondary">
                ยกเลิก
              </Dialog.Close>
              <button
                type="button"
                onClick={() => send('reject')}
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
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <button
        type="button"
        onClick={() => send('approve')}
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
    </div>
  )
}
