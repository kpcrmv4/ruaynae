import Link from 'next/link'
import { AlertTriangle, CalendarClock, HardHat, Plus, Wallet } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { fmtBaht, fmtDate, todayInBangkok } from '@/lib/format'
import { SITE_STATUS_LABEL, SITE_STATUS_TONE, timeProgress } from '@/lib/sites'
import { Badge } from '@/components/ui/badge'
import { Metric, MetricBar } from '@/components/ui/metric'
import { EmptyState } from '@/components/ui/states'

export const metadata = { title: 'ภาพรวม' }

/** กี่ไซต์ที่โชว์บนหน้าแรก — ที่เหลือกดดูได้ที่ /sites */
const TOP_SITES = 6

export default async function OverviewPage() {
  const me = await getCurrentUser()
  const sb = await getSupabaseServer()
  const today = todayInBangkok()

  // 🔴 ตัวเลขสรุปคำนวณในฐานข้อมูลด้วย RPC ที่เป็น `security invoker`
  // RLS จึงยังทำงาน — หัวหน้าไซต์ได้ตัวเลขของไซต์ตัวเองโดยไม่ต้องมี if ตรงนี้
  // และไม่มีการดึงแถวมานับใน JS ซึ่งจะเพี้ยนเงียบ ๆ ที่ 1,000 แถว
  const [{ data: summary, error: sErr }, { data: sites, error: lErr }] = await Promise.all([
    sb.rpc('site_overview', { p_on: today }),
    sb
      .from('sites')
      .select('id, name, client_name, contract_amount, start_date, end_date, status')
      .eq('status', 'active')
      // ไซต์ที่ใกล้ครบกำหนดที่สุดอยู่บนสุด · ไซต์ที่ยังไม่ตั้งวันจบไปท้ายสุด
      .order('end_date', { ascending: true, nullsFirst: false })
      .range(0, TOP_SITES - 1),
  ])

  if (sErr || lErr) {
    console.error('[overview] โหลดภาพรวมไม่ได้', sErr?.message ?? lErr?.message)
    return (
      <div className="rounded-lg border border-urgent-ring bg-urgent-bg p-6 text-center">
        <p className="text-sm text-urgent">โหลดภาพรวมไม่สำเร็จ</p>
        <p className="mt-1 text-xs text-urgent">ลองรีเฟรชหน้านี้อีกครั้ง</p>
      </div>
    )
  }

  const s = summary?.[0] ?? {
    total_count: 0, active_count: 0, active_contract: 0, due_soon_count: 0, overdue_count: 0,
  }
  const isOwner = me.role === 'owner'
  const rows = sites ?? []

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-ink">
            สวัสดี {me.fullName.split(' ')[0]}
          </h1>
          <p className="mt-0.5 text-sm text-muted-token">
            {isOwner ? 'ภาพรวมทั้งบริษัท' : 'ภาพรวมเฉพาะไซต์ที่คุณดูแล'} · {fmtDate(today)}
          </p>
        </div>
        <Link href="/entry" className="btn-primary shrink-0">
          <Plus className="size-4" />
          บันทึกรายจ่าย
        </Link>
      </div>

      <MetricBar>
        <Metric
          label="กำลังก่อสร้าง"
          value={s.active_count}
          unit="ไซต์"
          icon={HardHat}
          href="/sites?status=active"
          hint={s.total_count > s.active_count ? `จากทั้งหมด ${s.total_count} ไซต์` : undefined}
        />
        {/* ค่างานตามสัญญาเป็นตัวเลขเดียวที่มีจริงในเฟสนี้ — ยอดเก็บเงินและต้นทุน
            ต้องรอ P2/P4 · การ์ดที่โชว์ ฿0 ตอนนี้จะอ่านเหมือน "ยังไม่เก็บเงินได้เลย"
            ทั้งที่ความจริงคือ "ระบบยังไม่รู้จักรายรับ" ซึ่งคนละเรื่องกัน */}
        <Metric
          label="ค่างานที่รับไว้"
          value={fmtBaht(s.active_contract)}
          icon={Wallet}
          hint="ตามสัญญาของไซต์ที่กำลังทำ"
        />
        <Metric
          label="ใกล้ครบกำหนด"
          value={s.due_soon_count}
          unit="ไซต์"
          icon={CalendarClock}
          tone={s.due_soon_count > 0 ? 'progress' : 'default'}
          hint="เหลือไม่ถึง 30 วัน"
        />
        <Metric
          label="เลยกำหนดแล้ว"
          value={s.overdue_count}
          unit="ไซต์"
          icon={AlertTriangle}
          tone={s.overdue_count > 0 ? 'urgent' : 'default'}
          hint={s.overdue_count > 0 ? 'ต้องเลื่อนกำหนดหรือปิดงาน' : 'ทุกไซต์ยังอยู่ในกำหนด'}
        />
      </MetricBar>

      <div className="sec-head">
        ไซต์ที่กำลังก่อสร้าง
        <Link href="/sites" className="count text-brand hover:underline">
          ดูทั้งหมด
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={HardHat}
          message={
            isOwner
              ? 'ยังไม่มีไซต์ที่กำลังก่อสร้าง — เพิ่มไซต์งานแล้วเริ่มบันทึกรายรับรายจ่ายเข้าไป'
              : 'ยังไม่มีไซต์ที่คุณดูแลอยู่ ให้เจ้าของมอบหมายไซต์ให้ก่อน'
          }
          action={
            isOwner ? (
              <Link href="/sites" className="btn-primary">
                <Plus className="size-4" />
                เพิ่มไซต์งาน
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((site, i) => {
            const p = timeProgress(site.start_date, site.end_date, today)
            const late = p.kind === 'ok' && p.daysLeft < 0
            return (
              <Link
                key={site.id}
                href={`/sites/${site.id}`}
                // ไล่ขึ้นมาทีละใบ ห่าง 50ms — บอกลำดับการอ่านโดยไม่ต้องเขียนอธิบาย
                style={{ animationDelay: `${i * 50}ms` }}
                className="card-surface animate-rise-in p-4 shadow-e1 transition-colors duration-100 hover:border-brand"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-ink">{site.name}</div>
                    <div className="truncate text-sm text-muted-token">
                      {site.client_name ?? 'ยังไม่ได้ระบุลูกค้า'}
                    </div>
                  </div>
                  <Badge tone={late ? 'urgent' : SITE_STATUS_TONE[site.status]} dot>
                    {late ? 'เลยกำหนด' : SITE_STATUS_LABEL[site.status]}
                  </Badge>
                </div>

                {/* แถบเวลาเท่านั้นในเฟสนี้ · แถบเก็บเงินและต้นทุนจะมาต่อกันตรงนี้
                    ตอน P2/P4 — วาดแถบที่เป็น 0 ไว้ก่อนคือการบอกว่าคำนวณแล้ว */}
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

                {isOwner && (
                  <div className="mt-3 border-t border-line-soft pt-2 text-sm tnum text-muted-token">
                    ค่างาน{' '}
                    <span className="font-semibold text-ink">
                      {site.contract_amount > 0 ? fmtBaht(site.contract_amount) : 'ยังไม่ได้ตั้ง'}
                    </span>
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      )}

      <p className="mt-5 rounded-lg border border-line-soft bg-surface-2 px-4 py-3 text-sm text-muted-token">
        แถบ <span className="font-medium text-ink-2">เก็บเงินแล้ว</span> และ{' '}
        <span className="font-medium text-ink-2">ต้นทุน</span> รวมถึงกำไรคงเหลือ
        จะขึ้นเมื่อเริ่มบันทึกรายรับ-รายจ่าย (เฟส P2) และลงชื่อคนเข้าไซต์ (เฟส P4)
        — ตอนนี้ระบบยังไม่มีข้อมูลพวกนั้น จึงยังไม่แสดงตัวเลขที่คำนวณไม่ได้
      </p>
    </>
  )
}
