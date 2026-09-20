import Link from 'next/link'
import { fmtBaht, fmtDate } from '@/lib/format'
import { DOC_KIND_SHORT, DOC_STATUS_LABEL, DOC_STATUS_TONE } from '@/lib/documents'
import { Badge } from '@/components/ui/badge'
import type { Database } from '@/lib/database.types'

type Kind = Database['public']['Enums']['doc_kind']
type Status = Database['public']['Enums']['doc_status']

export type DocRowData = {
  id: string
  kind: Kind
  doc_no: string | null
  status: Status
  doc_date: string
  customer_name: string
  total: number | string
  siteName?: string | null
}

/**
 * แถวเอกสารหนึ่งใบ — ใช้ทั้ง `/documents` และกล่องเอกสารในหน้าโครงการ
 *
 * เขียนที่เดียวเพราะสองที่จะเพี้ยนจากกันทันทีที่มีคนเพิ่มสถานะแล้วแก้แค่ที่เดียว
 * · `showSite` ปิดในหน้าโครงการ (ทุกแถวเป็นโครงการเดียวกันอยู่แล้ว)
 * ส่วน `showKind` เปิดในหน้าโครงการ เพราะที่นั่นใบเสนอราคากับใบเสร็จปนกัน
 */
export function DocRow({
  doc,
  showSite = true,
  showKind = false,
}: {
  doc: DocRowData
  showSite?: boolean
  showKind?: boolean
}) {
  return (
    <li className="border-b border-line-soft last:border-b-0">
      <Link
        href={`/documents/${doc.id}`}
        className="flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-surface-2 md:px-4"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold tnum text-ink">{doc.doc_no ?? 'ยังไม่ออกเลข'}</span>
            <Badge tone={DOC_STATUS_TONE[doc.status]} dot>
              {DOC_STATUS_LABEL[doc.status]}
            </Badge>
            {showKind && (
              <span className="text-xs text-muted-token">{DOC_KIND_SHORT[doc.kind]}</span>
            )}
          </div>
          <span className="mt-0.5 block truncate text-sm text-ink-2">{doc.customer_name}</span>
          <span className="block truncate text-xs text-muted-token">
            {fmtDate(doc.doc_date)}
            {showSite ? (doc.siteName ? ` · ${doc.siteName}` : ' · ไม่ผูกโครงการ') : ''}
          </span>
        </div>
        <span className="shrink-0 text-right tnum font-semibold text-ink">
          {fmtBaht(Number(doc.total))}
        </span>
      </Link>
    </li>
  )
}
