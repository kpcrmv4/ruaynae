'use client'

import { Check, History, Loader2, UserRound, X } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { fmtBaht } from '@/lib/format'

type Employee = {
  id: string
  full_name: string
  job_title: string | null
}
/** `amount`/`otAmount` เป็น `null` เมื่อคนดูไม่มีสิทธิ์เห็นเงิน — ไม่ใช่ 0 */
type Row = {
  id: string
  employee_id: string
  work_units: number
  amount: number | null
  otAmount: number | null
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
  canSeeMoney,
  dayWage,
  yesterdaySignIns,
  bookedElsewhere,
}: {
  date: string
  today: string
  siteId: string
  sites: { id: string; name: string }[]
  employees: Employee[]
  signedIn: Row[]
  /** เจ้าของเท่านั้น — หัวหน้าไซต์บันทึกว่าใครมา ไม่ได้ดูเงิน */
  canSeeMoney: boolean
  /** ค่าแรงรวมของวัน จาก RPC ฝั่งเซิร์ฟเวอร์ — undefined = คนดูไม่มีสิทธิ์เห็นเงิน */
  dayWage?: number
  /** ใครเข้าไซต์นี้เมื่อวาน (วันก่อนวันที่เลือก) — ป้อนปุ่ม "เหมือนเมื่อวาน" */
  yesterdaySignIns: { employee_id: string; work_units: number }[]
  /**
   * วันนี้ใครถูกลงชื่อ "ที่ไซต์อื่น" ไปแล้วกี่วัน และไซต์ไหนบ้าง
   *
   * เพดานคือ 1 วันต่อคนต่อวัน (guard ที่ฐานข้อมูล) — ค่านี้ทำให้หน้าจอบอกล่วงหน้า
   * แทนที่จะปล่อยให้กดแล้วเจอ error · ว่างเปล่าไม่ได้แปลว่าคนนั้นว่าง มันแปลว่า
   * "เท่าที่คนดูมีสิทธิ์เห็น" — ฐานข้อมูลยังเป็นตัวตัดสินสุดท้ายเสมอ
   */
  bookedElsewhere: Record<string, { units: number; siteNames: string[] }>
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [busy, setBusy] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [half, setHalf] = useState<Record<string, boolean>>({})
  const [ot, setOt] = useState<Record<string, string>>({})

  const byEmployee = new Map(signedIn.map((r) => [r.employee_id, r]))
  const inSite = employees.filter((e) => byEmployee.has(e.id))
  const notIn = employees.filter((e) => !byEmployee.has(e.id))

  /** เหลือลงได้อีกกี่วันสำหรับคนนี้ (เพดาน 1 วันต่อวัน หักที่ลงไว้ที่ไซต์อื่นแล้ว) */
  const capacityOf = (employeeId: string) =>
    Math.max(0, 1 - (bookedElsewhere[employeeId]?.units ?? 0))

  // ชุดของเมื่อวานที่ยังไม่ถูกลงวันนี้ คนยังอยู่ในรายชื่อ และยังมีโควตาเหลือ
  // — คนที่เต็มวันอยู่ไซต์อื่นแล้วต้องไม่ถูกนับในปุ่ม ไม่งั้นตัวเลขบนปุ่มโกหก
  const employeeIds = new Set(employees.map((e) => e.id))
  const copyFromYesterday = yesterdaySignIns.filter(
    (r) =>
      employeeIds.has(r.employee_id) &&
      !byEmployee.has(r.employee_id) &&
      capacityOf(r.employee_id) > 0,
  )

  /** เปลี่ยนวันหรือไซต์ = เปลี่ยน URL — แชร์ลิงก์ได้ กดย้อนกลับได้ */
  function go(next: Record<string, string>) {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) p.set(k, v)
    router.push(`/attendance?${p.toString()}`)
  }

  /** ยิงลงชื่อหนึ่งคน — คืนรหัสเหตุผลที่ไม่สำเร็จ (null = สำเร็จ) ให้ผู้เรียกสรุปข้อความเอง */
  async function postSignIn(employeeId: string, workUnits: number, otAmount: number) {
    try {
      const r = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId,
          employeeId,
          workDate: date,
          workUnits,
          // ส่งเฉพาะตอนเป็นเจ้าของ · API ก็เพิกเฉยค่าที่หัวหน้าไซต์ส่งมาอีกชั้น
          ...(canSeeMoney ? { otAmount } : {}),
        }),
      })
      if (r.ok) return null
      const b = await r.json().catch(() => ({}))
      return typeof b.error === 'string' ? b.error : 'UNKNOWN'
    } catch {
      return 'NETWORK'
    }
  }

  async function signIn(employeeId: string) {
    if (busy || bulkBusy) return
    setBusy(employeeId)
    // ลงครึ่งวันที่ไซต์อื่นไปแล้ว = เหลือโควตาแค่ครึ่งวัน ส่งเต็มวันไปก็โดนปฏิเสธ
    const cap = capacityOf(employeeId)
    const code = await postSignIn(
      employeeId,
      half[employeeId] || cap < 1 ? 0.5 : 1,
      Number(ot[employeeId] ?? 0) || 0,
    )
    if (code === null) {
      toast.success('ลงชื่อแล้ว')
      router.refresh()
    } else {
      toast.error(code === 'NETWORK' ? 'เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่' : fail(code))
    }
    setBusy(null)
  }

  /**
   * ลงชื่อทั้งชุดของเมื่อวานในแตะเดียว — ชุดคนหน้างานมักซ้ำกันทั้งสัปดาห์
   *
   * ยิงผ่าน API เดิมทีละคน (ด่านกันซ้ำ/กันเกินวันของฐานข้อมูลยังตรวจครบทุกคน)
   * คัดลอกเฉพาะ เต็มวัน/ครึ่งวัน — OT เป็นเรื่องของแต่ละวัน ไม่คัดลอก
   */
  async function signInLikeYesterday() {
    if (busy || bulkBusy || copyFromYesterday.length === 0) return
    setBulkBusy(true)
    let ok = 0
    let skipped = 0
    for (const r of copyFromYesterday) {
      // ตัดยอดให้พอดีโควตาที่เหลือ — เมื่อวานเต็มวันแต่วันนี้ไปครึ่งวันที่อื่นแล้ว
      // ก็ลงได้แค่ครึ่งวัน · ไม่ใช่ยิงเต็มวันไปให้ถูกปฏิเสธแล้วนับเป็น "ข้าม"
      const units = Math.min(r.work_units === 0.5 ? 0.5 : 1, capacityOf(r.employee_id))
      const code = units > 0 ? await postSignIn(r.employee_id, units, 0) : 'WORK_UNITS_EXCEEDED'
      if (code === null) ok += 1
      else skipped += 1
    }
    if (ok > 0 && skipped === 0) toast.success(`ลงชื่อเหมือนเมื่อวานแล้ว ${ok} คน`)
    else if (ok > 0) toast.success(`ลงชื่อแล้ว ${ok} คน · ข้าม ${skipped} คน (ถูกลงชื่อที่อื่นแล้ว)`)
    else toast.error('ลงชื่อไม่สำเร็จ ลองติ๊กทีละคนเพื่อดูเหตุผล')
    router.refresh()
    setBulkBusy(false)
  }

  async function signOut(row: Row) {
    if (busy || bulkBusy) return
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

      {/* ทางลัดของเช้าวันปกติ — ชุดคนเหมือนเมื่อวาน ไม่ต้องไล่ติ๊กใหม่ทั้งไซต์ */}
      {copyFromYesterday.length > 0 && (
        <button
          type="button"
          onClick={signInLikeYesterday}
          disabled={busy !== null || bulkBusy}
          className="btn-secondary w-full disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {bulkBusy ? <Loader2 className="size-4 animate-spin" /> : <History className="size-4" />}
          {bulkBusy
            ? 'กำลังลงชื่อ…'
            : `เหมือนเมื่อวาน — ลงชื่อ ${copyFromYesterday.length} คนเดิม`}
        </button>
      )}

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
                  {row.amount !== null && (
                    <span className="shrink-0 text-sm font-semibold tnum text-ink">
                      {fmtBaht(row.amount)}
                      {(row.otAmount ?? 0) > 0 && (
                        <span className="ml-1 text-xs font-normal text-muted-token">
                          (รวม OT {fmtBaht(row.otAmount)})
                        </span>
                      )}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => signOut(row)}
                    disabled={busy !== null || bulkBusy}
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
            {notIn.map((e) => {
              // เต็มโควตาที่ไซต์อื่นแล้ว = กดยังไงก็ไม่ผ่าน · เหลือครึ่งวัน = ลงได้แค่ครึ่งวัน
              const other = bookedElsewhere[e.id]
              const cap = capacityOf(e.id)
              const full = Boolean(other) && cap <= 0
              const halfOnly = Boolean(other) && cap > 0 && cap < 1
              const where = other?.siteNames.join(' · ')
              return (
                <li
                  key={e.id}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-3.5 py-2.5 last:border-b-0 md:px-4 ${
                    full ? 'bg-surface-2' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className={`truncate font-medium ${full ? 'text-muted-token' : 'text-ink'}`}>
                      {e.full_name}
                    </div>
                    <div className="truncate text-xs text-muted-token">
                      {e.job_title ?? 'ไม่ได้ระบุตำแหน่ง'}
                      {/* บอกตั้งแต่ก่อนกด ไม่ใช่ให้กดแล้วค่อยขึ้น error */}
                      {other && (
                        <>
                          {' · '}
                          <span className={full ? 'font-medium text-urgent' : 'text-status-progress'}>
                            {where ? `วันนี้อยู่ ${where}` : 'วันนี้ลงชื่อที่ไซต์อื่นแล้ว'}
                            {full ? ' (เต็มวัน)' : ' (ครึ่งวัน)'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {full ? (
                    <span className="chip shrink-0 bg-status-pending-bg text-status-pending ring-status-pending-ring">
                      ลงครบวันแล้ว
                    </span>
                  ) : (
                    <>
                      {halfOnly ? (
                        // โควตาเหลือครึ่งวัน — ไม่ให้เลือกเป็นอย่างอื่น เพราะเลือกไปก็ถูกปฏิเสธ
                        <span className="chip shrink-0 bg-status-progress-bg text-status-progress ring-status-progress-ring">
                          ลงได้ครึ่งวัน
                        </span>
                      ) : (
                        <label className="flex shrink-0 items-center gap-1.5 text-sm text-ink-2">
                          <input
                            type="checkbox"
                            checked={Boolean(half[e.id])}
                            onChange={(ev) => setHalf((h) => ({ ...h, [e.id]: ev.target.checked }))}
                            className="size-4 accent-brand"
                          />
                          ครึ่งวัน
                        </label>
                      )}

                      {/* ช่อง OT เป็นเงิน — เจ้าของเท่านั้นที่เห็นและกรอกได้ */}
                      {canSeeMoney && (
                        <input
                          type="text"
                          inputMode="decimal"
                          value={ot[e.id] ?? ''}
                          onChange={(ev) => setOt((o) => ({ ...o, [e.id]: ev.target.value }))}
                          placeholder="OT ฿"
                          aria-label={`ค่า OT ของ ${e.full_name}`}
                          className="input-base w-24 shrink-0 tnum"
                        />
                      )}

                      <button
                        type="button"
                        onClick={() => signIn(e.id)}
                        disabled={busy !== null || bulkBusy}
                        className="btn-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {busy === e.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Check className="size-4" />
                        )}
                        เข้าไซต์
                      </button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ── แถบสรุปลอยล่าง — เห็นตลอดเวลาที่ไล่ติ๊กรายชื่อยาว ๆ ─────────────
          ตัวเลขมาจากเซิร์ฟเวอร์ (router.refresh() หลังทุกการติ๊ก) ไม่ใช่บวกเอง
          บนจอเล็กลอยเหนือแถบเมนูล่าง · หัวหน้าไซต์เห็นจำนวนคน ไม่เห็นเงิน */}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 lg:bottom-4">
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 shadow-e2">
          <UserRound className="size-5 shrink-0 text-brand" strokeWidth={1.8} />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-token">เข้าไซต์แล้ว</div>
            <div
              className="truncate text-lg font-bold leading-6 tnum text-ink"
              {...(dayWage !== undefined ? { 'data-day-wage': dayWage } : {})}
            >
              {inSite.length} คน
              {dayWage !== undefined && (
                <span className="ml-1.5 font-semibold">· ค่าแรงวันนี้ {fmtBaht(dayWage)}</span>
              )}
            </div>
          </div>
          {notIn.length > 0 && (
            <span className="shrink-0 text-sm tnum text-muted-token">ยังไม่เข้า {notIn.length} คน</span>
          )}
        </div>
      </div>
    </div>
  )
}
