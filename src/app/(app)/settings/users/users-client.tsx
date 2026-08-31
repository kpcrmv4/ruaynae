'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { KeyRound, Loader2, Plus, ShieldCheck, UserRound, UserX } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { PIN_LENGTH } from '@/lib/pin-core'

type Row = {
  id: string
  full_name: string
  role: 'owner' | 'site_supervisor'
  is_active: boolean
  created_at: string
}

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่ทำได้',
  NAME_REQUIRED: 'กรุณากรอกชื่อ',
  EMAIL_REQUIRED: 'กรุณากรอกอีเมลให้ถูกต้อง',
  EMAIL_TAKEN: 'อีเมลนี้มีผู้ใช้แล้ว',
  PASSWORD_TOO_SHORT: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัว',
  PIN_LENGTH: `PIN ต้องเป็นตัวเลข ${PIN_LENGTH} หลัก`,
  PIN_TAKEN: 'PIN นี้มีคนใช้แล้ว — PIN ห้ามซ้ำเพราะระบบระบุตัวตนจาก PIN อย่างเดียว',
  SELF_DEACTIVATE_FORBIDDEN: 'ปิดบัญชีตัวเองไม่ได้ จะเข้าระบบไม่ได้อีก',
  LAST_OWNER_FORBIDDEN: 'ต้องเหลือเจ้าของอย่างน้อยหนึ่งคนเสมอ',
  PIN_SYNC_FAILED: 'ตั้ง PIN ไม่สำเร็จ กรุณาลองใหม่',
  NOT_FOUND: 'ไม่พบผู้ใช้รายนี้',
}
const fail = (code?: string) => MESSAGES[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'

const ROLE_LABEL = { owner: 'เจ้าของ', site_supervisor: 'หัวหน้าไซต์' } as const

export function UsersClient({ meId, users }: { meId: string; users: Row[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  // ใช้ dialog ของ radix ไม่ใช่ window.prompt — prompt เป็นญาติของ alert()
  // บล็อกทั้งหน้า ปิดธีมไม่ได้ และบนมือถือบางรุ่นแสดงผลเพี้ยน
  const [pinFor, setPinFor] = useState<Row | null>(null)
  const [pinValue, setPinValue] = useState('')
  const [form, setForm] = useState({
    fullName: '',
    role: 'site_supervisor' as Row['role'],
    email: '',
    password: '',
    pin: '',
  })

  async function send(key: string, url: string, method: 'POST' | 'PATCH', body: unknown, ok: string) {
    if (busy) return false
    setBusy(key)
    try {
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(fail(b.error))
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

  async function create() {
    const done = await send('new', '/api/settings/users', 'POST', form, 'เพิ่มผู้ใช้แล้ว')
    if (done) {
      setForm({ fullName: '', role: 'site_supervisor', email: '', password: '', pin: '' })
      setAdding(false)
    }
  }

  async function submitPin() {
    if (!pinFor) return
    const done = await send(
      pinFor.id, `/api/settings/users/${pinFor.id}`, 'PATCH',
      { pin: pinValue }, 'ตั้ง PIN ใหม่แล้ว',
    )
    if (done) {
      setPinFor(null)
      setPinValue('')
    }
  }

  const isSupervisorForm = form.role === 'site_supervisor'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-ink">ผู้ใช้ระบบ</h1>
          <p className="mt-0.5 text-sm text-muted-token">
            คนที่ล็อกอินเข้าระบบได้ ·{' '}
            <Link href="/settings/users?tab=workers" className="font-medium text-brand hover:underline">
              คนงานที่มีแค่ค่าแรงอยู่ที่นี่
            </Link>
          </p>
        </div>
        <button onClick={() => setAdding((v) => !v)} className="btn-primary shrink-0">
          <Plus className="size-4" />
          เพิ่มผู้ใช้
        </button>
      </div>

      {adding && (
        <section className="rounded-lg border border-line bg-surface p-4">
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="fullName" className="label-base">ชื่อ-นามสกุล</label>
              <input
                id="fullName"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                className="input-base"
              />
            </div>
            <div>
              <label htmlFor="role" className="label-base">บทบาท</label>
              <select
                id="role"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Row['role'] })}
                className="input-base"
              >
                <option value="site_supervisor">หัวหน้าไซต์ (ล็อกอินด้วย PIN)</option>
                <option value="owner">เจ้าของ (ล็อกอินด้วยอีเมล)</option>
              </select>
            </div>

            {isSupervisorForm ? (
              <div>
                <label htmlFor="pin" className="label-base">PIN {PIN_LENGTH} หลัก</label>
                <input
                  id="pin"
                  inputMode="numeric"
                  maxLength={PIN_LENGTH}
                  value={form.pin}
                  onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })}
                  className="input-base"
                />
                <p className="mt-1 text-xs text-muted-token">ห้ามซ้ำกับคนอื่น — ระบบระบุตัวตนจาก PIN อย่างเดียว</p>
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="email" className="label-base">อีเมล</label>
                  <input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="input-base"
                  />
                </div>
                <div>
                  <label htmlFor="password" className="label-base">รหัสผ่านเริ่มต้น</label>
                  <input
                    id="password"
                    type="text"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="input-base"
                  />
                  <p className="mt-1 text-xs text-muted-token">อย่างน้อย 8 ตัว · บอกเจ้าตัวให้เปลี่ยนหลังเข้าครั้งแรก</p>
                </div>
              </>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={create} disabled={busy !== null} className="btn-primary">
              {busy === 'new' ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              สร้างผู้ใช้
            </button>
            <button onClick={() => setAdding(false)} disabled={busy !== null} className="btn-secondary">
              ยกเลิก
            </button>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-lg border border-line bg-surface">
        {users.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-token">ยังไม่มีผู้ใช้ในระบบ</p>
        ) : (
          users.map((u) => (
            <div
              key={u.id}
              className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0"
            >
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-full border ${
                  u.role === 'owner'
                    ? 'border-brand-tint-strong bg-brand-tint text-brand-on-tint'
                    : 'border-line bg-surface-2 text-muted-token'
                }`}
              >
                {u.role === 'owner' ? <ShieldCheck className="size-4.5" /> : <UserRound className="size-4.5" />}
              </span>

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">
                  {u.full_name || '(ยังไม่ได้ตั้งชื่อ)'}
                  {u.id === meId && <span className="ml-2 text-xs text-muted-token">(คุณ)</span>}
                </div>
                <div className="truncate text-xs text-muted-token">
                  {ROLE_LABEL[u.role]}
                  {u.role === 'site_supervisor' && ' · ล็อกอินด้วย PIN'}
                  {!u.is_active && ' · ปิดใช้งานอยู่'}
                </div>
              </div>

              <div className="flex shrink-0 gap-2">
                {u.role === 'site_supervisor' && (
                  <button
                    onClick={() => { setPinFor(u); setPinValue('') }}
                    disabled={busy !== null}
                    className="btn-ghost"
                  >
                    {busy === u.id ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                    ตั้ง PIN ใหม่
                  </button>
                )}
                <button
                  onClick={() =>
                    send(
                      u.id,
                      `/api/settings/users/${u.id}`,
                      'PATCH',
                      { isActive: !u.is_active },
                      u.is_active ? 'ปิดใช้งานแล้ว' : 'เปิดใช้งานแล้ว',
                    )
                  }
                  disabled={busy !== null || u.id === meId}
                  title={u.id === meId ? 'ปิดบัญชีตัวเองไม่ได้' : undefined}
                  className="btn-ghost"
                >
                  <UserX className="size-4" />
                  {u.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <Dialog.Root open={pinFor !== null} onOpenChange={(o) => !o && setPinFor(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-5 shadow-e3">
            <Dialog.Title className="text-base font-semibold text-ink">ตั้ง PIN ใหม่</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-token">
              ให้ {pinFor?.full_name} · PIN เดิมจะใช้ไม่ได้ทันที
            </Dialog.Description>

            <div className="my-4">
              <label htmlFor="newPin" className="label-base">PIN {PIN_LENGTH} หลัก</label>
              <input
                id="newPin"
                inputMode="numeric"
                maxLength={PIN_LENGTH}
                autoFocus
                value={pinValue}
                onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && pinValue.length === PIN_LENGTH && void submitPin()}
                className="input-base text-center text-xl tracking-[0.4em]"
              />
              <p className="mt-1.5 text-xs text-muted-token">
                ห้ามซ้ำกับคนอื่น · จดไว้ให้เจ้าตัวด้วย ระบบดูย้อนหลังไม่ได้
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={submitPin}
                disabled={busy !== null || pinValue.length !== PIN_LENGTH}
                className="btn-primary flex-1"
              >
                {busy === pinFor?.id ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                บันทึก
              </button>
              <Dialog.Close className="btn-secondary">ยกเลิก</Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
