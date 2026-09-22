'use client'

import { CalendarClock, Check, Eye, EyeOff, Loader2, Play, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/states'
import { fmtBaht, fmtDate } from '@/lib/format'
import { monthOptions, recurringError } from '@/lib/recurring'
import { PageHeader } from '@/components/ui/page-header'

type Rule = {
  id: string
  name: string
  amount: number
  category_id: string
  category_name: string | null
  site_id: string | null
  site_name: string | null
  employee_name: string | null
  day_of_month: number
  start_month: string
  end_month: string | null
  pay_method: 'cash' | 'transfer'
  is_active: boolean
  posted_months: number
  posted_total: number
  /** ถึงกำหนดแล้วแต่ยังไม่มีรายการ — ตัวเลขที่บอกว่าต้องกดปุ่มลงไหม */
  due_months: number
}
type Option = { id: string; name: string }
type Staff = {
  id: string
  full_name: string
  default_site_id: string | null
  monthly_salary: number | null
}

const emptyForm = (today: string) => ({
  employeeId: '',
  name: '',
  amount: '',
  categoryId: '',
  siteId: '',
  dayOfMonth: '1',
  startMonth: today.slice(0, 7),
  payMethod: 'transfer' as 'cash' | 'transfer',
})

/**
 * ค่าใช้จ่ายรายเดือน — ตั้งครั้งเดียว ระบบลงให้ทุกเดือน
 *
 * 🔴 "สร้างกฎ" กับ "ลงย้อนหลัง" เป็นคำขอเดียวกัน — แยกกันแล้วเจ้าของจะลืมกด
 * ปุ่มที่สอง แล้วเดือนที่ผ่านมาจะหายจากบัญชีเงียบ ๆ · ปุ่ม "ลงรายการที่ถึง
 * กำหนด" มีไว้สำหรับเดือนที่ผ่านไปหลังจากตั้งกฎแล้ว
 */
export function RecurringClient({
  today,
  rules,
  categories,
  sites,
  staff,
  preselectEmployee,
}: {
  today: string
  rules: Rule[]
  categories: Option[]
  sites: Option[]
  staff: Staff[]
  preselectEmployee: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState('')
  const preset = staff.find((s) => s.id === preselectEmployee)
  const [adding, setAdding] = useState(Boolean(preset))
  const [form, setForm] = useState(() => ({
    ...emptyForm(today),
    ...(preset
      ? {
          employeeId: preset.id,
          name: `เงินเดือน ${preset.full_name}`,
          amount: preset.monthly_salary === null ? '' : String(preset.monthly_salary),
          siteId: preset.default_site_id ?? '',
        }
      : {}),
  }))
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setFieldError('')
  }

  async function send(key: string, url: string, method: string, body: unknown, ok: string) {
    if (busy) return null
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
        const msg = recurringError(b.error)
        setFieldError(msg)
        toast.error(msg)
        return null
      }
      toast.success(ok)
      router.refresh()
      return b as { created?: number; backfillFailed?: boolean }
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
      return null
    } finally {
      setBusy(null)
    }
  }

  const pickStaff = (id: string) => {
    const s = staff.find((x) => x.id === id)
    setForm((f) => ({
      ...f,
      employeeId: id,
      ...(s
        ? {
            name: `เงินเดือน ${s.full_name}`,
            amount: s.monthly_salary === null ? f.amount : String(s.monthly_salary),
            siteId: s.default_site_id ?? '',
          }
        : {}),
    }))
    setFieldError('')
  }

  const create = async () => {
    const b = await send('new', '/api/settings/recurring', 'POST', form, 'ตั้งค่าใช้จ่ายรายเดือนแล้ว')
    if (!b) return
    if (b.backfillFailed) toast.error('ตั้งกฎแล้ว แต่ลงย้อนหลังไม่สำเร็จ — กดปุ่ม "ลงรายการที่ถึงกำหนด" อีกครั้ง')
    else if ((b.created ?? 0) > 0) toast.success(`ลงย้อนหลังให้แล้ว ${b.created} เดือน`)
    setAdding(false)
    setForm(emptyForm(today))
  }

  const months = monthOptions(today)
  const totalDue = rules.reduce((s, r) => s + (r.is_active ? r.due_months : 0), 0)

  return (
    <div className="space-y-5">
      <PageHeader
        title="ค่าใช้จ่ายรายเดือน"
        subtitle="ตั้งครั้งเดียว ระบบลงเป็นรายจ่ายให้ทุกเดือน · เงินเดือน ค่าเช่า ค่าอินเทอร์เน็ต"
        action={
          !adding ? (
            <button onClick={() => setAdding(true)} className="btn-primary shrink-0">
              <Plus className="size-4" />
              ตั้งรายการใหม่
            </button>
          ) : undefined
        }
        backHref="/settings"
        className="mb-0"
      />

      {/* ยอดที่ถึงกำหนดแล้วแต่ยังไม่ลง — ต้องเห็นก่อนเลื่อนหาเอง */}
      {totalDue > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-status-progress-ring bg-status-progress-bg px-3.5 py-2.5">
          <CalendarClock className="size-4 shrink-0 text-status-progress" strokeWidth={1.8} />
          <span className="min-w-0 flex-1 text-sm font-medium text-status-progress">
            มี {totalDue} เดือนที่ถึงกำหนดแล้วแต่ยังไม่ได้ลงรายการ
          </span>
        </div>
      )}

      {/* ── ฟอร์มตั้งรายการ ───────────────────────────────────────── */}
      {adding && (
        <section className="panel p-4">
          <h2 className="mb-3 text-base font-bold text-ink">ตั้งค่าใช้จ่ายรายเดือน</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {staff.length > 0 && (
              <div className="sm:col-span-2">
                <label htmlFor="rc-emp" className="label-base">
                  เป็นเงินเดือนของใคร (ไม่บังคับ)
                </label>
                <select
                  id="rc-emp"
                  value={form.employeeId}
                  onChange={(e) => pickStaff(e.target.value)}
                  className="input-base"
                >
                  <option value="">ไม่ผูกกับคน — ค่าเช่า ค่าเน็ต ฯลฯ</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                      {s.monthly_salary !== null && ` · ${fmtBaht(s.monthly_salary)}/เดือน`}
                    </option>
                  ))}
                </select>
                {/* 🔴 บอกไปเลยว่าทำไมไม่มีคนรายวันให้เลือก — ไม่งั้นเจ้าของจะ
                    คิดว่าระบบพัง แล้วไปตั้งเป็นรายการลอย ๆ ซึ่งจะนับซ้ำ */}
                <p className="mt-1 text-xs text-muted-token">
                  มีเฉพาะคนที่รับเป็นรายเดือน — คนรายวันมีค่าแรงจากการลงชื่อเข้าโครงการอยู่แล้ว
                  ตั้งซ้ำจะทำให้ต้นทุนเป็นสองเท่า
                </p>
              </div>
            )}

            <div className="sm:col-span-2">
              <label htmlFor="rc-name" className="label-base">ชื่อรายการ</label>
              <input
                id="rc-name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="เช่น เงินเดือน สมชาย · ค่าเช่าออฟฟิศ"
                className="input-base"
              />
            </div>

            <div>
              <label htmlFor="rc-amount" className="label-base">จำนวนเงินต่อเดือน (บาท)</label>
              <input
                id="rc-amount"
                type="text"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => set('amount', e.target.value)}
                placeholder="18000"
                className="input-base tnum"
              />
            </div>

            <div>
              <label htmlFor="rc-cat" className="label-base">หมวด</label>
              <select
                id="rc-cat"
                value={form.categoryId}
                onChange={(e) => set('categoryId', e.target.value)}
                className="input-base"
              >
                <option value="">— เลือกหมวด —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="rc-site" className="label-base">ลงเป็นค่าใช้จ่ายของ</label>
              <select
                id="rc-site"
                value={form.siteId}
                onChange={(e) => set('siteId', e.target.value)}
                className="input-base"
              >
                <option value="">ส่วนกลาง (ไม่ผูกโครงการ)</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="rc-day" className="label-base">ลงทุกวันที่</label>
              <select
                id="rc-day"
                value={form.dayOfMonth}
                onChange={(e) => set('dayOfMonth', e.target.value)}
                className="input-base tnum"
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              {/* เดือนที่ไม่มีวันที่นั้นจะลงวันสุดท้ายของเดือนแทน ไม่ใช่ข้ามเดือน */}
              <p className="mt-1 text-xs text-muted-token">
                เดือนที่ไม่มีวันนี้จะลงวันสุดท้ายของเดือนแทน
              </p>
            </div>

            <div>
              <label htmlFor="rc-start" className="label-base">เริ่มตั้งแต่เดือน</label>
              <select
                id="rc-start"
                value={form.startMonth}
                onChange={(e) => set('startMonth', e.target.value)}
                className="input-base"
              >
                {months.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-token">
                ระบบจะลงย้อนหลังให้ตั้งแต่เดือนนี้จนถึงเดือนปัจจุบันทันที
              </p>
            </div>

            <div>
              <label htmlFor="rc-pay" className="label-base">จ่ายด้วย</label>
              <select
                id="rc-pay"
                value={form.payMethod}
                onChange={(e) => set('payMethod', e.target.value as 'cash' | 'transfer')}
                className="input-base"
              >
                <option value="transfer">โอน</option>
                <option value="cash">เงินสด</option>
              </select>
            </div>
          </div>

          {fieldError && <p className="mt-2 text-sm text-urgent">{fieldError}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => {
                setAdding(false)
                setForm(emptyForm(today))
                setFieldError('')
              }}
              disabled={busy !== null}
              className="btn-secondary"
            >
              ยกเลิก
            </button>
            <button
              onClick={create}
              disabled={busy !== null}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === 'new' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              ตั้งรายการและลงย้อนหลัง
            </button>
          </div>
        </section>
      )}

      {/* ── รายการที่ตั้งไว้ ──────────────────────────────────────── */}
      {rules.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          message="ยังไม่มีค่าใช้จ่ายรายเดือน — ตั้งเงินเดือนหรือค่าเช่าไว้ แล้วระบบจะลงเป็นรายจ่ายให้ทุกเดือนเอง"
        />
      ) : (
        <div className="panel">
          {rules.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-3.5 py-3 last:border-b-0 md:px-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`truncate font-semibold ${r.is_active ? 'text-ink' : 'text-muted-token line-through'}`}>
                    {r.name}
                  </span>
                  {!r.is_active && <Badge tone="pending">ปิดอยู่</Badge>}
                  {r.due_months > 0 && r.is_active && (
                    <Badge tone="progress">ค้าง {r.due_months} เดือน</Badge>
                  )}
                </div>
                <div className="truncate text-xs text-muted-token">
                  {r.site_name ?? 'ส่วนกลาง'} · {r.category_name ?? 'ไม่มีหมวด'} · ทุกวันที่{' '}
                  {r.day_of_month} · เริ่ม {fmtDate(r.start_month)}
                  {r.posted_months > 0 &&
                    ` · ลงแล้ว ${r.posted_months} เดือน รวม ${fmtBaht(r.posted_total)}`}
                </div>
              </div>

              <span className="shrink-0 text-base font-bold tnum text-ink">
                {fmtBaht(r.amount)}
              </span>

              <div className="flex shrink-0 gap-1.5">
                {r.is_active && r.due_months > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      send(r.id, `/api/settings/recurring/${r.id}`, 'PATCH', { run: true },
                        'ลงรายการที่ถึงกำหนดแล้ว')
                    }
                    disabled={busy !== null}
                    className="btn-primary"
                  >
                    {busy === r.id ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                    ลงรายการ
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    send(r.id, `/api/settings/recurring/${r.id}`, 'PATCH',
                      { isActive: !r.is_active },
                      r.is_active ? 'ปิดแล้ว — เดือนถัดไปจะไม่ลงเพิ่ม' : 'เปิดใช้งานแล้ว')
                  }
                  disabled={busy !== null}
                  className="btn-ghost"
                >
                  {r.is_active ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  {r.is_active ? 'ปิด' : 'เปิด'}
                </button>
                {/* กฎที่เคยลงรายการแล้วลบไม่ได้ — ปุ่มจึงไม่วาดเลย ไม่ใช่วาดแล้วกดไม่ผ่าน */}
                {r.posted_months === 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      send(r.id, `/api/settings/recurring/${r.id}`, 'DELETE', undefined, 'ลบแล้ว')
                    }
                    disabled={busy !== null}
                    aria-label={`ลบ ${r.name}`}
                    className="btn-ghost text-urgent"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="rounded-lg border border-line-soft bg-surface-2 px-4 py-3 text-xs text-muted-token">
        รายการที่ระบบลงให้จะเป็น <span className="font-medium text-ink-2">รายจ่ายที่อนุมัติแล้ว</span>{' '}
        ทันที และเข้าไปอยู่ใน /ledger เหมือนรายการที่คีย์เอง · แก้ยอดในกฎ
        <span className="font-medium text-ink-2"> ไม่ย้อนไปแก้เดือนที่ลงไปแล้ว</span> —
        เดือนเก่าคือสิ่งที่จ่ายไปจริงตามยอดตอนนั้น อยากแก้ให้ไปแก้รายการนั้นตรง ๆ
      </p>
    </div>
  )
}
