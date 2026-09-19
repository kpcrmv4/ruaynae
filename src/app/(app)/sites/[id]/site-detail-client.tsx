'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { CalendarPlus, Loader2, Pencil, Trash2, UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { SITE_STATUSES, SITE_STATUS_LABEL, type SiteStatus } from '@/lib/sites'
import { siteError } from '../sites-client'

type Site = {
  id: string
  name: string
  client_name: string | null
  client_phone: string | null
  address: string | null
  start_date: string | null
  end_date: string | null
  status: SiteStatus
}
type Crew = {
  id: string
  effective_from: string
  effective_to: string | null
  profiles: { id: string; full_name: string } | null
}
type Milestone = { id: string; seq: number; name: string; planned_amount: number; planned_date: string | null }
type Person = { id: string; full_name: string }

/** โมดัลรูปเดียวกันทั้งไฟล์ — สามฟอร์มที่หน้าตาไม่เหมือนกันในหน้าเดียวอ่านเหมือนคนละแอป */
function Modal({
  open, onOpenChange, title, description, children, onSubmit, busy, submitLabel = 'บันทึก',
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description?: string
  children: ReactNode
  onSubmit: () => void
  busy: boolean
  submitLabel?: string
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90svh] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
          <Dialog.Title className="text-lg font-bold text-ink">{title}</Dialog.Title>
          {description && (
            <Dialog.Description className="mt-0.5 text-sm text-muted-token">{description}</Dialog.Description>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">{children}</div>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close disabled={busy} className="btn-secondary">ยกเลิก</Dialog.Close>
            <button onClick={onSubmit} disabled={busy} className="btn-primary">
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? 'กำลังบันทึก…' : submitLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Field({ id, label, span, children }: { id: string; label: string; span?: boolean; children: ReactNode }) {
  return (
    <div className={span ? 'sm:col-span-2' : undefined}>
      <label htmlFor={id} className="label-base">{label}</label>
      {children}
    </div>
  )
}

export function SiteDetailActions({
  site, contractAmount, crew, milestones, people,
}: {
  site: Site
  /** มาจากตาราง `site_finance` คนละตารางกับ `sites` — เจ้าของเท่านั้นที่อ่านได้
   *  คอมโพเนนต์นี้เรนเดอร์ให้เจ้าของเท่านั้นอยู่แล้ว จึงรับเป็น number ตรง ๆ */
  contractAmount: number
  crew: Crew[]
  milestones: Milestone[]
  people: Person[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [addingMilestone, setAddingMilestone] = useState(false)

  const [form, setForm] = useState({
    name: site.name,
    clientName: site.client_name ?? '',
    clientPhone: site.client_phone ?? '',
    address: site.address ?? '',
    contractAmount: contractAmount ? String(contractAmount) : '',
    startDate: site.start_date ?? '',
    endDate: site.end_date ?? '',
    status: site.status,
  })
  const [crewForm, setCrewForm] = useState({
    profileId: people[0]?.id ?? '',
    effectiveFrom: '',
    effectiveTo: '',
  })
  const [msForm, setMsForm] = useState({ name: '', plannedAmount: '', plannedDate: '', seq: '' })

  async function send(url: string, method: 'POST' | 'PATCH' | 'DELETE', body: unknown, ok: string) {
    if (busy) return false
    setBusy(true)
    try {
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(siteError(b.error))
        return false
      }
      toast.success(ok)
      router.refresh()
      return true
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveSite = async () => {
    if (!form.name.trim()) return toast.error('กรุณากรอกชื่อโครงการ')
    if (await send(`/api/sites/${site.id}`, 'PATCH', form, 'บันทึกการแก้ไขแล้ว')) setEditing(false)
  }

  const assign = async () => {
    if (!crewForm.profileId) return toast.error('กรุณาเลือกผู้ใช้')
    const done = await send(
      `/api/sites/${site.id}/supervisors`, 'POST', crewForm, 'มอบหมายหัวหน้าโครงการแล้ว',
    )
    if (done) {
      setCrewForm({ profileId: people[0]?.id ?? '', effectiveFrom: '', effectiveTo: '' })
      setAssigning(false)
    }
  }

  const addMilestone = async () => {
    if (!msForm.name.trim()) return toast.error('กรุณากรอกชื่องวด')
    if (await send(`/api/sites/${site.id}/milestones`, 'POST', msForm, 'เพิ่มงวดแล้ว')) {
      setMsForm({ name: '', plannedAmount: '', plannedDate: '', seq: '' })
      setAddingMilestone(false)
    }
  }

  return (
    <>
      <button onClick={() => setEditing(true)} disabled={busy} className="btn-secondary">
        <Pencil className="size-4" />
        แก้ไข
      </button>
      <button onClick={() => setAssigning(true)} disabled={busy} className="btn-secondary">
        <UserPlus className="size-4" />
        มอบหมายหัวหน้าโครงการ
      </button>
      <button onClick={() => setAddingMilestone(true)} disabled={busy} className="btn-secondary">
        <CalendarPlus className="size-4" />
        เพิ่มงวด
      </button>

      {/* ── แก้ข้อมูลโครงการ ─────────────────────────────────────────── */}
      <Modal
        open={editing} onOpenChange={setEditing} busy={busy} onSubmit={saveSite}
        title="แก้ไขโครงการ"
        description="ค่าที่ไม่แก้ให้ปล่อยไว้ ระบบบันทึกทับทั้งชุด"
      >
        <Field id="e-name" label="ชื่อโครงการ" span>
          <input id="e-name" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-base" />
        </Field>
        <Field id="e-client" label="ชื่อลูกค้า">
          <input id="e-client" value={form.clientName}
            onChange={(e) => setForm({ ...form, clientName: e.target.value })} className="input-base" />
        </Field>
        <Field id="e-phone" label="เบอร์ติดต่อ">
          <input id="e-phone" type="tel" inputMode="tel" value={form.clientPhone}
            onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} className="input-base" />
        </Field>
        <Field id="e-address" label="ที่ตั้งหน้างาน" span>
          <input id="e-address" value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })} className="input-base" />
        </Field>
        <Field id="e-amount" label="ค่างานตามสัญญา (บาท)">
          <input id="e-amount" type="text" inputMode="decimal" value={form.contractAmount}
            onChange={(e) => setForm({ ...form, contractAmount: e.target.value })}
            className="input-base tnum" />
        </Field>
        <Field id="e-status" label="สถานะ">
          <select id="e-status" value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as SiteStatus })}
            className="input-base">
            {SITE_STATUSES.map((s) => <option key={s} value={s}>{SITE_STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field id="e-start" label="วันเริ่มงาน">
          <input id="e-start" type="date" value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="input-base" />
        </Field>
        <Field id="e-end" label="กำหนดส่งมอบ">
          <input id="e-end" type="date" value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="input-base" />
        </Field>
      </Modal>

      {/* ── มอบหมายหัวหน้าโครงการ ────────────────────────────────────── */}
      <Modal
        open={assigning} onOpenChange={setAssigning} busy={busy} onSubmit={assign}
        title="มอบหมายหัวหน้าโครงการ"
        description="ช่วงเวลาสำคัญ — ย้ายคนโดยไม่ระบุวัน จะทำให้รายงานย้อนหลังเปลี่ยนเจ้าของตามไปด้วย · คนหนึ่งคนดูแลหลายโครงการพร้อมกันได้"
      >
        <Field id="c-person" label="ผู้ใช้" span>
          <select id="c-person" value={crewForm.profileId}
            onChange={(e) => setCrewForm({ ...crewForm, profileId: e.target.value })}
            className="input-base">
            {people.length === 0 && <option value="">ยังไม่มีหัวหน้าโครงการในระบบ</option>}
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </Field>
        <Field id="c-from" label="เริ่มดูแลวันที่">
          <input id="c-from" type="date" value={crewForm.effectiveFrom}
            onChange={(e) => setCrewForm({ ...crewForm, effectiveFrom: e.target.value })}
            className="input-base" />
        </Field>
        <Field id="c-to" label="ถึงวันที่ (เว้นว่างได้)">
          <input id="c-to" type="date" value={crewForm.effectiveTo}
            onChange={(e) => setCrewForm({ ...crewForm, effectiveTo: e.target.value })}
            className="input-base" />
        </Field>
      </Modal>

      {/* ── เพิ่มงวดเงิน ──────────────────────────────────────────── */}
      <Modal
        open={addingMilestone} onOpenChange={setAddingMilestone} busy={busy} onSubmit={addMilestone}
        title="เพิ่มงวดเงิน"
        description={`งวดถัดไปคืองวดที่ ${milestones.length + 1} — เว้นเลขงวดไว้ให้ระบบใส่ให้ได้`}
      >
        <Field id="m-name" label="ชื่องวด" span>
          <input id="m-name" value={msForm.name}
            onChange={(e) => setMsForm({ ...msForm, name: e.target.value })}
            placeholder="เช่น งวดที่ 2 — เทพื้นชั้นสอง" className="input-base" />
        </Field>
        <Field id="m-amount" label="ยอดตามแผน (บาท)">
          <input id="m-amount" type="text" inputMode="decimal" value={msForm.plannedAmount}
            onChange={(e) => setMsForm({ ...msForm, plannedAmount: e.target.value })}
            className="input-base tnum" />
        </Field>
        <Field id="m-date" label="กำหนดเก็บเงิน">
          <input id="m-date" type="date" value={msForm.plannedDate}
            onChange={(e) => setMsForm({ ...msForm, plannedDate: e.target.value })}
            className="input-base" />
        </Field>
        <Field id="m-seq" label="เลขงวด (เว้นว่าง = ต่อท้าย)">
          <input id="m-seq" type="text" inputMode="numeric" value={msForm.seq}
            onChange={(e) => setMsForm({ ...msForm, seq: e.target.value })}
            className="input-base tnum" />
        </Field>
      </Modal>

      <RemoveButtons
        siteId={site.id} crew={crew} milestones={milestones} busy={busy} send={send}
      />
    </>
  )
}

/**
 * ปุ่มถอน/ลบ ถูกเรนเดอร์เป็น portal เข้าไปในแถวของแต่ละรายการไม่ได้จากที่นี่
 * (แถวอยู่ใน Server Component) จึงรวมไว้เป็นแผงเดียวใต้หัวข้อ
 * แลกความสวยกับการที่ทุกปุ่มมีปลายทางจริงและถูกทดสอบได้
 */
function RemoveButtons({
  siteId, crew, milestones, busy, send,
}: {
  siteId: string
  crew: Crew[]
  milestones: Milestone[]
  busy: boolean
  send: (url: string, m: 'POST' | 'PATCH' | 'DELETE', b: unknown, ok: string) => Promise<boolean>
}) {
  const [confirm, setConfirm] = useState<{ url: string; label: string; ok: string } | null>(null)
  if (crew.length === 0 && milestones.length === 0) return null

  return (
    <>
      <details className="w-full">
        <summary className="cursor-pointer text-sm text-muted-token hover:text-ink">
          ถอนหัวหน้าโครงการ / ลบงวด
        </summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {crew.map((m) => (
            <button
              key={m.id}
              disabled={busy}
              onClick={() => setConfirm({
                url: `/api/sites/${siteId}/supervisors?assignment=${m.id}`,
                label: `ถอน ${m.profiles?.full_name ?? 'ผู้ใช้'} ออกจากโครงการนี้`,
                ok: 'ถอนหัวหน้าโครงการแล้ว',
              })}
              className="btn-danger px-3 py-1.5 text-sm"
            >
              <Trash2 className="size-3.5" />
              {m.profiles?.full_name ?? 'ผู้ใช้'}
            </button>
          ))}
          {milestones.map((m) => (
            <button
              key={m.id}
              disabled={busy}
              onClick={() => setConfirm({
                url: `/api/sites/${siteId}/milestones?milestone=${m.id}`,
                label: `ลบงวดที่ ${m.seq} — ${m.name}`,
                ok: 'ลบงวดแล้ว',
              })}
              className="btn-danger px-3 py-1.5 text-sm"
            >
              <Trash2 className="size-3.5" />
              งวด {m.seq}
            </button>
          ))}
        </div>
      </details>

      <Dialog.Root open={confirm !== null} onOpenChange={(v) => !busy && !v && setConfirm(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
            <Dialog.Title className="text-lg font-bold text-ink">ยืนยันการลบ</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-token">
              {confirm?.label} — ลบแล้วย้อนกลับไม่ได้ แต่ประวัติยังอยู่ในบันทึกการใช้งาน
            </Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close disabled={busy} className="btn-secondary">ยกเลิก</Dialog.Close>
              <button
                disabled={busy}
                onClick={async () => {
                  if (!confirm) return
                  if (await send(confirm.url, 'DELETE', undefined, confirm.ok)) setConfirm(null)
                }}
                className="btn-danger"
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                ลบ
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
