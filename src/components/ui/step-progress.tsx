import type { LucideIcon } from 'lucide-react'
import { Check } from 'lucide-react'

export type ProgressStep = {
  key: string
  label: string
  icon: LucideIcon
  done: boolean
  /** the step being waited on right now — brand RING, never the green fill */
  current?: boolean
}

/**
 * Icon circles joined by connectors, for any document with a life cycle
 * (request → approve → order → receive).
 *
 * THREE STATES, THREE TREATMENTS — and `current` is the one everybody omits:
 *   done     green fill + check          "this happened"
 *   current  brand ring on brand tint    "everyone is waiting on this"
 *   future   grey outline                "not yet"
 * Without `current`, a half-finished document looks identical whether it is
 * sitting in someone's queue or blocked, and the list stops answering the only
 * question anybody opens it to ask.
 *
 * Same component at `size="sm"` inside a list row and full size on the detail
 * page, so the row and the page cannot drift apart.
 *
 * NO 'use client' — it takes `LucideIcon` props from Server Components. Define
 * the steps once in a shared module (`lib/<domain>-steps.ts`) and never inline
 * them per page; two copies of a step list diverge the first time one changes.
 */
export function StepProgress({
  steps,
  size = 'md',
  showLabels = true,
}: {
  steps: readonly ProgressStep[]
  size?: 'sm' | 'md'
  showLabels?: boolean
}) {
  const circle = size === 'sm' ? 'size-7' : 'size-9'
  const iconSize = size === 'sm' ? 'size-3.5' : 'size-4'

  return (
    <div className="w-full">
      <div className="flex items-center">
        {steps.map((step, i) => {
          const prev = steps[i - 1]
          // a connector is only "done" when BOTH ends are — otherwise a skipped
          // step reads as completed
          const lineDone = Boolean(prev?.done && step.done)
          const Icon = step.done ? Check : step.icon
          return (
            <div key={step.key} className={`flex items-center ${i === 0 ? '' : 'flex-1'}`}>
              {i > 0 && (
                <div
                  className={`h-0.5 flex-1 rounded-full ${lineDone ? 'bg-status-done' : 'bg-line'}`}
                  aria-hidden
                />
              )}
              <div
                title={step.label}
                className={`grid ${circle} shrink-0 place-items-center rounded-full border-2 transition-colors ${
                  step.done
                    ? 'border-status-done bg-status-done text-white'
                    : step.current
                      ? 'border-brand bg-brand-tint text-brand-on-tint'
                      : 'border-line bg-card text-muted-token'
                }`}
              >
                <Icon className={iconSize} strokeWidth={2.5} />
              </div>
            </div>
          )
        })}
      </div>

      {showLabels && (
        <div className="mt-1.5 flex items-start">
          {steps.map((step, i) => (
            <div
              key={step.key}
              className={`text-xs leading-4 ${
                i === 0 ? 'text-left' : i === steps.length - 1 ? 'flex-1 text-right' : 'flex-1 text-center'
              } ${
                step.done
                  ? 'font-semibold text-status-done'
                  : step.current
                    ? 'font-semibold text-brand-on-tint'
                    : 'text-muted-token'
              }`}
            >
              {step.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
