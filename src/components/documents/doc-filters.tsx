'use client'

import { CalendarDays, Warehouse } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { RANGE_LABEL, detectRange, rangeDates, type RangeKey } from '@/lib/date-range'
import type { DocKind } from '@/lib/documents'

export type DocFilterState = {
  kind: DocKind
  status: string
  q: string
  site: string
  from: string
  to: string
}

/**
 * ช่วงเวลา + โครงการ ของหน้าเอกสาร
 *
 * 🔴 มีปุ่มจริงให้กด ไม่ใช่รับพารามิเตอร์เฉย ๆ — หน้านี้เคยอ่าน `?site=` ได้
 * แต่ไม่มีอะไรบนจอที่ตั้งค่ามันเลย · ตัวกรองที่กดไม่ได้คือตัวกรองที่ไม่มีอยู่จริง
 * สำหรับคนใช้ และยังผิดกฎ "ทุก endpoint/พารามิเตอร์ต้องมีปุ่มที่เรียกมัน" (§15)
 *
 * แหล่งความจริงคือ URL เหมือน `/ledger` — แชร์ลิงก์ได้ · ปุ่ม Back ทำงานเอง
 * · เปลี่ยนตัวกรองตัด `after` (cursor) ทิ้งเสมอ ไม่งั้นได้หน้าสองของลิสต์ใหม่
 */
export function DocFilters({
  today,
  sites,
  siteName,
  current,
}: {
  today: string
  sites: { id: string; name: string }[]
  /** ชื่อโครงการที่กรองอยู่ เผื่อมันไม่อยู่ในกล่อง (ปิดงานแล้ว) จะได้ยังเห็นชื่อ */
  siteName: string | null
  current: DocFilterState
}) {
  const router = useRouter()
  const [range, setRange] = useState<RangeKey>(() => detectRange(current.from, current.to, today))
  const [dates, setDates] = useState({ from: current.from, to: current.to })

  const hrefWith = (patch: Partial<DocFilterState>) => {
    const next = { ...current, ...patch }
    const p = new URLSearchParams({ kind: next.kind })
    if (next.status && next.status !== 'all') p.set('status', next.status)
    if (next.q) p.set('q', next.q)
    if (next.site) p.set('site', next.site)
    if (next.from) p.set('from', next.from)
    if (next.to) p.set('to', next.to)
    return `/documents?${p.toString()}`
  }

  const go = (patch: Partial<DocFilterState>) => router.push(hrefWith(patch))

  const pickRange = (k: RangeKey) => {
    setRange(k)
    if (k === 'custom') return // รอให้กรอกวันก่อน ค่อยไป
    const d = rangeDates(k, today)
    setDates(d)
    go(d)
  }

  const pickDate = (field: 'from' | 'to', value: string) => {
    const d = { ...dates, [field]: value }
    setDates(d)
    go(d)
  }

  const siteKnown = !current.site || current.site === 'none' || sites.some((s) => s.id === current.site)

  const control = 'input-base py-2 pl-9 text-[15px]'
  const icon = 'pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-token'

  return (
    <div className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <label className="relative block sm:w-auto">
        <span className="sr-only">ช่วงเวลา</span>
        <CalendarDays className={icon} strokeWidth={1.8} aria-hidden />
        <select
          value={range}
          onChange={(e) => pickRange(e.target.value as RangeKey)}
          className={`${control} sm:w-auto sm:pr-9`}
        >
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => (
            <option key={k} value={k}>{RANGE_LABEL[k]}</option>
          ))}
        </select>
      </label>

      <label className="relative block sm:w-auto">
        <span className="sr-only">โครงการ</span>
        <Warehouse className={icon} strokeWidth={1.8} aria-hidden />
        <select
          value={current.site}
          onChange={(e) => go({ site: e.target.value })}
          className={`${control} sm:w-auto sm:pr-9`}
        >
          <option value="">ทุกโครงการ</option>
          {/* งานที่เสนอราคาไว้แต่ยังไม่ได้เปิดโครงการ — ต้องหาเจอ ไม่ใช่หายไปในกอง */}
          <option value="none">เฉพาะใบที่ไม่ผูกโครงการ</option>
          {!siteKnown && (
            <option value={current.site}>{siteName ?? 'โครงการที่เลือก'}</option>
          )}
          {sites.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>

      {/* 🔴 <input type="date"> ส่ง ค.ศ. เสมอ ห้ามแปลงเป็น พ.ศ. ก่อนส่ง (§15) */}
      {range === 'custom' && (
        <>
          <input
            type="date"
            value={dates.from}
            onChange={(e) => pickDate('from', e.target.value)}
            aria-label="ตั้งแต่วันที่"
            className="input-base py-2 tnum sm:w-auto"
          />
          <input
            type="date"
            value={dates.to}
            onChange={(e) => pickDate('to', e.target.value)}
            aria-label="ถึงวันที่"
            className="input-base py-2 tnum sm:w-auto"
          />
        </>
      )}
    </div>
  )
}
