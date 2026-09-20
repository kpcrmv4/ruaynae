'use client'

import { ArrowRight, CalendarClock, HardHat, Loader2, Pencil, Plus, UserCheck, UserX } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { fmtBaht } from '@/lib/format'
import {
  WAGE_TYPES, WAGE_TYPE_LABEL, employeeError, type WageType,
} from '@/lib/employees'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/states'
import { EmployeeDelete, type DeleteInfo } from './employee-delete'
import { BackButton } from '@/components/ui/back-button'

export type EmployeeRow = {
  id: string
  full_name: string
  job_title: string | null
  wage_type: WageType
  daily_rate: number | null
  monthly_salary: number | null
  default_site_id: string | null
  is_active: boolean
  profile_id: string | null
}

/** แถวจาก RPC `employees_delete_info()` — ตัวเลขที่กล่องยืนยันการลบต้องใช้ */
export type DeleteInfoRow = DeleteInfo & { employee_id: string }

type Site = { id: string; name: string }
/** บัญชีล็อกอินที่ผูกได้ — ต้องมี `role` มาด้วย ไม่งั้นกล่องเลือกบอกไม่ได้ว่าใครเป็นใคร */
type Person = { id: string; full_name: string; role: 'owner' | 'site_supervisor' }

const ROLE_LABEL = { owner: 'เจ้าของ', site_supervisor: 'หัวหน้าโครงการ' } as const

/** ตำแหน่งที่พิมพ์บ่อย — กดแล้วเติมให้ พิมพ์เองก็ยังได้ */
const JOB_TITLES = [
  'หัวหน้าคนงาน',
  'หัวหน้าโครงการ',
  'โฟร์แมน',
  'ช่างปูน',
  'ช่างไม้',
  'ช่างเหล็ก',
  'ช่างไฟ',
  'กรรมกร',
] as const

/**
 * ขนาดปุ่มในแถวคนงาน — ต่ำกว่า lg ย่อลง (padding + ตัวหนังสือ 13px) ให้ปุ่ม
 * สี่ปุ่มพร้อมป้ายข้อความเรียงพอดีแม้จอ 360 (วัดจริง 289/298px) · `whitespace-nowrap`
 * กันคำในปุ่มหักกลาง "ปิดใช้ / งาน" — ถ้าแคบกว่านั้นอีก ปุ่มสุดท้ายตกบรรทัดใหม่
 * ทั้งปุ่มแทน (flex-wrap) · lg ขึ้นไปกลับเป็นขนาดปกติของ `btn-*`
 */
const ACTION_BTN =
  'gap-1 whitespace-nowrap px-1.5 py-2 text-[13px] lg:gap-2 lg:px-4 lg:py-2.5 lg:text-base'

const EMPTY = {
  fullName: '',
  jobTitle: '',
  wageType: 'daily' as WageType,
  dailyRate: '',
  monthlySalary: '',
  defaultSiteId: '',
  profileId: '',
}

export function EmployeesClient({
  employees,
  sites,
  people,
  deleteInfo,
}: {
  employees: EmployeeRow[]
  sites: Site[]
  people: Person[]
  deleteInfo: DeleteInfoRow[]
}) {
  const infoOf = new Map(deleteInfo.map((d) => [d.employee_id, d]))
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [fieldError, setFieldError] = useState('')

  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  async function send(key: string, url: string, method: 'POST' | 'PATCH', body: unknown, ok: string) {
    // กันกดซ้ำสองชั้น: ปุ่ม disabled *และ* ธงตรงนี้
    if (busy) return false
    setBusy(key)
    setFieldError('')
    try {
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        const msg = employeeError(b.error)
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

  function openEdit(e: EmployeeRow) {
    setAdding(false)
    setEditing(e.id)
    setFieldError('')
    setForm({
      fullName: e.full_name,
      jobTitle: e.job_title ?? '',
      wageType: e.wage_type,
      dailyRate: e.daily_rate === null ? '' : String(e.daily_rate),
      monthlySalary: e.monthly_salary === null ? '' : String(e.monthly_salary),
      defaultSiteId: e.default_site_id ?? '',
      profileId: e.profile_id ?? '',
    })
  }

  async function submit() {
    const payload = {
      ...form,
      defaultSiteId: form.defaultSiteId || null,
      profileId: form.profileId || null,
    }
    const done = editing
      ? await send(editing, `/api/employees/${editing}`, 'PATCH', payload, 'บันทึกแล้ว')
      : await send('new', '/api/employees', 'POST', payload, 'เพิ่มคนงานแล้ว')
    if (done) {
      setForm(EMPTY)
      setAdding(false)
      setEditing(null)
    }
  }

  const isDaily = form.wageType === 'daily'
  const formOpen = adding || editing !== null

  return (
    <div className="space-y-4">
      {/* 🔴 บนจอ 390 คำอธิบายสองบรรทัดครึ่งถูกบีบอยู่ข้างปุ่มกว้าง 140px
          จนขึ้นบรรทัดใหม่สี่รอบและอ่านเหมือนกำแพงตัวหนังสือ (เจ้าของแจ้ง 1 ก.ย. 2569)
          · แยกเป็นสามชั้นแทน: หัวเรื่อง+ปุ่มบรรทัดเดียว · คำอธิบายเต็มความกว้าง
          · ทางลัดไปหน้าผู้ใช้ระบบเป็นลิงก์ของตัวเองที่แตะได้เต็มบรรทัด
          — บนจอกว้างยังเป็นสองคอลัมน์เหมือนเดิม */}
      <div>
        <div className="flex items-center gap-3">
          {/* h1 เพราะตอนนี้เป็นหน้าของตัวเอง ไม่ได้อยู่ใต้แท็บของหน้าผู้ใช้ระบบแล้ว —
              หน้าที่หัวเรื่องหลักเป็น h2 คือหน้าที่ข้ามลำดับหัวข้อไปหนึ่งขั้น */}
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-ink">คนงาน</h1>
          <button
            onClick={() => {
              setEditing(null)
              setForm(EMPTY)
              setFieldError('')
              setAdding((v) => !v)
            }}
            className="btn-primary shrink-0"
          >
            <Plus className="size-4" />
            เพิ่มคนงาน
          </button>
          <BackButton fallbackHref="/settings" />
        </div>
        <p className="mt-1 text-sm leading-6 text-muted-token">
          ทุกคนที่มีค่าแรงต้องจ่าย · <span className="font-medium text-ink-2">ไม่ต้องล็อกอิน</span>{' '}
          และไม่มี role
        </p>
        <Link
          href="/settings/users"
          className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
        >
          คนที่ล็อกอินได้อยู่ที่นี่
          <ArrowRight className="size-4" />
        </Link>
      </div>

      {formOpen && (
        <section className="rounded-lg border border-line bg-surface p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="emp-name" className="label-base">ชื่อ-นามสกุล</label>
              <input
                id="emp-name"
                value={form.fullName}
                onChange={(e) => set('fullName', e.target.value)}
                className="input-base"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="emp-title" className="label-base">ตำแหน่ง</label>
              <input
                id="emp-title"
                value={form.jobTitle}
                onChange={(e) => set('jobTitle', e.target.value)}
                placeholder="เช่น ช่างปูน · กรรมกร"
                className="input-base"
              />
              {/* 🔴 ยังเป็นช่องพิมพ์อิสระ ไม่ใช่กล่องเลือกที่ล็อกตัวเลือกไว้ —
                  ผู้รับเหมาแต่ละเจ้าเรียกตำแหน่งไม่เหมือนกัน · ชิปเป็นทางลัดของ
                  ตำแหน่งที่ใช้บ่อย ไม่ใช่รายการที่อนุญาต (เจ้าของแจ้ง 4 ก.ย. 2569
                  ว่าไม่มี "หัวหน้าคนงาน" ให้เลือก) */}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {JOB_TITLES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => set('jobTitle', t)}
                    aria-pressed={form.jobTitle === t}
                    className={`rounded-sm border px-2 py-1 text-xs font-medium transition-colors duration-100 ${
                      form.jobTitle === t
                        ? 'border-brand bg-brand-tint text-brand-on-tint'
                        : 'border-line-strong bg-surface text-ink-2 hover:border-ink-2 hover:text-ink'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="emp-wage" className="label-base">ประเภทค่าแรง</label>
              <select
                id="emp-wage"
                value={form.wageType}
                onChange={(e) => set('wageType', e.target.value as WageType)}
                className="input-base"
              >
                {WAGE_TYPES.map((w) => (
                  <option key={w} value={w}>{WAGE_TYPE_LABEL[w]}</option>
                ))}
              </select>
            </div>

            {/* 🔴 โชว์ช่องเดียวตามประเภทที่เลือก · ฟอร์มที่โชว์ทั้งสองช่องพร้อมกัน
                คือฟอร์มที่ชวนกรอกผิด แล้วเรตที่ค้างอยู่จะถูกใครสักคนอ่านไปใช้ */}
            {isDaily ? (
              <div>
                <label htmlFor="emp-daily" className="label-base">ค่าแรงต่อวัน (บาท)</label>
                <input
                  id="emp-daily"
                  type="text"
                  inputMode="decimal"
                  value={form.dailyRate}
                  onChange={(e) => set('dailyRate', e.target.value)}
                  placeholder="600"
                  className="input-base tnum"
                />
              </div>
            ) : (
              <div>
                <label htmlFor="emp-monthly" className="label-base">เงินเดือน (บาท)</label>
                <input
                  id="emp-monthly"
                  type="text"
                  inputMode="decimal"
                  value={form.monthlySalary}
                  onChange={(e) => set('monthlySalary', e.target.value)}
                  placeholder="18000"
                  className="input-base tnum"
                />
              </div>
            )}

            {!isDaily && (
              <div>
                <label htmlFor="emp-site" className="label-base">
                  เงินเดือนลงโครงการประจำ
                </label>
                <select
                  id="emp-site"
                  value={form.defaultSiteId}
                  onChange={(e) => set('defaultSiteId', e.target.value)}
                  className="input-base"
                >
                  <option value="">ส่วนกลาง (ไม่ผูกโครงการ)</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label htmlFor="emp-profile" className="label-base">
                ผูกกับบัญชีผู้ใช้ (ถ้าคนนี้ล็อกอินด้วย)
              </label>
              <select
                id="emp-profile"
                value={form.profileId}
                onChange={(e) => set('profileId', e.target.value)}
                className="input-base"
              >
                <option value="">ไม่มีบัญชี — เป็นคนงานอย่างเดียว</option>
                {/* 🔴 ต้องบอกตำแหน่งด้วย — ชื่อเปล่า ๆ ไม่ได้บอกว่าคนไหนคือ
                    หัวหน้าโครงการ เจ้าของจึงเลือกไม่ถูกว่าจะผูกกับใคร
                    (เจ้าของแจ้ง 4 ก.ย. 2569) */}
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} · {ROLE_LABEL[p.role]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {fieldError && <p className="mt-2 text-sm text-urgent">{fieldError}</p>}

          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => {
                setAdding(false)
                setEditing(null)
                setFieldError('')
              }}
              className="btn-secondary"
            >
              ยกเลิก
            </button>
            <button
              onClick={submit}
              disabled={busy !== null}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy !== null && <Loader2 className="size-4 animate-spin" />}
              {editing ? 'บันทึกการแก้ไข' : 'เพิ่มคนงาน'}
            </button>
          </div>
        </section>
      )}

      {employees.length === 0 ? (
        <EmptyState
          icon={HardHat}
          message="ยังไม่มีคนงาน — เพิ่มคนแรกแล้วจะลงชื่อเข้าโครงการได้ที่หน้าคนเข้าโครงการ"
        />
      ) : (
        <div className="panel">
          {employees.map((e) => (
            /* 🔴 บนจอ 390 ชื่อ · ค่าแรง · ปุ่มสามสี่ปุ่ม เคยเบียดกันบรรทัดเดียวจนชื่อ
                เหลือ "วิชัย ทอง..." และแถวคนรายเดือน (มีปุ่มเพิ่มหนึ่งปุ่ม) ตกไปสอง
                บรรทัดคนละแบบกับแถวอื่น (เจ้าของแจ้ง 19 ก.ย. 2569)
                · ต่ำกว่า lg วางเป็นสองชั้นเสมอ: ชื่อเต็ม+ตำแหน่ง ↔ ค่าแรง แล้วปุ่ม
                เรียงชิดขวาเป็นแถวของตัวเอง ทุกแถวหน้าตาเดียวกันไม่ว่ามีกี่ปุ่ม
                · lg ขึ้นไป (มี sidebar แล้ว) ยังเป็นบรรทัดเดียวเหมือนเดิม
                · ปุ่มมีป้ายข้อความ**ทุกขนาดจอ** — ไอคอนเปล่า ๆ สามสี่อันเรียงกัน
                ผู้ใช้ที่ไม่ชำนาญคอมแยกไม่ออกว่าอันไหนทำอะไร (เจ้าของแจ้ง 19 ก.ย. 2569)
                · ให้พอดีจอ 390 จึงย่อปุ่มและตัวหนังสือลงหนึ่งขั้นต่ำกว่า lg (ACTION_BTN) */
            <div
              key={e.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 border-b border-line-soft px-3.5 py-3 last:border-b-0 md:px-4 lg:grid-cols-[minmax(0,1fr)_auto_auto]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="break-words font-semibold leading-6 text-ink">{e.full_name}</span>
                  {!e.is_active && <Badge tone="pending">ปิดใช้งาน</Badge>}
                  {e.profile_id && <Badge tone="info">มีบัญชีล็อกอิน</Badge>}
                </div>
                <div className="mt-0.5 text-sm leading-5 text-muted-token">
                  {e.job_title ?? 'ยังไม่ได้ระบุตำแหน่ง'} · {WAGE_TYPE_LABEL[e.wage_type]}
                </div>
              </div>

              <div className="shrink-0 text-right leading-5">
                <span className="text-base font-bold tnum text-ink">
                  {e.wage_type === 'daily' ? fmtBaht(e.daily_rate) : fmtBaht(e.monthly_salary)}
                </span>
                <span className="ml-1 text-sm text-muted-token">
                  {e.wage_type === 'daily' ? '/ วัน' : '/ เดือน'}
                </span>
              </div>

              <div className="col-span-2 flex flex-wrap items-center justify-end gap-1 lg:col-span-1 lg:flex-nowrap lg:gap-2">
                {/* 🔴 เฉพาะคนรายเดือน — คนรายวันมีค่าแรงเกิดตอนติ๊กเข้าโครงการ
                    อยู่แล้ว ตั้งเงินเดือนซ้ำจะทำให้ต้นทุนเป็นสองเท่า (§17 ข้อ 1)
                    · ปุ่มจึงไม่วาดเลยสำหรับคนรายวัน ไม่ใช่วาดแล้วกดไม่ผ่าน */}
                {e.wage_type === 'monthly' && e.is_active && (
                  <Link
                    href={`/settings/recurring?employee=${e.id}`}
                    aria-label={`ตั้งเงินเดือนรายเดือนของ ${e.full_name}`}
                    className={`btn-secondary ${ACTION_BTN}`}
                  >
                    <CalendarClock className="size-4 shrink-0" />
                    เงินเดือน
                  </Link>
                )}
                <button
                  onClick={() => openEdit(e)}
                  aria-label={`แก้ไข ${e.full_name}`}
                  className={`btn-secondary ${ACTION_BTN}`}
                >
                  <Pencil className="size-4 shrink-0" />
                  แก้ไข
                </button>
                <button
                  onClick={() =>
                    send(e.id, `/api/employees/${e.id}`, 'PATCH', { isActive: !e.is_active },
                      e.is_active ? 'ปิดใช้งานแล้ว' : 'เปิดใช้งานแล้ว')
                  }
                  disabled={busy !== null}
                  aria-label={e.is_active ? `ปิดใช้งาน ${e.full_name}` : `เปิดใช้งาน ${e.full_name}`}
                  className={`btn-secondary ${ACTION_BTN} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {busy === e.id ? (
                    <Loader2 className="size-4 shrink-0 animate-spin" />
                  ) : e.is_active ? (
                    <UserX className="size-4 shrink-0" />
                  ) : (
                    <UserCheck className="size-4 shrink-0" />
                  )}
                  {e.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                </button>
                {/* ปิดใช้งาน ≠ ลบ — ปิดคือ "ไม่ทำงานกับเราแล้ว แต่ประวัติยังอยู่"
                    ส่วนลบคือเอาออกจากระบบจริง ๆ พร้อมประวัติที่ยังไม่ได้จ่ายเงิน */}
                <EmployeeDelete
                  id={e.id}
                  fullName={e.full_name}
                  info={infoOf.get(e.id)}
                  disabled={busy !== null}
                  className={ACTION_BTN}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
