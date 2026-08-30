import Link from 'next/link'
import { Search } from 'lucide-react'

export type FilterChip = { key: string; label: string; count?: number }

/**
 * Search box + filter chips for a list page.
 *
 * NO CLIENT STATE, NO 'use client'. Search is a `<form method="get">`, filters
 * are `<Link>`s, and the whole state of the view lives in the URL
 * (`?status=pending&q=abc`). What that buys, in order of how much it matters:
 *
 *   - the page stays a Server Component, so the filtered query runs in the DB
 *     and the client is never shipped the unfiltered rows;
 *   - a filtered view is a link — shareable, bookmarkable, pasteable into chat;
 *   - Back does the right thing without any work;
 *   - no loading flash and no state to keep in sync on navigation.
 *
 * COLOUR RULE, and it is the thing that makes an admin UI look designed rather
 * than assembled: the selected chip is INK, not the brand colour. A filter is
 * not the primary action of the page. Reserve the brand fill for controls that
 * create data. Every project that paints its filters brand-orange ends up with
 * a screen where six things shout equally and the actual primary button is
 * invisible among them.
 *
 * Chips come before the search box on wide screens because they are pressed far
 * more often than anything is typed.
 */
export function ListToolbar({
  basePath,
  q,
  filters,
  activeFilter,
  filterParam = 'status',
  placeholder = 'ค้นหา…',
  searchLabel = 'ค้นหา',
}: {
  basePath: string
  q: string
  filters: readonly FilterChip[]
  activeFilter: string
  filterParam?: string
  placeholder?: string
  searchLabel?: string
}) {
  return (
    <div className="mb-4 flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
      {/* phones: one scrolling strip (the scrollbar itself is noise, hence
          .no-scrollbar). ≥md: wrap normally, nothing to scroll. */}
      <div className="-mx-1 flex flex-nowrap gap-1.5 overflow-x-auto px-1 pb-1 no-scrollbar md:flex-wrap md:overflow-visible md:pb-0">
        {filters.map((f) => {
          const params = new URLSearchParams()
          if (f.key !== 'all') params.set(filterParam, f.key)
          if (q) params.set('q', q)
          const href = params.toString() ? `${basePath}?${params}` : basePath
          const active = activeFilter === f.key
          return (
            <Link
              key={f.key}
              href={href}
              aria-current={active ? 'true' : undefined}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-sm font-medium leading-5 transition-colors duration-100 ${
                active
                  ? 'border-ink bg-ink text-canvas'
                  : 'border-line-strong bg-surface text-ink-2 hover:border-ink-2 hover:text-ink'
              }`}
            >
              {f.label}
              {/* the count belongs ON the chip — otherwise choosing a filter is
                  a guess about whether it has anything in it */}
              {f.count !== undefined && (
                <span
                  className={`rounded-xs px-1 text-xs font-semibold tnum ${
                    active ? 'bg-canvas/20 text-canvas' : 'bg-surface-3 text-muted-token'
                  }`}
                >
                  {f.count}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      <form action={basePath} method="get" className="flex shrink-0 gap-2 md:w-[19rem]">
        {/* keep the active filter when searching, or typing silently resets it */}
        {activeFilter !== 'all' && <input type="hidden" name={filterParam} value={activeFilter} />}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-token" />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={placeholder}
            aria-label={placeholder}
            className="input-base py-2 pl-8.5"
          />
        </div>
        <button type="submit" className="btn-secondary shrink-0 px-3 py-2">
          {searchLabel}
        </button>
      </form>
    </div>
  )
}
