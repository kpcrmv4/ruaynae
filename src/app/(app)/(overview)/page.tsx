import Link from 'next/link'
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  Coins,
  HardHat,
  Plus,
  TrendingDown,
  Wallet,
} from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { fmtBaht, fmtDateWithWeekday, todayInBangkok } from '@/lib/format'
import { SITE_STATUS_LABEL, SITE_STATUS_TONE, timeProgress } from '@/lib/sites'
import { asNullableNumber, moneyBars } from '@/lib/money'
import { Badge } from '@/components/ui/badge'
import { Metric, MetricBar } from '@/components/ui/metric'
import { EmptyState } from '@/components/ui/states'
import { MoneyBars, OverrunBadge, ProfitChip, SiteSummary } from '@/components/sites/money-bars'
import { TodayBoard } from '@/components/overview/today-board'
import { BondAlert } from '@/components/overview/bond-alert'
import { BOND_SOON_DAYS } from '@/lib/bonds'
import { DataError } from '@/components/ui/data-error'

export const metadata = { title: 'วันนี้' }

/** กี่โครงการที่โชว์บนหน้าแรก — ที่เหลือกดดูได้ที่ /sites */
const TOP_SITES = 6

/**
 * การ์ด "งานวันนี้" บนสุดของหน้าแรก
 *
 * ปิดไว้ตามคำขอของเจ้าของ (4 ก.ย. 2569) — โค้ดยังอยู่ครบที่
 * `components/overview/today-board.tsx` · เปลี่ยนเป็น `true` แล้วการ์ดกลับมา
 * ทั้งใบพร้อม query ของมัน · ปิดอยู่ = ไม่มี query ไหนถูกยิงเลย
 */
const SHOW_TODAY_BOARD = false

export default async function OverviewPage() {
  const me = await getCurrentUser()
  const sb = await getSupabaseServer()
  const today = todayInBangkok()

  // 🔴 ตัวเลขสรุปคำนวณในฐานข้อมูลด้วย RPC ที่เป็น `security invoker`
  // RLS จึงยังทำงาน — หัวหน้าโครงการได้ตัวเลขของโครงการตัวเองโดยไม่ต้องมี if ตรงนี้
  // และไม่มีการดึงแถวมานับใน JS ซึ่งจะเพี้ยนเงียบ ๆ ที่ 1,000 แถว
  const isOwner = me.role === 'owner'

  const [{ data: summary, error: sErr }, { data: sites, error: lErr }, { data: bondSum }] = await Promise.all([
    sb.rpc('site_overview', { p_on: today }),
    sb
      .from('sites')
      .select('id, name, client_name, start_date, end_date, status')
      .eq('status', 'active')
      // โครงการที่ใกล้ครบกำหนดที่สุดอยู่บนสุด · โครงการที่ยังไม่ตั้งวันจบไปท้ายสุด
      .order('end_date', { ascending: true, nullsFirst: false })
      .range(0, TOP_SITES - 1),
    // หลักประกันสัญญา (R11) — เจ้าของเท่านั้น · RPC นับในฐานข้อมูล · อ่านไม่ได้ก็แค่ไม่มีแถบ
    isOwner
      ? sb.rpc('bond_summary', { p_on: today, p_soon_days: BOND_SOON_DAYS }).then(({ data, error }) => {
          if (error) console.error('[overview] อ่านสรุปหลักประกันไม่ได้', error.message)
          return { data: data ?? null }
        })
      : Promise.resolve({ data: null }),
  ])

  const rows = sites ?? []
  const ids = rows.map((s) => s.id)

  // ยอดเงินของโครงการที่จะแสดงจริงเท่านั้น — ขอบเขตผูกกับลิสต์ข้างบน
  // ไม่ใช่ยิงทีละโครงการ (N+1) และไม่ใช่ดึงมาทั้งฐานแล้วค่อยตัดใน JS
  const { data: money, error: mErr } = ids.length
    ? await sb
        .rpc('site_money', {})
        .in('site_id', ids)
        .order('site_id', { ascending: true })
        .range(0, ids.length - 1)
    : { data: [], error: null }

  const loadError = sErr ?? lErr ?? mErr
  if (loadError) {
    console.error('[overview] โหลดภาพรวมไม่ได้', loadError.message)
    return (
      <DataError message="โหลดภาพรวมไม่สำเร็จ" />
    )
  }

  const s = summary?.[0]
  // 🔴 ชนิดที่ Supabase สร้างให้บอกว่าคอลัมน์พวกนี้ไม่มีวันเป็น null
  // แต่ RPC คืน null จริงเมื่อไม่มีสิทธิ์เห็น — แปลงก่อนใช้เสมอ
  const activeContract = asNullableNumber(s?.active_contract)
  const activeIncome = asNullableNumber(s?.active_income)
  const activeCost = Number(s?.active_cost ?? 0)
  const pendingCount = Number(s?.pending_count ?? 0)
  const pendingTotal = Number(s?.pending_total ?? 0)

  const moneyOf = new Map(
    (money ?? []).map((m) => [
      m.site_id,
      {
        contract: asNullableNumber(m.contract_amount),
        income: asNullableNumber(m.income_approved),
        cost: Number(m.cost_total),
        wage: Number(m.cost_wage),
        material: Number(m.cost_material),
        attendanceDays: Number(m.attendance_days),
      },
    ]),
  )

  const activeCount = Number(s?.active_count ?? 0)

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-ink">
            สวัสดี {me.fullName.split(' ')[0]}
          </h1>
          <p className="mt-0.5 text-sm text-muted-token">
            {fmtDateWithWeekday(today)} · {isOwner ? 'ภาพรวมทั้งบริษัท' : 'เฉพาะโครงการที่คุณดูแล'}
          </p>
        </div>
        {/* บนมือถือปุ่มกลมกลางแถบล่างทำหน้าที่นี้อยู่แล้ว — ไม่วางปุ่มซ้ำสองที่ */}
        <Link href="/entry" className="btn-primary hidden shrink-0 lg:inline-flex">
          <Plus className="size-4" />
          บันทึกรายจ่าย
        </Link>
      </div>

      {/* ── หลักประกันสัญญาที่ครบ/ใกล้ครบ — เด่นสุดบนหน้าแรก (เจ้าของสั่ง 19 ก.ย. 2569) ──
          วาดเฉพาะตอนมีของจริง · ไม่มี = ไม่มีแถบ */}
      {isOwner && bondSum?.[0] && (
        <BondAlert
          overdueCount={Number(bondSum[0].overdue_count ?? 0)}
          overdueAmount={Number(bondSum[0].overdue_amount ?? 0)}
          dueSoonCount={Number(bondSum[0].due_soon_count ?? 0)}
          dueSoonAmount={Number(bondSum[0].due_soon_amount ?? 0)}
        />
      )}

      {/* ── งานวันนี้ — ปิดไว้ตามคำขอของเจ้าของ (4 ก.ย. 2569) ─────────────
          การ์ดยังอยู่ครบใน components/overview/today-board.tsx · เอากลับมา
          ด้วยการเปลี่ยน SHOW_TODAY_BOARD ข้างบนเป็น true ที่เดียว */}
      {SHOW_TODAY_BOARD && (
        <TodayBoard
          today={today}
          activeCount={activeCount}
          pendingCount={pendingCount}
          pendingTotal={pendingTotal}
        />
      )}

      <MetricBar cols={SHOW_TODAY_BOARD ? 3 : 2}>
        <Metric
          label="กำลังก่อสร้าง"
          value={activeCount}
          unit="โครงการ"
          icon={HardHat}
          href="/sites?status=active"
          hint={
            Number(s?.total_count ?? 0) > activeCount ? `จากทั้งหมด ${s?.total_count} โครงการ` : undefined
          }
        />
        <Metric
          label="ใกล้ครบกำหนด"
          value={Number(s?.due_soon_count ?? 0)}
          unit="โครงการ"
          icon={CalendarClock}
          tone={Number(s?.due_soon_count ?? 0) > 0 ? 'progress' : 'default'}
          hint="เหลือไม่ถึง 30 วัน"
        />
        <Metric
          label="เลยกำหนดแล้ว"
          value={Number(s?.overdue_count ?? 0)}
          unit="โครงการ"
          icon={AlertTriangle}
          tone={Number(s?.overdue_count ?? 0) > 0 ? 'urgent' : 'default'}
          hint={Number(s?.overdue_count ?? 0) > 0 ? 'ต้องเลื่อนกำหนดหรือปิดงาน' : 'ทุกโครงการยังอยู่ในกำหนด'}
        />
        {/* 🔴 ยอดรออนุมัติต้องมีที่ยืนบนหน้าแรกเสมอ ไม่ใช่หายไปเฉย ๆ (DESIGN.md §5.3)
            แถบเงินข้างล่างนับเฉพาะ approved — ถ้าไม่โชว์ยอดค้างสักที่ เงินที่คีย์แล้ว
            แต่ยังไม่อนุมัติจะเหมือนไม่เคยถูกบันทึก · การ์ด "งานวันนี้" เคยรับหน้าที่นี้
            ตอนเปิดอยู่ ช่องนี้จึงโผล่เฉพาะตอนการ์ดปิด ไม่ให้ตัวเลขซ้ำสองที่ */}
        {!SHOW_TODAY_BOARD && (
          <Metric
            label="รออนุมัติ"
            value={pendingCount}
            unit="รายการ"
            icon={ClipboardCheck}
            tone={pendingCount > 0 ? 'progress' : 'default'}
            href="/ledger?status=pending"
            hint={pendingCount > 0 ? `รวม ${fmtBaht(pendingTotal)}` : 'ไม่มีรายการค้าง'}
          />
        )}
      </MetricBar>

      {/* ── แถบเงิน — เจ้าของเท่านั้น ────────────────────────────────
          ค่างานและรายรับอยู่ตารางที่หัวหน้าโครงการอ่านไม่ได้ · RPC จึงคืน null
          ไม่ใช่ 0 · แถบทั้งแถบหายไปแทนที่จะวาด ฿0 ให้คนเข้าใจผิด */}
      {activeContract !== null && activeIncome !== null && (
        <MetricBar>
          <Metric
            label="ค่างานที่รับไว้"
            value={fmtBaht(activeContract)}
            icon={Wallet}
            hint="ตามสัญญาของโครงการที่กำลังทำ"
          />
          <Metric
            label="เบิกเงินสะสม"
            value={fmtBaht(activeIncome)}
            icon={Coins}
            tone="done"
            hint={
              activeContract > 0
                ? `${Math.round((activeIncome / activeContract) * 100)}% ของค่างาน`
                : 'ยังไม่ได้ตั้งค่างาน'
            }
          />
          <Metric
            label="ต้นทุนสะสม"
            value={fmtBaht(activeCost)}
            icon={TrendingDown}
            hint="รายจ่ายที่อนุมัติแล้ว + ค่าแรง"
          />
          <Metric
            label="กำไรคงเหลือ"
            value={fmtBaht(activeContract - activeCost)}
            icon={Wallet}
            tone={activeContract - activeCost < 0 ? 'urgent' : 'default'}
            hint="ค่างาน − ต้นทุนที่เกิดขึ้นแล้ว"
          />
        </MetricBar>
      )}

      <div className="sec-head">
        โครงการที่กำลังก่อสร้าง
        <Link href="/sites" className="count text-brand hover:underline">
          ดูทั้งหมด
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={HardHat}
          message={
            isOwner
              ? 'ยังไม่มีโครงการที่กำลังก่อสร้าง — เพิ่มโครงการแล้วเริ่มบันทึกรายรับรายจ่ายเข้าไป'
              : 'ยังไม่มีโครงการที่คุณดูแลอยู่ ให้เจ้าของมอบหมายโครงการให้ก่อน'
          }
          action={
            isOwner ? (
              <Link href="/sites" className="btn-primary">
                <Plus className="size-4" />
                เพิ่มโครงการ
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((site, i) => {
            const p = timeProgress(site.start_date, site.end_date, today)
            const late = p.kind === 'ok' && p.daysLeft < 0
            const bars = moneyBars(
              moneyOf.get(site.id) ?? { contract: null, income: null, cost: 0 },
            )
            return (
              <Link
                key={site.id}
                href={`/sites/${site.id}`}
                // ไล่ขึ้นมาทีละใบ ห่าง 50ms — บอกลำดับการอ่านโดยไม่ต้องเขียนอธิบาย
                style={{ animationDelay: `${i * 50}ms` }}
                /*
                  🔴 `min-w-0` บนตัวการ์ดเอง ไม่ใช่แค่ข้างใน — ช่องของ grid เป็น
                  `1fr` ซึ่งย่อว่า `minmax(auto, 1fr)` และ `auto` ตัวนั้นคือ
                  **ความกว้างขั้นต่ำของเนื้อหา** · การ์ดที่มีชิปเรียงกันจึงดัน
                  ช่องให้กว้างเกินจอ · วัดได้จริงบนจอ 390px: ขอบขวาไปอยู่ที่
                  461px แล้วส่วนที่เกินถูก `overflow-x: clip` ของเชลล์ตัดทิ้ง
                  โดยไม่มีแถบเลื่อนให้รู้ตัว (แถว P8-E2E-04)
                */
                className="card-surface animate-rise-in min-w-0 p-4 shadow-e1 transition-colors duration-100 hover:border-brand"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-ink">{site.name}</div>
                    {/* ยังไม่ได้กรอกชื่อลูกค้า = ไม่ต้องเขียนอะไรเลย
                        ข้อความ "ยังไม่ได้ระบุ" กินบรรทัดเท่าข้อมูลจริงแต่ไม่ได้
                        บอกอะไร และไม่มีปุ่มให้แก้ตรงนั้นด้วย (เจ้าของสั่ง 4 ก.ย. 2569) */}
                    {(site.client_name || bars.kind === 'ok') && (
                      <div className="truncate text-sm text-muted-token">
                        {site.client_name}
                        {bars.kind === 'ok' && (
                          <>
                            {site.client_name ? ' · ' : ''}
                            ค่างาน{' '}
                            <span className="tnum font-medium text-ink-2">
                              {fmtBaht(bars.contract)}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <Badge tone={late ? 'urgent' : SITE_STATUS_TONE[site.status]} dot>
                    {late ? 'เลยกำหนด' : SITE_STATUS_LABEL[site.status]}
                  </Badge>
                </div>

                <div className="mt-3">
                  {p.kind === 'unset' ? (
                    <p className="text-sm text-muted-token">ยังไม่ได้ตั้งช่วงเวลา</p>
                  ) : (
                    <>
                      <div className="mb-1 flex items-baseline justify-between text-xs">
                        <span className="text-muted-token">เวลา</span>
                        <span className={`tnum font-semibold ${late ? 'text-urgent' : 'text-ink'}`}>
                          {late
                            ? `เลยมา ${Math.abs(p.daysLeft)} วัน`
                            : `เหลือ ${p.daysLeft} วัน · ${p.percent}%`}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-bar-track">
                        <div
                          className={`h-full rounded-full animate-grow-x ${late ? 'bg-urgent' : 'bg-bar-time'}`}
                          style={{ width: `${p.percent}%` }}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* แถบเบิกเงิน + ต้นทุน · หัวหน้าโครงการเห็นแค่ยอดรายจ่าย ไม่มีเปอร์เซ็นต์ */}
                <MoneyBars bars={bars} />
                <SiteSummary bars={bars} />

                {bars.kind === 'ok' && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-2.5">
                    <ProfitChip profit={bars.profit} />
                    {bars.overrun && <OverrunBadge />}
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      )}

      <p className="mt-5 rounded-lg border border-line-soft bg-surface-2 px-4 py-3 text-sm text-muted-token">
        ต้นทุนนับจาก <span className="font-medium text-ink-2">รายจ่ายที่อนุมัติแล้ว</span> บวกกับ{' '}
        <span className="font-medium text-ink-2">ค่าแรงจากการลงชื่อคนเข้าโครงการ</span> ซึ่งเกิดขึ้นทันทีที่ติ๊ก
        — การเบิกล่วงหน้าและการจ่ายค่าแรงเป็นเงินสดออก ไม่ถูกนับเป็นต้นทุนซ้ำอีกรอบ
      </p>
    </>
  )
}
