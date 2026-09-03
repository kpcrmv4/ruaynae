import { AlertTriangle } from 'lucide-react'
import { fmtBaht } from '@/lib/format'
import { OVERRUN_LABEL, type CostSplit, type MoneyBars as Bars } from '@/lib/money'

/**
 * แถบ "เบิกเงินสะสม" และ "ต้นทุนสะสม" ต่อท้ายแถบเวลา (DESIGN.md §5.1)
 *
 * Server Component — ไม่มีอะไรต้องกด ไม่ต้องมี 'use client'
 *
 * 🔴 สามแถบต้องคนละสี เพราะเป็นคนละความหมาย: เวลาเดินไปเรื่อย ๆ เป็นเรื่องปกติ
 * แต่ต้นทุนแซงเงินที่เก็บได้ไม่ใช่ · ใช้สีเดียวกันแล้วสายตาจะอ่านว่าเป็นชุดเดียวกัน
 *
 * 🔴 `kind: 'hidden'` ไม่วาดอะไรเลย — ไม่ใช่วาดแถบ 0%
 * แถบว่างอ่านเหมือน "ยังเก็บเงินไม่ได้เลย" ทั้งที่ความจริงคือ "คุณไม่มีสิทธิ์เห็น"
 */
export function MoneyBars({ bars }: { bars: Bars }) {
  // 🔴 หัวหน้าโครงการไม่เห็นตัวเลขเงินของโครงการเลย — เจ้าของสั่งไว้ 31 ส.ค. 2569
  // ว่าเขามีหน้าที่แค่บันทึกรายจ่ายและบันทึกว่าวันนี้ใครมาทำงาน
  // · ไม่วาดอะไรเลย ดีกว่าวาดยอดที่ขาดค่าแรงไปโดยไม่บอก ซึ่งเป็นตัวเลขผิด
  // ที่ดูน่าเชื่อถือ · รายจ่ายที่เขาคีย์เองยังดูได้ทีละรายการที่ /ledger
  if (bars.kind === 'hidden') return null

  if (bars.kind === 'no-contract') {
    return (
      <div className="mt-2.5 space-y-1.5">
        <Row label="เบิกเงินสะสม" value={fmtBaht(bars.income)} tone="paid" />
        <Row label="ต้นทุนสะสม" value={fmtBaht(bars.cost)} tone="cost" />
        <CostLegend split={bars.split} />
        <p className="pt-0.5 text-xs text-muted-token">
          ยังไม่ได้ตั้งค่างาน — ตั้งแล้วจะคิดเปอร์เซ็นต์และกำไรคงเหลือให้
        </p>
      </div>
    )
  }

  return (
    <div className="mt-2.5 space-y-2">
      <Bar
        label="เบิกเงินสะสม"
        value={`${fmtBaht(bars.income)} · ${bars.paidPercent}%`}
        width={bars.paidWidth}
        tone="paid"
      />

      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted-token">ต้นทุนสะสม</span>
          <span className="tnum font-semibold text-ink">
            {fmtBaht(bars.cost)} · {bars.costPercent}%
          </span>
        </div>
        {/* แถบเดียวสามท่อน — ท่อนย่อยบวกกันได้ความยาวของ "ต้นทุนสะสม" พอดี
            จึงอ่านได้ทั้ง "ต้นทุนกินค่างานไปเท่าไหร่" และ "ต้นทุนก้อนนั้นเป็นอะไรบ้าง"
            ในแถบเดียว โดยไม่ต้องเพิ่มแถบที่สี่ให้การ์ดสูงขึ้นอีก */}
        <div className="flex h-2 overflow-hidden rounded-full bg-bar-track">
          <Segment width={bars.costSegments.wage} className="bg-bar-cost-wage" />
          <Segment width={bars.costSegments.material} className="bg-bar-cost-material" />
          <Segment width={bars.costSegments.other} className="bg-bar-cost-other" />
        </div>
      </div>

      <CostLegend split={bars.split} />
    </div>
  )
}

/**
 * สามตัวเลขใต้แถบต้นทุน — จุดสีผูกตัวเลขเข้ากับท่อนในแถบ
 *
 * 🔴 สามก้อนนี้บวกกันได้ "ต้นทุนสะสม" พอดี ไม่ใช่ยอดที่ต้องเอาไปบวกเพิ่ม
 * (`other` คำนวณจากส่วนต่าง จึงเป็นจริงเสมอ ดู `splitCost()`) · ป้าย
 * "รวมค่าแรงอยู่ในนั้นแล้ว" ของเดิมจึงไม่ต้องมีอีก — แถบบอกเองแล้ว
 */
function CostLegend({ split }: { split: CostSplit }) {
  return (
    <dl className="grid grid-cols-3 gap-x-2 pt-0.5 text-xs">
      <LegendItem dot="bg-bar-cost-wage" label="ค่าแรง" value={split.wage} />
      <LegendItem dot="bg-bar-cost-material" label="ค่าวัสดุ" value={split.material} />
      <LegendItem dot="bg-bar-cost-other" label="อื่น ๆ" value={split.other} />
    </dl>
  )
}

function LegendItem({ dot, label, value }: { dot: string; label: string; value: number }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-muted-token">
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-0.5 truncate font-semibold tnum text-ink-2">{fmtBaht(value)}</dd>
    </div>
  )
}

/**
 * ช่องสรุปท้ายการ์ด — วันที่ลงเวลา · ค่าแรงรวม · ค่าวัสดุรวม
 *
 * ตัวเลขชุดเดียวกับแถบต้นทุน แต่ตอบคนละคำถาม: แถบตอบว่า "ต้นทุนหน้าตาเป็นยังไง"
 * ช่องนี้ตอบว่า "โครงการนี้เดินมากี่วันแล้ว และหมดไปกับสองก้อนใหญ่เท่าไหร่"
 * · `attendanceDays` นับเป็น **วัน** ไม่ใช่คน-วัน — 5 คนในวันเดียวคือ 1 วัน
 */
export function SiteSummary({ bars }: { bars: Bars }) {
  if (bars.kind === 'hidden') return null

  return (
    <dl className="mt-3 grid grid-cols-3 divide-x divide-line-soft rounded-lg border border-line-soft bg-surface-2">
      <SummaryCell label="วันที่ลงเวลา" value={`${bars.attendanceDays}`} unit="วัน" />
      <SummaryCell label="ค่าแรงรวม" value={fmtBaht(bars.split.wage)} />
      <SummaryCell label="ค่าวัสดุรวม" value={fmtBaht(bars.split.material)} />
    </dl>
  )
}

function SummaryCell({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0 px-2.5 py-2 text-center">
      <dt className="truncate text-xs text-muted-token">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-semibold tnum text-ink">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted-token">{unit}</span>}
      </dd>
    </div>
  )
}

function Segment({ width, className }: { width: number; className: string }) {
  if (width <= 0) return null
  return <span className={`h-full animate-grow-x ${className}`} style={{ width: `${width}%` }} />
}

function Bar({
  label,
  value,
  width,
  tone,
}: {
  label: string
  value: string
  width: number
  tone: 'paid' | 'cost'
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-token">{label}</span>
        <span className={`tnum font-semibold ${tone === 'paid' ? 'text-income' : 'text-ink'}`}>
          {value}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-bar-track">
        <div
          className={`h-full rounded-full animate-grow-x ${tone === 'paid' ? 'bg-bar-paid' : 'bg-bar-cost'}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone: 'paid' | 'cost' }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-token">{label}</span>
      <span className={`tnum font-semibold ${tone === 'paid' ? 'text-income' : 'text-ink'}`}>
        {value}
      </span>
    </div>
  )
}

/**
 * ป้ายเตือนบนการ์ดโครงการ · ขึ้นเฉพาะโครงการที่ `ต้นทุน% > เก็บเงิน%`
 * โครงการที่ยังไม่แซงในหน้าเดียวกันต้องไม่ขึ้น ไม่งั้นป้ายก็ไม่ได้บอกอะไร
 */
export function OverrunBadge() {
  return (
    <span className="chip text-urgent bg-urgent-bg ring-urgent-ring">
      <AlertTriangle className="size-3.5 shrink-0" />
      {OVERRUN_LABEL}
    </span>
  )
}

/** กำไรคงเหลือ (ประมาณ) — ตัวเลขเดียวที่เจ้าของถามบ่อยที่สุด */
export function ProfitChip({ profit }: { profit: number }) {
  return (
    <span className="chip text-ink-2 bg-surface-2 ring-line">
      กำไรคงเหลือ
      <b className={`tnum ${profit < 0 ? 'text-urgent' : 'text-income'}`}>{fmtBaht(profit)}</b>
    </span>
  )
}
