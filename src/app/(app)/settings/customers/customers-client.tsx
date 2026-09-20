'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { BookUser, Check, Loader2, Pencil, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/states'

export type CustomerRow = {
  id: string
  name: string
  tax_id: string | null
  branch: string | null
  address: string | null
  phone: string | null
  email: string | null
}

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่ทำได้',
  NAME_REQUIRED: 'กรอกชื่อลูกค้า',
  NOT_FOUND: 'ไม่พบลูกค้ารายนี้แล้ว — อาจถูกลบไปจากอีกหน้าจอ',
  CUSTOMER_DUPLICATE: 'มีลูกค้าชื่อนี้ในทะเบียนอยู่แล้ว',
}
const fail = (code?: string) => MESSAGES[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'

const blank = { name: '', tax_id: '', branch: '', address: '', phone: '', email: '' }
type Draft = typeof blank

/**
 * ทะเบียนลูกค้า — แก้และลบรายที่พิมพ์ผิดหรือเลิกใช้แล้ว
 *
 * 🔴 เอกสารที่ออกไปแล้ว **ไม่เปลี่ยนตามและไม่หายตาม** เพราะชื่อกับที่อยู่บนใบ
 * เป็นสำเนาในแถวเอกสารเอง · ที่นี่คุมแค่สิ่งที่จะถูกเติมให้ใบถัดไป
 */
export function CustomersClient({ rows }: { rows: CustomerRow[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<CustomerRow | null>(null)
  const [removing, setRemoving] = useState<CustomerRow | null>(null)
  const [draft, setDraft] = useState<Draft>(blank)
  const [busy, setBusy] = useState(false)

  const open = (c: CustomerRow) => {
    setDraft({
      name: c.name,
      tax_id: c.tax_id ?? '',
      branch: c.branch ?? '',
      address: c.address ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
    })
    setEditing(c)
  }

  async function save() {
    if (busy || !editing) return
    if (!draft.name.trim()) {
      toast.error(MESSAGES.NAME_REQUIRED)
      return
    }
    setBusy(true)
    try {
      const r = await fetch(`/api/customers/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          taxId: draft.tax_id,
          branch: draft.branch,
          address: draft.address,
          phone: draft.phone,
          email: draft.email,
        }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(fail(b.error))
        return
      }
      toast.success('บันทึกแล้ว')
      setEditing(null)
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (busy || !removing) return
    setBusy(true)
    try {
      const r = await fetch(`/api/customers/${removing.id}`, { method: 'DELETE' })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(fail(b.error))
        return
      }
      toast.success('ลบออกจากทะเบียนแล้ว')
      setRemoving(null)
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  const field = (k: keyof Draft) => ({
    value: draft[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft((p) => ({ ...p, [k]: e.target.value })),
    className: 'input-base',
  })

  return (
    <div className="space-y-4">
      <PageHeader
        title="ทะเบียนลูกค้า"
        subtitle="ที่อยู่และเลขผู้เสียภาษีที่ฟอร์มเอกสารเติมให้ · เพิ่มรายใหม่จากปุ่ม “เก็บเข้าทะเบียนลูกค้า” ในฟอร์มเอกสาร"
        backHref="/settings"
        className="mb-0"
      />

      <p className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink-2">
        แก้ตรงนี้<span className="font-semibold text-ink">ไม่ย้อนไปแก้ใบที่ออกไปแล้ว</span> —
        ชื่อและที่อยู่บนกระดาษถูกถ่ายสำเนาลงในใบตั้งแต่ตอนสร้าง · ที่นี่คุมเฉพาะใบถัดไป
      </p>

      {rows.length === 0 ? (
        <EmptyState
          icon={BookUser}
          message="ยังไม่มีลูกค้าในทะเบียน — เปิดฟอร์มเอกสาร พิมพ์ชื่อกับที่อยู่ แล้วกด “เก็บเข้าทะเบียนลูกค้า”"
        />
      ) : (
        <div className="panel">
          <div className="panel-head">
            ลูกค้าทั้งหมด
            <span className="ml-auto text-xs font-normal tnum text-muted-token">
              {rows.length} ราย
            </span>
          </div>
          <ul>
            {rows.map((c) => (
              <li
                key={c.id}
                className="flex items-start gap-3 border-b border-line-soft px-3.5 py-3 last:border-b-0 md:px-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{c.name}</p>
                  {(c.tax_id || c.branch) && (
                    <p className="text-xs tnum text-muted-token">
                      {c.tax_id ?? ''}
                      {c.branch ? ` · ${c.branch}` : ''}
                    </p>
                  )}
                  {c.address && (
                    <p className="truncate text-xs text-muted-token">{c.address}</p>
                  )}
                  {c.phone && <p className="text-xs tnum text-muted-token">โทร {c.phone}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => open(c)}
                    aria-label={`แก้ไข ${c.name}`}
                    className="grid size-9 place-items-center rounded-md text-muted-token transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemoving(c)}
                    aria-label={`ลบ ${c.name}`}
                    className="grid size-9 place-items-center rounded-md text-muted-token transition-colors hover:bg-urgent-bg hover:text-urgent"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── กล่องแก้ไข ─────────────────────────────────────────────── */}
      <Dialog.Root open={editing !== null} onOpenChange={(v) => { if (!busy && !v) setEditing(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
            <Dialog.Title className="text-lg font-bold text-ink">แก้ข้อมูลลูกค้า</Dialog.Title>
            <Dialog.Description className="mt-0.5 text-sm text-muted-token">
              มีผลกับเอกสารที่จะออกหลังจากนี้เท่านั้น
            </Dialog.Description>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="c-name" className="label-base">ชื่อลูกค้า</label>
                <input id="c-name" {...field('name')} />
              </div>
              <div>
                <label htmlFor="c-tax" className="label-base">เลขประจำตัวผู้เสียภาษี</label>
                <input id="c-tax" inputMode="numeric" {...field('tax_id')} className="input-base tnum" />
              </div>
              <div>
                <label htmlFor="c-branch" className="label-base">สำนักงานใหญ่ / สาขา</label>
                <input id="c-branch" placeholder="สำนักงานใหญ่" {...field('branch')} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="c-address" className="label-base">ที่อยู่</label>
                <textarea id="c-address" rows={2} {...field('address')} />
              </div>
              <div>
                <label htmlFor="c-phone" className="label-base">โทรศัพท์</label>
                <input id="c-phone" {...field('phone')} />
              </div>
              <div>
                <label htmlFor="c-email" className="label-base">อีเมล</label>
                <input id="c-email" {...field('email')} />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} disabled={busy} className="btn-secondary">
                ยกเลิก
              </button>
              <button type="button" onClick={save} disabled={busy} className="btn-primary disabled:opacity-60">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                บันทึก
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* ── กล่องยืนยันการลบ ───────────────────────────────────────── */}
      <Dialog.Root open={removing !== null} onOpenChange={(v) => { if (!busy && !v) setRemoving(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
            <Dialog.Title className="text-lg font-bold text-ink">
              ลบ {removing?.name} ออกจากทะเบียน
            </Dialog.Title>
            <Dialog.Description className="mt-0.5 text-sm text-muted-token">
              <span className="font-semibold text-ink">เอกสารที่เคยออกให้รายนี้ไม่หายและไม่เปลี่ยน</span>
              {' '}— ชื่อกับที่อยู่บนใบเป็นสำเนาของใบเอง · ที่หายไปคือการเติมให้อัตโนมัติในใบถัดไป
            </Dialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRemoving(null)} disabled={busy} className="btn-secondary">
                ยกเลิก
              </button>
              <button type="button" onClick={remove} disabled={busy} className="btn-danger disabled:opacity-60">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                ลบ
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
