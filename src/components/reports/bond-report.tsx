import Link from 'next/link'
import { BarChart3, ShieldCheck } from 'lucide-react'
import { fmtBaht, fmtDate } from '@/lib/format'
import {
  BOND_KIND_LABEL, BOND_SOON_DAYS, BOND_STATUS_LABEL, BOND_STATUS_TONE, isBondStatus,
  type BondKind, type BondStatus,
} from '@/lib/bonds'
import { Badge } from '@/components/ui/badge'
import { Metric, MetricBar } from '@/components/ui/metric'
import { EmptyState } from '@/components/ui/states'

/** แถวจาก RPC `bond_status` หลังแปลงตัวเลขแล้ว */
export type BondRow = {
  site_id: string
  site_name: string
  contract_no: string | null
  contract_amount: number
  bond_kind: BondKind | null
  bond_amount: number
  bond_ref: string | null
  handover_date: string | null
  warranty_end: string | null
  bond_returned_at: string | null
  bond_returned_amount: number | null
  days_left: number | null
  status: BondStatus
}

export type BondSummary = {
  overdueCount: number
  overdueAmount: number
  dueSoonCount: number
  dueSoonAmount: number
}

/** แท็บของหน้ารายงาน — รายงานการเงิน (ตามช่วงเวลา) กับ หลักประกันสัญญา (ตามสถานะ) */
export function ReportTabs({ active, periodKey }: { active: 'money' | 'bonds'; periodKey: string }) {
  const tabs = [
    { key: 'money', label: 'รายงานการเงิน', icon: BarChart3, href: `/reports?p=${periodKey}` },
    { key: 'bonds', label: 'หลักประกันสัญญา', icon: ShieldCheck, href: `/reports?tab=bonds&p=${periodKey}` },
  ] as const
  return (
    <div role="tablist" aria-label="ประเภทรายงาน" className="-mx-1 mb-4 flex overflow-x-auto border-b border-line px-1 no-scrollbar">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          role="tab"
          aria-selected={active === t.key}
          className={`-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors duration-100 ${
            active === t.key
              ? 'border-ink font-semibold text-ink'
              : 'border-transparent font-medium text-muted-token hover:text-ink'
          }`}
        >
          <t.icon className="size-4" strokeWidth={1.8} />
          {t.label}
        </Link>
      ))}
    </div>
  )
}

/** วันที่เหลือ/เลย เป็นประโยคที่คนอ่านแล้วรู้ว่าต้องทำอะไร */
function dueText(r: BondRow): string {
  if (r.status === 'returned') return `ได้คืน ${fmtDate(r.bond_returned_at)}`
  if (r.status === 'pending_handover') return 'ยังไม่ระบุวันส่งมอบ'
  if (r.days_left === null) return ''
  if (r.days_left < 0) return `เลยมาแล้ว ${Math.abs(r.days_left)} วัน`
  if (r.days_left === 0) return 'ครบวันนี้'
  return `อีก ${r.days_left} วัน`
}

const GROUPS: { status: BondStatus; title: string; hint: string }[] = [
  { status: 'overdue', title: 'ครบประกันแล้ว — รอทวงคืน', hint: 'ไปขอหลักประกันคืนได้เลย' },
  { status: 'due_soon', title: `ใกล้ครบประกัน (ไม่เกิน ${BOND_SOON_DAYS} วัน)`, hint: 'เตรียมเอกสารขอคืน' },
  { status: 'in_warranty', title: 'อยู่ในระยะประกันผลงาน', hint: '' },
  { status: 'pending_handover', title: 'ยังไม่ส่งมอบงวดสุดท้าย', hint: 'ใส่วันส่งมอบในหน้าโครงการเพื่อให้ระบบนับวันครบให้' },
  { status: 'returned', title: 'ได้รับคืนแล้ว', hint: '' },
]

/**
 * แท็บ "หลักประกันสัญญา" — เรียงตามความเร่งด่วน: รอทวงคืนอยู่บนสุด
 *
 * ตัวเลขสรุปมาจาก RPC `bond_summary` (นับในฐานข้อมูล) · แถวมาจาก `bond_status`
 * ซึ่งจัดลำดับมาให้แล้ว · ที่นี่แค่แบ่งกลุ่มตามสถานะเพื่อให้กวาดตาได้
 */
export function BondReport({ rows, summary }: { rows: BondRow[]; summary: BondSummary }) {
  const withBond = rows.filter((r) => r.status !== 'none')
  if (withBond.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        message="ยังไม่มีโครงการที่ตั้งหลักประกันสัญญาไว้ — ใส่เลขที่สัญญา ชนิด ยอด และวันส่งมอบในกล่อง “แก้ไข” ของหน้าโครงการ"
        action={<Link href="/sites" className="btn-primary">ไปหน้าโครงการ</Link>}
      />
    )
  }

  const returnedTotal = withBond
    .filter((r) => r.status === 'returned')
    .reduce((s, r) => s + (r.bond_returned_amount ?? r.bond_amount), 0)
  const heldTotal = withBond
    .filter((r) => r.status === 'in_warranty' || r.status === 'due_soon' || r.status === 'overdue' || r.status === 'pending_handover')
    .reduce((s, r) => s + r.bond_amount, 0)

  return (
    <>
      <MetricBar>
        <Metric
          label="ครบแล้ว รอทวงคืน"
          value={fmtBaht(summary.overdueAmount)}
          tone={summary.overdueCount > 0 ? 'urgent' : 'default'}
          hint={summary.overdueCount > 0 ? `${summary.overdueCount} งาน — ไปขอคืนได้เลย` : 'ไม่มีงานค้าง'}
        />
        <Metric
          label={`ใกล้ครบใน ${BOND_SOON_DAYS} วัน`}
          value={fmtBaht(summary.dueSoonAmount)}
          tone={summary.dueSoonCount > 0 ? 'progress' : 'default'}
          hint={summary.dueSoonCount > 0 ? `${summary.dueSoonCount} งาน` : 'ยังไม่มี'}
        />
        <Metric label="ถูกหักไว้ทั้งหมด" value={fmtBaht(heldTotal)} hint="ยังไม่ได้คืน รวมทุกสถานะ" />
        <Metric label="ได้คืนแล้ว" value={fmtBaht(returnedTotal)} tone="done" hint="ยอดที่ได้รับคืนจริง" />
      </MetricBar>

      <div className="space-y-4">
        {GROUPS.map((g) => {
          const items = withBond.filter((r) => r.status === g.status)
          if (items.length === 0) return null
          return (
            <section
              key={g.status}
              className={`panel ${
                g.status === 'overdue' ? 'border-urgent-ring' : g.status === 'due_soon' ? 'border-status-progress-ring' : ''
              }`}
            >
              <div className="panel-head">
                <Badge tone={BOND_STATUS_TONE[g.status]} dot>{BOND_STATUS_LABEL[g.status]}</Badge>
                <span className="min-w-0 truncate">{g.title}</span>
                <span className="ml-auto shrink-0 text-xs font-normal tnum text-muted-token">
                  {items.length} งาน · {fmtBaht(items.reduce((s, r) => s + r.bond_amount, 0))}
                </span>
              </div>
              {g.hint && (
                <p className="border-b border-line-soft px-4 py-1.5 text-xs text-muted-token">{g.hint}</p>
              )}
              <ul>
                {items.map((r) => (
                  <li key={r.site_id} className="border-b border-line-soft last:border-b-0">
                    <Link
                      href={`/sites/${r.site_id}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3.5 py-2.5 transition-colors duration-100 hover:bg-surface-2 md:px-4"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{r.site_name}</span>
                        <span className="block truncate text-xs text-muted-token">
                          {r.contract_no ? `สัญญา ${r.contract_no} · ` : ''}
                          {r.bond_kind ? BOND_KIND_LABEL[r.bond_kind] : ''}
                          {r.handover_date ? ` · ส่งมอบ ${fmtDate(r.handover_date)}` : ''}
                          {r.warranty_end ? ` · ครบ ${fmtDate(r.warranty_end)}` : ''}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block text-base font-bold tnum text-ink">{fmtBaht(r.bond_amount)}</span>
                        <span
                          className={`block text-xs tnum ${
                            r.status === 'overdue'
                              ? 'font-semibold text-urgent'
                              : r.status === 'due_soon'
                                ? 'font-semibold text-status-progress'
                                : 'text-muted-token'
                          }`}
                        >
                          {dueText(r)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      <p className="mt-3 rounded-lg border border-line-soft bg-surface-2 px-4 py-3 text-xs text-muted-token">
        วันครบประกัน = วันส่งมอบงวดสุดท้าย + ระยะประกันผลงาน (ค่าเริ่มต้น 24 เดือน แก้ได้รายโครงการ)
        · ทวงคืนได้ตั้งแต่วันถัดจากวันครบ · เงินสดที่ได้คืนถูกลงเป็นรายรับของโครงการนั้นในหมวด “หลักประกันสัญญาคืน”
      </p>
    </>
  )
}

/** แปลงแถวดิบจาก RPC ให้เป็นตัวเลขจริง — RPC คืน numeric เป็น number อยู่แล้ว แต่ status เป็น text */
export function toBondRow(r: {
  site_id: string
  site_name: string
  contract_no: string | null
  contract_amount: number
  bond_kind: BondKind | null
  bond_amount: number
  bond_ref: string | null
  handover_date: string | null
  warranty_end: string | null
  bond_returned_at: string | null
  bond_returned_amount: number | null
  days_left: number | null
  status: string
}): BondRow {
  return {
    ...r,
    contract_amount: Number(r.contract_amount ?? 0),
    bond_amount: Number(r.bond_amount ?? 0),
    bond_returned_amount: r.bond_returned_amount === null ? null : Number(r.bond_returned_amount),
    status: isBondStatus(r.status) ? r.status : 'none',
  }
}
