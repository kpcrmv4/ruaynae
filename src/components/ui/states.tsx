import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'

/**
 * Every data view ships all four states: skeleton / error+retry / empty / success.
 *
 * NO 'use client' IN THIS FILE. `EmptyState` takes a `LucideIcon` as a prop, and
 * a Client Component cannot receive a component reference from a Server
 * Component ("Only plain objects can be passed to Client Components"). The
 * classic way to break this is to put the retry card — which needs onClick — in
 * the same file; the directive then applies to everything here. Keep the
 * interactive one in its own file (`error-retry.tsx`).
 *
 * Skeletons must match the SHAPE of what loads, not be generic grey bars — a
 * skeleton of the wrong shape produces a layout shift on arrival, which reads
 * as slower than no skeleton at all.
 */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xs bg-line-soft ${className}`} />
}

/** matches <ListRow>: title line, meta line, one badge on the right */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="panel">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-5 w-16 rounded-xs" />
        </div>
      ))}
    </div>
  )
}

/** matches <MetricBar> exactly — same grid, same borders, same padding */
export function MetricSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="mb-6 grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface shadow-e1 sm:grid-flow-col sm:grid-cols-[repeat(auto-fit,minmax(0,1fr))]">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="min-w-0 space-y-2 border-b border-r border-line-soft px-3.5 py-3 last:border-r-0 sm:border-b-0 md:px-4"
        >
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-14" />
        </div>
      ))}
    </div>
  )
}

/**
 * An empty state says what would be here and how to put something here. "ไม่มีข้อมูล"
 * is a dead end — pass an `action` whenever the user is allowed to create the
 * missing thing.
 */
export function EmptyState({
  icon: Icon = Inbox,
  message,
  action,
}: {
  icon?: typeof Inbox
  message: string
  action?: ReactNode
}) {
  return (
    <div className="panel px-6 py-12 text-center">
      <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-surface-2 text-muted-token ring-1 ring-inset ring-line">
        <Icon className="size-5" strokeWidth={1.8} />
      </span>
      {/* max-w in ch — a message spanning the full width of a desktop panel is
          one very long line nobody finishes reading */}
      <p className="mx-auto mb-4 max-w-[46ch] text-base leading-6 text-muted-token">{message}</p>
      {action}
    </div>
  )
}
