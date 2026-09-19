import Link from 'next/link'
import { HardHat, UserRound } from 'lucide-react'
import { fmtBaht } from '@/lib/format'
import { EmptyState } from '@/components/ui/states'
import type { AdjustPreset } from '@/lib/wage-adjustments'
import { SiteWageButton, SiteWageProvider, type WageDay, type WageRowKey } from './site-wage-edit'

export type WorkRow = {
  employee_id: string
  full_name: string
  job_title: string | null
  site_id: string
  site_name: string
  /** วันแรงของคนนี้ที่โครงการนี้ (ครึ่งวัน = 0.5) — เอาไปคูณค่าแรง */
  days: number
  /** `null` = ไม่มีสิทธิ์เห็นยอดเงิน — ไม่ใช่ ฿0 */
  amount: number | null
  /** โครงการนี้มีคนเข้าทำงานกี่วัน (นับวันไม่ซ้ำ) */
  site_work_days: number
  /** คนนี้มาทำงานกี่วัน (นับวันไม่ซ้ำ ข้ามทุกโครงการ) */
  employee_work_days: number
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
 * · ปุ่มดินสอท้ายแถว (แก้ค่าแรงที่จ่ายจริง — R10) เป็น client island ใบเล็ก
 *   ที่คุยกับ provider ตัวเดียวซึ่งถือกล่องแก้ไขไว้ตัวเดียวต่อหน้า
 */
export function SiteHistory({
  rows,
  view,
  monthKey,
  details,
  presets,
}: {
  rows: WorkRow[]
  view: 'person' | 'site'
  /** ค่า `?p=` ที่กำลังดูอยู่ — ติดไปกับลิงก์สลับมุมมองเสมอ */
  monthKey: string
  /** รายวันของแต่ละ คน×โครงการ — ป้อนกล่องแก้ค่าแรง */
  details: Record<WageRowKey, WageDay[]>
  /** รายการปรับสำเร็จรูปที่เปิดอยู่ — ป้อนกล่องปรับ OT/เบี้ยเลี้ยง/หัก */
  presets: AdjustPreset[]
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
  const groups = new Map<
    string,
    { title: string; sub: string | null; workDays: number; rows: WorkRow[] }
  >()
  for (const r of rows) {
    const key = byPerson ? r.employee_id : r.site_id
    const g = groups.get(key)
    if (g) g.rows.push(r)
    else {
      groups.set(key, {
        title: byPerson ? r.full_name : r.site_name,
        sub: byPerson ? r.job_title : null,
        // 🔴 **นับวันจริง ไม่ใช่บวก `days` ของทุกแถว** — 8 คนมาทำงาน 4 วัน
        // เท่ากับโครงการเดินไป 4 วัน ไม่ใช่ 29 วัน (เจ้าของแจ้ง 4 ก.ย. 2569)
        // ค่านี้มาจาก count(distinct work_date) ในฐานข้อมูล เพราะแถวที่ส่งมา
        // เป็นระดับ คน×โครงการ ซึ่งบอกไม่ได้ว่าวันซ้ำกันหรือเปล่า
        workDays: byPerson ? r.employee_work_days : r.site_work_days,
        rows: [r],
      })
    }
  }

  const list = [...groups.values()]
  // มุมมองรายโครงการ: โครงการที่ใช้คนเยอะสุดอยู่บนสุด — ไม่ใช่เรียงตามชื่อคน
  if (!byPerson) {
    list.sort((a, b) => b.workDays - a.workDays || sumDays(b.rows) - sumDays(a.rows))
    for (const g of list) g.rows.sort((a, b) => b.days - a.days)
  }

  return (
    <SiteWageProvider details={details} presets={presets}>
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
                {/* คำว่า "ทำงาน N วัน" ไม่ใช่ "รวม N วัน" — "รวม" ชวนให้อ่านว่า
                    เป็นผลบวกของตัวเลขในแถวข้างล่าง ซึ่งมันไม่ใช่ · จำนวนคน/โครงการ
                    ต่อท้ายไว้ตอบว่าแถวข้างล่างมาจากไหน */}
                <span className="ml-auto shrink-0 text-xs font-normal tnum text-muted-token">
                  ทำงาน {g.workDays} วัน · {g.rows.length} {byPerson ? 'โครงการ' : 'คน'}
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
                      <span className="w-20 shrink-0 text-right text-sm tnum text-muted-token">
                        {fmtBaht(r.amount)}
                      </span>
                    )}
                    {/* แก้ค่าแรงที่จ่ายจริง — เฉพาะแถวที่ยังมีวันค้างจ่าย · จ่ายแล้วเป็นกุญแจ */}
                    {r.amount !== null && (
                      <SiteWageButton
                        employeeId={r.employee_id}
                        siteId={r.site_id}
                        personName={r.full_name}
                        siteName={r.site_name}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      <p className="mt-3 rounded-lg border border-line-soft bg-surface-2 px-4 py-3 text-xs text-muted-token">
        <b>ทำงาน N วัน</b> บนหัวข้อคือ<span className="font-medium text-ink-2">จำนวนวันที่มีคนเข้าทำงานจริง</span>{' '}
        (นับวันไม่ซ้ำ) ไม่ใช่ผลบวกของแถวข้างล่าง — 8 คนมาวันเดียวกันคือ 1 วัน
        · ตัวเลขในแต่ละแถวเป็นวันแรงของคนนั้น ครึ่งวันนับเป็น 0.5
        · ยอดเงินคือ<span className="font-medium text-ink-2">ค่าแรงที่เกิดขึ้น</span>{' '}
        ไม่ใช่เงินที่จ่ายออกไปแล้ว
        · ดินสอท้ายแถว = แก้ค่าแรงที่จ่ายจริง / OT / เบี้ยเลี้ยง / รายการหัก ของวันที่ยังไม่จ่าย
      </p>
    </SiteWageProvider>
  )
}

const sumDays = (rows: WorkRow[]) => rows.reduce((s, r) => s + r.days, 0)

/** `null` ทั้งกลุ่ม = ไม่มีสิทธิ์เห็นเงิน — ไม่ใช่บวกกันได้ ฿0 */
const sumAmount = (rows: WorkRow[]) =>
  rows.some((r) => r.amount === null) ? null : rows.reduce((s, r) => s + (r.amount ?? 0), 0)
