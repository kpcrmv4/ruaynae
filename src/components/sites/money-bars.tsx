import { AlertTriangle } from 'lucide-react'
import { fmtBaht } from '@/lib/format'
import { OVERRUN_LABEL, type MoneyBars as Bars } from '@/lib/money'

/**
 * แถบ "เก็บเงินแล้ว" และ "ต้นทุนที่จ่ายจริง" ต่อท้ายแถบเวลา (DESIGN.md §5.1)
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
  // หัวหน้าไซต์: เห็นยอดรายจ่ายของไซต์ตัวเองได้ (เขาเป็นคนคีย์เองอยู่แล้ว)
  // แต่ไม่มีเปอร์เซ็นต์ เพราะเปอร์เซ็นต์ต้องหารด้วยค่างาน ซึ่งเป็นความลับ —
  // บอกทั้งยอดและเปอร์เซ็นต์เมื่อไหร่ ก็เท่ากับบอกค่างานไปด้วย
  if (bars.kind === 'hidden') {
    return (
      <div className="mt-2.5">
        <Row label="รายจ่ายที่อนุมัติแล้ว" value={fmtBaht(bars.cost)} tone="cost" />
      </div>
    )
  }

  if (bars.kind === 'no-contract') {
    return (
      <div className="mt-2.5 space-y-1.5">
        <Row label="เก็บเงินแล้ว" value={fmtBaht(bars.income)} tone="paid" />
        <Row label="ต้นทุนที่จ่ายจริง" value={fmtBaht(bars.cost)} tone="cost" />
        <p className="pt-0.5 text-xs text-muted-token">
          ยังไม่ได้ตั้งค่างาน — ตั้งแล้วจะคิดเปอร์เซ็นต์และกำไรคงเหลือให้
        </p>
      </div>
    )
  }

  return (
    <div className="mt-2.5 space-y-2">
      <Bar
        label="เก็บเงินแล้ว"
        value={`${fmtBaht(bars.income)} · ${bars.paidPercent}%`}
        width={bars.paidWidth}
        tone="paid"
      />
      <Bar
        label="ต้นทุนที่จ่ายจริง"
        value={`${fmtBaht(bars.cost)} · ${bars.costPercent}%`}
        width={bars.costWidth}
        tone="cost"
      />
    </div>
  )
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
 * ป้ายเตือนบนการ์ดไซต์ · ขึ้นเฉพาะไซต์ที่ `ต้นทุน% > เก็บเงิน%`
 * ไซต์ที่ยังไม่แซงในหน้าเดียวกันต้องไม่ขึ้น ไม่งั้นป้ายก็ไม่ได้บอกอะไร
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
