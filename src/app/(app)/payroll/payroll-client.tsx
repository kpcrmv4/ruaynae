'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { BadgeCheck, Check, ChevronDown, HandCoins, Loader2, Wallet, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { fmtBaht, fmtDate } from '@/lib/format'

/**
 * เบี้ย/ค่าหักหนึ่งรายการของคนหนึ่งคน — **พร้อมวันที่ที่ได้**
 *
 * 🔴 ยอดรวมตอบคำถามของเจ้าของไม่ได้ ("ให้ครบวันที่เขาออกต่างจังหวัดหรือยัง")
 * ฿3,000 อาจเป็น 15 วัน × ฿200 หรือ 10 วัน × ฿300 ก็ได้ · ต้องกางวันให้ดู
 */
type Adjustment = {
  name: string
  kind: 'add' | 'deduct'
  total: number
  /** ได้กี่ครั้ง — เทียบกับ \`days\` ของคนนั้นแล้วรู้ทันทีว่าตกหล่นไหม */
  times: number
  days: string[]
}

type Row = {
  employee_id: string
  full_name: string
  job_title: string | null
  /** วันแรงที่ยังไม่ได้รับเงิน (เต็มวัน = 1 · ครึ่งวัน = 0.5) */
  days: number
  /** ค่าจ้างฐาน (วัน × เรต) · ค่าพิเศษ · ค่าหัก — สามก้อนนี้บวกกันได้ \`accrued\` เป๊ะ
   *  เพราะฐานข้อมูลเป็นคนคำนวณ ไม่ใช่หน้าจอบวกเอง */
  base: number
  extra: number
  deduct: number
  accrued: number
  advanced: number
  balance: number
  adjustments: Adjustment[]
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
  /** หักคืนจากค่าแรงไปแล้วเท่าไหร่ · > 0 = ลบใบนี้ไม่ได้แล้ว เงินถูกหักไปบางส่วนแล้ว */
  deducted_amount: number
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
const fail = (code?: string) => MESSAGES[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'

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
  /** วันที่เบิก — ลงย้อนหลังได้ (คำสั่งเจ้าของ 20 ก.ย. 2569) เริ่มที่วันนี้เสมอ */
  const [advDate, setAdvDate] = useState(today)
  const [fieldError, setFieldError] = useState('')
  /** การ์ดไหนกางใบเบิกอยู่ · คีย์เป็น employee_id */
  const [openAdv, setOpenAdv] = useState<string | null>(null)
  /** เบี้ยรายการไหนกางวันที่อยู่ · คีย์เป็น employee_id + ชื่อรายการ */
  const [openDays, setOpenDays] = useState<string | null>(null)

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
        const msg = fail(b.error)
        setFieldError(msg)
        toast.error(msg)
        return false
      }
      // เบิกเกินค่าแรงที่ทำไปแล้ว = บันทึกสำเร็จ แต่ต้องเตือน ไม่ใช่เงียบ
      // 🔴 ยอดมาจากคำตอบของเซิร์ฟเวอร์ ไม่ใช่ที่หน้าจอคำนวณเอง
      if (b.overdrawn && typeof b.balance === 'number') {
        toast.warning(`${ok} · เบิกเกินค่าแรงค้างจ่ายแล้ว ${fmtBaht(Math.abs(b.balance))}`)
      } else {
        toast.success(ok)
      }
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

  /**
   * ยอดที่กำลังพิมพ์เกินค่าแรงค้างจ่ายอยู่เท่าไหร่ — `0` = ไม่เกิน
   *
   * คงเหลือติดลบอยู่แล้ว (เบิกเกินมาก่อน) จะถูกบวกเข้าไปด้วยโดยอัตโนมัติ
   * เพราะ `typed − balance` ของ balance ติดลบ = typed + ยอดที่เกินอยู่เดิม
   */
  const typed = Number(amount.replace(/,/g, '').trim())
  const overBy =
    advanceFor && Number.isFinite(typed) && typed > 0
      ? Math.max(0, Math.round((typed - advanceFor.balance) * 100) / 100)
      : 0

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
                className="border-b border-line-soft px-3.5 py-3.5 last:border-b-0 md:px-4"
              >
                {/* ── ชื่อ + จำนวนวัน ─────────────────────────────────
                    🔴 เดิมเอาตัวเลขสี่ช่องไปวางข้างชื่อในแถวเดียวที่ wrap ได้ · พอจอแคบ
                    มันพับไปทับลิสต์ใบเบิกที่อยู่ใต้ชื่อ อ่านไม่ออกทั้งใบ (เจ้าของแจ้ง
                    21 ก.ย. 2569 พร้อมภาพหน้าจอ) · ตอนนี้ทุกยอดอยู่บรรทัดของตัวเอง
                    ชื่อชิดซ้าย ตัวเลขชิดขวา ซึ่งอ่านได้ทุกความกว้างโดยไม่ต้องมีจุดตัด */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-ink">{r.full_name}</div>
                    <div className="truncate text-xs text-muted-token">
                      {r.job_title ?? 'ไม่ได้ระบุตำแหน่ง'}
                    </div>
                  </div>
                  <span className="chip shrink-0 bg-surface-2 tnum text-ink-2 ring-line">
                    {r.days} วัน
                  </span>
                </div>

                {/* ── ยอดแยกก้อน: ค่าจ้าง → ค่าพิเศษ → ค่าหัก → รวม → เบิก → คงเหลือ
                    เรียงตามลำดับที่เงินเดินจริง คนอ่านจึงไล่ตามได้โดยไม่ต้องคิดเอง */}
                <dl className="mt-2.5 space-y-1 text-sm">
                  <MoneyLine label="ค่าจ้าง" value={fmtBaht(r.base)} />

                  {r.adjustments.filter((a) => a.kind === 'add').map((a) => (
                    <AdjustLine
                      key={'add-' + a.name}
                      adj={a}
                      open={openDays === r.employee_id + a.name}
                      onToggle={() =>
                        setOpenDays(openDays === r.employee_id + a.name ? null : r.employee_id + a.name)
                      }
                    />
                  ))}
                  {r.extra > 0 && !r.adjustments.some((a) => a.kind === 'add') && (
                    <MoneyLine label="ค่าพิเศษ" value={'+ ' + fmtBaht(r.extra)} tone="income" />
                  )}

                  {r.adjustments.filter((a) => a.kind === 'deduct').map((a) => (
                    <AdjustLine
                      key={'ded-' + a.name}
                      adj={a}
                      open={openDays === r.employee_id + a.name}
                      onToggle={() =>
                        setOpenDays(openDays === r.employee_id + a.name ? null : r.employee_id + a.name)
                      }
                    />
                  ))}

                  <div className="flex items-baseline justify-between gap-3 border-t border-line-soft pt-1.5">
                    <dt className="text-ink-2">ค่าแรงรวม</dt>
                    <dd className="tnum font-semibold text-ink">{fmtBaht(r.accrued)}</dd>
                  </div>

                  {r.advanced !== 0 && (
                    <>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="min-w-0">
                          <button
                            type="button"
                            onClick={() => setOpenAdv(openAdv === r.employee_id ? null : r.employee_id)}
                            aria-expanded={openAdv === r.employee_id}
                            className="inline-flex items-center gap-1 text-ink-2 underline-offset-2 hover:underline"
                          >
                            เบิกล่วงหน้า
                            <ChevronDown
                              className={'size-3.5 transition-transform ' + (openAdv === r.employee_id ? 'rotate-180' : '')}
                              aria-hidden="true"
                            />
                          </button>
                          {/* 🔴 ป้ายนี้ต้องเห็นโดย**ไม่ต้องกาง** — กับดักข้อ 1 ของโปรเจ็ค:
                              ถ้าใบเบิกอ่านเหมือนรายจ่าย คนอ่านจะบวกเข้ากับต้นทุนในหัว
                              แล้วได้สองเท่า · ตอนออกแบบการ์ดใหม่ผมย้ายมันเข้าไปในส่วนที่
                              ต้องกดกาง แล้ว P5-UI-07 แดงทันที ซึ่งเป็นหน้าที่ของแถวนั้นพอดี */}
                          <span className="mt-0.5 block text-[11px] text-muted-token">
                            จ่ายเงิน · ไม่นับซ้ำเป็นต้นทุน
                          </span>
                        </dt>
                        <dd className="shrink-0 tnum text-muted-token">− {fmtBaht(r.advanced)}</dd>
                      </div>

                      {/* ใบที่ถูกหักคืนไปแล้วบางส่วน — ต้องเห็นโดยไม่ต้องกางเหมือนกัน
                          เพราะมันคือเงินที่บริษัทได้คืนไปแล้วส่วนหนึ่ง ไม่ใช่รายละเอียดปลีกย่อย */}
                      {advancesOf(r.employee_id)
                        .filter((a) => a.deducted_amount > 0)
                        .map((a) => (
                          <div key={'part-' + a.id} className="flex items-baseline justify-between gap-3">
                            <dt className="min-w-0 truncate text-xs text-muted-token">
                              {fmtDate(a.advance_date)} · หักแล้ว {fmtBaht(a.deducted_amount)} · เหลือ{' '}
                              {fmtBaht(a.amount - a.deducted_amount)}
                            </dt>
                            <dd className="shrink-0 text-[11px] text-muted-token">ค้างหักรอบหน้า</dd>
                          </div>
                        ))}
                    </>
                  )}

                  {/* ใบเบิกทีละใบ — กางเมื่อกด ไม่ใช่กางค้างไว้ให้ทุกการ์ดยาว */}
                  {openAdv === r.employee_id && advancesOf(r.employee_id).length > 0 && (
                    <ul className="space-y-1 rounded-sm bg-surface-2 p-2">
                      {advancesOf(r.employee_id).map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="min-w-0 truncate text-muted-token">
                            {fmtDate(a.advance_date)}
                            {a.deducted_amount > 0 && ' · หักแล้ว ' + fmtBaht(a.deducted_amount)}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <span className="tnum text-ink-2">
                              {fmtBaht(a.amount - a.deducted_amount)}
                            </span>
                            {a.deducted_amount > 0 ? (
                              <span className="text-[11px] text-muted-token">ค้างหัก</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => send(a.id, '/api/advances/' + a.id, undefined, 'ลบใบเบิกแล้ว', 'DELETE')}
                                disabled={busy !== null}
                                aria-label={'ลบใบเบิก ' + fmtBaht(a.amount) + ' ของ ' + r.full_name}
                                className="text-urgent transition-opacity hover:opacity-70 disabled:opacity-40"
                              >
                                <X className="size-3.5" />
                              </button>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* 🔴 ติดลบ = เบิกเกินค่าแรงที่ทำไปแล้ว · ต้องอ่านออกตั้งแต่ในลิสต์ */}
                  <div
                    data-balance-for={r.employee_id}
                    className="flex items-baseline justify-between gap-3 border-t border-line pt-1.5"
                  >
                    <dt className="font-medium text-ink">
                      {r.balance < 0 ? 'เบิกเกิน' : 'คงเหลือต้องจ่าย'}
                    </dt>
                    <dd className={'tnum text-lg font-bold ' + (r.balance < 0 ? 'text-urgent' : 'text-income')}>
                      {r.balance < 0 ? '− ' + fmtBaht(Math.abs(r.balance)) : fmtBaht(r.balance)}
                    </dd>
                  </div>
                </dl>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAdvanceFor(r)
                      setAmount('')
                      setAdvDate(today)
                      setFieldError('')
                    }}
                    // 🔴 ไม่ปิดปุ่มตอนคงเหลือ ฿0 หรือติดลบ — เบิกเกินได้ (20 ก.ย. 2569)
                    disabled={busy !== null}
                    className="btn-secondary flex-1 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <HandCoins className="size-4" />
                    เบิก
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPayFor(r)
                      setFieldError('')
                    }}
                    disabled={busy !== null || r.accrued <= 0}
                    className="btn-primary flex-1 disabled:cursor-not-allowed disabled:opacity-60"
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
              {(advanceFor?.balance ?? 0) < 0 ? (
                <>
                  คนนี้<span className="font-semibold text-urgent">เบิกเกินไปแล้ว{' '}
                    <span className="tnum">{fmtBaht(Math.abs(advanceFor?.balance ?? 0))}</span>
                  </span>{' '}
                </>
              ) : (
                <>
                  ค่าแรงค้างจ่ายที่เบิกได้{' '}
                  <span className="font-semibold tnum text-ink">{fmtBaht(advanceFor?.balance ?? 0)}</span>{' '}
                </>
              )}
              · การเบิกคือเงินสดออก ไม่ทำให้ต้นทุนโครงการเพิ่ม
            </Dialog.Description>

            <div className="mt-4">
              <label htmlFor="adv-date" className="label-base">วันที่เบิก</label>
              {/* 🔴 `<input type="date">` รับและส่งเป็น ค.ศ. เสมอ ห้ามแปลงเป็น พ.ศ. ก่อนส่ง
                  · `max` กันวันในอนาคตตั้งแต่บนหน้าจอ ส่วน route กันซ้ำอีกชั้น */}
              <input
                id="adv-date"
                type="date"
                value={advDate}
                max={today}
                onChange={(e) => {
                  setAdvDate(e.target.value)
                  if (fieldError) setFieldError('')
                }}
                className="input-base tnum"
              />
              <p className="mt-1 text-xs text-muted-token">
                ลงย้อนหลังได้ · ไม่ว่าลงวันไหน ใบเบิกจะถูกหักตอนจ่ายค่าแรงครั้งถัดไป
              </p>
            </div>

            <div className="mt-3">
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
              {/* คำเตือนสด ๆ ก่อนกด — ไม่ห้าม แต่ต้องรู้ตัวว่ากำลังจ่ายเกินค่าแรงที่เขาทำมา */}
              {overBy > 0 && (
                <p className="mt-1.5 rounded-xs bg-urgent-bg px-2.5 py-1.5 text-sm text-urgent">
                  เกินค่าแรงค้างจ่าย <span className="font-semibold tnum">{fmtBaht(overBy)}</span>{' '}
                  · จะถูกหักคืนจากค่าแรงงวดถัดไปจนครบ
                </p>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close disabled={busy !== null} className="btn-secondary">ยกเลิก</Dialog.Close>
              <button
                type="button"
                onClick={async () => {
                  if (!advanceFor) return
                  const done = await send(
                    advanceFor.employee_id, '/api/advances',
                    { employeeId: advanceFor.employee_id, amount, advanceDate: advDate },
                    'บันทึกเบิกแล้ว',
                  )
                  if (done) setAdvanceFor(null)
                }}
                disabled={busy !== null || amount.trim() === '' || advDate === ''}
                className={`${overBy > 0 ? 'btn-danger' : 'btn-primary'} disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {busy !== null ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {overBy > 0 ? 'ยืนยันเบิกเกิน' : 'บันทึกเบิก'}
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

/**
 * หนึ่งบรรทัดของยอด: ชื่อชิดซ้าย ตัวเลขชิดขวา
 *
 * 🔴 ตัวเลขเงินต้อง \`tnum\` เสมอ ไม่งั้นหลักไม่ตรงกันระหว่างบรรทัด แล้วสายตา
 * เทียบยอดไม่ได้ · และห้ามเอาหลายยอดมาเรียงแนวนอนบนจอแคบ (นั่นคือบั๊กที่เพิ่งแก้)
 */
function MoneyLine({
  label,
  value,
  tone = 'default',
}: {
  label: React.ReactNode
  value: string
  tone?: 'default' | 'income' | 'urgent' | 'muted'
}) {
  const color =
    tone === 'income' ? 'text-income'
      : tone === 'urgent' ? 'text-urgent'
        : tone === 'muted' ? 'text-muted-token'
          : 'text-ink'
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="min-w-0 text-ink-2">{label}</dt>
      <dd className={'shrink-0 tnum ' + color}>{value}</dd>
    </div>
  )
}

/**
 * บรรทัดเบี้ย/ค่าหัก ที่ **กางดูวันที่ได้**
 *
 * บรรทัดปิดอยู่ยังบอก "กี่ครั้ง" เสมอ เพราะตัวเลขนั้นคือสิ่งที่เอาไปเทียบกับ
 * จำนวนวันที่เขาออกต่างจังหวัดจริง · กางแล้วเห็นวันเป็นชิป ไล่ทีละวันได้
 */
function AdjustLine({
  adj,
  open,
  onToggle,
}: {
  adj: Adjustment
  open: boolean
  onToggle: () => void
}) {
  const add = adj.kind === 'add'
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="min-w-0">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="inline-flex max-w-full items-center gap-1 text-left text-ink-2 underline-offset-2 hover:underline"
          >
            <span className="truncate">{adj.name}</span>
            <span className="shrink-0 tnum text-muted-token">×{adj.times}</span>
            <ChevronDown
              className={'size-3.5 shrink-0 transition-transform ' + (open ? 'rotate-180' : '')}
              aria-hidden="true"
            />
          </button>
        </dt>
        <dd className={'shrink-0 tnum ' + (add ? 'text-income' : 'text-urgent')}>
          {add ? '+ ' : '− '}
          {fmtBaht(adj.total)}
        </dd>
      </div>
      {open && (
        <dd className="flex flex-wrap gap-1 rounded-sm bg-surface-2 p-2">
          {adj.days.map((d, i) => (
            <span
              key={d + i}
              className="chip bg-surface tnum text-ink-2 ring-line"
            >
              {fmtDate(d)}
            </span>
          ))}
        </dd>
      )}
    </>
  )
}
