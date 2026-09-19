'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Pencil, Sparkles, X } from 'lucide-react'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { fmtBaht, fmtDateLong, fmtDateTime } from '@/lib/format'
import {
  INCOME_KIND_LABEL, PAY_METHOD_LABEL, TXN_KIND_LABEL, TXN_STATUS_LABEL, TXN_STATUS_TONE,
  canModifyTxn,
} from '@/lib/transactions'
import { Badge } from '@/components/ui/badge'
import { SlipGallery } from '@/components/ui/slip-gallery'
import { useTxnEdit } from '@/components/ledger/txn-edit'
import { toEditableTxn } from '@/lib/txn-editable'
import type { TxnRowData } from '@/components/ledger/txn-row'

type OpenFn = (txn: TxnRowData) => void
const DetailCtx = createContext<OpenFn | null>(null)

/**
 * ครอบลิสต์รายการเพื่อให้ทุกแถวกดดูรายละเอียดได้
 *
 * 🔴 **กล่องมีตัวเดียวต่อหน้า ไม่ใช่ตัวหนึ่งต่อแถว** — เหตุผลเดียวกับกล่องแก้ไข
 * (`TxnEditProvider`) · สามสิบแถวที่แต่ละแถวพก dialog ของตัวเองคือ markup
 * สามสิบชุดที่ถูกส่งข้ามเน็ตเพื่อให้คนเปิดดูอย่างมากหนึ่งชุด
 *
 * ทำไมต้องมีกล่องนี้ ทั้งที่แถวก็บอกยอดกับหมวดอยู่แล้ว:
 * แถวถูกบีบให้กวาดตาได้เร็ว — รายละเอียดยาว ๆ จึงถูก `truncate` ตัดหาย และสลิป
 * เหลือขนาดนิ้วหัวแม่มือซึ่งอ่านอะไรไม่ได้ · ที่นี่คือที่ที่เปิดดูของจริง
 */
export function TxnDetailProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<TxnRowData | null>(null)

  return (
    <DetailCtx.Provider value={setTarget}>
      {children}
      {/* key = id → รูปที่เลือกในแกลเลอรีเริ่มใหม่ทุกครั้งที่เปิดแถวใหม่ */}
      {target && (
        <TxnDetailDialog key={target.id} txn={target} onClose={() => setTarget(null)} />
      )}
    </DetailCtx.Provider>
  )
}

/**
 * ปุ่มใสทับทั้งแถว — กดตรงไหนของการ์ดก็เปิดรายละเอียด
 *
 * 🔴 เป็นปุ่มซ้อนทับ ไม่ใช่การครอบทั้งแถวด้วย `<button>` — ในแถวมีปุ่มดินสอ
 * อยู่ด้วย และ `<button>` ซ้อน `<button>` เป็น HTML ที่ผิดซึ่งเบราว์เซอร์
 * จะแก้ให้เองด้วยการแยกแท็กออก แล้วเลย์เอาต์จะพังแบบหาสาเหตุไม่เจอ
 * · ปุ่มดินสออยู่ใน stacking ที่สูงกว่า จึงยังกดได้ตามปกติ
 */
export function TxnDetailTrigger({ txn, label }: { txn: TxnRowData; label: string }) {
  const open = useContext(DetailCtx)
  if (!open) return null
  return (
    <button
      type="button"
      onClick={() => open(txn)}
      aria-label={`ดูรายละเอียด ${label}`}
      className="absolute inset-0 z-0 cursor-pointer rounded-xs focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-brand"
    />
  )
}

function DetailDialogRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="text-muted-token">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </>
  )
}

function TxnDetailDialog({ txn: t, onClose }: { txn: TxnRowData; onClose: () => void }) {
  const edit = useTxnEdit()
  // ปุ่มแก้ไขในกล่องนี้ใช้กติกาเดียวกับปุ่มดินสอท้ายแถว — ปุ่มที่กดแล้ว
  // โดนปฏิเสธทุกครั้งคือปุ่มที่ไม่ควรมี (CLAUDE.md §15)
  const canEdit =
    edit !== null && canModifyTxn({ status: t.status, created_by: t.created_by }, edit.me)

  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90svh] w-[min(34rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-e3 animate-pop-in">
          <div className="flex items-start gap-3 border-b border-line-soft px-4 py-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="flex flex-wrap items-baseline gap-x-2 text-lg font-bold text-ink">
                <span className={`tnum ${t.kind === 'income' ? 'text-income' : 'text-expense'}`}>
                  {t.kind === 'income' ? '+' : '−'}
                  {fmtBaht(t.amount)}
                </span>
                <span className="truncate">{t.categories?.name ?? 'ไม่มีหมวด'}</span>
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-sm text-muted-token">
                {TXN_KIND_LABEL[t.kind]} · {t.site_id ? (t.sites?.name ?? 'โครงการ') : 'ส่วนกลาง (ไม่ผูกโครงการ)'}
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
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone={TXN_STATUS_TONE[t.status]} dot>
                {TXN_STATUS_LABEL[t.status]}
              </Badge>
              {t.mcp_key_id && (
                <span className="chip border border-dashed border-line-strong text-muted-token ring-0">
                  <Sparkles className="size-3" strokeWidth={2} aria-hidden />
                  บันทึกผ่าน AI
                </span>
              )}
            </div>

            {/* 🔴 เหตุผลที่ตีกลับอยู่เหนือทุกอย่าง — คนเปิดใบที่ถูกตีกลับมาเพื่อ
                หาว่า "ต้องแก้อะไร" ไม่ใช่มาอ่านยอดที่ตัวเองคีย์เอง */}
            {t.status === 'rejected' && (
              <p className="mb-3 rounded-md border border-urgent-ring bg-urgent-bg px-3 py-2.5 text-sm text-urgent">
                <span className="font-semibold">เหตุผลที่ตีกลับ:</span>{' '}
                {t.rejected_reason?.trim() || 'ไม่ได้ระบุเหตุผล'}
              </p>
            )}

            <div className="mb-4">
              <SlipGallery
                attachments={t.attachments}
                emptyMessage="ไม่ได้แนบสลิป / บิลไว้กับรายการนี้"
              />
            </div>

            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <DetailDialogRow label="วันที่" value={fmtDateLong(t.txn_date)} />
              <DetailDialogRow
                label="โครงการ"
                value={t.site_id ? (t.sites?.name ?? 'โครงการ') : 'ส่วนกลาง (ไม่ผูกโครงการ)'}
              />
              <DetailDialogRow label="หมวด" value={t.categories?.name ?? 'ไม่มีหมวด'} />
              <DetailDialogRow label="วิธีจ่าย" value={PAY_METHOD_LABEL[t.pay_method]} />
              {t.income_kind && (
                <DetailDialogRow
                  label="ประเภท"
                  value={`${INCOME_KIND_LABEL[t.income_kind]}${t.installment_no ? ` ${t.installment_no}` : ''}`}
                />
              )}
              {/* ชื่อคนคีย์โผล่เท่าที่ RLS ให้เห็น — หัวหน้าโครงการอ่านโปรไฟล์
                  คนอื่นไม่ได้ จึงไม่วาดแถวนี้เลยแทนที่จะวาดเป็นขีดกลางลอย ๆ */}
              {t.profiles?.full_name && (
                <DetailDialogRow label="คีย์โดย" value={t.profiles.full_name} />
              )}
              {t.created_at && (
                <DetailDialogRow label="คีย์เมื่อ" value={fmtDateTime(t.created_at)} />
              )}
              <DetailDialogRow label="รายละเอียด" value={t.note?.trim() || '— ไม่ได้ระบุ —'} />
            </dl>
          </div>

          <div className="flex justify-end gap-2 border-t border-line-soft px-4 py-3">
            <Dialog.Close className="btn-secondary">ปิด</Dialog.Close>
            {canEdit && edit && (
              <button
                type="button"
                onClick={() => {
                  // ปิดกล่องนี้ก่อนแล้วค่อยเปิดกล่องแก้ไข — ไม่ซ้อนสอง dialog
                  // ซึ่งบนมือถือปุ่มย้อนกลับของเครื่องจะปิดผิดชั้น
                  onClose()
                  edit.open(toEditableTxn(t))
                }}
                className="btn-primary"
              >
                <Pencil className="size-4" strokeWidth={2} />
                แก้ไข
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
