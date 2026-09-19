'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { BadgeCheck, Loader2, Undo2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { fmtBaht } from '@/lib/format'
import { BOND_KIND_LABEL, type BondKind } from '@/lib/bonds'
import { PAY_METHODS, PAY_METHOD_LABEL, type PayMethod } from '@/lib/transactions'
import { siteError } from '../sites-client'

/**
 * ปุ่ม "ได้รับหลักประกันคืนแล้ว" + กล่องยืนยัน — และปุ่มยกเลิกเมื่อกดผิด
 *
 * เงินสดหักไว้ → ระบบลงรายรับของโครงการให้ทันที (บอกไว้ในกล่องก่อนกด)
 * หนังสือค้ำ → บันทึกวันรับคืนอย่างเดียว
 */
export function BondReturnButton({
  siteId,
  bondKind,
  bondAmount,
  today,
  returned,
}: {
  siteId: string
  bondKind: BondKind
  bondAmount: number
  today: string
  /** มีค่า = บันทึกรับคืนไปแล้ว → ปุ่มกลายเป็น "ยกเลิกการรับคืน" */
  returned: { at: string; amount: number } | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [date, setDate] = useState(today)
  const [amount, setAmount] = useState(String(bondAmount))
  const [payMethod, setPayMethod] = useState<PayMethod>('transfer')

  async function call(method: 'POST' | 'DELETE', body?: unknown, ok?: string) {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch(`/api/sites/${siteId}/bond-return`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(siteError(b.error))
        return
      }
      toast.success(ok ?? 'บันทึกแล้ว')
      setOpen(false)
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  if (returned) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => call('DELETE', undefined, 'ยกเลิกการรับคืนแล้ว')}
        className="btn-secondary text-sm"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
        ยกเลิกการรับคืน
      </button>
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !busy && setOpen(v)}>
      <Dialog.Trigger className="btn-primary text-sm">
        <BadgeCheck className="size-4" />
        ได้รับหลักประกันคืนแล้ว
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
          <Dialog.Title className="text-lg font-bold text-ink">บันทึกการรับหลักประกันคืน</Dialog.Title>
          <Dialog.Description className="mt-0.5 text-sm text-muted-token">
            {BOND_KIND_LABEL[bondKind]} · ตั้งไว้ {fmtBaht(bondAmount)}
            {bondKind === 'cash'
              ? ' — ระบบจะลงเป็นรายรับของโครงการนี้ให้ทันที (หมวด "หลักประกันสัญญาคืน")'
              : ' — บันทึกวันรับหนังสือคืน ไม่ใช่เงินเข้า'}
          </Dialog.Description>

          <div className="mt-4 grid gap-3">
            <div>
              <label htmlFor="bond-date" className="label-base">วันที่ได้รับคืน</label>
              <input
                id="bond-date"
                type="date"
                value={date}
                max={today}
                onChange={(e) => setDate(e.target.value)}
                className="input-base"
              />
            </div>
            <div>
              <label htmlFor="bond-amount" className="label-base">
                {bondKind === 'cash' ? 'ยอดที่ได้รับคืน (บาท)' : 'มูลค่าหนังสือค้ำ (บาท)'}
              </label>
              <input
                id="bond-amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input-base tnum"
              />
              {bondKind === 'cash' && (
                <p className="mt-1 text-xs text-muted-token">ราชการหักบางส่วนได้ — แก้ยอดให้ตรงกับที่ได้จริง</p>
              )}
            </div>
            {bondKind === 'cash' && (
              <div>
                <label htmlFor="bond-pay" className="label-base">รับเงินทาง</label>
                <select
                  id="bond-pay"
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as PayMethod)}
                  className="input-base"
                >
                  {PAY_METHODS.map((m) => (
                    <option key={m} value={m}>{PAY_METHOD_LABEL[m]}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close disabled={busy} className="btn-secondary">ยกเลิก</Dialog.Close>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                call('POST', { returnedAt: date, amount, payMethod }, 'บันทึกการรับคืนแล้ว')
              }
              className="btn-primary"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
