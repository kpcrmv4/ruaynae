'use client'

import { Check, SlidersHorizontal } from 'lucide-react'
import { fmtBaht } from '@/lib/format'
import type { AdjustLine } from '@/lib/wage-adjustments'

/**
 * รายชื่อคนที่ยังไม่เข้าโครงการ แบบ **การ์ดสี่เหลี่ยมเล็ก** สำหรับเลือกด้วยนิ้วเดียว
 *
 * ทำไมไม่ใช้แถวยาวเหมือนมุมมองรายชื่อ: หน้านี้ถูกใช้ยืนกลางโครงการ ถือมือถือมือเดียว
 * แล้วไล่แตะชื่อคนสิบกว่าคน · แถวเต็มความกว้างบังคับให้เลื่อนนิ้วขึ้นลงทั้งจอ
 * ส่วนตารางสองคอลัมน์เอาชื่อมาอยู่ในระยะนิ้วโป้งและเห็นได้ครั้งละหลายคน
 *
 * 🔴 การ์ดเป็น `div` ที่มีปุ่มคลุมทั้งใบ (`absolute inset-0`) ไม่ใช่ `<button>`
 * ที่ครอบทุกอย่าง — เพราะชิป "ครึ่งวัน" และ "ปรับค่าแรง" ข้างในต้องเป็นปุ่มของตัวเอง
 * และปุ่มซ้อนปุ่มเป็น HTML ที่ไม่ถูกต้อง (เบราว์เซอร์แต่ละตัวตีความคนละแบบ)
 * · เนื้อการ์ดจึงเป็น `pointer-events-none` ทั้งชั้น แล้วเปิดกลับเฉพาะชิป
 *
 * ⚠️ พื้นที่แตะขั้นต่ำ 44px — การ์ดสูง 5.5rem ทั้งใบเป็นปุ่ม ไม่ใช่แค่กล่องติ๊กเล็ก ๆ
 */
export type PickItem = {
  id: string
  name: string
  jobTitle: string | null
  /** ลงชื่อเต็มวันที่โครงการอื่นไปแล้ว = กดยังไงก็ไม่ผ่าน */
  full: boolean
  /** เหลือโควตาแค่ครึ่งวัน — เลือกครึ่งวันให้เองแล้ว ไม่ต้องมีชิปให้กด */
  halfOnly: boolean
  /** โครงการที่เขาอยู่วันนี้ (ถ้ามี) */
  where: string | null
  picked: boolean
  half: boolean
  /**
   * เงินของคนนี้วันนี้ — มีเฉพาะเจ้าของ (หัวหน้าโครงการไม่เห็นเงิน P4.5)
   * `base` = เรต × ส่วนของวัน · `lines` = รายการปรับที่ตั้งไว้ในกล่อง
   */
  money: { base: number; lines: AdjustLine[] } | null
}

export function PickGrid({
  items,
  disabled,
  onToggle,
  onToggleHalf,
  onAdjust,
}: {
  items: PickItem[]
  disabled: boolean
  onToggle: (id: string) => void
  onToggleHalf: (id: string, next: boolean) => void
  /** เปิดกล่องปรับค่าแรงของคนนี้ — ไม่ส่งมา = ไม่วาดปุ่ม (หัวหน้าโครงการ) */
  onAdjust?: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((it) => {
        const net = it.money ? it.money.lines.reduce((s, l) => s + (l.kind === 'add' ? l.amount : -l.amount), 0) : 0
        const total = it.money ? it.money.base + net : null
        return (
          <div
            key={it.id}
            className={`relative rounded-lg border-2 transition-colors duration-100 ${
              it.picked
                ? 'border-brand-solid bg-brand-tint'
                : it.full
                  ? 'border-line bg-surface-2'
                  : 'border-line-strong bg-surface active:bg-surface-2'
            }`}
          >
            <button
              type="button"
              onClick={() => onToggle(it.id)}
              disabled={it.full || disabled}
              aria-pressed={it.picked}
              aria-label={`${it.name}${it.full ? ' (ลงครบวันแล้ว)' : ''}`}
              className="absolute inset-0 z-0 rounded-md disabled:cursor-not-allowed"
            />

            <div className="pointer-events-none relative z-10 flex min-h-22 flex-col gap-1 p-2.5">
              <div className="flex items-start gap-1.5">
                <span
                  className={`line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-5 ${
                    it.full ? 'text-muted-token' : 'text-ink'
                  }`}
                >
                  {it.name}
                </span>
                <span
                  aria-hidden
                  className={`grid size-5.5 shrink-0 place-items-center rounded-full border-2 ${
                    it.picked
                      ? 'border-brand-solid bg-brand-solid text-white'
                      : it.full
                        ? 'border-line'
                        : 'border-line-strong'
                  }`}
                >
                  {it.picked && <Check className="size-3.5" strokeWidth={3} />}
                </span>
              </div>

              {/* 🔴 สรุปเงินของคนที่เลือกไว้ — เจ้าของเห็นทันทีว่าติ๊กแล้วค่าแรงออกมาเท่าไหร่
                  ไม่ต้องเปิดกล่องเพื่อดู · บรรทัดรายการปรับบอกว่ามาจากอะไร */}
              {it.picked && total !== null && it.money && (
                <div className="min-w-0">
                  <div className="text-base font-bold leading-6 tnum text-ink">{fmtBaht(total)}</div>
                  {it.money.lines.length > 0 && (
                    <div className="truncate text-[11px] leading-4 text-muted-token">
                      {it.money.lines
                        .map((l) => `${l.kind === 'add' ? '+' : '−'}${l.name} ${l.amount.toLocaleString('th-TH')}`)
                        .join(' · ')}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-auto flex flex-wrap items-center gap-1">
                {/* ลำดับความสำคัญ: เหตุผลที่กดไม่ได้ > ตัวเลือกของคนที่เลือกไว้ > ตำแหน่ง */}
                {it.full ? (
                  <span className="chip bg-status-pending-bg text-status-pending ring-status-pending-ring">
                    ลงครบวันแล้ว
                  </span>
                ) : it.picked ? (
                  <>
                    {it.halfOnly ? (
                      <span className="chip bg-status-progress-bg text-status-progress ring-status-progress-ring">
                        ลงได้ครึ่งวัน
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onToggleHalf(it.id, !it.half)}
                        disabled={disabled}
                        aria-pressed={it.half}
                        className={`pointer-events-auto chip ${
                          it.half
                            ? 'bg-brand-solid text-white ring-0'
                            : 'border border-line-strong bg-surface text-ink-2 ring-0'
                        }`}
                      >
                        ครึ่งวัน
                      </button>
                    )}
                    {/* ปุ่ม + ปรับค่าแรง — เฉพาะเจ้าของ · เปิดกล่องเลือก OT/เบี้ยเลี้ยง/หัก */}
                    {onAdjust && (
                      <button
                        type="button"
                        onClick={() => onAdjust(it.id)}
                        disabled={disabled}
                        aria-label={`ปรับค่าแรงของ ${it.name}`}
                        className={`pointer-events-auto chip ring-0 ${
                          it.money && it.money.lines.length > 0
                            ? 'border border-brand-solid bg-surface text-brand'
                            : 'border border-line-strong bg-surface text-ink-2'
                        }`}
                      >
                        <SlidersHorizontal className="size-3" strokeWidth={2.2} aria-hidden />
                        ปรับ
                      </button>
                    )}
                  </>
                ) : it.halfOnly ? (
                  <span className="chip bg-status-progress-bg text-status-progress ring-status-progress-ring">
                    ลงได้ครึ่งวัน
                  </span>
                ) : (
                  <span className="truncate text-xs text-muted-token">
                    {it.where ? `วันนี้อยู่ ${it.where}` : (it.jobTitle ?? 'ไม่ได้ระบุตำแหน่ง')}
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
