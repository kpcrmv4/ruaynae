import Link from 'next/link'
import { ArrowRight, ShieldAlert, ShieldCheck } from 'lucide-react'
import { fmtBaht } from '@/lib/format'
import { BOND_SOON_DAYS } from '@/lib/bonds'

/**
 * แถบเตือนหลักประกันสัญญาบนหน้าแรก — เจ้าของเท่านั้น (คำสั่งเจ้าของ 19 ก.ย. 2569:
 * "ใกล้ถึงให้แสดงแจ้งเตือนที่หน้าแรกด้วย ให้ดูเด่น ๆ รวมถึงรายการที่เกินด้วย")
 *
 * · เกินแล้ว = แดง (เงินที่ควรได้คืนแต่ยังไม่ได้ไปทวง) · ใกล้ครบ = ส้ม
 * · ไม่มีทั้งสองอย่าง = ไม่วาดอะไรเลย — แถบที่ขึ้นทุกวันคือแถบที่คนเลิกอ่าน
 * · ทั้งใบเป็นลิงก์ไปแท็บหลักประกันในหน้ารายงาน ซึ่งเรียงรอทวงคืนไว้บนสุด
 */
export function BondAlert({
  overdueCount,
  overdueAmount,
  dueSoonCount,
  dueSoonAmount,
}: {
  overdueCount: number
  overdueAmount: number
  dueSoonCount: number
  dueSoonAmount: number
}) {
  if (overdueCount === 0 && dueSoonCount === 0) return null
  const urgent = overdueCount > 0
  return (
    <Link
      href="/reports?tab=bonds"
      className={`mb-5 flex items-center gap-3 rounded-lg border-2 px-4 py-3.5 transition-colors duration-100 ${
        urgent
          ? 'border-urgent bg-urgent-bg hover:border-urgent-solid'
          : 'border-status-progress bg-status-progress-bg hover:border-status-progress-ring'
      }`}
    >
      {urgent ? (
        <ShieldAlert className="size-7 shrink-0 text-urgent" strokeWidth={1.8} aria-hidden />
      ) : (
        <ShieldCheck className="size-7 shrink-0 text-status-progress" strokeWidth={1.8} aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span className={`block text-base font-bold leading-6 ${urgent ? 'text-urgent' : 'text-status-progress'}`}>
          {urgent
            ? `หลักประกันสัญญาครบกำหนดแล้ว ${overdueCount} งาน · ${fmtBaht(overdueAmount)}`
            : `หลักประกันสัญญาใกล้ครบ ${dueSoonCount} งาน · ${fmtBaht(dueSoonAmount)}`}
        </span>
        <span className="block text-sm text-ink-2">
          {urgent
            ? `ไปขอหลักประกันคืนได้เลย${dueSoonCount > 0 ? ` · และอีก ${dueSoonCount} งานจะครบใน ${BOND_SOON_DAYS} วัน (${fmtBaht(dueSoonAmount)})` : ''}`
            : `จะครบประกันผลงานภายใน ${BOND_SOON_DAYS} วัน — เตรียมเอกสารขอคืน`}
        </span>
      </span>
      <ArrowRight className={`size-5 shrink-0 ${urgent ? 'text-urgent' : 'text-status-progress'}`} aria-hidden />
    </Link>
  )
}
