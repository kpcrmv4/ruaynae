'use client'

import { Filter } from 'lucide-react'
import { useState } from 'react'

export type RangeKey = 'all' | 'today' | 'month' | 'last' | 'year' | 'custom'

export const RANGE_LABEL: Record<RangeKey, string> = {
  all: 'ทุกช่วงเวลา',
  today: 'วันนี้',
  month: 'เดือนนี้',
  last: 'เดือนที่แล้ว',
  year: 'ปีนี้',
  custom: 'กำหนดช่วงเอง…',
}

/** ช่วงวันของแต่ละตัวเลือก — `null` = ไม่จำกัด (ไม่ส่ง from/to เลย) */
export function rangeDates(key: RangeKey, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastMonth = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }
  // วันสุดท้ายของเดือนก่อน = วันที่ 0 ของเดือนนี้
  const lastEnd = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)

  switch (key) {
    case 'today':
      return { from: today, to: today }
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'last':
      return { from: `${lastMonth.y}-${pad(lastMonth.m)}-01`, to: lastEnd }
    case 'year':
      return { from: `${y}-01-01`, to: today }
    default:
      return { from: '', to: '' }
  }
}

/** ค่าบน URL ตรงกับตัวเลือกสำเร็จรูปตัวไหน — ไม่ตรงเลยคือ "กำหนดเอง" */
export function detectRange(from: string, to: string, today: string): RangeKey {
  if (!from && !to) return 'all'
  for (const k of ['today', 'month', 'last', 'year'] as const) {
    const d = rangeDates(k, today)
    if (d.from === from && d.to === to) return k
  }
  return 'custom'
}

/**
 * แถบตัวกรองของหน้ารายรับ-รายจ่าย
 *
 * 🔴 เดิมเป็นชิปช่วงเวลาหนึ่งแถว + ช่องวันที่สองช่อง + กล่องเลือกโครงการ =
 * **หกแถวควบคุมก่อนถึงข้อมูลแถวแรก** บนจอ 390px และช่อง `type="date"` ถูกบีบ
 * จนเหลือกล่องเปล่า ๆ ที่กดแล้วไม่รู้ว่าคืออะไร (เจ้าของแจ้ง 4 ก.ย. 2569)
 * · ยุบเหลือกล่องเลือกสองอันเรียงคู่กัน · ช่องวันที่โผล่เฉพาะตอนเลือก
 * "กำหนดช่วงเอง" ซึ่งเป็นกรณีส่วนน้อย
 *
 * 🔴 แหล่งความจริงยังเป็น `from`/`to` บน URL เหมือนเดิม — กล่องเลือกเป็นแค่
 * ตัวเติมค่าให้ ไม่มีพารามิเตอร์ตัวที่สองที่วันหนึ่งจะขัดกันเอง
 */
export function LedgerFilters({
  today,
  sites,
  isOwner,
  site,
  from,
  to,
  /** ตัวกรองอื่นที่ต้องติดไปกับฟอร์มด้วย ไม่งั้นกดกรองแล้วขอบเขตอื่นหายเงียบ ๆ */
  keep,
}: {
  today: string
  sites: { id: string; name: string }[]
  isOwner: boolean
  site: string
  from: string
  to: string
  keep: Record<string, string>
}) {
  const [range, setRange] = useState<RangeKey>(() => detectRange(from, to, today))
  const [dates, setDates] = useState({ from, to })

  const pickRange = (k: RangeKey) => {
    setRange(k)
    // เลือกช่วงสำเร็จรูป = เขียนวันให้เลย · "กำหนดเอง" คงค่าที่กรอกไว้
    if (k !== 'custom') setDates(rangeDates(k, today))
  }

  return (
    <form
      action="/ledger"
      method="get"
      className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center"
    >
      {Object.entries(keep).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      <select
        value={range}
        onChange={(e) => pickRange(e.target.value as RangeKey)}
        aria-label="ช่วงเวลา"
        className="input-base col-span-1 py-2 sm:w-auto"
      >
        {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => (
          <option key={k} value={k}>{RANGE_LABEL[k]}</option>
        ))}
      </select>

      <select
        name="site"
        defaultValue={site}
        aria-label="กรองตามโครงการ"
        className="input-base col-span-1 py-2 sm:w-auto"
      >
        <option value="">ทุกโครงการ</option>
        {isOwner && <option value="central">เฉพาะส่วนกลาง</option>}
        {sites.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      {/* 🔴 ช่วงสำเร็จรูปส่งวันไปด้วย hidden — ปลายทางอ่าน from/to อย่างเดียว
          จึงไม่ต้องรู้จักคำว่า "เดือนนี้" และลิงก์ที่แชร์กันไปยังคงหมายถึง
          ช่วงวันเดิมเสมอ แม้เปิดคนละวัน */}
      {range === 'custom' ? (
        <>
          <input
            type="date"
            name="from"
            value={dates.from}
            max={today}
            onChange={(e) => setDates((d) => ({ ...d, from: e.target.value }))}
            aria-label="ตั้งแต่วันที่"
            className="input-base col-span-1 py-2 tnum sm:w-auto"
          />
          <input
            type="date"
            name="to"
            value={dates.to}
            max={today}
            onChange={(e) => setDates((d) => ({ ...d, to: e.target.value }))}
            aria-label="ถึงวันที่"
            className="input-base col-span-1 py-2 tnum sm:w-auto"
          />
        </>
      ) : (
        <>
          {dates.from && <input type="hidden" name="from" value={dates.from} />}
          {dates.to && <input type="hidden" name="to" value={dates.to} />}
        </>
      )}

      <button type="submit" className="btn-secondary col-span-2 py-2 sm:w-auto sm:px-4">
        <Filter className="size-4" />
        กรอง
      </button>
    </form>
  )
}
