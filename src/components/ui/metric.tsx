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
  /** จำนวนคอลัมน์บนจอเล็ก — แถบ 3 ช่องใช้ 3 จะได้ไม่เหลือช่องว่างครึ่งแถว */
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
      <div className={`mt-0.5 text-center text-3xl font-bold tracking-tight tnum ${VALUE_TONE[tone]}`}>
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
