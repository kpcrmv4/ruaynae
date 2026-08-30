import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * One row of any list — the single row shape for the whole app.
 *
 * WHY THIS EXISTS. The obvious spelling is `flex flex-wrap` with a `flex-1`
 * text column. It looks fine until a row carries badges or buttons on a phone.
 * `flex-1` is `flex: 1 1 0%` — basis ZERO — so the item can never be wider than
 * its share of the row and `flex-wrap` never fires. It just keeps shrinking.
 * Two badges plus two buttons leave the text column ~40–98px wide, and Thai has
 * no word spaces, so the browser breaks INSIDE the word: one syllable per line.
 * Users report that as "the font is broken", which sends you to the wrong file.
 *
 * grid + `col-span` fixes the cause: on a phone the trailing content is pushed
 * onto its own line instead of competing with the text; at ≥sm it rejoins the
 * row. `minmax(0,1fr)` not `1fr` — a bare `1fr` is `minmax(auto,1fr)` and
 * inherits the same refusal to shrink.
 */
export function ListRow({
  href,
  title,
  meta,
  aside,
  chevron,
}: {
  /** whole row becomes a link. Do NOT set this when `aside` contains a button —
   *  a button nested in a link navigates instead of doing its own job. */
  href?: string
  title: ReactNode
  meta?: ReactNode
  /** badges / buttons / figures — drops to its own full-width line on phones */
  aside?: ReactNode
  chevron?: boolean
}) {
  const showChevron = chevron ?? Boolean(href)

  const body = (
    <>
      <div className="order-1 min-w-0">
        <div className="truncate text-base font-semibold leading-6 text-ink">{title}</div>
        {meta && <div className="text-sm leading-5 text-muted-token">{meta}</div>}
      </div>

      {aside && (
        <div className="order-3 col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:order-2 sm:col-span-1 sm:justify-end">
          {aside}
        </div>
      )}

      {showChevron && <ChevronRight className="order-2 size-4 flex-none text-muted-token sm:order-3" />}
    </>
  )

  const cls = [
    'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5',
    'border-b border-line-soft px-3.5 py-2.5 last:border-b-0 md:px-4',
    'sm:grid-cols-[minmax(0,1fr)_auto_auto]',
  ].join(' ')

  return href ? (
    <Link href={href} className={`${cls} transition-colors duration-100 hover:bg-surface-2`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}
