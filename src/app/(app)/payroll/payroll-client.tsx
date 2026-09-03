'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { BadgeCheck, Check, HandCoins, Loader2, Wallet, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { fmtBaht, fmtDate } from '@/lib/format'

type Row = {
  employee_id: string
  full_name: string
  job_title: string | null
  /** วันแรงที่ยังไม่ได้รับเงิน (เต็มวัน = 1 · ครึ่งวัน = 0.5) */
  days: number
  accrued: number
  advanced: number
  balance: number
}
/**
 * ประวัติการจ่ายหนึ่งครั้ง
 *
 * ⚠️ ในฐานข้อมูลมันคือ `payroll_runs` ที่ปิดแล้ว แต่**คำว่า "รอบจ่าย" ไม่โผล่
 * บนหน้าจออีกแล้ว** (คำสั่งเจ้าของ 4 ก.ย. 2569) — เจ้าของกดจ่ายรายคน
 * ระบบจึงสร้าง "รอบของคนคนเดียว" ให้เองแล้วปิดทันที · ตารางยังอยู่เพราะมันคือ
 * ตัวที่กันจ่ายซ้ำวันเดิม ล็อกค่าแรงย้อนหลัง และเป็นฐานของเพดานเบิก
 */
type Payment = {
  id: string
  period_start: string
  period_end: string
  /** ชื่อคนที่จ่ายให้ — `null` = การจ่ายรวมหลายคนจากระบบเดิม */
  employee_name: string | null
  total_accrued: number
  total_advance_deducted: number
  total_paid: number
}
type Advance = {
  id: string
  employee_id: string
  amount: number
  advance_date: string
  full_name: string
}

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่ทำได้',
  EMPLOYEE_REQUIRED: 'กรุณาเลือกคนงาน',
  AMOUNT_INVALID: 'จำนวนเงินต้องมากกว่า 0',
  DATE_INVALID: 'รูปแบบวันที่ไม่ถูกต้อง',
  DATE_BUDDHIST_ERA: 'ปีที่กรอกเป็น พ.ศ. — ระบบเก็บเป็น ค.ศ. กรุณาเลือกวันจากปฏิทิน',
  DATE_FUTURE: 'บันทึกเบิกของวันในอนาคตไม่ได้',
  PAYROLL_CLOSED: 'ใบเบิกนี้ถูกหักตอนจ่ายค่าแรงไปแล้ว ลบไม่ได้',
  NOTHING_TO_PAY: 'คนนี้ไม่มีค่าแรงค้างจ่าย',
  NOT_FOUND: 'ไม่พบรายการนี้',
}
const fail = (code?: string, detail?: string) =>
  code === 'ADVANCE_OVER_CEILING'
    ? (detail ?? 'เบิกเกินเพดานที่เบิกได้')
    : (MESSAGES[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่')

export function PayrollBoard({
  today,
  rows,
  payments,
  advances,
}: {
  today: string
  rows: Row[]
  payments: Payment[]
  advances: Advance[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [advanceFor, setAdvanceFor] = useState<Row | null>(null)
  const [payFor, setPayFor] = useState<Row | null>(null)
  const [amount, setAmount] = useState('')
  const [fieldError, setFieldError] = useState('')

  async function send(key: string, url: string, body: unknown, ok: string, method = 'POST') {
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
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        const msg = fail(b.error, b.detail)
        setFieldError(msg)
        toast.error(msg)
        return false
      }
      toast.success(ok)
      router.refresh()
      return true
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
      return false
    } finally {
      setBusy(null)
    }
  }

  const advancesOf = (id: string) => advances.filter((a) => a.employee_id === id)

  return (
    <div className="space-y-4">
      {/* ── ค้างจ่ายรายคน ─────────────────────────────────────────── */}
      <section className="panel">
        <div className="panel-head">
          ค่าแรงค้างจ่ายรายคน
          <span className="ml-auto text-xs font-normal tnum text-muted-token">{rows.length} คน</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-token">
            ยังไม่มีใครมียอดค้างจ่าย — ค่าแรงจะขึ้นที่นี่เมื่อติ๊กคนเข้าโครงการ
          </p>
        ) : (
          <ul>
            {rows.map((r) => (
              <li
                key={r.employee_id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-3.5 py-3 last:border-b-0 md:px-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink">{r.full_name}</div>
                  <div className="truncate text-xs text-muted-token">
                    {r.job_title ?? 'ไม่ได้ระบุตำแหน่ง'}
                  </div>
                  {advancesOf(r.employee_id).length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {advancesOf(r.employee_id).map((a) => (
                        <li key={a.id} className="flex items-center gap-1.5 text-xs text-muted-token">
                          {/* 🔴 แถวจ่ายเงินเป็นสีเทาพร้อมป้าย ไม่ใช่ตัวเลขแดง
                              เหมือนรายจ่าย — มันคือการล้างหนี้ ไม่ใช่ต้นทุนใหม่
                              (DESIGN.md §5.4) */}
                          <span className="chip bg-surface-2 text-muted-token ring-line">
                            จ่ายเงิน · ไม่นับซ้ำเป็นต้นทุน
                          </span>
                          <span className="tnum">{fmtBaht(a.amount)}</span>
                          <span>{fmtDate(a.advance_date)}</span>
                          <button
                            type="button"
                            onClick={() => send(a.id, `/api/advances/${a.id}`, undefined, 'ลบใบเบิกแล้ว', 'DELETE')}
                            disabled={busy !== null}
                            aria-label={`ลบใบเบิก ${fmtBaht(a.amount)} ของ ${r.full_name}`}
                            className="text-urgent transition-opacity hover:opacity-70 disabled:opacity-40"
                          >
                            <X className="size-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <dl className="flex shrink-0 gap-4 text-right text-sm">
                  {/* เจ้าของสั่งให้เห็นทั้ง "กี่วัน" และ "กี่บาท" — ยอดเงินอย่างเดียว
                      ตอบไม่ได้ว่าคนนี้มาทำงานกี่วัน ซึ่งเป็นตัวเลขที่ใช้เถียงกันจริง */}
                  <div>
                    <dt className="text-xs text-muted-token">ค้างจ่าย</dt>
                    <dd className="tnum font-semibold text-ink">{r.days} วัน</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-token">ค่าแรง</dt>
                    <dd className="tnum font-semibold text-ink">{fmtBaht(r.accrued)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-token">เบิกแล้ว</dt>
                    <dd className="tnum text-muted-token">{fmtBaht(r.advanced)}</dd>
                  </div>
                  <div data-balance-for={r.employee_id}>
                    <dt className="text-xs text-muted-token">คงเหลือ</dt>
                    <dd className="tnum font-bold text-income">{fmtBaht(r.balance)}</dd>
                  </div>
                </dl>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAdvanceFor(r)
                      setAmount('')
                      setFieldError('')
                    }}
                    disabled={busy !== null || r.balance <= 0}
                    className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <HandCoins className="size-4" />
                    เบิก
                  </button>
                  {/* จ่ายค่าแรง = เคลียร์ยอดค้างของคนนี้ให้หมดในปุ่มเดียว
                      · ยอดค่าแรงยังไม่ถึงมือแต่เบิกไปแล้วเต็มจำนวน (accrued
                        เท่ากับ advanced) ยังต้องกดได้ เพราะมันคือการปิดยอดค้าง
                        ที่เหลือ ฿0 ไม่ใช่ "ไม่มีอะไรให้ทำ" — ปิดเฉพาะตอนไม่มี
                        ค่าแรงค้างเลยจริง ๆ */}
                  <button
                    type="button"
                    onClick={() => {
                      setPayFor(r)
                      setFieldError('')
                    }}
                    disabled={busy !== null || r.accrued <= 0}
                    className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Wallet className="size-4" />
                    จ่ายค่าแรง
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── ประวัติการจ่าย ────────────────────────────────────────────
          อ่านอย่างเดียว · ไม่มีปุ่มเปิด/ปิดอะไรทั้งนั้น การจ่ายเกิดจากปุ่มข้างบน
          เท่านั้น · ยังต้องมีให้เห็น เพราะเวลามีคนทวงเงิน คำถามคือ "จ่ายไปเมื่อไหร่
          เท่าไหร่" ซึ่งยอดคงเหลือปัจจุบันตอบไม่ได้ */}
      <section className="panel">
        <div className="panel-head">
          ประวัติการจ่ายค่าแรง
          <span className="ml-auto text-xs font-normal tnum text-muted-token">
            {payments.length} ครั้ง
          </span>
        </div>
        {payments.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-token">
            ยังไม่เคยจ่ายค่าแรง — กดปุ่ม &ldquo;จ่ายค่าแรง&rdquo; ของแต่ละคนด้านบน
          </p>
        ) : (
          <ul>
            {payments.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-3.5 py-3 last:border-b-0 md:px-4"
              >
                <BadgeCheck className="size-4 shrink-0 text-status-done" strokeWidth={1.8} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">
                    {p.employee_name ?? 'จ่ายรวมหลายคน'}
                  </div>
                  <div className="truncate text-xs text-muted-token">
                    งานวันที่ {fmtDate(p.period_start)}
                    {p.period_end !== p.period_start && ` – ${fmtDate(p.period_end)}`}
                    {p.total_advance_deducted > 0 &&
                      ` · หักเบิก ${fmtBaht(p.total_advance_deducted)} จากค่าแรง ${fmtBaht(p.total_accrued)}`}
                  </div>
                </div>
                <span className="shrink-0 text-sm font-bold tnum text-ink">
                  {fmtBaht(p.total_paid)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── กล่องเบิก ─────────────────────────────────────────────── */}
      <Dialog.Root
        open={advanceFor !== null}
        onOpenChange={(v) => {
          if (busy) return
          if (!v) {
            setAdvanceFor(null)
            setFieldError('')
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
            <Dialog.Title className="text-lg font-bold text-ink">
              เบิกล่วงหน้า — {advanceFor?.full_name}
            </Dialog.Title>
            <Dialog.Description className="mt-0.5 text-sm text-muted-token">
              เบิกได้ไม่เกิน{' '}
              <span className="font-semibold tnum text-ink">{fmtBaht(advanceFor?.balance ?? 0)}</span>{' '}
              · การเบิกคือเงินสดออก ไม่ทำให้ต้นทุนโครงการเพิ่ม
            </Dialog.Description>

            <div className="mt-4">
              <label htmlFor="adv-amount" className="label-base">จำนวนเงิน (บาท)</label>
              <input
                id="adv-amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  if (fieldError) setFieldError('')
                }}
                placeholder="0"
                aria-invalid={fieldError ? 'true' : undefined}
                className="input-base tnum"
                autoFocus
              />
              {fieldError && <p className="mt-1 text-sm text-urgent">{fieldError}</p>}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close disabled={busy !== null} className="btn-secondary">ยกเลิก</Dialog.Close>
              <button
                type="button"
                onClick={async () => {
                  if (!advanceFor) return
                  const done = await send(
                    advanceFor.employee_id, '/api/advances',
                    { employeeId: advanceFor.employee_id, amount, advanceDate: today },
                    'บันทึกเบิกแล้ว',
                  )
                  if (done) setAdvanceFor(null)
                }}
                disabled={busy !== null || amount.trim() === ''}
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy !== null ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                บันทึกเบิก
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* ── กล่องยืนยันจ่ายค่าแรง ──────────────────────────────────────
          🔴 ต้องเห็นยอดสามบรรทัดก่อนกด — จ่ายแล้ว **ย้อนกลับไม่ได้** เพราะวัน
          ที่จ่ายแล้วจะถูกล็อกไม่ให้แก้ค่าแรงย้อนหลังอีก */}
      <Dialog.Root
        open={payFor !== null}
        onOpenChange={(v) => {
          if (busy) return
          if (!v) {
            setPayFor(null)
            setFieldError('')
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
            <Dialog.Title className="text-lg font-bold text-ink">
              จ่ายค่าแรง — {payFor?.full_name}
            </Dialog.Title>
            <Dialog.Description className="mt-0.5 text-sm text-muted-token">
              ปิดยอดค้างจ่ายของคนนี้ทั้งหมด {payFor?.days} วัน
            </Dialog.Description>

            <dl className="mt-4 space-y-1.5 rounded-lg border border-line-soft bg-surface-2 px-3.5 py-3 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-token">ค่าแรงที่เกิดขึ้น</dt>
                <dd className="tnum font-semibold text-ink">{fmtBaht(payFor?.accrued ?? 0)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-token">หักเบิกล่วงหน้า</dt>
                <dd className="tnum text-muted-token">− {fmtBaht(payFor?.advanced ?? 0)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2 border-t border-line-soft pt-1.5">
                <dt className="font-medium text-ink-2">จ่ายจริงวันนี้</dt>
                <dd className="tnum text-base font-bold text-income">
                  {fmtBaht(payFor?.balance ?? 0)}
                </dd>
              </div>
            </dl>

            <p className="mt-2 text-xs text-muted-token">
              จ่ายแล้ววันทำงานเหล่านี้จะถูกล็อก แก้ค่าแรงย้อนหลังไม่ได้อีก
              · ยอดนี้ไม่ทำให้ต้นทุนโครงการเพิ่ม เพราะนับไปตั้งแต่ตอนลงชื่อแล้ว
            </p>
            {fieldError && <p className="mt-2 text-sm text-urgent">{fieldError}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close disabled={busy !== null} className="btn-secondary">ยกเลิก</Dialog.Close>
              <button
                type="button"
                onClick={async () => {
                  if (!payFor) return
                  const done = await send(
                    `pay-${payFor.employee_id}`, '/api/payroll/pay',
                    { employeeId: payFor.employee_id },
                    `จ่ายค่าแรงให้ ${payFor.full_name} แล้ว`,
                  )
                  if (done) setPayFor(null)
                }}
                disabled={busy !== null}
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy !== null ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
                ยืนยันจ่าย
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
