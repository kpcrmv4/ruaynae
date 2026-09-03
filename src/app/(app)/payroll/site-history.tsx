import Link from 'next/link'
import { HardHat, UserRound } from 'lucide-react'
import { fmtBaht } from '@/lib/format'
import { EmptyState } from '@/components/ui/states'

export type WorkRow = {
  employee_id: string
  full_name: string
  job_title: string | null
  site_id: string
  site_name: string
  days: number
  /** `null` = ไม่มีสิทธิ์เห็นยอดเงิน — ไม่ใช่ ฿0 */
  amount: number | null
}

/**
 * "เดือนนี้ใครทำงานที่โครงการไหนบ้าง" — ข้อมูลชุดเดียว สองมุมมอง
 *
 * 🔴 สองมุมมองตอบคนละคำถาม และเจ้าของถามทั้งสองข้อจริง ๆ:
 *   รายคน     — "สมชายเดือนนี้ไปไหนมาบ้าง กี่วัน" (ใช้ตอนคนมาทวงค่าแรง)
 *   รายโครงการ — "โครงการนี้เดือนนี้ใช้คนไปกี่คน กี่วัน" (ใช้ตอนดูว่าต้นทุนมาจากไหน)
 * ยุบเหลือมุมมองเดียวแล้วอีกคำถามหนึ่งต้องมานั่งไล่บวกเอง
 *
 * Server Component — สลับมุมมองด้วยลิงก์ ไม่ใช่ state ฝั่ง client
 */
export function SiteHistory({
  rows,
  view,
  monthKey,
}: {
  rows: WorkRow[]
  view: 'person' | 'site'
  /** ค่า `?p=` ที่กำลังดูอยู่ — ติดไปกับลิงก์สลับมุมมองเสมอ */
  monthKey: string
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={UserRound}
        message="เดือนนี้ยังไม่มีใครถูกลงชื่อเข้าโครงการ — เลือกเดือนอื่น หรือไปลงชื่อที่หน้าคนเข้าโครงการ"
      />
    )
  }

  // จัดกลุ่มตามมุมมองที่เลือก — แถวเรียงมาจากฐานข้อมูลแล้ว
  const byPerson = view === 'person'
  const groups = new Map<string, { title: string; sub: string | null; rows: WorkRow[] }>()
  for (const r of rows) {
    const key = byPerson ? r.employee_id : r.site_id
    const g = groups.get(key)
    if (g) g.rows.push(r)
    else {
      groups.set(key, {
        title: byPerson ? r.full_name : r.site_name,
        sub: byPerson ? r.job_title : null,
        rows: [r],
      })
    }
  }

  const list = [...groups.values()]
  // มุมมองรายโครงการ: โครงการที่ใช้คนเยอะสุดอยู่บนสุด — ไม่ใช่เรียงตามชื่อคน
  if (!byPerson) {
    list.sort((a, b) => sumDays(b.rows) - sumDays(a.rows))
    for (const g of list) g.rows.sort((a, b) => b.days - a.days)
  }

  return (
    <>
      <div className="mb-3 flex gap-1.5">
        {(
          [
            { key: 'person', label: 'รายคน', icon: UserRound },
            { key: 'site', label: 'รายโครงการ', icon: HardHat },
          ] as const
        ).map((v) => (
          <Link
            key={v.key}
            href={`/payroll?tab=sites&p=${monthKey}${v.key === 'site' ? '&view=site' : ''}`}
            aria-current={view === v.key ? 'true' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-sm font-medium transition-colors duration-100 ${
              view === v.key
                ? 'border-ink bg-ink text-canvas'
                : 'border-line-strong bg-surface text-ink-2 hover:border-ink-2 hover:text-ink'
            }`}
          >
            <v.icon className="size-4" />
            {v.label}
          </Link>
        ))}
      </div>

      <div className="space-y-3">
        {list.map((g) => {
          const days = sumDays(g.rows)
          const money = sumAmount(g.rows)
          return (
            <section key={g.title} className="panel">
              <div className="panel-head">
                <span className="min-w-0 truncate">
                  {g.title}
                  {g.sub && (
                    <span className="ml-1.5 text-xs font-normal text-muted-token">{g.sub}</span>
                  )}
                </span>
                <span className="ml-auto shrink-0 text-xs font-normal tnum text-muted-token">
                  รวม {days} วัน
                  {money !== null && ` · ${fmtBaht(money)}`}
                </span>
              </div>
              <ul>
                {g.rows.map((r) => (
                  <li
                    key={`${r.employee_id}-${r.site_id}`}
                    className="flex items-center gap-3 border-b border-line-soft px-3.5 py-2.5 last:border-b-0 md:px-4"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {byPerson ? r.site_name : r.full_name}
                      {!byPerson && r.job_title && (
                        <span className="ml-1.5 text-xs text-muted-token">{r.job_title}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-sm tnum font-semibold text-ink">{r.days} วัน</span>
                    {r.amount !== null && (
                      <span className="w-24 shrink-0 text-right text-sm tnum text-muted-token">
                        {fmtBaht(r.amount)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      <p className="mt-3 rounded-lg border border-line-soft bg-surface-2 px-4 py-3 text-xs text-muted-token">
        นับจากการลงชื่อเข้าโครงการของเดือนที่เลือก · คนที่ทำครึ่งวันนับเป็น 0.5 วัน
        · ยอดเงินคือ<span className="font-medium text-ink-2">ค่าแรงที่เกิดขึ้น</span>{' '}
        ไม่ใช่เงินที่จ่ายออกไปแล้ว
      </p>
    </>
  )
}

const sumDays = (rows: WorkRow[]) => rows.reduce((s, r) => s + r.days, 0)

/** `null` ทั้งกลุ่ม = ไม่มีสิทธิ์เห็นเงิน — ไม่ใช่บวกกันได้ ฿0 */
const sumAmount = (rows: WorkRow[]) =>
  rows.some((r) => r.amount === null) ? null : rows.reduce((s, r) => s + (r.amount ?? 0), 0)
