'use client'

import { Check, Loader2, UserRound, X } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { fmtBaht } from '@/lib/format'
import { WAGE_TYPE_LABEL, type WageType } from '@/lib/employees'

type Employee = {
  id: string
  full_name: string
  job_title: string | null
  wage_type: WageType
  daily_rate: number | null
}
type Row = {
  id: string
  employee_id: string
  work_units: number
  ot_amount: number
  wage_snapshot: number
  amount: number
  note: string | null
}

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'คุณไม่ได้ดูแลไซต์นี้ในวันที่เลือก',
  SITE_REQUIRED: 'กรุณาเลือกไซต์',
  EMPLOYEE_REQUIRED: 'กรุณาเลือกคนงาน',
  DATE_INVALID: 'รูปแบบวันที่ไม่ถูกต้อง',
  DATE_BUDDHIST_ERA: 'ปีที่กรอกเป็น พ.ศ. — ระบบเก็บเป็น ค.ศ. กรุณาเลือกวันจากปฏิทิน',
  DATE_FUTURE: 'ลงชื่อล่วงหน้าไม่ได้ — ค่าแรงของวันที่ยังไม่มาถึงคือต้นทุนที่ยังไม่เกิด',
  WORK_UNITS_INVALID: 'ลงได้เฉพาะเต็มวันหรือครึ่งวัน',
  WORK_UNITS_EXCEEDED: 'วันนี้คนนี้ถูกลงชื่อที่ไซต์อื่นไปแล้ว รวมกันจะเกินหนึ่งวัน',
  ALREADY_SIGNED_IN: 'คนนี้ถูกลงชื่อในไซต์นี้ของวันนี้ไปแล้ว',
  EMPLOYEE_INACTIVE: 'คนงานคนนี้ถูกปิดใช้งานแล้ว',
  OT_INVALID: 'ค่า OT ต้องเป็นตัวเลขที่ไม่ติดลบ',
  NOT_FOUND: 'ไม่พบรายการนี้ — อาจถูกลบไปแล้ว',
}
const fail = (code?: string) => MESSAGES[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'

export function AttendanceBoard({
  date,
  today,
  siteId,
  sites,
  employees,
  signedIn,
}: {
  date: string
  today: string
  siteId: string
  sites: { id: string; name: string }[]
  employees: Employee[]
  signedIn: Row[]
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [busy, setBusy] = useState<string | null>(null)
  const [half, setHalf] = useState<Record<string, boolean>>({})
  const [ot, setOt] = useState<Record<string, string>>({})

  const byEmployee = new Map(signedIn.map((r) => [r.employee_id, r]))
  const inSite = employees.filter((e) => byEmployee.has(e.id))
  const notIn = employees.filter((e) => !byEmployee.has(e.id))

  /** เปลี่ยนวันหรือไซต์ = เปลี่ยน URL — แชร์ลิงก์ได้ กดย้อนกลับได้ */
  function go(next: Record<string, string>) {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) p.set(k, v)
    router.push(`/attendance?${p.toString()}`)
  }

  async function signIn(employeeId: string) {
    if (busy) return
    setBusy(employeeId)
    try {
      const r = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId,
          employeeId,
          workDate: date,
          workUnits: half[employeeId] ? 0.5 : 1,
          otAmount: Number(ot[employeeId] ?? 0) || 0,
        }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(fail(b.error))
        return
      }
      toast.success('ลงชื่อแล้ว')
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  async function signOut(row: Row) {
    if (busy) return
    setBusy(row.employee_id)
    try {
      const r = await fetch(`/api/attendance/${row.id}`, { method: 'DELETE' })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(fail(b.error))
        return
      }
      toast.success('เอาออกแล้ว')
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="att-site" className="label-base">ไซต์งาน</label>
          <select
            id="att-site"
            value={siteId}
            onChange={(e) => go({ site: e.target.value })}
            className="input-base"
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-1">
          <label htmlFor="att-date" className="label-base">วันที่</label>
          {/* 🔴 `<input type="date">` ส่งค่าเป็น ค.ศ. เสมอ ห้ามแปลงก่อนส่ง
              · `max` กันการเลือกวันในอนาคตตั้งแต่หน้าจอ */}
          <input
            id="att-date"
            type="date"
            value={date}
            max={today}
            onChange={(e) => e.target.value && go({ date: e.target.value })}
            className="input-base tnum"
          />
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          เข้าไซต์แล้ว
          <span className="ml-auto text-xs font-normal tnum text-muted-token">
            {inSite.length} คน
          </span>
        </div>
        {inSite.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-token">
            ยังไม่มีใครถูกลงชื่อในวันนี้ — ติ๊กจากรายชื่อข้างล่าง
          </p>
        ) : (
          <ul>
            {inSite.map((e) => {
              const row = byEmployee.get(e.id)!
              return (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-3.5 py-2.5 last:border-b-0 md:px-4"
                >
                  <UserRound className="size-4 shrink-0 text-muted-token" />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">
                    {e.full_name}
                    {Number(row.work_units) === 0.5 && (
                      <span className="ml-1.5 text-sm font-normal text-muted-token">ครึ่งวัน</span>
                    )}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tnum text-ink">
                    {fmtBaht(row.amount)}
                    {Number(row.ot_amount) > 0 && (
                      <span className="ml-1 text-xs font-normal text-muted-token">
                        (รวม OT {fmtBaht(row.ot_amount)})
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => signOut(row)}
                    disabled={busy !== null}
                    aria-label={`เอา ${e.full_name} ออกจากไซต์`}
                    className="btn-secondary shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy === e.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <X className="size-4" />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          ยังไม่เข้า
          <span className="ml-auto text-xs font-normal tnum text-muted-token">
            {notIn.length} คน
          </span>
        </div>
        {notIn.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-token">
            {employees.length === 0
              ? 'ยังไม่มีคนงานในระบบ — เจ้าของเพิ่มได้ที่หน้าตั้งค่า แท็บคนงาน'
              : 'ทุกคนถูกลงชื่อครบแล้ว'}
          </p>
        ) : (
          <ul>
            {notIn.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-3.5 py-2.5 last:border-b-0 md:px-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink">{e.full_name}</div>
                  <div className="truncate text-xs text-muted-token">
                    {e.job_title ?? 'ไม่ได้ระบุตำแหน่ง'} · {WAGE_TYPE_LABEL[e.wage_type]}
                    {e.wage_type === 'daily' && ` ${fmtBaht(e.daily_rate)}/วัน`}
                  </div>
                </div>

                <label className="flex shrink-0 items-center gap-1.5 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={Boolean(half[e.id])}
                    onChange={(ev) => setHalf((h) => ({ ...h, [e.id]: ev.target.checked }))}
                    className="size-4 accent-brand"
                  />
                  ครึ่งวัน
                </label>

                <input
                  type="text"
                  inputMode="decimal"
                  value={ot[e.id] ?? ''}
                  onChange={(ev) => setOt((o) => ({ ...o, [e.id]: ev.target.value }))}
                  placeholder="OT ฿"
                  aria-label={`ค่า OT ของ ${e.full_name}`}
                  className="input-base w-24 shrink-0 tnum"
                />

                <button
                  type="button"
                  onClick={() => signIn(e.id)}
                  disabled={busy !== null}
                  className="btn-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy === e.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  เข้าไซต์
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
