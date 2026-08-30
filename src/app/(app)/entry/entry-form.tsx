'use client'

import { Banknote, Check, Loader2, Wallet } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { Role } from '@/lib/auth/current-user'
import { fmtBaht } from '@/lib/format'
import {
  INCOME_KINDS, INCOME_KIND_LABEL, PAY_METHODS, PAY_METHOD_LABEL,
  type IncomeKind, type PayMethod, type TxnKind,
} from '@/lib/transactions'

type Site = { id: string; name: string }
type Category = { id: string; name: string; kind: TxnKind }

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'ไม่มีสิทธิ์ทำรายการนี้',
  INCOME_FORBIDDEN: 'หัวหน้าไซต์บันทึกรายรับไม่ได้ — เจ้าของเป็นคนบันทึกเอง',
  SITE_REQUIRED: 'กรุณาเลือกไซต์งาน',
  KIND_INVALID: 'ชนิดรายการไม่ถูกต้อง',
  CATEGORY_REQUIRED: 'กรุณาเลือกหมวด',
  CATEGORY_KIND_MISMATCH: 'หมวดที่เลือกไม่ตรงกับชนิดรายการ',
  AMOUNT_INVALID: 'จำนวนเงินต้องมากกว่า 0',
  DATE_REQUIRED: 'กรุณาเลือกวันที่',
  DATE_INVALID: 'รูปแบบวันที่ไม่ถูกต้อง',
  DATE_BUDDHIST_ERA: 'ปีที่กรอกเป็น พ.ศ. — ระบบเก็บเป็น ค.ศ. กรุณาเลือกวันจากปฏิทิน',
  DATE_FUTURE: 'บันทึกรายการของวันในอนาคตไม่ได้',
  INCOME_KIND_REQUIRED: 'กรุณาเลือกประเภทของรายรับ',
  INSTALLMENT_INVALID: 'เลขงวดต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป',
  CREATE_FAILED: 'บันทึกไม่สำเร็จ กรุณาลองใหม่',
}
const fail = (code?: string) => MESSAGES[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'

const CENTRAL = '__central__'

export function EntryForm({
  role, today, sites, categories,
}: {
  role: Role
  /** วันนี้ตามเวลาไทย คำนวณฝั่งเซิร์ฟเวอร์ — ห้ามใช้ new Date() ที่นี่
   *  เครื่องผู้ใช้ตั้งเขตเวลาอะไรก็ได้ และค่านั้นจะไม่ตรงกับที่เซิร์ฟเวอร์ตรวจ */
  today: string
  sites: Site[]
  categories: Category[]
}) {
  const router = useRouter()
  const isOwner = role === 'owner'

  const [kind, setKind] = useState<TxnKind>('expense')
  const [busy, setBusy] = useState(false)
  const [fieldError, setFieldError] = useState<{ field: string; text: string } | null>(null)
  const [form, setForm] = useState({
    siteId: sites[0]?.id ?? (isOwner ? CENTRAL : ''),
    categoryId: '',
    amount: '',
    txnDate: today,
    payMethod: 'cash' as PayMethod,
    incomeKind: 'installment' as IncomeKind,
    installmentNo: '',
    note: '',
  })

  // หมวดกรองตามชนิดที่เลือกอยู่ — เลือกรายรับแล้วต้องไม่เห็นหมวดของรายจ่าย
  const visibleCategories = useMemo(
    () => categories.filter((c) => c.kind === kind),
    [categories, kind],
  )

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setFieldError(null)
  }

  const switchKind = (next: TxnKind) => {
    setKind(next)
    // หมวดของอีกชนิดใช้ไม่ได้ — ล้างทิ้งแทนที่จะปล่อยให้ส่งไปแล้วโดนปฏิเสธ
    setForm((f) => ({ ...f, categoryId: '', siteId: next === 'income' ? (sites[0]?.id ?? '') : f.siteId }))
    setFieldError(null)
  }

  const amountNumber = Number(form.amount.replace(/,/g, ''))
  const amountValid = Number.isFinite(amountNumber) && amountNumber > 0

  async function submit() {
    if (busy) return
    if (!amountValid) return setFieldError({ field: 'amount', text: 'จำนวนเงินต้องมากกว่า 0' })
    if (!form.categoryId) return setFieldError({ field: 'category', text: 'กรุณาเลือกหมวด' })
    if (!isOwner && !form.siteId) return setFieldError({ field: 'site', text: 'กรุณาเลือกไซต์งาน' })

    setBusy(true)
    try {
      const r = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          siteId: form.siteId === CENTRAL ? null : form.siteId,
          categoryId: form.categoryId,
          amount: amountNumber,
          txnDate: form.txnDate,
          payMethod: form.payMethod,
          note: form.note,
          ...(kind === 'income'
            ? {
                incomeKind: form.incomeKind,
                ...(form.incomeKind === 'installment' ? { installmentNo: form.installmentNo } : {}),
              }
            : {}),
          // 🔴 หนึ่งค่าต่อ "หนึ่งครั้งที่ตั้งใจบันทึก" — ยิงซ้ำด้วยค่าเดิม
          // ฐานข้อมูลจะปฏิเสธแถวที่สอง · ปุ่ม disabled กันได้แค่กรณีปกติ
          // เน็ตช้าแล้วกดซ้ำ หรือเปิดสองแท็บ ยังผ่านมาได้
          clientRef: crypto.randomUUID(),
        }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(fail(b.error))
        return
      }
      toast.success(
        isOwner ? 'บันทึกแล้ว' : 'บันทึกแล้ว รอเจ้าของอนุมัติ',
      )
      setForm((f) => ({ ...f, amount: '', note: '', installmentNo: '' }))
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  const err = (field: string) => (fieldError?.field === field ? fieldError.text : null)

  return (
    <div className="mx-auto w-full max-w-xl">
      <h1 className="mb-1 text-2xl font-bold text-ink">
        {isOwner ? 'บันทึกรายรับ-รายจ่าย' : 'บันทึกรายจ่าย'}
      </h1>
      <p className="mb-5 text-sm text-muted-token">
        {isOwner
          ? 'รายการที่คุณคีย์เองจะถูกอนุมัติทันที'
          : 'รายการที่คีย์จะเข้าคิวรอเจ้าของอนุมัติ'}
      </p>

      {/* ── สลับรายรับ/รายจ่าย — เจ้าของเท่านั้น ─────────────────────
          หัวหน้าไซต์ไม่มีปุ่มนี้เลย ไม่ใช่มีแล้วกดไม่ได้ · ปุ่มที่กดแล้วถูก
          ปฏิเสธทุกครั้งคือปุ่มที่ไม่ควรมี */}
      {isOwner && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          {(['expense', 'income'] as const).map((k) => {
            const active = kind === k
            const Icon = k === 'income' ? Banknote : Wallet
            return (
              <button
                key={k}
                type="button"
                onClick={() => switchKind(k)}
                aria-pressed={active}
                className={`flex items-center justify-center gap-2 rounded-md border px-4 py-3 text-base font-semibold transition-colors duration-150 ${
                  active
                    ? k === 'income'
                      ? 'border-income bg-income-bg text-income'
                      : 'border-expense bg-expense-bg text-expense'
                    : 'border-line-strong bg-surface text-ink-2 hover:border-ink-2'
                }`}
              >
                <Icon className="size-4.5" />
                {k === 'income' ? 'รายรับ' : 'รายจ่าย'}
              </button>
            )
          })}
        </div>
      )}

      <div className="panel space-y-4 p-4">
        {/* จำนวนเงินอยู่บนสุดและตัวใหญ่ที่สุด — เป็นสิ่งที่คนมาที่หน้านี้เพื่อกรอก */}
        <div>
          <label htmlFor="amount" className="label-base">จำนวนเงิน (บาท)</label>
          <input
            id="amount"
            type="text"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => set('amount', e.target.value)}
            placeholder="0"
            aria-invalid={err('amount') ? 'true' : undefined}
            className="input-base py-3 text-2xl font-bold tnum"
            autoFocus
          />
          {err('amount') ? (
            <p className="mt-1 text-sm text-urgent">{err('amount')}</p>
          ) : (
            amountValid && (
              <p className="mt-1 text-sm text-muted-token tnum">{fmtBaht(amountNumber)}</p>
            )
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="site" className="label-base">ไซต์งาน</label>
            <select
              id="site"
              value={form.siteId}
              onChange={(e) => set('siteId', e.target.value)}
              aria-invalid={err('site') ? 'true' : undefined}
              className="input-base"
            >
              {sites.length === 0 && <option value="">— ยังไม่มีไซต์ที่คุณดูแล —</option>}
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
              {/* ส่วนกลาง = ค่าน้ำมัน ค่าทางด่วน ค่าออฟฟิศ ที่ไม่ใช่ต้นทุนของไซต์ไหน
                  หัวหน้าไซต์ไม่มีตัวเลือกนี้ — เป็นค่าใช้จ่ายของเจ้าของ */}
              {isOwner && kind === 'expense' && (
                <option value={CENTRAL}>ส่วนกลาง (ไม่ผูกไซต์)</option>
              )}
            </select>
            {err('site') && <p className="mt-1 text-sm text-urgent">{err('site')}</p>}
          </div>

          <div>
            <label htmlFor="category" className="label-base">หมวด</label>
            <select
              id="category"
              value={form.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
              aria-invalid={err('category') ? 'true' : undefined}
              className="input-base"
            >
              <option value="">— เลือกหมวด —</option>
              {visibleCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {err('category') && <p className="mt-1 text-sm text-urgent">{err('category')}</p>}
          </div>

          <div>
            {/* 🔴 input type=date แสดงปี พ.ศ. บนเครื่องที่ตั้งภาษาไทย
                แต่ค่าที่อ่านได้เป็น ค.ศ. เสมอ — ส่งลงฐานข้อมูลได้ตรง ๆ */}
            <label htmlFor="date" className="label-base">วันที่</label>
            <input
              id="date"
              type="date"
              max={today}
              value={form.txnDate}
              onChange={(e) => set('txnDate', e.target.value)}
              className="input-base"
            />
          </div>

          <div>
            <label htmlFor="pay" className="label-base">จ่ายด้วย</label>
            <select
              id="pay"
              value={form.payMethod}
              onChange={(e) => set('payMethod', e.target.value as PayMethod)}
              className="input-base"
            >
              {PAY_METHODS.map((m) => (
                <option key={m} value={m}>{PAY_METHOD_LABEL[m]}</option>
              ))}
            </select>
          </div>

          {kind === 'income' && (
            <>
              <div>
                <label htmlFor="incomeKind" className="label-base">รับเป็นค่าอะไร</label>
                <select
                  id="incomeKind"
                  value={form.incomeKind}
                  onChange={(e) => set('incomeKind', e.target.value as IncomeKind)}
                  className="input-base"
                >
                  {INCOME_KINDS.map((k) => (
                    <option key={k} value={k}>{INCOME_KIND_LABEL[k]}</option>
                  ))}
                </select>
              </div>
              {form.incomeKind === 'installment' && (
                <div>
                  <label htmlFor="installment" className="label-base">งวดที่</label>
                  <input
                    id="installment"
                    type="text"
                    inputMode="numeric"
                    value={form.installmentNo}
                    onChange={(e) => set('installmentNo', e.target.value)}
                    placeholder="เช่น 2"
                    className="input-base tnum"
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <label htmlFor="note" className="label-base">รายละเอียด (ไม่บังคับ)</label>
          <input
            id="note"
            value={form.note}
            onChange={(e) => set('note', e.target.value)}
            placeholder="เช่น ปูนซีเมนต์ 20 ถุง ร้านเจริญค้าวัสดุ"
            className="input-base"
          />
        </div>

        {/* แนบสลิปมาต่อที่ P2-c — ปุ่มถ่ายรูปกับเลือกจากแกลอรี่แยกกัน */}
        <p className="rounded-md border border-line-soft bg-surface-2 px-3 py-2 text-sm text-muted-token">
          การแนบสลิปจะเพิ่มในขั้นถัดไป (P2-c) — ตอนนี้บันทึกตัวเลขได้ก่อน
        </p>

        <button onClick={submit} disabled={busy} className="btn-primary w-full py-3 text-lg">
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />}
          {busy ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </div>
    </div>
  )
}
