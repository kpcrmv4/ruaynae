'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Check, Loader2, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { Role } from '@/lib/auth/current-user'
import { fmtBaht } from '@/lib/format'
import {
  TxnDraftFields, TxnKindSwitch, useTxnDraft,
  type DraftCategory, type DraftSite,
} from '@/components/ledger/txn-draft'

/**
 * ปุ่ม "บันทึก" บนหน้ารายรับ-รายจ่าย — เปิดกล่องคีย์รายการโดยไม่ต้องออกจากลิสต์
 *
 * 🔴 ใช้ฟอร์มชุดเดียวกับหน้า `/entry` (`useTxnDraft` + `TxnDraftFields`) —
 * ไม่ใช่ฟอร์มที่สองที่เขียนขึ้นใหม่ · สองฟอร์มที่ตรวจไม่เหมือนกันคือบั๊กที่
 * รอวันเกิด และคนใช้จะเจอกฎคนละชุดขึ้นกับว่าเข้ามาทางไหน
 *
 * 🔴 `key` บนกล่อง = รีเซ็ตฟอร์มทุกครั้งที่เปิดใหม่ · ยอดเงินที่ค้างจากครั้งก่อน
 * คือยอดที่กำลังจะถูกบันทึกซ้ำโดยไม่ตั้งใจ
 */
export function TxnCreateButton({
  role,
  today,
  sites,
  categories,
  /** โครงการที่หน้ากำลังกรองอยู่ — เปิดกล่องมาแล้วอยู่ที่โครงการนั้นเลย */
  initialSiteId,
}: {
  role: Role
  today: string
  sites: DraftSite[]
  categories: DraftCategory[]
  initialSiteId?: string
}) {
  const [open, setOpen] = useState(false)
  const [seq, setSeq] = useState(0)

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) setSeq((n) => n + 1)
      }}
    >
      <Dialog.Trigger className="btn-primary shrink-0">
        <Plus className="size-4" />
        บันทึก
      </Dialog.Trigger>
      {open && (
        <CreateDialog
          key={seq}
          role={role}
          today={today}
          sites={sites}
          categories={categories}
          initialSiteId={initialSiteId}
          onClose={() => setOpen(false)}
        />
      )}
    </Dialog.Root>
  )
}

function CreateDialog({
  role, today, sites, categories, initialSiteId, onClose,
}: {
  role: Role
  today: string
  sites: DraftSite[]
  categories: DraftCategory[]
  initialSiteId?: string
  onClose: () => void
}) {
  const router = useRouter()
  const draft = useTxnDraft({ role, today, sites, categories, initialSiteId })
  const blocked = draft.busy || draft.uploading

  const save = async (keepOpen: boolean) => {
    if (!(await draft.submit())) return
    router.refresh()
    if (keepOpen) draft.amountRef.current?.focus()
    else onClose()
  }

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 animate-fade-in" />
      {/* 🔴 กล่องสูงเกินจอได้ — ให้เลื่อนในตัวเอง ไม่ใช่ดันหัวกล่องหลุดขอบบน
          (§17 ข้อ 7: ที่ถูกตัดทิ้งแย่กว่าที่เลื่อนได้) */}
      <Dialog.Content
        onInteractOutside={(e) => blocked && e.preventDefault()}
        onEscapeKeyDown={(e) => blocked && e.preventDefault()}
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[90svh] w-[min(36rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-e3 animate-pop-in"
      >
        <div className="border-b border-line-soft px-4 py-3">
          <Dialog.Title className="text-lg font-bold text-ink">
            {draft.isOwner ? 'บันทึกรายรับ-รายจ่าย' : 'บันทึกรายจ่าย'}
          </Dialog.Title>
          <Dialog.Description className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-sm">
            <span className="text-muted-token">กำลังบันทึกของ</span>
            <span className="min-w-0 font-semibold text-ink">{draft.scopeLabel}</span>
          </Dialog.Description>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <TxnKindSwitch draft={draft} />
          <TxnDraftFields draft={draft} idPrefix="new-" />
        </div>

        <div className="flex flex-wrap gap-2 border-t border-line-soft p-3">
          <Dialog.Close disabled={blocked} className="btn-secondary">
            ปิด
          </Dialog.Close>
          {/* คีย์บิลเป็นตั้งคือกรณีปกติ — ปุ่มที่ปิดกล่องทุกครั้งบังคับให้กด
              "บันทึก" ใหม่ทุกใบ · ปุ่มนี้จึงเก็บโครงการ หมวด วันที่ ไว้ให้ */}
          <button
            type="button"
            onClick={() => save(true)}
            disabled={blocked}
            className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
          >
            บันทึกแล้วคีย์ต่อ
          </button>
          <button
            type="button"
            onClick={() => save(false)}
            disabled={blocked}
            className="btn-primary ml-auto disabled:cursor-not-allowed disabled:opacity-60"
          >
            {draft.busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            บันทึก
            {draft.amountValid && <span className="tnum">{fmtBaht(draft.amountNumber)}</span>}
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  )
}
