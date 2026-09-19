'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, Check, Loader2, Lock, Pencil, SlidersHorizontal, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { fmtBaht, fmtDate } from '@/lib/format'
import {
  ADJUST_ERRORS, adjustNet, type AdjustLine, type AdjustPreset,
} from '@/lib/wage-adjustments'
import { AdjustDialog } from '@/app/(app)/attendance/adjust-dialog'

/** หนึ่งวันทำงานของคน×โครงการ — จาก `attendance_grid` + บรรทัดปรับของวันนั้น */
export type WageDay = {
  attendance_id: string
  work_date: string
  work_units: number
  wage_snapshot: number
  /** ยอดสุทธิของรายการปรับ (บวก − หัก) */
  ot_amount: number
  amount: number
  paid: boolean
  lines: AdjustLine[]
}

export type WageRowKey = string
export const wageRowKey = (employeeId: string, siteId: string): WageRowKey => `${employeeId}|${siteId}`

type Target = {
  key: WageRowKey
  employeeId: string
  siteId: string
  personName: string
  siteName: string
}

const Ctx = createContext<{
  details: Record<WageRowKey, WageDay[]>
  open: (t: Target) => void
} | null>(null)

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่แก้ค่าแรงได้',
  AMOUNT_INVALID: 'ค่าแรงต้องไม่ติดลบ',
  PAYROLL_CLOSED: 'วันนี้ถูกจ่ายไปแล้ว แก้ไม่ได้',
  NOT_FOUND: 'ไม่พบรายการนี้ — อาจถูกลบไปแล้ว',
  ...ADJUST_ERRORS,
}
const fail = (code?: string) => MESSAGES[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'

/**
 * แก้ค่าแรงที่จ่ายจริงของ คน×โครงการ ในเดือนที่ดูอยู่ (คำสั่งเจ้าของ 19 ก.ย. 2569)
 *
 * แถวในแท็บ "ทำงานที่ไหนบ้าง" เป็นยอดรวมของหลายวัน — กล่องนี้จึงกางเป็นรายวัน:
 * แต่ละวันแก้ **ค่าแรงฐาน** ได้ตรง ๆ และเปิดกล่อง "ปรับ" (OT/เบี้ยเลี้ยง/หัก)
 * ของวันนั้นได้ · วันที่จ่ายเงินไปแล้วล็อกทั้งที่หน้าจอและที่ฐานข้อมูล
 *
 * 🔴 ค่าแรงคือต้นทุนของโครงการ (accrual — §17 ข้อ 1) แก้ตรงนี้ = แถบต้นทุน
 *    ของโครงการและกำไรขยับทันที · กล่องจึงเตือนชัด ๆ ก่อนกดบันทึก
 * 🔴 กล่องมีตัวเดียวต่อหน้า (provider + ปุ่มต่อแถว) — หลายสิบแถวที่แต่ละแถวพก
 *    dialog ของตัวเองคือ markup หลายสิบชุดที่ถูกส่งข้ามเน็ตเพื่อให้เปิดดูอย่างมากหนึ่ง
 * 🔴 ฐานบันทึกผ่าน `POST /api/payroll/day` **โดยไม่ส่ง OT** = ฟังก์ชันไม่แตะ
 *    รายการปรับ · รายการปรับบันทึกผ่าน `PUT /api/attendance/[id]/adjustments`
 *    ทันทีที่กดบันทึกในกล่องย่อย — สองทางนี้ไม่ทับกัน
 */
export function SiteWageProvider({
  details,
  presets,
  children,
}: {
  details: Record<WageRowKey, WageDay[]>
  presets: AdjustPreset[]
  children: ReactNode
}) {
  const [target, setTarget] = useState<Target | null>(null)
  return (
    <Ctx.Provider value={{ details, open: setTarget }}>
      {children}
      {target && (
        <SiteWageDialog
          key={target.key}
          target={target}
          days={details[target.key] ?? []}
          presets={presets}
          onClose={() => setTarget(null)}
        />
      )}
    </Ctx.Provider>
  )
}

/** ปุ่มดินสอท้ายแถว — วาดเฉพาะแถวที่ยังมีวันค้างจ่ายให้แก้ */
export function SiteWageButton({
  employeeId,
  siteId,
  personName,
  siteName,
}: {
  employeeId: string
  siteId: string
  personName: string
  siteName: string
}) {
  const ctx = useContext(Ctx)
  if (!ctx) return null
  const key = wageRowKey(employeeId, siteId)
  const days = ctx.details[key] ?? []
  const editable = days.some((d) => !d.paid)
  if (days.length === 0) return null
  return (
    <button
      type="button"
      onClick={() => ctx.open({ key, employeeId, siteId, personName, siteName })}
      aria-label={
        editable ? `แก้ค่าแรงของ ${personName} ที่ ${siteName}` : `ค่าแรงของ ${personName} ที่ ${siteName} จ่ายแล้ว`
      }
      title={editable ? 'แก้ค่าแรงที่จ่ายจริง' : 'จ่ายแล้ว — ดูได้อย่างเดียว'}
      className={`grid size-9 shrink-0 place-items-center rounded-md border transition-colors duration-100 ${
        editable
          ? 'border-line-strong bg-surface text-ink-2 hover:border-ink-2 hover:text-ink'
          : 'border-line bg-surface-2 text-muted-token'
      }`}
    >
      {editable ? <Pencil className="size-4" strokeWidth={1.8} /> : <Lock className="size-4" strokeWidth={1.8} />}
    </button>
  )
}

function SiteWageDialog({
  target,
  days,
  presets,
  onClose,
}: {
  target: Target
  days: WageDay[]
  presets: AdjustPreset[]
  onClose: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  // ค่าแรงฐานที่กำลังพิมพ์ ต่อวัน — เริ่มจากค่าจริงในฐานข้อมูล
  const [wages, setWages] = useState<Record<string, string>>(() =>
    Object.fromEntries(days.map((d) => [d.attendance_id, String(d.wage_snapshot)])),
  )
  // บรรทัดปรับล่าสุดต่อวัน — อัปเดตทันทีหลัง PUT สำเร็จ ให้ยอดรวมในกล่องตรงกับฐานข้อมูล
  const [lines, setLines] = useState<Record<string, AdjustLine[]>>(() =>
    Object.fromEntries(days.map((d) => [d.attendance_id, d.lines])),
  )
  const [adjustFor, setAdjustFor] = useState<WageDay | null>(null)
  const [adjustSaving, setAdjustSaving] = useState(false)

  const wageOf = (d: WageDay) => {
    const n = Number((wages[d.attendance_id] ?? '').replace(/,/g, ''))
    return Number.isFinite(n) && n >= 0 ? n : NaN
  }
  const totalOf = (d: WageDay) => {
    const w = wageOf(d)
    return Number.isNaN(w) ? NaN : d.work_units * w + adjustNet(lines[d.attendance_id] ?? [])
  }
  const changed = days.filter((d) => !d.paid && wageOf(d) !== d.wage_snapshot)
  const invalid = days.some((d) => !d.paid && (Number.isNaN(wageOf(d)) || totalOf(d) < 0))
  const totals = days.map(totalOf)
  const grand = totals.some(Number.isNaN) ? null : totals.reduce((s, t) => s + t, 0)
  const before = days.reduce((s, d) => s + d.amount, 0)

  async function saveBase() {
    if (busy || invalid || changed.length === 0) return
    setBusy(true)
    let ok = 0
    let firstError: string | null = null
    for (const d of changed) {
      try {
        const r = await fetch('/api/payroll/day', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employeeId: target.employeeId,
            siteId: target.siteId,
            workDate: d.work_date,
            workUnits: d.work_units,
            wage: wageOf(d),
            // ไม่ส่ง otAmount = ไม่แตะ OT/เบี้ยเลี้ยง/หัก ที่ตั้งไว้ของวันนั้น
          }),
        })
        if (r.ok) ok += 1
        else {
          const b = await r.json().catch(() => ({}))
          firstError ??= typeof b.error === 'string' ? b.error : 'UNKNOWN'
        }
      } catch {
        firstError ??= 'NETWORK'
      }
    }
    setBusy(false)
    if (firstError === null) {
      toast.success(`แก้ค่าแรงแล้ว ${ok} วัน — ต้นทุนโครงการอัปเดตแล้ว`)
      onClose()
      router.refresh()
      return
    }
    if (ok > 0) toast.error(`บันทึกได้ ${ok} วัน · ที่เหลือไม่สำเร็จ: ${fail(firstError)}`)
    else toast.error(firstError === 'NETWORK' ? 'เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่' : fail(firstError))
    router.refresh()
  }

  async function saveAdjust(next: AdjustLine[]) {
    if (!adjustFor) return
    setAdjustSaving(true)
    try {
      const r = await fetch(`/api/attendance/${adjustFor.attendance_id}/adjustments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjustments: next }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(fail(b.error))
        return
      }
      setLines((l) => ({ ...l, [adjustFor.attendance_id]: next }))
      toast.success('บันทึกรายการปรับแล้ว — ต้นทุนโครงการอัปเดตแล้ว')
      setAdjustFor(null)
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setAdjustSaving(false)
    }
  }

  return (
    <>
      <Dialog.Root open onOpenChange={(v) => !v && !busy && onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90svh] w-[min(32rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-e3 animate-pop-in">
            <div className="flex items-start gap-3 border-b border-line-soft px-4 py-3">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="truncate text-lg font-bold text-ink">
                  แก้ค่าแรง · {target.personName}
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 truncate text-sm text-muted-token">
                  {target.siteName} · {days.length} วันในเดือนนี้
                </Dialog.Description>
              </div>
              <Dialog.Close
                aria-label="ปิด"
                disabled={busy}
                className="grid size-9 shrink-0 place-items-center rounded-md border border-line-strong bg-surface text-ink-2 transition-colors hover:border-ink-2 hover:text-ink"
              >
                <X className="size-4" strokeWidth={2} />
              </Dialog.Close>
            </div>

            {/* 🔴 คำเตือนก่อนแก้ — ตัวเลขนี้คือต้นทุนของโครงการ ไม่ใช่แค่ยอดในสลิป */}
            <div className="flex gap-2.5 border-b border-status-progress-ring bg-status-progress-bg px-4 py-2.5">
              <AlertTriangle className="size-4.5 shrink-0 text-status-progress" strokeWidth={1.8} aria-hidden />
              <p className="text-sm leading-5 text-ink-2">
                <span className="font-semibold text-ink">การแก้ไขค่าแรงนี้จะแก้ไขค่าใช้จ่ายของโครงการด้วยทันที</span>{' '}
                — ต้นทุนค่าแรง กำไร และยอดค้างจ่ายของคนนี้เปลี่ยนตามทันทีที่บันทึก
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <ul>
                {days.map((d) => {
                  const ls = lines[d.attendance_id] ?? []
                  const total = totalOf(d)
                  return (
                    <li
                      key={d.attendance_id}
                      className={`border-b border-line-soft px-4 py-3 last:border-b-0 ${d.paid ? 'bg-surface-2' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-ink">
                            {fmtDate(d.work_date)}
                            {d.work_units === 0.5 && (
                              <span className="ml-1.5 text-xs font-normal text-muted-token">ครึ่งวัน</span>
                            )}
                          </span>
                          <span className="block text-xs text-muted-token">
                            {d.paid
                              ? 'จ่ายแล้ว — แก้ไม่ได้'
                              : ls.length > 0
                                ? ls.map((l) => `${l.kind === 'add' ? '+' : '−'}${l.name} ${l.amount.toLocaleString('th-TH')}`).join(' · ')
                                : 'ยังไม่มีรายการปรับ'}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 text-right text-base font-bold tnum ${
                            Number.isNaN(total) || total < 0 ? 'text-urgent' : 'text-ink'
                          }`}
                        >
                          {Number.isNaN(total) ? '—' : fmtBaht(total)}
                        </span>
                      </div>
                      {!d.paid && (
                        <div className="mt-2 flex items-center gap-2">
                          <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-ink-2">
                            <span className="shrink-0">ค่าแรง{d.work_units === 0.5 ? '/วัน' : ''}</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={wages[d.attendance_id] ?? ''}
                              onChange={(e) => setWages((w) => ({ ...w, [d.attendance_id]: e.target.value }))}
                              aria-label={`ค่าแรงฐานวันที่ ${fmtDate(d.work_date)}`}
                              className="input-base min-w-0 py-1.5 text-right tnum"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => setAdjustFor(d)}
                            disabled={busy}
                            className={`btn-secondary shrink-0 px-2.5 py-1.5 text-sm ${
                              ls.length > 0 ? 'border-brand-solid text-brand' : ''
                            }`}
                          >
                            <SlidersHorizontal className="size-4" />
                            ปรับ
                          </button>
                        </div>
                      )}
                      {!d.paid && wageOf(d) !== d.wage_snapshot && !Number.isNaN(wageOf(d)) && (
                        <p className="mt-1 text-xs text-muted-token">
                          เดิม {fmtBaht(d.wage_snapshot)}{d.work_units === 0.5 ? '/วัน' : ''} → {fmtBaht(wageOf(d))}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="border-t border-line-soft bg-surface-2 px-4 py-3">
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-sm">
                <dt className="text-muted-token">ยอดเดิมของเดือนนี้</dt>
                <dd className="text-right tnum text-ink-2">{fmtBaht(before)}</dd>
                <dt className="font-semibold text-ink">ยอดใหม่</dt>
                <dd className={`text-right text-lg font-bold tnum ${invalid ? 'text-urgent' : 'text-ink'}`}>
                  {grand === null ? '—' : fmtBaht(grand)}
                </dd>
              </dl>
              {invalid && (
                <p className="mt-1 text-xs text-urgent">ค่าแรงต้องเป็นตัวเลขไม่ติดลบ และหักได้ไม่เกินค่าแรงของวัน</p>
              )}
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={onClose} disabled={busy} className="btn-secondary flex-1">
                  ปิด
                </button>
                <button
                  type="button"
                  onClick={saveBase}
                  disabled={busy || invalid || changed.length === 0}
                  className="btn-primary flex-1 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  {busy ? 'กำลังบันทึก…' : changed.length > 0 ? `บันทึก ${changed.length} วัน` : 'บันทึก'}
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* กล่องปรับของวันเดียว — ซ้อนบนกล่องนี้ · บันทึกแล้วยิง PUT ทันที */}
      {adjustFor && (
        <AdjustDialog
          key={adjustFor.attendance_id}
          name={`${target.personName} · ${fmtDate(adjustFor.work_date)}`}
          units={adjustFor.work_units}
          base={adjustFor.work_units * (Number.isNaN(wageOf(adjustFor)) ? adjustFor.wage_snapshot : wageOf(adjustFor))}
          presets={presets}
          initial={lines[adjustFor.attendance_id] ?? []}
          saving={adjustSaving}
          onSave={saveAdjust}
          onClose={() => setAdjustFor(null)}
        />
      )}
    </>
  )
}
