'use client'

import * as Dialog from '@radix-ui/react-dialog'
import {
  AlertTriangle, Camera, Coins, ImagePlus, Landmark, Loader2, Pencil, Trash2, Undo2, X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { Role } from '@/lib/auth/current-user'
import { IMAGE_UPLOAD_ACCEPT, MAX_ATTACHMENTS } from '@/lib/constants'
import { fmtBaht } from '@/lib/format'
import { slipUploadError, uploadSlip } from '@/lib/slip-upload'
import {
  INCOME_KINDS, INCOME_KIND_LABEL, MAX_NOTE, PAY_METHODS, PAY_METHOD_LABEL,
  TXN_KIND_LABEL, canModifyTxn, txnError,
  type IncomeKind, type TxnKind,
} from '@/lib/transactions'
// 🔴 `toEditableTxn` อยู่ในไฟล์ธรรมดา ไม่ใช่ไฟล์นี้ — ฟังก์ชันที่ export จาก
// โมดูล 'use client' เรียกจาก Server Component ไม่ได้ (พังตอนรัน ไม่ใช่ตอน
// typecheck) และ `TxnRow` ซึ่งเป็น Server Component เป็นคนเรียกมัน
export type { EditableTxn } from '@/lib/txn-editable'
import type { EditableTxn } from '@/lib/txn-editable'

type Site = { id: string; name: string }
type Category = { id: string; name: string; kind: TxnKind }
type Me = { id: string; role: Role }

const CENTRAL = '__central__'

type OpenFn = (txn: EditableTxn) => void
const EditCtx = createContext<{ open: OpenFn; me: Me } | null>(null)

/**
 * ครอบลิสต์รายการเพื่อให้ทุกแถวมีปุ่มแก้ไขได้
 *
 * 🔴 **กล่องแก้ไขมีตัวเดียวต่อหน้า ไม่ใช่ตัวหนึ่งต่อแถว** — ตัวเลือกโครงการกับ
 * หมวดเป็นชุดเดียวกันทั้งหน้า ถ้าแนบไปกับทุกแถวมันจะถูกส่งข้ามเน็ตซ้ำ
 * สามสิบรอบต่อการเปิดหนึ่งหน้า บนมือถือกลางโครงการที่สัญญาณไม่ดี
 */
export function TxnEditProvider({
  me, today, sites, categories, children,
}: {
  me: Me
  /** วันนี้ตามเวลาไทย คำนวณฝั่งเซิร์ฟเวอร์ — ห้ามใช้ new Date() ที่นี่ */
  today: string
  sites: Site[]
  categories: Category[]
  children: ReactNode
}) {
  const [target, setTarget] = useState<EditableTxn | null>(null)

  return (
    <EditCtx.Provider value={{ open: setTarget, me }}>
      {children}
      {/* key = id → ฟอร์มเริ่มค่าจากแถวที่กดใหม่ทุกครั้ง ไม่มีค่าค้างจากแถวก่อน */}
      {target && (
        <TxnEditDialog
          key={target.id}
          txn={target}
          me={me}
          today={today}
          sites={sites}
          categories={categories}
          onClose={() => setTarget(null)}
        />
      )}
    </EditCtx.Provider>
  )
}

/**
 * กล่องแก้ไขของหน้านี้ (ถ้ามี) — กล่องรายละเอียดใช้เปิดต่อจากตัวเอง
 * คืน `null` เมื่อหน้านั้นไม่ได้ครอบด้วย provider ซึ่งแปลว่า "หน้านี้ไม่มีการแก้ไข"
 */
export function useTxnEdit() {
  return useContext(EditCtx)
}

/**
 * ปุ่มดินสอท้ายแถว · ไม่วาดเลยถ้าคนนี้แก้แถวนี้ไม่ได้
 * (ปุ่มที่กดแล้วถูกปฏิเสธทุกครั้งคือปุ่มที่ไม่ควรมี — CLAUDE.md §15)
 */
export function TxnEditButton({ txn }: { txn: EditableTxn }) {
  const ctx = useContext(EditCtx)
  if (!ctx) return null
  if (!canModifyTxn({ status: txn.status, created_by: txn.createdBy }, ctx.me)) return null
  return (
    <button
      type="button"
      onClick={() => ctx.open(txn)}
      aria-label={`แก้ไขรายการ ${fmtBaht(txn.amount)}`}
      className="grid size-11 shrink-0 place-items-center rounded-md border border-line-strong bg-surface text-ink-2 transition-colors duration-100 hover:border-ink-2 hover:text-ink active:bg-surface-2"
    >
      <Pencil className="size-4" strokeWidth={1.8} />
    </button>
  )
}

function Field({ id, label, span, children }: {
  id?: string; label: string; span?: boolean; children: ReactNode
}) {
  return (
    <div className={span ? 'sm:col-span-2' : undefined}>
      {id ? (
        <label htmlFor={id} className="label-base">{label}</label>
      ) : (
        <span className="label-base">{label}</span>
      )}
      {children}
    </div>
  )
}

function TxnEditDialog({
  txn, me, today, sites, categories, onClose,
}: {
  txn: EditableTxn
  me: Me
  today: string
  sites: Site[]
  categories: Category[]
  onClose: () => void
}) {
  const router = useRouter()
  const isOwner = me.role === 'owner'
  const [busy, setBusy] = useState<null | 'save' | 'delete' | 'slip'>(null)
  const [confirming, setConfirming] = useState(false)
  const [fieldError, setFieldError] = useState<{ field: string; text: string } | null>(null)
  const [slips, setSlips] = useState(txn.attachments)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({
    siteId: txn.siteId ?? CENTRAL,
    categoryId: txn.categoryId,
    amount: String(txn.amount),
    txnDate: txn.txnDate,
    payMethod: txn.payMethod,
    incomeKind: (txn.incomeKind ?? 'installment') as IncomeKind,
    installmentNo: txn.installmentNo === null ? '' : String(txn.installmentNo),
    note: txn.note ?? '',
  })

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setFieldError(null)
  }

  const amountNumber = Number(form.amount.replace(/,/g, ''))
  const amountValid = Number.isFinite(amountNumber) && amountNumber > 0

  // 🔴 หมวดที่ถูกปิดใช้งานไปแล้วไม่อยู่ในลิสต์ — ถ้าไม่เติมกลับเข้าไป
  // การเปิดกล่องแก้ไขจะทำให้หมวดของแถวนั้นหายไปเงียบ ๆ แล้วบันทึกทับด้วย
  // หมวดอื่น · เรื่องเดียวกับโครงการที่ปิดงานแล้วข้างล่าง
  const visibleCategories = categories.filter((c) => c.kind === txn.kind)
  const categoryOptions = visibleCategories.some((c) => c.id === txn.categoryId)
    ? visibleCategories
    : [...visibleCategories, { id: txn.categoryId, name: txn.categoryName ?? 'หมวดเดิม', kind: txn.kind }]

  const siteOptions = txn.siteId && !sites.some((s) => s.id === txn.siteId)
    ? [...sites, { id: txn.siteId, name: txn.siteName ?? 'โครงการเดิม' }]
    : sites

  /** ปิดกล่อง แล้วให้เซิร์ฟเวอร์คำนวณยอดใหม่ — ไม่แก้ตัวเลขในหน้าเอง */
  const done = (message: string) => {
    toast.success(message)
    onClose()
    router.refresh()
  }

  async function save() {
    if (busy) return
    if (!amountValid) return setFieldError({ field: 'amount', text: 'จำนวนเงินต้องมากกว่า 0' })
    if (!form.categoryId) return setFieldError({ field: 'category', text: 'กรุณาเลือกหมวด' })

    setBusy('save')
    try {
      const r = await fetch(`/api/transactions/${txn.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // ชนิดรายการแก้ที่นี่ไม่ได้ — รายรับที่คีย์ผิดเป็นรายจ่ายต้องลบแล้ว
          // คีย์ใหม่ ไม่ใช่สลับชนิดทับของเดิมจนหมวดกับยอดไม่เข้าพวกกัน
          kind: txn.kind,
          siteId: form.siteId === CENTRAL ? null : form.siteId,
          categoryId: form.categoryId,
          amount: amountNumber,
          txnDate: form.txnDate,
          payMethod: form.payMethod,
          note: form.note,
          ...(txn.kind === 'income'
            ? {
                incomeKind: form.incomeKind,
                ...(form.incomeKind === 'installment' ? { installmentNo: form.installmentNo } : {}),
              }
            : {}),
        }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(txnError(b.error))
        return
      }
      // หัวหน้าโครงการแก้ของที่ถูกตีกลับ = ส่งใหม่ · ฐานข้อมูลดันสถานะกลับเป็น
      // `pending` ให้เอง — บอกให้ตรงกับสิ่งที่เกิดขึ้นจริง ไม่ใช่ "บันทึกแล้ว" เฉย ๆ
      done(
        txn.status === 'rejected' && b.transaction?.status === 'pending'
          ? 'แก้แล้ว ส่งให้เจ้าของอนุมัติอีกครั้ง'
          : 'บันทึกการแก้ไขแล้ว',
      )
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (busy) return
    setBusy('delete')
    try {
      const r = await fetch(`/api/transactions/${txn.id}`, { method: 'DELETE' })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(txnError(b.error))
        return
      }
      done('ลบรายการแล้ว')
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  /**
   * แนบสลิปเพิ่มเข้ารายการที่บันทึกไปแล้ว
   *
   * ⚠️ มีผลทันทีที่อัปเสร็จ ไม่รอปุ่มบันทึก — เพราะสลิปถูกผูกด้วย endpoint
   * ของตัวเอง (`POST …/attachments`) · กล่องนี้จึงเขียนกำกับไว้ให้ชัดว่า
   * รูปบันทึกทันที ไม่ใช่ปล่อยให้ผู้ใช้เดาว่ากดยกเลิกแล้วรูปจะหายไหม
   */
  async function addSlip(file: File) {
    if (busy) return
    if (slips.length >= MAX_ATTACHMENTS) {
      toast.error('แนบได้ไม่เกิน ' + MAX_ATTACHMENTS + ' รูปต่อรายการ')
      return
    }
    setBusy('slip')
    try {
      const up = await uploadSlip(file, form.siteId === CENTRAL ? null : form.siteId)
      const r = await fetch(`/api/transactions/${txn.id}/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attachments: [{ objectKey: up.objectKey, thumbKey: up.thumbKey }],
        }),
      })
      URL.revokeObjectURL(up.preview)
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(txnError(b.error))
        return
      }
      toast.success('แนบสลิปแล้ว')
      // 🔴 ใช้ id จริงที่เซิร์ฟเวอร์คืนมา ไม่ใช่ id ที่แต่งขึ้นเอง — รูปย่อ
      // โหลดผ่าน `/api/uploads/<id>` ซึ่ง id ปลอมจะกลายเป็นรูปพังทันที
      const ids: string[] = Array.isArray(b.attachmentIds) ? b.attachmentIds : []
      setSlips((cur) => [...cur, ...ids.map((id) => ({ id }))])
      router.refresh()
    } catch (e) {
      toast.error(slipUploadError(e))
    } finally {
      setBusy(null)
    }
  }

  async function removeSlip(id: string) {
    if (busy) return
    setBusy('slip')
    try {
      const r = await fetch(`/api/attachments/${id}`, { method: 'DELETE' })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(txnError(b.error))
        return
      }
      setSlips((cur) => cur.filter((s) => s.id !== id))
      toast.success('เอาสลิปออกแล้ว')
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  const err = (field: string) => (fieldError?.field === field ? fieldError.text : null)
  const working = busy !== null

  return (
    <Dialog.Root open onOpenChange={(v) => !v && !working && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90svh] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
          {confirming ? (
            <>
              <Dialog.Title className="text-lg font-bold text-ink">
                ลบรายการ {fmtBaht(txn.amount)} ?
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-token">
                {txn.status === 'approved'
                  ? 'รายการนี้อนุมัติแล้ว การลบจะทำให้ยอดรวมของโครงการและรายงานเปลี่ยนย้อนหลังทันที'
                  : 'รายการนี้จะหายจากทุกหน้าและจากคิวอนุมัติ'}{' '}
                ค่าเดิมทั้งแถวยังถูกเก็บไว้ในประวัติการแก้ไข (/audit) แต่กู้กลับเป็นรายการไม่ได้
              </Dialog.Description>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={working}
                  className="btn-secondary"
                >
                  <Undo2 className="size-4" />
                  ย้อนกลับ
                </button>
                <button type="button" onClick={remove} disabled={working} className="btn-danger">
                  {busy === 'delete' ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  ยืนยันลบ
                </button>
              </div>
            </>
          ) : (
            <>
              <Dialog.Title className="text-lg font-bold text-ink">
                แก้ไข{TXN_KIND_LABEL[txn.kind]}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-sm text-muted-token">
                ชนิดรายการเปลี่ยนที่นี่ไม่ได้ — ถ้าคีย์ผิดชนิด ให้ลบแล้วคีย์ใหม่
              </Dialog.Description>

              {/* ── เตือนตามสถานะ — คนกดต้องรู้ผลก่อนกด ไม่ใช่หลังกด ─────── */}
              {txn.status === 'approved' && (
                <p className="mt-3 flex gap-2 rounded-md border border-urgent-ring bg-urgent-bg px-3 py-2 text-sm text-urgent">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
                  <span>
                    รายการนี้อนุมัติแล้ว การแก้จะเปลี่ยนยอดรวมของโครงการและรายงานย้อนหลัง
                    ทุกการแก้ถูกบันทึกไว้ในประวัติ (/audit)
                  </span>
                </p>
              )}
              {txn.status === 'rejected' && !isOwner && (
                <p className="mt-3 rounded-md border border-brand-tint-strong bg-brand-tint px-3 py-2 text-sm text-brand-on-tint">
                  แก้แล้วกดบันทึก รายการจะกลับเข้าคิวรอเจ้าของอนุมัติอีกครั้ง
                </p>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field id={`amount-${txn.id}`} label="จำนวนเงิน (บาท)">
                  <input
                    id={`amount-${txn.id}`}
                    type="text"
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(e) => set('amount', e.target.value)}
                    aria-invalid={err('amount') ? 'true' : undefined}
                    className="input-base py-2.5 text-xl font-bold tnum"
                    autoFocus
                  />
                  {err('amount') ? (
                    <p className="mt-1 text-sm text-urgent">{err('amount')}</p>
                  ) : (
                    amountValid && (
                      <p className="mt-1 text-sm tnum text-muted-token">{fmtBaht(amountNumber)}</p>
                    )
                  )}
                </Field>

                <Field id={`date-${txn.id}`} label="วันที่">
                  {/* 🔴 input type=date แสดงปี พ.ศ. บนเครื่องที่ตั้งภาษาไทย
                      แต่ค่าที่อ่านได้เป็น ค.ศ. เสมอ — ส่งลงฐานข้อมูลได้ตรง ๆ */}
                  <input
                    id={`date-${txn.id}`}
                    type="date"
                    max={today}
                    value={form.txnDate}
                    onChange={(e) => set('txnDate', e.target.value)}
                    className="input-base"
                  />
                </Field>

                <Field label="หมวด" span>
                  <div role="radiogroup" aria-label="หมวด" className="flex flex-wrap gap-2">
                    {categoryOptions.map((c) => {
                      const active = form.categoryId === c.id
                      return (
                        <button
                          key={c.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => set('categoryId', c.id)}
                          className={`min-h-11 rounded-md border px-3.5 text-sm transition-colors duration-100 ${
                            active
                              ? 'border-brand bg-brand-tint font-semibold text-brand-on-tint'
                              : 'border-line-strong bg-surface text-ink-2 hover:border-ink-2'
                          }`}
                        >
                          {c.name}
                        </button>
                      )
                    })}
                  </div>
                  {err('category') && <p className="mt-1 text-sm text-urgent">{err('category')}</p>}
                </Field>

                <Field id={`site-${txn.id}`} label="โครงการ">
                  <select
                    id={`site-${txn.id}`}
                    value={form.siteId}
                    onChange={(e) => set('siteId', e.target.value)}
                    className="input-base"
                  >
                    {siteOptions.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                    {isOwner && txn.kind === 'expense' && (
                      <option value={CENTRAL}>ส่วนกลาง (ไม่ผูกโครงการ)</option>
                    )}
                  </select>
                </Field>

                <Field label="จ่ายด้วย">
                  <div role="radiogroup" aria-label="จ่ายด้วย" className="grid grid-cols-2 gap-2">
                    {PAY_METHODS.map((m) => {
                      const active = form.payMethod === m
                      const Icon = m === 'cash' ? Coins : Landmark
                      return (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => set('payMethod', m)}
                          className={`flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm transition-colors duration-100 ${
                            active
                              ? 'border-brand bg-brand-tint font-semibold text-brand-on-tint'
                              : 'border-line-strong bg-surface text-ink-2 hover:border-ink-2'
                          }`}
                        >
                          <Icon className="size-4.5" strokeWidth={1.8} />
                          {PAY_METHOD_LABEL[m]}
                        </button>
                      )
                    })}
                  </div>
                </Field>

                {txn.kind === 'income' && (
                  <>
                    <Field id={`ik-${txn.id}`} label="รับเป็นค่าอะไร">
                      <select
                        id={`ik-${txn.id}`}
                        value={form.incomeKind}
                        onChange={(e) => set('incomeKind', e.target.value as IncomeKind)}
                        className="input-base"
                      >
                        {INCOME_KINDS.map((k) => (
                          <option key={k} value={k}>{INCOME_KIND_LABEL[k]}</option>
                        ))}
                      </select>
                    </Field>
                    {form.incomeKind === 'installment' && (
                      <Field id={`no-${txn.id}`} label="งวดที่">
                        <input
                          id={`no-${txn.id}`}
                          type="text"
                          inputMode="numeric"
                          value={form.installmentNo}
                          onChange={(e) => set('installmentNo', e.target.value)}
                          placeholder="เช่น 2"
                          className="input-base tnum"
                        />
                      </Field>
                    )}
                  </>
                )}

                <Field id={`note-${txn.id}`} label="รายละเอียด (ไม่บังคับ)" span>
                  <input
                    id={`note-${txn.id}`}
                    value={form.note}
                    onChange={(e) => set('note', e.target.value)}
                    maxLength={MAX_NOTE}
                    className="input-base"
                  />
                </Field>

                {/* ── สลิป — มีผลทันที ไม่รอปุ่มบันทึก ───────────────────── */}
                <Field label={`สลิป / บิล (${slips.length}/${MAX_ATTACHMENTS})`} span>
                  <div className="flex flex-wrap items-center gap-2">
                    {slips.map((s) => (
                      <span key={s.id} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/uploads/${s.id}?thumb=1`}
                          alt="สลิปที่แนบ"
                          loading="lazy"
                          className="size-16 rounded-md border border-line object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removeSlip(s.id)}
                          disabled={working}
                          aria-label="เอาสลิปนี้ออก"
                          className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full border-2 border-surface bg-urgent-solid text-white transition-transform active:scale-90 disabled:opacity-60"
                        >
                          <X className="size-3.5" strokeWidth={2.5} />
                        </button>
                      </span>
                    ))}
                    {slips.length < MAX_ATTACHMENTS && (
                      <>
                        <button
                          type="button"
                          onClick={() => cameraRef.current?.click()}
                          disabled={working}
                          className="btn-secondary"
                        >
                          {busy === 'slip' ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
                          ถ่ายรูป
                        </button>
                        <button
                          type="button"
                          onClick={() => galleryRef.current?.click()}
                          disabled={working}
                          className="btn-secondary"
                        >
                          <ImagePlus className="size-4" />
                          เลือกรูป
                        </button>
                      </>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-token">
                    รูปที่เพิ่มหรือเอาออกมีผลทันที ไม่ต้องรอปุ่มบันทึก
                  </p>
                  {/* ⚠️ ช่องกล้องคง image/* ไว้ — ไอโอเอสส่ง JPEG จากกล้องเสมอ
                      ส่วนแกลอรี่ต้องจำกัดชนิด ไม่งั้นได้ HEIC ดิบมาแล้วพัง */}
                  <input
                    ref={cameraRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) void addSlip(f)
                    }}
                  />
                  <input
                    ref={galleryRef}
                    type="file"
                    accept={IMAGE_UPLOAD_ACCEPT}
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) void addSlip(f)
                    }}
                  />
                </Field>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                {/* ปุ่มลบอยู่คนละฝั่งกับปุ่มบันทึกเสมอ — สองปุ่มที่ผลต่างกันคนละขั้ว
                    วางติดกันคือปุ่มที่วันหนึ่งจะถูกกดผิด */}
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={working}
                  className="btn-secondary mr-auto text-urgent"
                >
                  <Trash2 className="size-4" />
                  ลบรายการ
                </button>
                <Dialog.Close disabled={working} className="btn-secondary">ยกเลิก</Dialog.Close>
                <button type="button" onClick={save} disabled={working} className="btn-primary">
                  {busy === 'save' && <Loader2 className="size-4 animate-spin" />}
                  {busy === 'save' ? 'กำลังบันทึก…' : 'บันทึก'}
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
