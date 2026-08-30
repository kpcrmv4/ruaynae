import type { ReactNode } from 'react'

export type BadgeTone = 'pending' | 'progress' | 'done' | 'info' | 'urgent' | 'brand'

/**
 * THREE VALUES, ALWAYS: text / background / ring.
 *
 * A badge with only text+background dissolves at its edges on a grey surface,
 * and when several sit in one row they merge into a single smear of colour —
 * you cannot tell how many there are without counting words. The 1px inset ring
 * is what makes each one read as a discrete object on both --surface and
 * --canvas.
 *
 * SEMANTIC ASSIGNMENT, fixed for the whole app — two things a user must never
 * confuse get different hues permanently, and the hue is never chosen per page:
 *   done      complete · in stock · available
 *   progress  waiting · expiring soon
 *   urgent    overdue · short · blocked
 *   info      a distinct CATEGORY of record, not a state
 *   pending   not started
 *   brand     the item currently open, or the category the brand stands for
 */
const TONE: Record<BadgeTone, string> = {
  pending: 'text-status-pending bg-status-pending-bg ring-status-pending-ring',
  progress: 'text-status-progress bg-status-progress-bg ring-status-progress-ring',
  done: 'text-status-done bg-status-done-bg ring-status-done-ring',
  info: 'text-status-info bg-status-info-bg ring-status-info-ring',
  urgent: 'text-urgent bg-urgent-bg ring-urgent-ring',
  brand: 'text-brand-on-tint bg-brand-tint ring-brand-tint-strong',
}

const DOT: Record<BadgeTone, string> = {
  pending: 'bg-status-pending',
  progress: 'bg-status-progress',
  done: 'bg-status-done',
  info: 'bg-status-info',
  urgent: 'bg-urgent',
  brand: 'bg-brand',
}

export function Badge({
  tone = 'pending',
  dot = false,
  children,
}: {
  tone?: BadgeTone
  /** leading dot — for dense tables where the same status is scanned vertically */
  dot?: boolean
  children: ReactNode
}) {
  return (
    <span className={`chip ${TONE[tone]}`}>
      {dot && <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${DOT[tone]}`} />}
      {children}
    </span>
  )
}

/**
 * The lightest possible status: a coloured dot and ordinary text, no fill.
 * Use it in a row that already carries one badge — two filled chips side by side
 * compete, and neither wins.
 */
export function StatusDot({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-ink-2">
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[tone]}`} />
      {children}
    </span>
  )
}
