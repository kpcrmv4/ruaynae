'use client'

import { Eye, EyeOff, Loader2, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { categoryError, TXN_KINDS, TXN_KIND_LABEL, type TxnKind } from '@/lib/categories'
import { PageHeader } from '@/components/ui/page-header'

type Row = {
  id: string
  name: string
  kind: TxnKind
  sort_order: number
  is_active: boolean
  /** นับเข้าช่อง "ค่าวัสดุ" ของแถบต้นทุนในหน้าโครงการ — เฉพาะฝั่งรายจ่าย */
  is_material: boolean
}

export function CategoriesClient({ categories }: { categories: Row[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', kind: 'expense' as TxnKind, sortOrder: '' })

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
        toast.error(categoryError(b.error))
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
    if (!form.name.trim()) return toast.error('กรุณากรอกชื่อหมวด')
    if (await send('new', '/api/settings/categories', 'POST', form, 'เพิ่มหมวดแล้ว')) {
      setForm({ name: '', kind: form.kind, sortOrder: '' })
    }
  }

  const byKind = (k: TxnKind) => categories.filter((c) => c.kind === k)

  return (
    <div className="space-y-5">
      <PageHeader
        title="หมวดรายรับ-รายจ่าย"
        subtitle={
          <>
            หมวดที่ปิดจะหายจากฟอร์มบันทึก แต่รายการเก่ายังแสดงชื่อหมวดได้ตามปกติ ·
            หมวดรายจ่ายที่ติ๊ก <span className="font-medium text-ink-2">ค่าวัสดุ</span>{' '}
            จะถูกนับรวมเป็นช่อง &ldquo;ค่าวัสดุ&rdquo; ในแถบต้นทุนของแต่ละโครงการ
          </>
        }
        backHref="/settings"
        className="mb-0"
      />

      {/* ── เพิ่มหมวด ─────────────────────────────────────────────── */}
      <section className="panel p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <div>
            <label htmlFor="cat-name" className="label-base">ชื่อหมวดใหม่</label>
            <input
              id="cat-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="เช่น ค่าเช่านั่งร้าน"
              className="input-base"
            />
          </div>
          <div>
            <label htmlFor="cat-kind" className="label-base">ชนิด</label>
            <select
              id="cat-kind"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as TxnKind })}
              className="input-base"
            >
              {TXN_KINDS.map((k) => (
                <option key={k} value={k}>{TXN_KIND_LABEL[k]}</option>
              ))}
            </select>
          </div>
          <div>
            {/* ลำดับตัดสินว่าหมวดไหนอยู่บนสุดในกล่องเลือก — หมวดที่ใช้บ่อย
                ควรอยู่ใกล้มือ ไม่ใช่เรียงตามตัวอักษรซึ่งไม่ได้บอกอะไรเลย */}
            <label htmlFor="cat-order" className="label-base">ลำดับ</label>
            <input
              id="cat-order"
              type="text"
              inputMode="numeric"
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
              placeholder="100"
              className="input-base w-24 tnum"
            />
          </div>
          <button onClick={add} disabled={busy !== null} className="btn-primary">
            {busy === 'new' ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            เพิ่ม
          </button>
        </div>
      </section>

      {TXN_KINDS.map((kind) => (
        <section key={kind} className="panel">
          <div className="panel-head">
            {TXN_KIND_LABEL[kind]}
            <span className="ml-auto text-xs font-normal text-muted-token">
              {byKind(kind).length} หมวด
            </span>
          </div>
          {byKind(kind).length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-token">ยังไม่มีหมวดในชนิดนี้</p>
          ) : (
            <ul>
              {byKind(kind).map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-4 py-2.5 last:border-b-0"
                >
                  <span className="w-10 shrink-0 text-sm tnum text-muted-token">{c.sort_order}</span>
                  <span className={`min-w-0 flex-1 truncate font-medium ${c.is_active ? 'text-ink' : 'text-muted-token line-through'}`}>
                    {c.name}
                  </span>
                  {!c.is_active && <Badge tone="pending">ปิดอยู่</Badge>}
                  {/* 🔴 ธงนี้เป็นตัวตัดสินว่ารายจ่ายก้อนไหนไปโผล่ในช่อง "ค่าวัสดุ"
                      ของแถบต้นทุนในหน้าโครงการ · ให้ติ๊กเองแทนการเทียบชื่อหมวด
                      ในโค้ด เพราะเจ้าของเปลี่ยนชื่อหมวดและเพิ่มหมวดวัสดุอันที่สอง
                      ได้ตลอด (ค่าเหล็ก · ค่าปูน) ซึ่งการเทียบชื่อรองรับไม่ได้เลย */}
                  {kind === 'expense' && (
                    <label
                      className={`flex shrink-0 cursor-pointer items-center gap-1.5 text-xs ${
                        c.is_material ? 'font-semibold text-ink-2' : 'text-muted-token'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={c.is_material}
                        disabled={busy !== null}
                        onChange={() =>
                          send(c.id, `/api/settings/categories/${c.id}`, 'PATCH',
                            { isMaterial: !c.is_material },
                            c.is_material ? 'ไม่นับเป็นค่าวัสดุแล้ว' : 'นับเป็นค่าวัสดุแล้ว')
                        }
                        className="size-4 accent-brand-solid"
                      />
                      ค่าวัสดุ
                    </label>
                  )}
                  <button
                    onClick={() =>
                      send(c.id, `/api/settings/categories/${c.id}`, 'PATCH',
                        { isActive: !c.is_active },
                        c.is_active ? 'ปิดหมวดแล้ว' : 'เปิดหมวดแล้ว')
                    }
                    disabled={busy !== null}
                    className="btn-ghost shrink-0"
                  >
                    {busy === c.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : c.is_active ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                    {c.is_active ? 'ปิด' : 'เปิด'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
