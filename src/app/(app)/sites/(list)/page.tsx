import { HardHat } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { fmtBaht, fmtDate, todayInBangkok } from '@/lib/format'
import { SITE_STATUSES, SITE_STATUS_LABEL, SITE_STATUS_TONE, isSiteStatus, timeProgress } from '@/lib/sites'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/states'
import { ListRow } from '@/components/ui/list-row'
import { ListToolbar, type FilterChip } from '@/components/ui/list-toolbar'
import { NewSiteButton } from '../sites-client'

export const metadata = { title: 'โครงการ' }

/**
 * PostgREST `or=(…)` แยกเงื่อนไขด้วยจุลภาคและใช้วงเล็บเป็นไวยากรณ์
 * คำค้นที่มีอักขระพวกนี้จะทำให้ทั้งคำสั่งเพี้ยน — ตัดทิ้งก่อนเสมอ
 *
 * `%` กับ `_` เป็นไวลด์การ์ดของ ilike ด้วย — ปล่อยผ่านแล้วคนพิมพ์ `%`
 * จะได้ผลลัพธ์ทุกแถวโดยไม่รู้ตัว ซึ่งอ่านเหมือนตัวกรองพัง
 */
const safeQuery = (q: string) => q.replace(/[,()\\%_]/g, ' ').trim().slice(0, 60)

export default async function SitesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  const [me, sp] = await Promise.all([getCurrentUser(), searchParams])
  const status = isSiteStatus(sp.status) ? sp.status : 'all'
  const q = safeQuery(sp.q ?? '')

  // 🔴 client ที่ผูกกับเซสชัน ไม่ใช่ secret key — "หัวหน้าโครงการเห็นเฉพาะโครงการตัวเอง"
  // จึงบังคับด้วย RLS ไม่ใช่ด้วย where ที่ผมอาจลืมใส่ในหน้าถัดไป
  const sb = await getSupabaseServer()

  const search = q ? `name.ilike.%${q}%,client_name.ilike.%${q}%` : null

  let listQuery = sb
    .from('sites')
    .select('id, name, client_name, start_date, end_date, status')
  if (status !== 'all') listQuery = listQuery.eq('status', status)
  if (search) listQuery = listQuery.or(search)

  // นับด้วย head-count ทีละสถานะ ไม่ใช่ดึงแถวมานับเอง — ลิสต์ที่ยาวเกิน
  // 1,000 แถวจะถูก PostgREST ตัดเงียบ ๆ แล้วตัวเลขบนชิปจะน้อยกว่าความจริง
  const countFor = async (s: (typeof SITE_STATUSES)[number] | 'all') => {
    let qb = sb.from('sites').select('id', { count: 'exact', head: true })
    if (s !== 'all') qb = qb.eq('status', s)
    if (search) qb = qb.or(search)
    const { count, error: cErr } = await qb
    if (cErr) {
      console.error('[sites] นับจำนวนไม่ได้', cErr.message)
      return undefined
    }
    return count ?? 0
  }

  // ค่างานอยู่ตาราง `site_finance` ที่หัวหน้าโครงการอ่านไม่ได้เลย
  // จึงดึงเฉพาะตอนเป็นเจ้าของ — ถ้าดึงทุกครั้งจะได้ลิสต์ว่างเงียบ ๆ
  // ซึ่งแยกไม่ออกจาก "ยังไม่มีใครตั้งค่างาน"
  const isOwner = me.role === 'owner'

  const [listResult, financeRows, workRows, ...counts] = await Promise.all([
    // .order() + .range() ทุกลิสต์ ไม่พึ่งค่าเริ่มต้นของ PostgREST
    listQuery.order('created_at', { ascending: false }).range(0, PAGE_SIZE - 1),
    isOwner
      ? sb
          .from('site_finance')
          .select('site_id, contract_amount')
          .order('site_id', { ascending: true })
          .range(0, PAGE_SIZE - 1)
          .then(({ data, error: fErr }) => {
            if (fErr) console.error('[sites] อ่านค่างานไม่ได้', fErr.message)
            return data ?? []
          })
      : Promise.resolve([]),
    // 🔴 จำนวนวันที่มีคนเข้าทำงาน มาจาก RPC ที่นับ distinct ในฐานข้อมูล —
    // ค่าเดียวกับ "วันที่ลงเวลา" บนการ์ดหน้าโครงการ · ไม่ใช่บวกแถวใน JS
    sb
      .rpc('site_money', {})
      .order('site_id', { ascending: true })
      .range(0, PAGE_SIZE - 1)
      .then(({ data, error: wErr }) => {
        if (wErr) console.error('[sites] อ่านจำนวนวันที่ลงเวลาไม่ได้', wErr.message)
        return data ?? []
      }),
    countFor('all'),
    ...SITE_STATUSES.map((s) => countFor(s)),
  ])

  const { data: sites, error } = listResult

  if (error) {
    console.error('[sites] อ่านรายการโครงการไม่ได้', error.message)
    return (
      <div className="rounded-lg border border-urgent-ring bg-urgent-bg p-6 text-center">
        <p className="text-sm text-urgent">โหลดรายการโครงการไม่สำเร็จ</p>
        <p className="mt-1 text-xs text-urgent">ลองรีเฟรชหน้านี้อีกครั้ง</p>
      </div>
    )
  }

  const filters: FilterChip[] = [
    { key: 'all', label: 'ทั้งหมด', count: counts[0] },
    ...SITE_STATUSES.map((s, i) => ({
      key: s,
      label: SITE_STATUS_LABEL[s],
      count: counts[i + 1],
    })),
  ]

  const contractOf = new Map(financeRows.map((f) => [f.site_id, Number(f.contract_amount)]))
  const attendanceDaysOf = new Map(
    workRows.map((w) => [w.site_id, Number(w.attendance_days)]),
  )
  const today = todayInBangkok()
  const rows = sites ?? []
  // ไม่มีผลการค้นหา กับ ยังไม่มีโครงการเลย เป็นคนละสถานะ — ข้อความเดียวกันทำให้
  // คนคิดว่าข้อมูลหายไปทั้งที่แค่ตัวกรองไม่ตรง
  const isSearching = q !== '' || status !== 'all'

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-ink">โครงการ</h1>
          <p className="mt-0.5 text-sm text-muted-token">
            {isOwner ? 'โปรเจ็คทั้งหมดในระบบ' : 'เฉพาะโครงการที่คุณดูแลอยู่ตอนนี้'}
          </p>
        </div>
        {isOwner && <NewSiteButton />}
      </div>

      <ListToolbar
        basePath="/sites"
        q={q}
        filters={filters}
        activeFilter={status}
        placeholder="ค้นหาชื่อโครงการหรือชื่อลูกค้า…"
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={HardHat}
          message={
            isSearching
              ? 'ไม่พบโครงการที่ตรงกับเงื่อนไขนี้ ลองล้างตัวกรองหรือเปลี่ยนคำค้น'
              : isOwner
                ? 'ยังไม่มีโครงการในระบบ เริ่มจากเพิ่มโครงการแรกเพื่อบันทึกรายรับรายจ่ายเข้าไป'
                : 'ยังไม่มีโครงการที่คุณดูแลอยู่ ให้เจ้าของมอบหมายโครงการให้ก่อน'
          }
          action={isOwner && !isSearching ? <NewSiteButton /> : undefined}
        />
      ) : (
        <div className="panel">
          {rows.map((s) => (
            <ListRow
              key={s.id}
              href={`/sites/${s.id}`}
              title={s.name}
              meta={
                /*
                  🔴 `truncate` บน span เปล่า ๆ ไม่ทำงาน — `overflow: hidden`
                  ไม่มีผลกับกล่องแบบ inline · สแปนจึงกว้างตามเนื้อหาจริงและดัน
                  แถวออกนอกจอ (วัดได้ 397px บนจอ 390px) โดยไม่มี ellipsis ให้เห็น
                  ว่าโดนตัด · ต้องเป็น block (หรือ inline-block) ก่อน
                */
                <span className="block truncate">
                  {s.client_name ? `${s.client_name} · ` : ''}
                  {fmtDate(s.start_date)} – {fmtDate(s.end_date)}
                </span>
              }
              aside={
                <>
                  {/* 🔴 สองตัวเลขที่เจ้าของถามบ่อยที่สุดตอนกวาดตาดูลิสต์:
                      "เดินไปกี่วันแล้ว" กับ "เหลือเวลาอีกเท่าไหร่" (สั่ง 4 ก.ย. 2569)
                      · วันที่ลงเวลาเป็นค่าเดียวกับบนการ์ดหน้าโครงการ นับวันไม่ซ้ำ
                      · โครงการที่ยังไม่ตั้งช่วงเวลาไม่วาดช่องเวลาเลย ดีกว่าวาด
                        "0 วัน" ที่อ่านเหมือนหมดเวลาแล้ว */}
                  {(attendanceDaysOf.get(s.id) ?? 0) > 0 && (
                    <span className="shrink-0 text-xs tnum text-muted-token">
                      ลงเวลา{' '}
                      <span className="font-semibold text-ink-2">
                        {attendanceDaysOf.get(s.id)}
                      </span>{' '}
                      วัน
                    </span>
                  )}
                  <TimeLeft startDate={s.start_date} endDate={s.end_date} today={today} />
                  {/* หัวหน้าโครงการไม่เห็นช่องนี้เลย — และไม่ใช่แค่ซ่อนบนหน้าจอ
                      ฐานข้อมูลไม่ยอมให้เขาอ่านตาราง site_finance ตั้งแต่แรก */}
                  {isOwner && (
                    <span className="text-sm font-semibold tnum text-ink">
                      {(contractOf.get(s.id) ?? 0) > 0
                        ? fmtBaht(contractOf.get(s.id))
                        : 'ยังไม่ได้ตั้งค่างาน'}
                    </span>
                  )}
                  <Badge tone={SITE_STATUS_TONE[s.status]} dot>
                    {SITE_STATUS_LABEL[s.status]}
                  </Badge>
                </>
              }
            />
          ))}
        </div>
      )}
    </>
  )
}

/**
 * เวลาที่เหลือของโครงการ — เลยกำหนดแล้วเป็นสีเตือน ไม่ใช่เลขติดลบเฉย ๆ
 *
 * ยังไม่ตั้งช่วงเวลา = ไม่วาดอะไรเลย · "เหลือ 0 วัน" อ่านเหมือนหมดเวลาแล้ว
 * ซึ่งเป็นคนละเรื่องกับ "ยังไม่มีใครตั้งกำหนดส่ง"
 */
function TimeLeft({
  startDate,
  endDate,
  today,
}: {
  startDate: string | null
  endDate: string | null
  today: string
}) {
  const p = timeProgress(startDate, endDate, today)
  if (p.kind !== 'ok') return null
  const late = p.daysLeft < 0
  return (
    <span
      className={`shrink-0 text-xs tnum ${late ? 'font-semibold text-urgent' : 'text-muted-token'}`}
    >
      {late ? `เลยมา ${Math.abs(p.daysLeft)} วัน` : `เหลือ ${p.daysLeft} วัน`}
    </span>
  )
}
