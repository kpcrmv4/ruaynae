'use client'

import { Check, Eye, EyeOff, Loader2, Pencil, Plus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { fmtBaht } from '@/lib/format'
import { BackButton } from '@/components/ui/back-button'
import {
  ADJUST_KIND_LABEL, ADJUST_KINDS, adjustError, type AdjustKind, type AdjustPreset,
} from '@/lib/wage-adjustments'

const EMPTY = { name: '', kind: 'add' as AdjustKind, amount: '', sortOrder: '' }

/**
 * หน้าตั้งค่ารายการปรับค่าแรงสำเร็จรูป
 *
 * รายการที่ตั้งไว้ตรงนี้คือสิ่งที่โผล่ในกล่อง "ปรับค่าแรง" ตอนติ๊กคนเข้าโครงการ
 * · ยอดที่ตั้งเป็น**ค่าเริ่มต้น** — ตอนใช้จริงแก้เป็นครั้ง ๆ ได้
 * · ปิดแทนลบ: รายการที่ปิดหายจากกล่องเลือก แต่บรรทัดเก่าที่เคยใช้ยังอ่านชื่อได้
 */
export function WageAdjustmentsClient({ presets }: { presets: AdjustPreset[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [edit, setEdit] = useState(EMPTY)

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
        toast.error(adjustError(b.error))
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

  const add = async () => {
    if (!form.name.trim()) return toast.error('กรุณากรอกชื่อรายการ')
    const ok = await send('new', '/api/settings/wage-adjustments', 'POST', {
      name: form.name,
      kind: form.kind,
      amount: form.amount === '' ? 0 : Number(form.amount),
      sortOrder: form.sortOrder,
    }, 'เพิ่มรายการแล้ว')
    if (ok) setForm({ ...EMPTY, kind: form.kind })
  }

  const openEdit = (p: AdjustPreset) => {
    setEditing(p.id)
    setEdit({ name: p.name, kind: p.kind, amount: String(p.amount), sortOrder: String(p.sort_order) })
  }

  const saveEdit = async (id: string) => {
    if (!edit.name.trim()) return toast.error('กรุณากรอกชื่อรายการ')
    const ok = await send(id, `/api/settings/wage-adjustments/${id}`, 'PATCH', {
      name: edit.name,
      kind: edit.kind,
      amount: edit.amount === '' ? 0 : Number(edit.amount),
      sortOrder: edit.sortOrder,
    }, 'บันทึกแล้ว')
    if (ok) setEditing(null)
  }

  const kindField = (value: AdjustKind, onChange: (k: AdjustKind) => void, id: string) => (
    /* สองปุ่มติดกันแทนกล่องเลือก — "จ่ายเพิ่ม/หักออก" เป็นสองทางที่ต้องเห็นพร้อมกัน
       จะได้ไม่มีใครตั้ง "มาสาย" เป็นจ่ายเพิ่มโดยไม่รู้ตัว */
    <div role="group" aria-label="ชนิด" id={id} className="grid grid-cols-2 gap-1 rounded-md bg-surface-3 p-1">
      {ADJUST_KINDS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          aria-pressed={value === k}
          className={`rounded-sm px-2 py-1.5 text-sm transition-colors duration-100 ${
            value === k
              ? k === 'add'
                ? 'bg-surface font-semibold text-income shadow-sm'
                : 'bg-surface font-semibold text-expense shadow-sm'
              : 'font-medium text-ink-2'
          }`}
        >
          {ADJUST_KIND_LABEL[k]}
        </button>
      ))}
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink">รายการปรับค่าแรง</h1>
        <p className="mt-0.5 text-sm text-muted-token">
          OT · เบี้ยเลี้ยง · มาสาย — ตั้งไว้ครั้งเดียว แล้วเลือกใช้ตอนติ๊กคนเข้าโครงการ
          · ยอดที่ตั้งเป็น<span className="font-medium text-ink-2">ค่าเริ่มต้น</span> แก้เป็นครั้ง ๆ ได้
          </p>
        </div>
        <BackButton fallbackHref="/settings" />
      </div>

      {/* ── เพิ่มรายการ ───────────────────────────────────────────── */}
      <section className="panel p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_8rem_5rem_auto] sm:items-end">
          <div>
            <label htmlFor="adj-name" className="label-base">ชื่อรายการใหม่</label>
            <input
              id="adj-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="เช่น ค่าเดินทาง"
              className="input-base"
            />
          </div>
          <div>
            <span className="label-base">ชนิด</span>
            {kindField(form.kind, (k) => setForm({ ...form, kind: k }), 'adj-kind')}
          </div>
          <div>
            <label htmlFor="adj-amount" className="label-base">ยอดเริ่มต้น (บาท)</label>
            <input
              id="adj-amount"
              type="text"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="100"
              className="input-base tnum"
            />
          </div>
          <div>
            <label htmlFor="adj-order" className="label-base">ลำดับ</label>
            <input
              id="adj-order"
              type="text"
              inputMode="numeric"
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
              placeholder="100"
              className="input-base tnum"
            />
          </div>
          <button onClick={add} disabled={busy !== null} className="btn-primary">
            {busy === 'new' ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            เพิ่ม
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          รายการที่ตั้งไว้
          <span className="ml-auto text-xs font-normal tnum text-muted-token">{presets.length} รายการ</span>
        </div>
        {presets.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-token">
            ยังไม่มีรายการ — เพิ่มรายการแรกข้างบน เช่น OT 100 บาท
          </p>
        ) : (
          <ul>
            {presets.map((p) => (
              <li key={p.id} className="border-b border-line-soft px-4 py-2.5 last:border-b-0">
                {editing === p.id ? (
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto_7rem_4.5rem_auto] sm:items-center">
                    <input
                      value={edit.name}
                      onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                      aria-label="ชื่อรายการ"
                      className="input-base py-2"
                    />
                    {kindField(edit.kind, (k) => setEdit({ ...edit, kind: k }), `adj-kind-${p.id}`)}
                    <input
                      type="text"
                      inputMode="decimal"
                      value={edit.amount}
                      onChange={(e) => setEdit({ ...edit, amount: e.target.value })}
                      aria-label="ยอดเริ่มต้น"
                      className="input-base py-2 tnum"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={edit.sortOrder}
                      onChange={(e) => setEdit({ ...edit, sortOrder: e.target.value })}
                      aria-label="ลำดับ"
                      className="input-base py-2 tnum"
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => saveEdit(p.id)}
                        disabled={busy !== null}
                        className="btn-primary flex-1 py-2 sm:flex-none"
                      >
                        {busy === p.id ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                        บันทึก
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        disabled={busy !== null}
                        aria-label="ยกเลิกการแก้ไข"
                        className="btn-secondary py-2"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="w-8 shrink-0 text-sm tnum text-muted-token">{p.sort_order}</span>
                    <span
                      className={`min-w-0 flex-1 truncate font-medium ${
                        p.is_active ? 'text-ink' : 'text-muted-token line-through'
                      }`}
                    >
                      {p.name}
                    </span>
                    <Badge tone={p.kind === 'add' ? 'done' : 'urgent'}>{ADJUST_KIND_LABEL[p.kind]}</Badge>
                    <span
                      className={`shrink-0 text-sm font-semibold tnum ${
                        p.kind === 'add' ? 'text-income' : 'text-expense'
                      }`}
                    >
                      {p.kind === 'add' ? '+' : '−'}{fmtBaht(p.amount)}
                    </span>
                    {!p.is_active && <Badge tone="pending">ปิดอยู่</Badge>}
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        disabled={busy !== null}
                        aria-label={`แก้ไข ${p.name}`}
                        className="btn-ghost"
                      >
                        <Pencil className="size-4" />
                        <span className="hidden sm:inline">แก้ไข</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          send(p.id, `/api/settings/wage-adjustments/${p.id}`, 'PATCH',
                            { isActive: !p.is_active },
                            p.is_active ? 'ปิดรายการแล้ว' : 'เปิดรายการแล้ว')
                        }
                        disabled={busy !== null}
                        className="btn-ghost"
                      >
                        {busy === p.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : p.is_active ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                        {p.is_active ? 'ปิด' : 'เปิด'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
