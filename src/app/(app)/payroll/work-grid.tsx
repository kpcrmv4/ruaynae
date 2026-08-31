'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Check, Loader2, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { fmtBaht, fmtDateLong } from '@/lib/format'

export type GridEmployee = {
  id: string
  full_name: string
  job_title: string | null
  /** เรตรายวันของคนนี้ — ใช้เป็นค่าเริ่มต้นในกล่องแก้ไข (null = คนรายเดือน) */
  daily_rate: number | null
  wage_type: 'daily' | 'monthly'
  default_site_id: string | null
}

export type GridCell = {
  attendance_id: string
  employee_id: string
  work_date: string
  site_id: string
  site_name: string
  work_units: number
  wage_snapshot: number
  ot_amount: number
  amount: number
  paid: boolean
}

type Site = { id: string; name: string }

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่แก้ตารางนี้ได้',
  SITE_REQUIRED: 'กรุณาเลือกไซต์งาน',
  EMPLOYEE_REQUIRED: 'ไม่พบคนงานคนนี้',
  DATE_INVALID: 'รูปแบบวันที่ไม่ถูกต้อง',
  DATE_BUDDHIST_ERA: 'ปีที่กรอกเป็น พ.ศ. — ระบบเก็บเป็น ค.ศ.',
  DATE_FUTURE: 'ลงชื่อล่วงหน้าไม่ได้ — ค่าแรงของวันที่ยังไม่มาถึงคือต้นทุนที่ยังไม่เกิด',
  WORK_UNITS_INVALID: 'ลงได้เฉพาะเต็มวันหรือครึ่งวัน',
  WORK_UNITS_EXCEEDED: 'วันนี้คนนี้ถูกลงชื่อที่ไซต์อื่นไปแล้ว รวมกันจะเกินหนึ่งวัน',
  AMOUNT_INVALID: 'ค่าแรงต้องไม่ติดลบ',
  OT_INVALID: 'ค่า OT ต้องเป็นตัวเลขที่ไม่ติดลบ',
  PAYROLL_CLOSED: 'วันนี้ถูกจ่ายไปแล้ว แก้ไม่ได้',
  EMPLOYEE_INACTIVE: 'คนงานคนนี้ถูกปิดใช้งานแล้ว',
  NOT_FOUND: 'ไม่พบรายการนี้ — อาจถูกลบไปแล้ว',
}
const fail = (code?: string) => MESSAGES[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'

/** เสาร์-อาทิตย์ระบายพื้นต่างเล็กน้อย — งานไซต์ทำเสาร์ แต่อาทิตย์มักหยุด */
const isWeekend = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return d === 0 || d === 6
}
const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const dowOf = (iso: string) => DOW[new Date(`${iso}T00:00:00Z`).getUTCDay()]

/**
 * ตารางการทำงานของเดือนที่เลือก — แถวเป็นคน คอลัมน์เป็นวัน
 *
 * 🔴 ตารางกว้างกว่าจอเสมอ (31 วัน) จึง **เลื่อนแนวนอนในกล่องของตัวเอง**
 * และคอลัมน์ชื่อคนถูกตรึงไว้ซ้าย — ไม่งั้นเลื่อนไปวันที่ 20 แล้วไม่รู้ว่าแถวไหนของใคร
 * · ห้ามปล่อยให้ทั้งหน้าเลื่อนแทน เพราะเชลล์ตั้ง `overflow-x: clip` ไว้
 *   ส่วนที่เกินจะถูกตัดทิ้งโดยไม่มีแถบเลื่อนบอก (§17 ข้อ 7)
 *
 * สถานะในช่อง (มีคำอธิบายสีอยู่เหนือตาราง):
 *   ว่าง       = ไม่ได้มาทำงาน — แตะเพื่อเพิ่ม
 *   ค้างจ่าย   = ทำงานแล้วแต่ยังไม่ถูกปิดรอบ (สีส้ม) — แตะเพื่อแก้
 *   จ่ายแล้ว   = อยู่ในรอบที่ปิดแล้ว (เทา + ติ๊กถูก) — แก้ไม่ได้ ทั้งที่หน้าจอและที่ฐานข้อมูล
 */
export function WorkGrid({
  employees,
  cells,
  sites,
  days,
  today,
}: {
  employees: GridEmployee[]
  cells: GridCell[]
  sites: Site[]
  /** ทุกวันของเดือนที่เลือก (ค.ศ. `YYYY-MM-DD`) */
  days: string[]
  today: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<{ employee: GridEmployee; date: string; cell?: GridCell } | null>(
    null,
  )
  const [siteId, setSiteId] = useState('')
  const [wage, setWage] = useState('')
  const [half, setHalf] = useState(false)
  const [ot, setOt] = useState('')

  const byKey = new Map(cells.map((c) => [`${c.employee_id}|${c.work_date}`, c]))
  const cellOf = (employeeId: string, date: string) => byKey.get(`${employeeId}|${date}`)

  const totalOf = (employeeId: string) =>
    cells.filter((c) => c.employee_id === employeeId).reduce((s, c) => s + c.amount, 0)
  const daysOf = (employeeId: string) =>
    cells.filter((c) => c.employee_id === employeeId).reduce((s, c) => s + c.work_units, 0)

  function openCell(employee: GridEmployee, date: string) {
    const cell = cellOf(employee.id, date)
    if (cell?.paid) return // จ่ายแล้ว = อ่านอย่างเดียว
    if (date > today) return // วันในอนาคตยังไม่มีต้นทุน
    setOpen({ employee, date, cell })
    setSiteId(cell?.site_id ?? employee.default_site_id ?? sites[0]?.id ?? '')
    // ค่าเริ่มต้นของช่องเงิน: ของเดิมในวันนั้น → เรตของคนนั้น → ว่าง
    setWage(String(cell?.wage_snapshot ?? employee.daily_rate ?? ''))
    setHalf((cell?.work_units ?? 1) === 0.5)
    setOt(cell && cell.ot_amount > 0 ? String(cell.ot_amount) : '')
  }

  async function save() {
    if (!open || busy) return
    if (!siteId) {
      toast.error('กรุณาเลือกไซต์งาน')
      return
    }
    const wageNum = Number(wage.replace(/,/g, ''))
    if (!Number.isFinite(wageNum) || wageNum < 0) {
      toast.error('ค่าแรงต้องเป็นตัวเลขที่ไม่ติดลบ')
      return
    }
    setBusy(true)
    try {
      const r = await fetch('/api/payroll/day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: open.employee.id,
          siteId,
          workDate: open.date,
          workUnits: half ? 0.5 : 1,
          wage: wageNum,
          otAmount: Number(ot.replace(/,/g, '')) || 0,
        }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(fail(b.error))
        return
      }
      toast.success('บันทึกแล้ว')
      setOpen(null)
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!open?.cell || busy) return
    setBusy(true)
    try {
      const r = await fetch(`/api/attendance/${open.cell.attendance_id}`, { method: 'DELETE' })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(fail(b.error))
        return
      }
      toast.success('เอาวันนี้ออกแล้ว')
      setOpen(null)
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  const wageNum = Number(wage.replace(/,/g, '')) || 0
  const otNum = Number(ot.replace(/,/g, '')) || 0
  const dayTotal = wageNum * (half ? 0.5 : 1) + otNum

  return (
    <>
      {/* ── คำอธิบายสี — ต้องอยู่เหนือตาราง ไม่ใช่ให้เดาเอาเอง ────────── */}
      <div className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-token">
        <span className="font-medium text-ink-2">ความหมายของช่อง:</span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-4 rounded-xs border border-line-strong bg-surface" />
          ไม่ได้ทำงาน
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-4 rounded-xs bg-status-progress-bg ring-1 ring-inset ring-status-progress-ring"
          />
          ค้างจ่าย
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="flex size-4 items-center justify-center rounded-xs bg-surface-3 text-muted-token"
          >
            <Check className="size-3" strokeWidth={3} />
          </span>
          จ่ายแล้ว (แก้ไม่ได้)
        </span>
      </div>

      <div className="panel overflow-hidden">
        {/* กล่องเลื่อนแนวนอนของตัวเอง — ไม่ให้ทั้งหน้าเลื่อนตาม */}
        <div className="overflow-x-auto">
          <table className="w-max border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 w-40 border-b border-r border-line bg-surface-2 px-3 py-2 text-left text-xs font-semibold text-muted-token">
                  พนักงาน
                </th>
                {days.map((d) => {
                  const day = Number(d.slice(8, 10))
                  const future = d > today
                  return (
                    <th
                      key={d}
                      scope="col"
                      className={`w-11 border-b border-line px-0 py-1.5 text-center text-[11px] font-semibold ${
                        isWeekend(d) ? 'bg-surface-3 text-urgent' : 'bg-surface-2 text-ink-2'
                      } ${future ? 'opacity-45' : ''}`}
                    >
                      <span className="block tnum leading-4">{day}</span>
                      <span className="block text-[10px] font-normal leading-3 text-muted-token">
                        {dowOf(d)}
                      </span>
                    </th>
                  )
                })}
                <th className="w-28 border-b border-l border-line bg-surface-2 px-3 py-2 text-right text-xs font-semibold text-muted-token">
                  รวมเดือนนี้
                </th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="even:bg-surface-2/40">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 w-40 border-b border-r border-line-soft bg-surface px-3 py-1.5 text-left"
                  >
                    <span className="block max-w-36 truncate text-sm font-medium text-ink">
                      {e.full_name}
                    </span>
                    <span className="block max-w-36 truncate text-[11px] text-muted-token">
                      {e.wage_type === 'monthly'
                        ? 'รายเดือน · ไม่คิดค่าแรงรายวัน'
                        : e.daily_rate
                          ? `วันละ ${fmtBaht(e.daily_rate)}`
                          : 'ยังไม่ได้ตั้งค่าแรง'}
                    </span>
                  </th>

                  {days.map((d) => {
                    const cell = cellOf(e.id, d)
                    const future = d > today
                    const locked = cell?.paid === true
                    return (
                      <td key={d} className="border-b border-line-soft p-0.5 text-center">
                        <button
                          type="button"
                          onClick={() => openCell(e, d)}
                          disabled={locked || future || busy}
                          aria-label={`${e.full_name} · ${fmtDateLong(d)}${
                            cell
                              ? ` · ${cell.site_name} ${fmtBaht(cell.amount)}${cell.paid ? ' (จ่ายแล้ว)' : ' (ค้างจ่าย)'}`
                              : ' · ยังไม่ได้ลง'
                          }`}
                          className={`flex h-9 w-10 items-center justify-center rounded-sm text-[11px] font-semibold tnum transition-colors duration-100 ${
                            locked
                              ? 'cursor-not-allowed bg-surface-3 text-muted-token'
                              : cell
                                ? 'bg-status-progress-bg text-status-progress ring-1 ring-inset ring-status-progress-ring hover:brightness-95'
                                : future
                                  ? 'cursor-not-allowed text-muted-token opacity-30'
                                  : 'text-muted-token hover:bg-brand-tint hover:text-brand-on-tint'
                          }`}
                        >
                          {locked ? (
                            <Check className="size-4" strokeWidth={3} />
                          ) : cell ? (
                            <span>{cell.work_units === 0.5 ? '½' : '✓'}</span>
                          ) : (
                            <span aria-hidden>+</span>
                          )}
                        </button>
                      </td>
                    )
                  })}

                  <td className="border-b border-l border-line-soft px-3 py-1.5 text-right">
                    <span className="block text-sm font-bold tnum text-ink">
                      {fmtBaht(totalOf(e.id))}
                    </span>
                    <span className="block text-[11px] tnum text-muted-token">
                      {daysOf(e.id)} วัน
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-token">
        แตะช่องวันเพื่อเพิ่มหรือแก้ — เลือกไซต์และค่าแรงของวันนั้นได้ (ค่าเริ่มต้นดึงจากเรตของคนนั้น)
        · วันที่อยู่ในรอบจ่ายที่ปิดแล้วจะล็อกไว้ ทั้งที่หน้าจอและที่ฐานข้อมูล
      </p>

      {/* ── กล่องแก้ไขหนึ่งวัน ─────────────────────────────────────── */}
      <Dialog.Root open={open !== null} onOpenChange={(v) => !busy && !v && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90svh] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
            <Dialog.Title className="text-lg font-bold text-ink">
              {open?.employee.full_name}
            </Dialog.Title>
            <Dialog.Description className="mt-0.5 text-sm text-muted-token">
              {open ? fmtDateLong(open.date) : ''}
              {open?.cell ? ' · แก้ไขวันที่บันทึกไว้แล้ว' : ' · เพิ่มวันทำงาน'}
            </Dialog.Description>

            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="grid-site" className="label-base">
                  ทำงานที่ไซต์
                </label>
                <select
                  id="grid-site"
                  value={siteId}
                  onChange={(ev) => setSiteId(ev.target.value)}
                  className="input-base"
                >
                  {sites.length === 0 && <option value="">— ยังไม่มีไซต์งาน —</option>}
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="grid-wage" className="label-base">
                  ค่าแรงต่อวัน (บาท)
                </label>
                <input
                  id="grid-wage"
                  type="text"
                  inputMode="decimal"
                  value={wage}
                  onChange={(ev) => setWage(ev.target.value)}
                  placeholder="0"
                  className="input-base text-lg font-semibold tnum"
                />
                <p className="mt-1 text-xs text-muted-token">
                  ค่าเริ่มต้นคือเรตของคนนี้ · แก้เฉพาะวันนี้ได้โดยไม่กระทบวันอื่น
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span id="grid-units" className="label-base">
                    ทำงาน
                  </span>
                  <div role="radiogroup" aria-labelledby="grid-units" className="grid grid-cols-2 gap-2">
                    {[
                      { v: false, label: 'เต็มวัน' },
                      { v: true, label: 'ครึ่งวัน' },
                    ].map((o) => (
                      <button
                        key={o.label}
                        type="button"
                        role="radio"
                        aria-checked={half === o.v}
                        onClick={() => setHalf(o.v)}
                        className={`min-h-11 rounded-md border text-sm transition-colors duration-100 ${
                          half === o.v
                            ? 'border-brand bg-brand-tint font-semibold text-brand-on-tint'
                            : 'border-line-strong bg-surface text-ink-2 hover:border-ink-2'
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label htmlFor="grid-ot" className="label-base">
                    OT (บาท)
                  </label>
                  <input
                    id="grid-ot"
                    type="text"
                    inputMode="decimal"
                    value={ot}
                    onChange={(ev) => setOt(ev.target.value)}
                    placeholder="0"
                    className="input-base tnum"
                  />
                </div>
              </div>

              {/* ยืนยันด้วยตัวเลขที่จะถูกบันทึกจริง ไม่ใช่ให้คิดเองในหัว */}
              <div className="flex items-baseline justify-between rounded-md border border-line bg-surface-2 px-3 py-2.5">
                <span className="text-sm text-ink-2">ค่าแรงของวันนี้</span>
                <span className="text-lg font-bold tnum text-ink">{fmtBaht(dayTotal)}</span>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              {open?.cell && (
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="btn-danger disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 className="size-4" />
                  เอาวันนี้ออก
                </button>
              )}
              <span className="flex-1" />
              <Dialog.Close disabled={busy} className="btn-secondary">
                ยกเลิก
              </Dialog.Close>
              <button
                type="button"
                onClick={save}
                disabled={busy || sites.length === 0}
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                บันทึก
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
