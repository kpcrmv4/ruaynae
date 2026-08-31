'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { CalendarRange, Check, HandCoins, Loader2, Lock, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { fmtBaht, fmtDate } from '@/lib/format'
import { Badge } from '@/components/ui/badge'

type Row = {
  employee_id: string
  full_name: string
  job_title: string | null
  /** วันแรงที่ยังไม่ถูกปิดรอบ (เต็มวัน = 1 · ครึ่งวัน = 0.5) */
  days: number
  accrued: number
  advanced: number
  balance: number
}
type Run = {
  id: string
  period_start: string
  period_end: string
  status: 'open' | 'closed'
  site_name: string | null
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
  DATE_RANGE_INVALID: 'วันสิ้นสุดต้องไม่มาก่อนวันเริ่ม',
  PERIOD_OVERLAP: 'ช่วงเวลานี้ซ้อนกับรอบที่เปิดไว้แล้ว — ค่าแรงวันเดียวจะถูกจ่ายสองรอบ',
  PAYROLL_CLOSED: 'ใบเบิกนี้ถูกหักในรอบที่ปิดแล้ว ลบไม่ได้',
  ALREADY_CLOSED: 'รอบนี้ปิดไปแล้ว',
  NOTHING_TO_PAY: 'ไม่มีค่าแรงค้างจ่ายในช่วงนี้',
  NOT_FOUND: 'ไม่พบรายการนี้',
}
const fail = (code?: string, detail?: string) =>
  code === 'ADVANCE_OVER_CEILING'
    ? (detail ?? 'เบิกเกินเพดานที่เบิกได้')
    : (MESSAGES[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่')

export function PayrollBoard({
  today,
  rows,
  runs,
  sites,
  advances,
}: {
  today: string
  rows: Row[]
  runs: Run[]
  sites: { id: string; name: string }[]
  advances: Advance[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [advanceFor, setAdvanceFor] = useState<Row | null>(null)
  const [amount, setAmount] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [openRun, setOpenRun] = useState(false)
  const [period, setPeriod] = useState({ start: today, end: today, siteId: '' })

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
            ยังไม่มีใครมียอดค้างจ่าย — ค่าแรงจะขึ้นที่นี่เมื่อติ๊กคนเข้าไซต์
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

                <button
                  type="button"
                  onClick={() => {
                    setAdvanceFor(r)
                    setAmount('')
                    setFieldError('')
                  }}
                  disabled={busy !== null || r.balance <= 0}
                  className="btn-secondary shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <HandCoins className="size-4" />
                  เบิก
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── รอบจ่าย ───────────────────────────────────────────────── */}
      <section className="panel">
        <div className="panel-head">
          รอบจ่ายค่าแรง
          <button
            type="button"
            onClick={() => {
              setOpenRun(true)
              setFieldError('')
            }}
            className="ml-auto text-sm font-medium text-brand hover:underline"
          >
            เปิดรอบใหม่
          </button>
        </div>
        {runs.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-token">
            ยังไม่เคยเปิดรอบจ่าย — เปิดรอบแล้วปิดรอบเพื่อสรุปว่าต้องจ่ายใครเท่าไหร่
          </p>
        ) : (
          <ul>
            {runs.map((run) => (
              <li
                key={run.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-3.5 py-3 last:border-b-0 md:px-4"
              >
                <CalendarRange className="size-4 shrink-0 text-muted-token" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">
                    {fmtDate(run.period_start)} – {fmtDate(run.period_end)}
                  </div>
                  <div className="truncate text-xs text-muted-token">
                    {run.site_name ?? 'ทุกไซต์'}
                    {run.status === 'closed' &&
                      ` · ค่าแรง ${fmtBaht(run.total_accrued)} − เบิก ${fmtBaht(run.total_advance_deducted)} = จ่ายจริง ${fmtBaht(run.total_paid)}`}
                  </div>
                </div>
                {run.status === 'closed' ? (
                  <Badge tone="done" dot>
                    ปิดรอบแล้ว
                  </Badge>
                ) : (
                  <button
                    type="button"
                    onClick={() => send(run.id, `/api/payroll/${run.id}/close`, undefined, 'ปิดรอบแล้ว')}
                    disabled={busy !== null}
                    className="btn-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy === run.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Lock className="size-4" />
                    )}
                    ปิดรอบ
                  </button>
                )}
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
              · การเบิกคือเงินสดออก ไม่ทำให้ต้นทุนไซต์เพิ่ม
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

      {/* ── กล่องเปิดรอบ ──────────────────────────────────────────── */}
      <Dialog.Root
        open={openRun}
        onOpenChange={(v) => {
          if (busy) return
          setOpenRun(v)
          if (!v) setFieldError('')
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
            <Dialog.Title className="text-lg font-bold text-ink">เปิดรอบจ่ายค่าแรง</Dialog.Title>
            <Dialog.Description className="mt-0.5 text-sm text-muted-token">
              เลือกช่วงวันที่จะจ่าย · ตอนปิดรอบระบบจะหักยอดที่เบิกไปแล้วให้อัตโนมัติ
            </Dialog.Description>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="run-start" className="label-base">ตั้งแต่วันที่</label>
                <input
                  id="run-start"
                  type="date"
                  value={period.start}
                  max={today}
                  onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))}
                  className="input-base tnum"
                />
              </div>
              <div>
                <label htmlFor="run-end" className="label-base">ถึงวันที่</label>
                <input
                  id="run-end"
                  type="date"
                  value={period.end}
                  max={today}
                  onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))}
                  className="input-base tnum"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="run-site" className="label-base">เฉพาะไซต์ (ไม่บังคับ)</label>
                <select
                  id="run-site"
                  value={period.siteId}
                  onChange={(e) => setPeriod((p) => ({ ...p, siteId: e.target.value }))}
                  className="input-base"
                >
                  <option value="">ทุกไซต์</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {fieldError && <p className="mt-2 text-sm text-urgent">{fieldError}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close disabled={busy !== null} className="btn-secondary">ยกเลิก</Dialog.Close>
              <button
                type="button"
                onClick={async () => {
                  const done = await send('new-run', '/api/payroll', {
                    periodStart: period.start,
                    periodEnd: period.end,
                    siteId: period.siteId || null,
                  }, 'เปิดรอบแล้ว')
                  if (done) setOpenRun(false)
                }}
                disabled={busy !== null}
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === 'new-run' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CalendarRange className="size-4" />
                )}
                เปิดรอบ
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
