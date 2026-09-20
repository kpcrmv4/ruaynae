'use client'

import * as Dialog from '@radix-ui/react-dialog'
import {
  BadgeCheck, Check, FileCheck, FileText, Loader2, Printer, Receipt, Send, Trash2, Wallet, X,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { fmtBaht } from '@/lib/format'
import {
  CONVERT_TARGETS, DOC_KIND_SHORT, isEditable, type DocKind, type DocStatus,
} from '@/lib/documents'

type IncomeCategory = { id: string; name: string }

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่ทำได้',
  NOT_FOUND: 'ไม่พบเอกสารนี้',
  DOC_COUNTER_NOT_SET: 'ยังไม่ได้ตั้งเลขที่เอกสาร — ไปที่ ตั้งค่า → เอกสาร เพื่อกรอกเลขล่าสุด',
  DOC_ALREADY_ISSUED: 'เอกสารนี้ออกเลขไปแล้ว',
  DOC_NOT_ISSUED: 'ต้องออกเลขที่เอกสารก่อน',
  DOC_ALREADY_SENT: 'ทำเครื่องหมายว่าส่งแล้วไปก่อนหน้านี้',
  DOC_ALREADY_VOID: 'เอกสารนี้ถูกยกเลิกไปแล้ว',
  DOC_LINES_EMPTY: 'ต้องมีอย่างน้อยหนึ่งรายการก่อนออกเอกสาร',
  DOC_DELETE_ISSUED: 'เอกสารที่ออกเลขแล้วลบไม่ได้ ให้ยกเลิกแทน',
  DOC_ALREADY_CONVERTED: 'ใบชนิดนี้ถูกสร้างจากใบนี้ไปแล้ว — เปิดใบเดิมแทนการสร้างซ้ำ',
  CONVERT_PATH_INVALID: 'สร้างใบชนิดนี้ต่อจากใบนี้ไม่ได้',
  DOC_INCOME_LINKED: 'ใบนี้ผูกกับรายรับไปแล้ว',
  INCOME_RECEIPT_ONLY: 'ลงรายรับได้เฉพาะใบเสร็จ',
  ACCEPT_QUOTATION_ONLY: 'สถานะตอบรับมีเฉพาะใบเสนอราคา',
  CATEGORY_REQUIRED: 'เลือกหมวดรายรับก่อน',
  CATEGORY_INVALID: 'หมวดที่เลือกไม่ใช่หมวดรายรับ',
  TXN_ALREADY_LINKED: 'รายการนี้ถูกผูกกับเอกสารอื่นแล้ว',
  VOID_REASON_REQUIRED: 'ระบุเหตุผลที่ยกเลิก',
  DOC_LOCKED: 'เอกสารนี้ส่งให้ลูกค้าหรือผูกรายรับไปแล้ว แก้ไม่ได้',
}
const fail = (code?: string) => MESSAGES[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'

/**
 * ปุ่มทั้งหมดของเอกสารหนึ่งใบ
 *
 * 🔴 ปุ่มที่ซ่อนไม่ใช่การควบคุมสิทธิ์ — ทุกปุ่มที่นี่มี route ที่ปฏิเสธเองด้วย
 * ตรงนี้แค่ไม่พาคนไปกดสิ่งที่จะโดนปฏิเสธ
 */
export function DocActions({
  id,
  kind,
  status,
  txnId,
  total,
  incomeCategories,
}: {
  id: string
  kind: DocKind
  status: DocStatus
  txnId: string | null
  total: number
  incomeCategories: IncomeCategory[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [voidOpen, setVoidOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [incomeOpen, setIncomeOpen] = useState(false)
  const [categoryId, setCategoryId] = useState(incomeCategories[0]?.id ?? '')
  const [fieldError, setFieldError] = useState('')

  async function call(key: string, path: string, body?: unknown, ok = 'บันทึกแล้ว') {
    if (busy) return null
    setBusy(key)
    setFieldError('')
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        const msg = fail(b.error)
        setFieldError(msg)
        toast.error(msg)
        return null
      }
      toast.success(ok)
      router.refresh()
      return b
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
      return null
    } finally {
      setBusy(null)
    }
  }

  const spin = (key: string) => busy === key

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Link href={`/documents/${id}/print`} className="btn-secondary">
          <Printer className="size-4" />
          พิมพ์
        </Link>

        {isEditable(status, txnId) && (
          <Link href={`/documents/${id}/edit`} className="btn-secondary">
            แก้ไข
          </Link>
        )}

        {status === 'draft' && (
          <button
            type="button"
            onClick={() => call('issue', `/api/documents/${id}/issue`, undefined, 'ออกเลขที่เอกสารแล้ว')}
            disabled={busy !== null}
            className="btn-primary disabled:opacity-60"
          >
            {spin('issue') ? <Loader2 className="size-4 animate-spin" /> : <FileCheck className="size-4" />}
            ออกเอกสาร (ออกเลขที่)
          </button>
        )}

        {status === 'issued' && (
          <button
            type="button"
            onClick={() => call('send', `/api/documents/${id}/send`, undefined, 'ทำเครื่องหมายว่าส่งแล้ว')}
            disabled={busy !== null}
            className="btn-primary disabled:opacity-60"
          >
            {spin('send') ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            ส่งให้ลูกค้าแล้ว
          </button>
        )}

        {kind === 'quotation' && (status === 'issued' || status === 'sent') && (
          <button
            type="button"
            onClick={() => call('accept', `/api/documents/${id}/accept`, undefined, 'บันทึกการตอบรับแล้ว')}
            disabled={busy !== null}
            className="btn-secondary disabled:opacity-60"
          >
            {spin('accept') ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />}
            ลูกค้าตอบรับแล้ว
          </button>
        )}

        {/* ใบเสนอราคา → ใบแจ้งหนี้/ใบเสร็จ · ใบแจ้งหนี้ → ใบเสร็จ
            ข้ามใบแจ้งหนี้ได้โดยตั้งใจ — งานเล็กที่รับเงินสดหน้างานไม่มีใครวางบิลก่อน */}
        {status !== 'void' && status !== 'draft' &&
          CONVERT_TARGETS[kind].map((to) => (
            <button
              key={to}
              type="button"
              onClick={async () => {
                const b = await call(
                  `convert-${to}`,
                  `/api/documents/${id}/convert`,
                  { to },
                  `สร้างร่าง${DOC_KIND_SHORT[to]}แล้ว`,
                )
                if (b?.id) router.push(`/documents/${b.id}`)
              }}
              disabled={busy !== null}
              className="btn-secondary disabled:opacity-60"
            >
              {spin(`convert-${to}`)
                ? <Loader2 className="size-4 animate-spin" />
                : to === 'invoice' ? <FileText className="size-4" /> : <Receipt className="size-4" />}
              สร้าง{DOC_KIND_SHORT[to]}จากใบนี้
            </button>
          ))}

        {kind === 'receipt' && status !== 'draft' && status !== 'void' && !txnId && (
          <button
            type="button"
            onClick={() => { setIncomeOpen(true); setFieldError('') }}
            disabled={busy !== null}
            className="btn-secondary disabled:opacity-60"
          >
            <Wallet className="size-4" />
            ลงเป็นรายรับ
          </button>
        )}

        {status !== 'draft' && status !== 'void' && (
          <button
            type="button"
            onClick={() => { setVoidOpen(true); setReason(''); setFieldError('') }}
            disabled={busy !== null}
            className="btn-danger disabled:opacity-60"
          >
            <X className="size-4" />
            ยกเลิกเอกสาร
          </button>
        )}

        {status === 'draft' && (
          <button
            type="button"
            onClick={async () => {
              if (busy) return
              setBusy('delete')
              const r = await fetch(`/api/documents/${id}`, { method: 'DELETE' })
              setBusy(null)
              if (!r.ok) {
                const b = await r.json().catch(() => ({}))
                toast.error(fail(b.error))
                return
              }
              toast.success('ลบร่างแล้ว')
              router.push('/documents')
              router.refresh()
            }}
            disabled={busy !== null}
            className="btn-danger disabled:opacity-60"
          >
            {spin('delete') ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            ลบร่าง
          </button>
        )}
      </div>

      {fieldError && <p className="mt-2 text-sm text-urgent">{fieldError}</p>}

      {/* ── ยกเลิกเอกสาร ─────────────────────────────────────────── */}
      <Dialog.Root open={voidOpen} onOpenChange={(v) => { if (!busy) setVoidOpen(v) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
            <Dialog.Title className="text-lg font-bold text-ink">ยกเลิกเอกสาร</Dialog.Title>
            <Dialog.Description className="mt-0.5 text-sm text-muted-token">
              เลขที่ใบนี้จะ<span className="font-semibold text-ink">ไม่ถูกนำกลับมาใช้ซ้ำ</span> และยังอยู่ในระบบ
              เพื่อให้ตอบได้ว่าใบนั้นไปไหน · ออกใบใหม่ได้เลยหลังยกเลิก
            </Dialog.Description>
            <div className="mt-4">
              <label htmlFor="void-reason" className="label-base">เหตุผล</label>
              <input
                id="void-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="เช่น พิมพ์ยอดผิด"
                className="input-base"
                autoFocus
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close disabled={busy !== null} className="btn-secondary">ปิด</Dialog.Close>
              <button
                type="button"
                onClick={async () => {
                  const b = await call('void', `/api/documents/${id}/void`, { reason }, 'ยกเลิกเอกสารแล้ว')
                  if (b) setVoidOpen(false)
                }}
                disabled={busy !== null || reason.trim() === ''}
                className="btn-danger disabled:opacity-60"
              >
                {spin('void') ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                ยืนยันยกเลิก
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* ── ลงเป็นรายรับ ─────────────────────────────────────────── */}
      <Dialog.Root open={incomeOpen} onOpenChange={(v) => { if (!busy) setIncomeOpen(v) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
            <Dialog.Title className="text-lg font-bold text-ink">ลงเป็นรายรับ</Dialog.Title>
            <Dialog.Description className="mt-0.5 text-sm text-muted-token">
              จะบันทึกรายรับ <span className="font-semibold tnum text-ink">{fmtBaht(total)}</span>{' '}
              (ยอดเต็มตามหน้ากระดาษ) · ถ้าคีย์รายรับของงานนี้ไว้แล้ว{' '}
              <span className="font-semibold text-ink">อย่ากดซ้ำ</span> ให้ไปผูกจากหน้ารายการแทน
              ไม่งั้นรายรับจะนับสองรอบ
            </Dialog.Description>
            <div className="mt-4">
              <label htmlFor="income-cat" className="label-base">หมวดรายรับ</label>
              <select
                id="income-cat"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="input-base"
              >
                {incomeCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close disabled={busy !== null} className="btn-secondary">ปิด</Dialog.Close>
              <button
                type="button"
                onClick={async () => {
                  const b = await call('income', `/api/documents/${id}/income`, { categoryId }, 'ลงรายรับแล้ว')
                  if (b) setIncomeOpen(false)
                }}
                disabled={busy !== null || !categoryId}
                className="btn-primary disabled:opacity-60"
              >
                {spin('income') ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                บันทึกรายรับ
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
