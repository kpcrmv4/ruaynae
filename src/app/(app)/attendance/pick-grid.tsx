'use client'

import { Check } from 'lucide-react'

/**
 * รายชื่อคนที่ยังไม่เข้าโครงการ แบบ **การ์ดสี่เหลี่ยมเล็ก** สำหรับเลือกด้วยนิ้วเดียว
 *
 * ทำไมไม่ใช้แถวยาวเหมือนมุมมองรายชื่อ: หน้านี้ถูกใช้ยืนกลางโครงการ ถือมือถือมือเดียว
 * แล้วไล่แตะชื่อคนสิบกว่าคน · แถวเต็มความกว้างบังคับให้เลื่อนนิ้วขึ้นลงทั้งจอ
 * ส่วนตารางสองคอลัมน์เอาชื่อมาอยู่ในระยะนิ้วโป้งและเห็นได้ครั้งละหลายคน
 *
 * 🔴 การ์ดเป็น `div` ที่มีปุ่มคลุมทั้งใบ (`absolute inset-0`) ไม่ใช่ `<button>`
 * ที่ครอบทุกอย่าง — เพราะชิป "ครึ่งวัน" ข้างในต้องเป็นปุ่มของตัวเอง และปุ่มซ้อน
 * ปุ่มเป็น HTML ที่ไม่ถูกต้อง (เบราว์เซอร์แต่ละตัวตีความคนละแบบ)
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
  /** OT ที่ตั้งไว้ (ตั้งค่าได้ในมุมมองรายชื่อเท่านั้น — ในการ์ดแค่บอกว่ามี) */
  ot: number
}

export function PickGrid({
  items,
  disabled,
  onToggle,
  onToggleHalf,
}: {
  items: PickItem[]
  disabled: boolean
  onToggle: (id: string) => void
  onToggleHalf: (id: string, next: boolean) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((it) => (
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

            <div className="mt-auto flex flex-wrap items-center gap-1">
              {/* ลำดับความสำคัญ: เหตุผลที่กดไม่ได้ > ตัวเลือกของคนที่เลือกไว้ > ตำแหน่ง */}
              {it.full ? (
                <span className="chip bg-status-pending-bg text-status-pending ring-status-pending-ring">
                  ลงครบวันแล้ว
                </span>
              ) : it.halfOnly ? (
                <span className="chip bg-status-progress-bg text-status-progress ring-status-progress-ring">
                  ลงได้ครึ่งวัน
                </span>
              ) : it.picked ? (
                <>
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
                  {it.ot > 0 && (
                    <span className="chip border border-line-strong text-ink-2 ring-0">
                      OT ฿{it.ot.toLocaleString('th-TH')}
                    </span>
                  )}
                </>
              ) : (
                <span className="truncate text-xs text-muted-token">
                  {it.where ? `วันนี้อยู่ ${it.where}` : (it.jobTitle ?? 'ไม่ได้ระบุตำแหน่ง')}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
