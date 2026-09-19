'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Check, Loader2, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { fmtBaht } from '@/lib/format'
import {
  ADJUST_KIND_LABEL, ADJUST_KINDS, MAX_ADJUST_LINES, MAX_ADJUST_NAME, adjustNet,
  type AdjustKind, type AdjustLine, type AdjustPreset,
} from '@/lib/wage-adjustments'

/**
 * กล่อง "ปรับค่าแรง" ของคนหนึ่งคนในหนึ่งวัน — OT · เบี้ยเลี้ยง · มาสาย · พิมพ์เอง
 *
 * รายการสำเร็จรูปมาจากหน้าตั้งค่า พร้อมยอดเริ่มต้น · แตะแถวเพื่อเลือก แล้วแก้ยอด
 * ได้เป็นครั้ง ๆ · ข้างล่างพิมพ์รายการเองได้ พร้อมเลือกว่าจ่ายเพิ่มหรือหักออก
 * · แถบสรุปล่างบอกทันทีว่าค่าแรงของคนนี้วันนี้ออกมาเท่าไหร่
 *
 * 🔴 กล่องนี้ **ไม่รู้ว่าปลายทางคือ state ในหน้าหรือ API** — `onSave` เป็นคนตัดสิน
 *    คนที่ยังไม่ได้ลงชื่อเก็บไว้ในหน้าจนกว่าจะกด "ลงชื่อ N คน" · คนที่ลงชื่อแล้ว
 *    ยิง PUT ทันที · กล่องเดียวจึงใช้ได้ทั้งสองทาง ไม่ต้องมีสองแบบที่วันหนึ่งจะต่างกัน
 * 🔴 เจ้าของเท่านั้นที่เห็นกล่องนี้ (เงิน — P4.5) · หน้าที่เรียกเป็นคนไม่วาดปุ่มให้หัวหน้าโครงการ
 */
export function AdjustDialog({
  name,
  units,
  base,
  presets,
  initial,
  saving,
  onSave,
  onClose,
}: {
  name: string
  /** 1 = เต็มวัน · 0.5 = ครึ่งวัน — โชว์ให้รู้ว่าฐานที่คิดคือเท่าไหร่ */
  units: number
  /** ค่าแรงฐานของวัน (เรต × ส่วนของวัน) · คนรายเดือนเป็น 0 เพราะเงินเดือนไปทางกฎรายเดือน */
  base: number
  presets: AdjustPreset[]
  initial: AdjustLine[]
  saving: boolean
  onSave: (lines: AdjustLine[]) => void
  onClose: () => void
}) {
  const [lines, setLines] = useState<AdjustLine[]>(initial)

  const presetLine = (id: string) => lines.find((l) => l.presetId === id)

  const togglePreset = (p: AdjustPreset) => {
    setLines((ls) =>
      ls.some((l) => l.presetId === p.id)
        ? ls.filter((l) => l.presetId !== p.id)
        : ls.length >= MAX_ADJUST_LINES
          ? ls
          : [...ls, { presetId: p.id, name: p.name, kind: p.kind, amount: p.amount }],
    )
  }

  const setAmount = (index: number, raw: string) => {
    const n = Number(raw)
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, amount: Number.isFinite(n) ? n : 0 } : l)))
  }

  const custom = lines
    .map((l, i) => ({ line: l, index: i }))
    .filter(({ line }) => line.presetId === null)

  const addCustom = () =>
    setLines((ls) =>
      ls.length >= MAX_ADJUST_LINES ? ls : [...ls, { presetId: null, name: '', kind: 'add', amount: 0 }],
    )

  const patchCustom = (index: number, patch: Partial<AdjustLine>) =>
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)))

  const removeLine = (index: number) => setLines((ls) => ls.filter((_, i) => i !== index))

  // บรรทัดที่ยังกรอกไม่ครบ (ชื่อว่าง / ยอด 0) จะถูกตัดทิ้งตอนบันทึก — ไม่ใช่ปฏิเสธทั้งกล่อง
  // เพราะคนกด "เพิ่มรายการเอง" แล้วเปลี่ยนใจไม่ควรต้องหาปุ่มลบก่อนถึงจะบันทึกได้
  const clean = lines.filter((l) => l.name.trim() !== '' && l.amount > 0)
  const added = clean.filter((l) => l.kind === 'add').reduce((s, l) => s + l.amount, 0)
  const deducted = clean.filter((l) => l.kind === 'deduct').reduce((s, l) => s + l.amount, 0)
  const net = adjustNet(clean)
  const total = base + net
  const negative = total < 0

  const kindSwitch = (value: AdjustKind, onChange: (k: AdjustKind) => void) => (
    <div role="group" aria-label="ชนิด" className="grid shrink-0 grid-cols-2 gap-0.5 rounded-md bg-surface-3 p-0.5">
      {ADJUST_KINDS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          aria-pressed={value === k}
          className={`rounded-sm px-2 py-1 text-xs transition-colors duration-100 ${
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
    <Dialog.Root open onOpenChange={(v) => !v && !saving && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90svh] w-[min(30rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-e3 animate-pop-in">
          <div className="flex items-start gap-3 border-b border-line-soft px-4 py-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-lg font-bold text-ink">ปรับค่าแรง · {name}</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-sm text-muted-token">
                {units === 0.5 ? 'ครึ่งวัน' : 'เต็มวัน'} · ค่าแรงฐาน{' '}
                <span className="font-semibold tnum text-ink-2">{fmtBaht(base)}</span>
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="ปิด"
              disabled={saving}
              className="grid size-9 shrink-0 place-items-center rounded-md border border-line-strong bg-surface text-ink-2 transition-colors hover:border-ink-2 hover:text-ink"
            >
              <X className="size-4" strokeWidth={2} />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* ── รายการสำเร็จรูป ─────────────────────────────────── */}
            {presets.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-token">
                ยังไม่ได้ตั้งรายการสำเร็จรูป — ตั้งได้ที่ ตั้งค่า › รายการปรับค่าแรง · พิมพ์เองข้างล่างได้เลย
              </p>
            ) : (
              <ul className="border-b border-line-soft">
                {presets.map((p) => {
                  const line = presetLine(p.id)
                  const index = lines.findIndex((l) => l.presetId === p.id)
                  const on = Boolean(line)
                  return (
                    <li
                      key={p.id}
                      className={`flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-b-0 ${
                        on ? 'bg-brand-tint' : ''
                      }`}
                    >
                      {/* ทั้งแถวเป็นปุ่มเลือก · ช่องยอดอยู่นอกปุ่ม (ปุ่มซ้อน input ไม่ได้) */}
                      <button
                        type="button"
                        onClick={() => togglePreset(p)}
                        aria-pressed={on}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span
                          aria-hidden
                          className={`grid size-5.5 shrink-0 place-items-center rounded-sm border-2 transition-colors duration-100 ${
                            on ? 'border-brand-solid bg-brand-solid text-white' : 'border-line-strong'
                          }`}
                        >
                          {on && <Check className="size-3.5" strokeWidth={3} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-ink">{p.name}</span>
                          <span
                            className={`block text-xs ${p.kind === 'add' ? 'text-income' : 'text-expense'}`}
                          >
                            {ADJUST_KIND_LABEL[p.kind]} · ตั้งไว้ {fmtBaht(p.amount)}
                          </span>
                        </span>
                      </button>
                      <div className="relative w-28 shrink-0">
                        <span
                          className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold ${
                            p.kind === 'add' ? 'text-income' : 'text-expense'
                          }`}
                        >
                          {p.kind === 'add' ? '+' : '−'}
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={on ? String(line!.amount) : ''}
                          placeholder={String(p.amount)}
                          disabled={!on}
                          onChange={(e) => setAmount(index, e.target.value)}
                          aria-label={`ยอด ${p.name}`}
                          className="input-base py-1.5 pl-6 text-right tnum"
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            {/* ── พิมพ์เอง ───────────────────────────────────────── */}
            <div className="px-4 py-3">
              {custom.length > 0 && (
                <ul className="mb-2 space-y-2">
                  {custom.map(({ line, index }) => (
                    <li key={index} className="rounded-md border border-line-strong p-2.5">
                      <div className="flex items-center gap-2">
                        <input
                          value={line.name}
                          maxLength={MAX_ADJUST_NAME}
                          onChange={(e) => patchCustom(index, { name: e.target.value })}
                          placeholder="ชื่อรายการ เช่น ค่าเดินทาง"
                          aria-label="ชื่อรายการ"
                          className="input-base min-w-0 flex-1 py-1.5"
                          autoFocus={line.name === ''}
                        />
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          aria-label="ลบรายการนี้"
                          className="grid size-9 shrink-0 place-items-center rounded-md border border-line-strong text-ink-2 transition-colors hover:border-urgent hover:text-urgent"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        {kindSwitch(line.kind, (k) => patchCustom(index, { kind: k }))}
                        <div className="relative min-w-0 flex-1">
                          <span
                            className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold ${
                              line.kind === 'add' ? 'text-income' : 'text-expense'
                            }`}
                          >
                            {line.kind === 'add' ? '+' : '−'}
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={line.amount === 0 ? '' : String(line.amount)}
                            onChange={(e) => setAmount(index, e.target.value)}
                            placeholder="0"
                            aria-label="ยอด"
                            className="input-base py-1.5 pl-6 text-right tnum"
                          />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={addCustom}
                disabled={lines.length >= MAX_ADJUST_LINES}
                className="btn-secondary w-full py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="size-4" />
                เพิ่มรายการเอง
              </button>
            </div>
          </div>

          {/* ── สรุป + ปุ่ม ─────────────────────────────────────── */}
          <div className="border-t border-line-soft bg-surface-2 px-4 py-3">
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-sm">
              <dt className="text-muted-token">ค่าแรงฐาน</dt>
              <dd className="text-right tnum text-ink-2">{fmtBaht(base)}</dd>
              {added > 0 && (
                <>
                  <dt className="text-muted-token">จ่ายเพิ่ม</dt>
                  <dd className="text-right tnum text-income">+{fmtBaht(added)}</dd>
                </>
              )}
              {deducted > 0 && (
                <>
                  <dt className="text-muted-token">หักออก</dt>
                  <dd className="text-right tnum text-expense">−{fmtBaht(deducted)}</dd>
                </>
              )}
              <dt className="font-semibold text-ink">ค่าแรงวันนี้</dt>
              <dd className={`text-right text-lg font-bold tnum ${negative ? 'text-urgent' : 'text-ink'}`}>
                {fmtBaht(total)}
              </dd>
            </dl>
            {negative && (
              <p className="mt-1 text-xs text-urgent">หักมากกว่าค่าแรงของวันไม่ได้ — ระบบจะไม่รับยอดติดลบ</p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="btn-secondary flex-1"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => onSave(clean)}
                disabled={saving || negative}
                className="btn-primary flex-1 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {saving ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
