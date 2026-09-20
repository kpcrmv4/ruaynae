'use client'

import { Check, Loader2, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Role } from '@/lib/auth/current-user'
import { fmtBaht } from '@/lib/format'
import {
  TxnDraftFields, TxnKindSwitch, useTxnDraft,
  type DraftCategory, type DraftSite,
} from '@/components/ledger/txn-draft'
import type { TxnKind } from '@/lib/transactions'
import { BackButton } from '@/components/ui/back-button'

/**
 * หน้าบันทึกเต็มจอ — **เปลือก**ของฟอร์มที่อยู่ใน `components/ledger/txn-draft.tsx`
 *
 * ช่องกรอกและตรรกะทั้งหมดอยู่ที่นั่นที่เดียว เพราะกล่องบันทึกบน `/ledger`
 * ใช้ชุดเดียวกัน · ที่ต่างกันคือปุ่มบันทึกลอยเหนือแถบเมนู กับหัวเรื่องเท่านั้น
 */
export function EntryForm({
  role, today, sites, categories, initialKind = 'expense', initialSiteId,
}: {
  role: Role
  today: string
  sites: DraftSite[]
  categories: DraftCategory[]
  /** เปิดหน้าจากแผ่นบันทึกประจำวันด้วย ?kind=income — หน้า page กรอง role ให้แล้ว */
  initialKind?: TxnKind
  /** เปิดหน้าจากปุ่มลัดบนหน้าโครงการด้วย ?site= — หน้า page ตรวจแล้วว่าโครงการนี้เลือกได้จริง */
  initialSiteId?: string
}) {
  const router = useRouter()
  const draft = useTxnDraft({ role, today, sites, categories, initialKind, initialSiteId })

  // ยกเลิกแล้วกลับไปหน้าโครงการที่กำลังคีย์ให้ · ส่วนกลางไม่มีหน้าของตัวเอง
  // จึงกลับหน้าแรก แทนที่จะพาไปหน้าที่ไม่เกี่ยวกับสิ่งที่เพิ่งทำ
  const cancelHref = draft.currentSite ? `/sites/${draft.currentSite.id}` : '/'

  const save = async () => {
    if (await draft.submit()) {
      // จังหวะ "บันทึกรายการต่อ" — โครงการ หมวด วันที่ วิธีจ่าย ค้างไว้ให้
      // เคอร์เซอร์กลับไปที่ช่องยอดเงิน คีย์บิลใบถัดไปได้เลย
      draft.amountRef.current?.focus()
      router.refresh()
    }
  }

  const blocked = draft.busy || draft.uploading

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h1 className="min-w-0 text-2xl font-bold text-ink">
          {draft.isOwner ? 'บันทึกรายรับ-รายจ่าย' : 'บันทึกรายจ่าย'}
        </h1>
        <BackButton />
      </div>
      {/* 🔴 ตอบ "คีย์ให้โครงการไหน" ตั้งแต่บรรทัดบน ไม่ใช่ให้ตาเลื่อนลงไปหา
          กล่องเลือกกลางฟอร์ม · คนคีย์บิลเป็นตั้งจะสลับโครงการแล้วลืม แล้วยอด
          ไปเข้าโครงการผิดโดยไม่มีอะไรทัก */}
      <p className="mb-1 flex flex-wrap items-baseline gap-x-1.5 text-sm">
        <span className="text-muted-token">กำลังบันทึกของ</span>
        <span className="min-w-0 font-semibold text-ink">{draft.scopeLabel}</span>
      </p>
      <p className="mb-5 text-sm text-muted-token">
        {draft.isOwner
          ? 'รายการที่คุณคีย์เองจะถูกอนุมัติทันที'
          : 'รายการที่คีย์จะเข้าคิวรอเจ้าของอนุมัติ'}
      </p>

      <TxnKindSwitch draft={draft} />

      <div className="panel p-4">
        <TxnDraftFields draft={draft} />
      </div>

      {/* ── ปุ่มบันทึกลอยเหนือแถบเมนูล่างเสมอ ─────────────────────────────
          ฟอร์มยาวกว่าจอมือถือ — ปุ่มที่ต้องเลื่อนหาคือปุ่มที่กดช้าไปหนึ่งจังหวะ
          ยอดเงินอยู่บนปุ่มให้เช็คตาเปล่าอีกรอบก่อนกด · บนเดสก์ท็อปกลับไปอยู่
          ท้ายฟอร์มตามปกติ */}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mt-4 flex gap-2 lg:static">
        <button
          onClick={save}
          disabled={blocked}
          className="btn-primary flex-1 py-3 text-lg shadow-e2 lg:shadow-none"
        >
          {draft.busy ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />}
          {draft.busy ? (
            'กำลังบันทึก…'
          ) : (
            <>
              บันทึก
              {draft.amountValid && <span className="tnum">{fmtBaht(draft.amountNumber)}</span>}
            </>
          )}
        </button>
        {/* 🔴 ระหว่างกำลังบันทึกต้องกดไม่ได้ — ลิงก์ที่กดตอนนั้นจะพาออกจากหน้า
            กลางคัน แล้วคนคีย์จะไม่มีวันรู้ว่ารายการลงหรือไม่ลง · `<a>` ไม่มี
            `disabled` จึงต้องปิดทั้งเมาส์ (pointer-events) และแป้น (tabIndex) */}
        <Link
          href={cancelHref}
          aria-disabled={blocked ? 'true' : undefined}
          tabIndex={blocked ? -1 : undefined}
          className={`btn-secondary w-1/4 shrink-0 py-3 text-lg shadow-e2 lg:shadow-none ${
            blocked ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          <X className="size-5" />
          {/* จอแคบเหลือแค่กากบาท — คำว่า "ยกเลิก" ในช่องกว้าง 1/4 ของจอ 390px
              จะถูกตัดจนอ่านไม่ออกอยู่ดี · ชื่อยังอยู่ครบสำหรับโปรแกรมอ่านหน้าจอ */}
          <span className="sr-only sm:not-sr-only">ยกเลิก</span>
        </Link>
      </div>
    </div>
  )
}
