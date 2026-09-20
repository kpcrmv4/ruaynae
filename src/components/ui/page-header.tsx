import type { ReactNode } from 'react'
import { BackButton } from '@/components/ui/back-button'

/**
 * Page title + the page's own primary action.
 *
 * THE ACTION IS A PROP. Do not wrap `<PageHeader>` in another flex row to put a
 * button beside it — the header already owns that layout, and wrapping it makes
 * every other element in the header (theme toggle, bell, whatever the shell
 * puts there) jump to the wrong side. Anything global belongs in the top bar,
 * which every page has; only the action that belongs to THIS page comes here.
 *
 * Space above the title is always greater than space below it, so the title
 * binds to its own content instead of floating between two sections.
 */
export function PageHeader({
  title,
  subtitle,
  action,
  backHref = '/',
}: {
  title: string
  subtitle?: ReactNode
  action?: ReactNode
  /** ปลายทางตอนไม่มีประวัติให้ถอย (เปิดลิงก์ตรงเข้าหน้านี้) — ดู `BackButton` */
  backHref?: string
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold text-ink">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-muted-token">{subtitle}</div>}
      </div>
      {/*
        `shrink-0` keeps a Thai button label from being squeezed until it breaks
        mid-syllable — but `shrink-0` ALONE overflows the page when a header
        carries several buttons, and `overflow-x: clip` then eats the last one
        with no scrollbar to reveal it. Measured: a four-button header was 401px
        wide on a 390px screen and the rightmost button was simply gone.
        `max-w-full` + `flex-wrap` makes them wrap instead of vanish.
      */}
      {/* ปุ่มย้อนกลับอยู่ **ขวาสุดเสมอ** ต่อจากปุ่มของหน้านั้น (คำสั่งเจ้าของ 20 ก.ย. 2569)
          — อยู่ในนี้ ไม่ใช่ให้แต่ละหน้าใส่เอง หน้าที่ใช้ `PageHeader` จึงได้ปุ่มครบ
          โดยอัตโนมัติ และไม่มีทางมีหน้าไหนหล่นหาย */}
      <div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
        {action}
        <BackButton fallbackHref={backHref} />
      </div>
    </div>
  )
}
