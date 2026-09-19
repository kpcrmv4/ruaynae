'use client'

import { CalendarDays, Search, Warehouse } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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

/** ช่วงวันของแต่ละตัวเลือก — `''` ทั้งคู่ = ไม่จำกัด (ไม่ส่ง from/to เลย) */
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

export type StatusChip = { key: string; label: string; count?: number }

type Current = {
  kind: string
  status: string
  q: string
  site: string
  from: string
  to: string
}

const KINDS = [
  ['all', 'ทั้งหมด'],
  ['income', 'รายรับ'],
  ['expense', 'รายจ่าย'],
] as const

/**
 * ส่วนหัวของหน้ารายรับ-รายจ่าย — ตัวกรองทุกตัวรวมอยู่ที่นี่ที่เดียว
 *
 * 🔴 เดิมมีชิปชนิด · กล่องเลือกสองอัน · ปุ่ม "กรอง" · ชิปสถานะ · ช่องค้นหา
 * เรียงกันลงมา **หน้าตาเหมือนกันหมด** (ชิปดำสองแถวคนละความหมาย) และต้องกด
 * "กรอง" อีกทีหลังเลือก (เจ้าของแจ้ง 19 ก.ย. 2569) · ตอนนี้แต่ละชั้นมี
 * รูปร่างของตัวเอง เพื่อให้กวาดตาแล้วรู้ว่าอันไหนคืออะไรโดยไม่ต้องอ่าน:
 *
 *   1. ชนิด (รายรับ/รายจ่าย) = **แถบสลับ** ช่องเดียวสามส่วน
 *   2. ช่วงเวลา + โครงการ = **กล่องเลือกมีไอคอน** เปลี่ยนแล้วไปทันที ไม่มีปุ่มกรอง
 *   3. ค้นหา = ช่องพิมพ์ (อันเดียวที่ยังต้องกดส่ง เพราะพิมพ์อยู่กลางคำจะยิงไม่ได้)
 *   4. สถานะ = **แท็บขีดล่าง** ติดกับลิสต์ เพราะมันคือการแบ่งหน้าลิสต์ ไม่ใช่ตัวกรอง
 *
 * 🔴 แหล่งความจริงยังเป็น URL เหมือนเดิม (`kind` `status` `q` `site` `from` `to`)
 * — ทุกปุ่มคือลิงก์หรือ `router.push` ไปยัง URL ใหม่ · แชร์ลิงก์ได้ · Back ทำงานเอง
 * · ทุกการเปลี่ยนตัวกรองตัด `after` (cursor) ทิ้งเสมอ ไม่งั้นได้หน้าสองของลิสต์ใหม่
 */
export function LedgerFilters({
  today,
  sites,
  siteName,
  isOwner,
  current,
  statuses,
}: {
  today: string
  sites: { id: string; name: string }[]
  /** ชื่อโครงการที่กรองอยู่ เผื่อมันไม่อยู่ในกล่องเลือก (ปิดงานแล้ว) จะได้ยังแสดงชื่อได้ */
  siteName: string | null
  isOwner: boolean
  current: Current
  statuses: readonly StatusChip[]
}) {
  const router = useRouter()
  const [range, setRange] = useState<RangeKey>(() => detectRange(current.from, current.to, today))
  const [dates, setDates] = useState({ from: current.from, to: current.to })

  /** URL ของหน้านี้หลังแก้ค่าบางตัว — ค่าว่างคือถอดตัวกรองนั้นออก */
  const hrefWith = (patch: Partial<Current>) => {
    const next = { ...current, ...patch }
    const p = new URLSearchParams()
    if (next.kind && next.kind !== 'all') p.set('kind', next.kind)
    if (next.status && next.status !== 'all') p.set('status', next.status)
    if (next.q) p.set('q', next.q)
    if (next.site) p.set('site', next.site)
    if (next.from) p.set('from', next.from)
    if (next.to) p.set('to', next.to)
    const s = p.toString()
    return s ? `/ledger?${s}` : '/ledger'
  }

  const go = (patch: Partial<Current>) => router.push(hrefWith(patch))

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

  const siteKnown =
    !current.site || current.site === 'central' || sites.some((s) => s.id === current.site)

  const control = 'input-base py-2 pl-9 text-[15px]'
  const icon = 'pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-token'

  return (
    <div className="mb-4 space-y-2.5">
      {/* 1 · ชนิด — เจ้าของเท่านั้นที่มีทั้งสองชนิดให้สลับ
          หัวหน้าโครงการเห็นแต่รายจ่าย แถบสลับที่มีช่องเดียวคือแถบที่ไม่ทำอะไร */}
      {isOwner && (
        <div
          role="group"
          aria-label="ชนิดรายการ"
          className="grid grid-cols-3 gap-1 rounded-md bg-surface-3 p-1 sm:inline-grid"
        >
          {KINDS.map(([k, label]) => {
            const active = current.kind === k
            return (
              <Link
                key={k}
                href={hrefWith({ kind: k })}
                aria-current={active ? 'true' : undefined}
                className={`rounded-sm px-3 py-1.5 text-center text-sm transition-colors duration-100 sm:px-5 ${
                  active
                    ? 'bg-surface font-semibold text-ink shadow-sm'
                    : 'font-medium text-ink-2 hover:text-ink'
                }`}
              >
                {label}
              </Link>
            )
          })}
        </div>
      )}

      {/* 2 · ช่วงเวลา + โครงการ — เปลี่ยนแล้วไปเลย ไม่มีปุ่มกรอง */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
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
            {isOwner && <option value="central">เฉพาะส่วนกลาง</option>}
            {/* โครงการที่กรองอยู่แต่ไม่อยู่ในกล่อง (ปิดงานแล้ว) — ต้องยังเห็นชื่อ
                ตัวกรองที่มองไม่เห็นคือตัวกรองที่ทำให้อ่านตัวเลขผิดขอบเขต */}
            {!siteKnown && (
              <option value={current.site}>{siteName ?? 'โครงการที่เลือก'}</option>
            )}
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>

        {/* ช่องวันที่โผล่เฉพาะตอน "กำหนดช่วงเอง" ซึ่งเป็นกรณีส่วนน้อย
            🔴 <input type="date"> ส่ง ค.ศ. เสมอ ห้ามแปลงก่อนส่ง (CLAUDE.md §15) */}
        {range === 'custom' && (
          <>
            <input
              type="date"
              value={dates.from}
              max={today}
              onChange={(e) => pickDate('from', e.target.value)}
              aria-label="ตั้งแต่วันที่"
              className="input-base py-2 tnum sm:w-auto"
            />
            <input
              type="date"
              value={dates.to}
              max={today}
              onChange={(e) => pickDate('to', e.target.value)}
              aria-label="ถึงวันที่"
              className="input-base py-2 tnum sm:w-auto"
            />
          </>
        )}
      </div>

      {/* 3 · ค้นหา — ฟอร์ม GET ธรรมดา · ตัวกรองอื่นติดไปด้วยเป็น hidden
          ไม่งั้นพิมพ์ค้นหาแล้วขอบเขตโครงการ/ช่วงวันหายเงียบ ๆ */}
      <form action="/ledger" method="get" className="flex gap-2 sm:max-w-md">
        {current.kind !== 'all' && <input type="hidden" name="kind" value={current.kind} />}
        {current.status !== 'all' && <input type="hidden" name="status" value={current.status} />}
        {current.site && <input type="hidden" name="site" value={current.site} />}
        {current.from && <input type="hidden" name="from" value={current.from} />}
        {current.to && <input type="hidden" name="to" value={current.to} />}
        <div className="relative flex-1">
          <Search className={icon} aria-hidden />
          <input
            type="search"
            name="q"
            defaultValue={current.q}
            placeholder="ค้นหาจากรายละเอียด…"
            aria-label="ค้นหาจากรายละเอียด"
            className={control}
          />
        </div>
        <button type="submit" className="btn-secondary shrink-0 px-3 py-2 text-[15px]">
          ค้นหา
        </button>
      </form>

      {/* 4 · สถานะ — แท็บขีดล่าง ติดกับลิสต์ · เลื่อนแนวนอนได้บนจอแคบ
          สีที่เลือกเป็นหมึก ไม่ใช่สีแบรนด์ (ตัวกรองไม่ใช่ปุ่มหลักของหน้า) */}
      <div
        role="tablist"
        aria-label="สถานะ"
        className="-mx-1 flex overflow-x-auto border-b border-line px-1 no-scrollbar"
      >
        {statuses.map((s) => {
          const active = current.status === s.key
          return (
            <Link
              key={s.key}
              href={hrefWith({ status: s.key })}
              role="tab"
              aria-selected={active}
              className={`-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2 py-2 text-[13px] transition-colors duration-100 sm:px-3 sm:text-sm ${
                active
                  ? 'border-ink font-semibold text-ink'
                  : 'border-transparent font-medium text-muted-token hover:text-ink'
              }`}
            >
              {s.label}
              {s.count !== undefined && (
                <span
                  className={`rounded-xs px-1 text-xs font-semibold tnum ${
                    active ? 'bg-ink text-canvas' : 'bg-surface-3 text-muted-token'
                  }`}
                >
                  {s.count}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
