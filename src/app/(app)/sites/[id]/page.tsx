import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CalendarDays, Phone, MapPin, UserRound } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { fmtBaht, fmtDate, fmtDateLong, todayInBangkok } from '@/lib/format'
import { SITE_STATUS_LABEL, SITE_STATUS_TONE, timeProgress } from '@/lib/sites'
import { asNullableNumber, moneyBars } from '@/lib/money'
import { Badge } from '@/components/ui/badge'
import { Metric, MetricBar } from '@/components/ui/metric'
import { MoneyBars, OverrunBadge } from '@/components/sites/money-bars'
import { SiteDetailActions } from './site-detail-client'

export const metadata = { title: 'รายละเอียดไซต์งาน' }

export default async function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [me, { id }] = await Promise.all([getCurrentUser(), params])
  const sb = await getSupabaseServer()

  const { data: site, error } = await sb
    .from('sites')
    .select('id, name, client_name, client_phone, address, start_date, end_date, status')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[sites] อ่านไซต์ไม่ได้', error.message)
    return (
      <div className="rounded-lg border border-urgent-ring bg-urgent-bg p-6 text-center">
        <p className="text-sm text-urgent">โหลดข้อมูลไซต์งานไม่สำเร็จ</p>
        <p className="mt-1 text-xs text-urgent">ลองรีเฟรชหน้านี้อีกครั้ง</p>
      </div>
    )
  }
  // 🔴 หัวหน้าไซต์ที่ไม่ได้ดูแลไซต์นี้จะได้ 0 แถวจาก RLS → 404 ไม่ใช่หน้าเปล่า
  // หน้าเปล่าอ่านเหมือนระบบพัง และยังบอกใบ้ด้วยว่า "ไซต์นี้มีอยู่จริงนะ"
  if (!site) notFound()

  const isOwner = me.role === 'owner'

  const [{ data: crew }, { data: milestones }, people, money] = await Promise.all([
    sb
      .from('site_supervisors')
      .select('id, effective_from, effective_to, profiles(id, full_name)')
      .eq('site_id', id)
      .order('effective_from', { ascending: false })
      .range(0, PAGE_SIZE - 1),
    sb
      .from('site_milestones')
      .select('id, seq, name, planned_amount, planned_date')
      .eq('site_id', id)
      .order('seq', { ascending: true })
      .range(0, PAGE_SIZE - 1),
    // รายชื่อสำหรับกล่องมอบหมาย — หัวหน้าไซต์อ่าน profiles คนอื่นไม่ได้ตาม RLS
    // จึงดึงเฉพาะตอนเป็นเจ้าของ ไม่ใช่ดึงทุกครั้งแล้วได้ลิสต์ว่างเงียบ ๆ
    me.role === 'owner'
      ? sb
          .from('profiles')
          .select('id, full_name')
          .eq('role', 'site_supervisor')
          .eq('is_active', true)
          .order('full_name', { ascending: true })
          .range(0, PAGE_SIZE - 1)
          .then(({ data, error: pErr }) => {
            if (pErr) console.error('[sites] อ่านรายชื่อหัวหน้าไซต์ไม่ได้', pErr.message)
            return data ?? []
          })
      : Promise.resolve([]),
    // ยอดเงินของไซต์นี้ · RPC เป็น `security invoker` จึงคืน `null` ให้หัวหน้าไซต์
    // เอง — `null` แปลว่า "ไม่มีสิทธิ์เห็น" ซึ่งไม่เหมือน 0 ที่แปลว่า
    // "ยังไม่ได้ตั้ง" — สองอย่างนี้ห้ามปนกัน
    sb
      .rpc('site_money', { p_site: id })
      .then(({ data, error: fErr }) => {
        if (fErr) console.error('[sites] อ่านยอดเงินไม่ได้', fErr.message)
        const row = data?.[0]
        return {
          contract: asNullableNumber(row?.contract_amount),
          income: asNullableNumber(row?.income_approved),
          cost: Number(row?.cost_total ?? 0),
          wage: Number(row?.cost_wage ?? 0),
        }
      }),
  ])

  const today = todayInBangkok()
  const progress = timeProgress(site.start_date, site.end_date, today)
  const plannedTotal = (milestones ?? []).reduce((sum, m) => sum + Number(m.planned_amount), 0)
  const bars = moneyBars(money)

  return (
    <>
      <Link
        href="/sites"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted-token transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-4" />
        ไซต์งานทั้งหมด
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold text-ink">{site.name}</h1>
            <Badge tone={SITE_STATUS_TONE[site.status]} dot>
              {SITE_STATUS_LABEL[site.status]}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-token">
            {site.client_name ? `ลูกค้า: ${site.client_name}` : 'ยังไม่ได้ระบุลูกค้า'}
          </p>
        </div>
        {isOwner && (
          <SiteDetailActions
            site={site}
            contractAmount={money.contract ?? 0}
            crew={crew ?? []}
            milestones={milestones ?? []}
            people={people}
          />
        )}
      </div>

      {/* ── ความคืบหน้า — สามแถบ (DESIGN.md §5.1) ─────────────────────
          เวลา · เก็บเงินแล้ว · ต้นทุนที่จ่ายจริง
          หัวหน้าไซต์เห็นแค่ยอดรายจ่าย ไม่มีเปอร์เซ็นต์ เพราะเปอร์เซ็นต์
          ต้องหารด้วยค่างาน ซึ่งเป็นความลับจากเขา */}
      <section className="panel mb-4 p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold text-ink-2">ความคืบหน้า</h2>
          {progress.kind === 'ok' && (
            <span className="text-sm tnum text-muted-token">
              {progress.elapsedDays} / {progress.totalDays} วัน ·{' '}
              <span className={progress.daysLeft < 0 ? 'font-semibold text-urgent' : ''}>
                {progress.daysLeft < 0
                  ? `เลยกำหนดมาแล้ว ${Math.abs(progress.daysLeft)} วัน`
                  : `เหลืออีก ${progress.daysLeft} วัน`}
              </span>
            </span>
          )}
        </div>

        {progress.kind === 'unset' ? (
          <p className="text-sm text-muted-token">
            ยังไม่ได้ตั้งช่วงเวลา — ใส่วันเริ่มงานและกำหนดส่งมอบเพื่อให้ระบบคำนวณความคืบหน้าให้
          </p>
        ) : (
          <>
            <div className="h-2.5 overflow-hidden rounded-full bg-bar-track">
              <div
                className="h-full rounded-full bg-bar-time animate-grow-x"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-xs tnum text-muted-token">
              <span>{fmtDate(site.start_date)}</span>
              <span className="font-semibold text-ink">{progress.percent}%</span>
              <span>{fmtDate(site.end_date)}</span>
            </div>
          </>
        )}

        <MoneyBars bars={bars} />

        {bars.kind === 'ok' && bars.overrun && (
          <div className="mt-3">
            <OverrunBadge />
          </div>
        )}

        <p className="mt-3 border-t border-line-soft pt-3 text-xs text-muted-token">
          ต้นทุนนับจากรายจ่ายที่อนุมัติแล้ว บวกค่าแรงจากการลงชื่อคนเข้าไซต์
          ซึ่งเกิดขึ้นทันทีที่ติ๊ก ไม่ต้องรออนุมัติ
        </p>
      </section>

      {/* ── ตัวเลขเงินสี่ตัว — เจ้าของเท่านั้น ─────────────────────────
          `hidden` = ไม่มีสิทธิ์เห็น → ไม่วาดอะไรเลย ดีกว่าวาด ฿0 ให้เข้าใจผิด */}
      {bars.kind !== 'hidden' && (
        <MetricBar>
          <Metric
            label="ค่างานตามสัญญา"
            value={bars.kind === 'ok' ? fmtBaht(bars.contract) : 'ยังไม่ได้ตั้ง'}
          />
          <Metric label="เก็บเงินแล้ว" value={fmtBaht(bars.income)} tone="done" />
          <Metric label="ต้นทุนที่จ่ายจริง" value={fmtBaht(bars.cost)} />
          <Metric
            label="กำไรคงเหลือ (ประมาณ)"
            value={bars.kind === 'ok' ? fmtBaht(bars.profit) : '—'}
            tone={bars.kind === 'ok' && bars.profit < 0 ? 'urgent' : 'default'}
            hint={bars.kind === 'ok' ? 'ค่างาน − ต้นทุนที่เกิดขึ้นแล้ว' : 'ต้องตั้งค่างานก่อน'}
          />
        </MetricBar>
      )}

      {/* ── ข้อมูลสัญญา ────────────────────────────────────────────── */}
      <section className="panel mb-4">
        <div className="panel-head">ข้อมูลสัญญา</div>
        <dl className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-muted-token">ช่วงเวลางาน</dt>
            <dd className="mt-0.5 flex items-center gap-1.5 text-base text-ink">
              <CalendarDays className="size-4 shrink-0 text-muted-token" />
              {site.start_date || site.end_date
                ? `${fmtDateLong(site.start_date)} – ${fmtDateLong(site.end_date)}`
                : 'ยังไม่ได้ตั้ง'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-token">เบอร์ติดต่อลูกค้า</dt>
            <dd className="mt-0.5 flex items-center gap-1.5 text-base text-ink">
              <Phone className="size-4 shrink-0 text-muted-token" />
              {site.client_phone ? (
                <a href={`tel:${site.client_phone}`} className="text-brand hover:underline">
                  {site.client_phone}
                </a>
              ) : (
                <span className="text-muted-token">ยังไม่ได้ระบุ</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-token">ที่ตั้งหน้างาน</dt>
            <dd className="mt-0.5 flex items-start gap-1.5 text-base text-ink">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-token" />
              {site.address || <span className="text-muted-token">ยังไม่ได้ระบุ</span>}
            </dd>
          </div>
        </dl>
      </section>

      {/* ── หัวหน้าไซต์ ────────────────────────────────────────────── */}
      <section className="panel mb-4">
        <div className="panel-head">
          หัวหน้าไซต์
          <span className="ml-auto text-xs font-normal text-muted-token">
            {(crew ?? []).length} รายการ
          </span>
        </div>
        {(crew ?? []).length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-token">
            ยังไม่มีใครดูแลไซต์นี้ — หัวหน้าไซต์จะเห็นและคีย์รายจ่ายของไซต์นี้ได้หลังถูกมอบหมาย
          </p>
        ) : (
          <ul>
            {(crew ?? []).map((m) => {
              const current =
                m.effective_from <= today && (m.effective_to === null || m.effective_to >= today)
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-4 py-2.5 last:border-b-0"
                >
                  <UserRound className="size-4 shrink-0 text-muted-token" />
                  <span className="font-medium text-ink">
                    {m.profiles?.full_name ?? 'ผู้ใช้ที่ถูกลบแล้ว'}
                  </span>
                  <span className="text-sm tnum text-muted-token">
                    {fmtDate(m.effective_from)} –{' '}
                    {m.effective_to ? fmtDate(m.effective_to) : 'ยังไม่กำหนด'}
                  </span>
                  {/* "ปัจจุบัน" คือช่วงที่ครอบวันนี้ ไม่ใช่ช่วงที่ยังไม่มีวันสิ้นสุด —
                      การย้ายล่วงหน้าจะปิดช่วงปัจจุบันไว้ ถ้าดูที่ effective_to
                      คนจะหายจากไซต์ทันทีที่บันทึกการย้าย ทั้งที่ยังไม่ถึงวัน */}
                  {current && (
                    <span className="ml-auto">
                      <Badge tone="done">ดูแลอยู่ตอนนี้</Badge>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ── แผนงวดเงิน ─────────────────────────────────────────────── */}
      <section className="panel">
        <div className="panel-head">
          แผนงวดเงิน (ไม่บังคับ)
          {plannedTotal > 0 && (
            <span className="ml-auto text-xs font-normal tnum text-muted-token">
              รวม {fmtBaht(plannedTotal)}
            </span>
          )}
        </div>
        {(milestones ?? []).length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-token">
            ยังไม่ได้วางแผนงวด — บันทึกรายรับได้ตามปกติโดยไม่ต้องวางแผนก่อน
            แต่ถ้าวางไว้จะเห็นได้ว่างวดไหนถึงกำหนดแล้วยังไม่ได้เก็บ
          </p>
        ) : (
          <ul>
            {(milestones ?? []).map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-4 py-2.5 last:border-b-0"
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-semibold tnum text-ink-2">
                  {m.seq}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{m.name}</span>
                <span className="text-sm tnum text-muted-token">{fmtDate(m.planned_date)}</span>
                <span className="text-sm font-semibold tnum text-ink">
                  {fmtBaht(m.planned_amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
