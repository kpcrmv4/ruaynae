import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'

export type MetricTone = 'default' | 'urgent' | 'progress' | 'done' | 'info'

const VALUE_TONE: Record<MetricTone, string> = {
  default: 'text-ink',
  urgent: 'text-urgent',
  progress: 'text-status-progress',
  done: 'text-status-done',
  info: 'text-status-info',
}

/**
 * The figure strip at the top of a page.
 *
 * WHY ONE PANEL, NOT FOUR CARDS. The default every project reaches for is
 * `grid auto-fit minmax(150px,1fr)` with four floating cards. At 1440px that
 * yields ~280px-wide cards each holding a 24px number adrift in empty space,
 * and nothing on the page says which figure matters more than which. One panel
 * divided by hairlines reads as a single instrument, stays dense on a phone,
 * and puts the numbers close enough together to be compared.
 *
 * A figure that counts rows should be able to SHOW you those rows: give it
 * `href` and the cell becomes a link to the filtered list it is counting. A
 * dashboard number you cannot click is a dead end.
 *
 * Server Component — it takes a `LucideIcon` as a prop, which only works
 * because this file has no 'use client'. Do not add one.
 */
export function MetricBar({
  children,
  cols = 2,
}: {
  children: ReactNode
  /**
   * จำนวนคอลัมน์บนจอเล็ก — แถบ 3 ช่องใช้ 3 จะได้ไม่เหลือช่องว่างครึ่งแถว
   *
   * 🔴 ใช้ `3` เฉพาะแถบที่เป็น **จำนวนนับ** (4 โครงการ · 12 รายการ) เท่านั้น
   * ช่องกว้าง 1/3 ของจอ 390px เหลือที่ให้ตัวเลขราว 100px ซึ่งไม่พอกับยอดเงิน
   * หลักแสนขึ้นไป · แถบที่เป็นเงินให้ใช้ 2
   */
  cols?: 2 | 3
}) {
  return (
    <div
      className={`mb-6 grid ${cols === 3 ? 'grid-cols-3' : 'grid-cols-2'} overflow-hidden rounded-lg border border-line bg-surface shadow-e1 sm:grid-flow-col sm:grid-cols-[repeat(auto-fit,minmax(0,1fr))]`}
    >
      {children}
    </div>
  )
}

/**
 * ขนาดตัวเลขบนจอเล็ก — ยาวขึ้น = เล็กลงหนึ่งขั้น
 *
 * 🔴 ตัวเลขเงินย่อเองไม่ได้และ `truncate` ก็ใช้ไม่ได้ — "฿69,20…" คือตัวเลข
 * **ผิด** ไม่ใช่ตัวเลขที่อ่านยาก · ของที่เจอจริง: ฿-69,203 ในช่องกว้าง 1/3
 * ของจอ 390px ล้นออกไปทับช่องข้าง ๆ โดยที่ `overflow-hidden` ของแถบซ่อน
 * ส่วนที่เกินขอบขวาสุดไว้อีกที ตัวตรวจ "ล้นขอบจอ" จึงไม่มีทางจับได้
 *
 * ⚠️ ไม่ใช่ปัญหาของจอมือถืออย่างเดียว — ตั้งแต่ `sm:` ขึ้นไปแถบเรียงเป็น
 * คอลัมน์เท่ากัน แถบ 4 ช่องบนจอ 768px จึงเหลือที่ให้ตัวเลขแค่ ~151px
 * (วัดจริง: ฿3,554,300 ต้องการ 157px) · ขนาดจึงต้องไล่ขึ้นตามเบรกพอยต์
 * ไม่ใช่กระโดดกลับเต็มขนาดที่ `sm:`
 */
function valueSize(value: ReactNode): string {
  const len = typeof value === 'string' || typeof value === 'number' ? String(value).length : 0
  if (len >= 12) return 'text-xl md:text-2xl xl:text-3xl'
  if (len >= 10) return 'text-2xl lg:text-3xl'
  return 'text-3xl'
}

export function Metric({
  label,
  value,
  unit,
  hint,
  icon: Icon,
  tone = 'default',
  href,
}: {
  label: string
  value: ReactNode
  unit?: string
  hint?: string
  icon?: LucideIcon
  tone?: MetricTone
  href?: string
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-token">
        {Icon && <Icon className="size-3.5 shrink-0" strokeWidth={2} />}
        <span className="truncate">{label}</span>
      </div>
      {/* tnum: these get scanned vertically against each other */}
      <div className={`mt-0.5 text-center font-bold tracking-tight tnum ${valueSize(value)} ${VALUE_TONE[tone]}`}>
        {value}
        {unit && <span className="ml-1 text-sm font-normal tracking-normal text-muted-token">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 truncate text-center text-xs text-muted-token">{hint}</div>}
    </>
  )

  // min-w-0 — without it a long label refuses to truncate and widens the cell
  const cls = 'min-w-0 border-b border-r border-line-soft px-3.5 py-3 last:border-r-0 sm:border-b-0 md:px-4'

  return href ? (
    <Link href={href} className={`${cls} transition-colors duration-100 hover:bg-surface-2`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}
