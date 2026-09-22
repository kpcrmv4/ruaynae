import 'server-only'

import Link from 'next/link'
import {
  CalendarDays,
  ChevronRight,
  Inbox,
  Receipt,
  Undo2,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { fmtBaht, fmtDate } from '@/lib/format'
import { DataError } from '@/components/ui/data-error'

/**
 * การ์ด "งานวันนี้" ของหน้าแรก — กระดานงานประจำวันของ role นั้น
 *
 * ⚠️ **ตอนนี้ถูกปิดไว้ตามคำขอของเจ้าของ (4 ก.ย. 2569)** — หน้าแรกขึ้นแถบตัวเลข
 * กับรายการโครงการตรง ๆ · เปิดกลับมาได้ด้วยการตั้ง `SHOW_TODAY_BOARD = true`
 * ใน `src/app/(app)/(overview)/page.tsx` ที่เดียว
 *
 * แยกมาไว้ไฟล์นี้เพื่อให้ "ปิด" แปลว่าไม่ยิง query ทั้ง 5 ตัวด้วย ไม่ใช่แค่
 * ดึงข้อมูลมาแล้วไม่วาด — การ์ดที่ซ่อนอยู่ต้องไม่กินเวลาโหลดหน้าแรก
 */
export async function TodayBoard({
  today,
  activeCount,
  pendingCount,
  pendingTotal,
}: {
  /** วันนี้ตามเวลาไทย (YYYY-MM-DD) — ส่งมาจากหน้าเพื่อให้ทั้งหน้าใช้วันเดียวกัน */
  today: string
  /** จำนวนโครงการที่กำลังก่อสร้าง — มาจาก RPC `site_overview` ที่หน้าเรียกไปแล้ว */
  activeCount: number
  pendingCount: number
  pendingTotal: number
}) {
  const me = await getCurrentUser()
  const sb = await getSupabaseServer()
  const isOwner = me.role === 'owner'

  // เจ้าของเห็นรายการเงินวันนี้ทั้งบริษัท · หัวหน้าโครงการเห็นเฉพาะที่ตัวเองคีย์
  // (RLS กรองโครงการให้อยู่แล้ว แต่ "งานของฉันวันนี้" ต้องแคบกว่านั้นอีกชั้น)
  let todayTxnQ = sb.from('transactions').select('id, kind, amount, status').eq('txn_date', today)
  if (!isOwner) todayTxnQ = todayTxnQ.eq('created_by', me.id)

  const [
    { data: todayTxns, error: tErr },
    { count: todayTxnCount, error: tcErr },
    { data: todayAtt, error: aErr },
    { data: oldestPending, error: oErr },
    { count: rejectedCount, error: rErr },
  ] = await Promise.all([
    // แถวของ "หนึ่งวัน" มีเพดานธรรมชาติ (คนคีย์ไม่กี่สิบรายการ/วัน) จึงเอามาบวกได้
    // แต่ก็ยังนับจำนวนจริงจากฐานข้อมูลคู่กัน — ถ้าวันไหนทะลุเพดานที่ดึงมา
    // ป้ายจะติด "(บางส่วน)" แทนที่จะโชว์ยอดขาดเงียบ ๆ (§7)
    todayTxnQ.order('created_at', { ascending: false }).range(0, 199),
    (() => {
      let c = sb.from('transactions').select('id', { count: 'exact', head: true }).eq('txn_date', today)
      if (!isOwner) c = c.eq('created_by', me.id)
      return c
    })(),
    sb
      .from('attendance')
      .select('site_id')
      .eq('work_date', today)
      .order('site_id', { ascending: true })
      .range(0, 499),
    // รายการที่รอคิวนานที่สุด — เจ้าของเท่านั้น (คิวเป็นงานของเจ้าของ)
    isOwner
      ? sb
          .from('transactions')
          .select('created_at')
          .eq('status', 'pending')
          .order('created_at', { ascending: true })
          .range(0, 0)
      : Promise.resolve({ data: [] as { created_at: string }[], error: null }),
    // รายการของฉันที่ถูกตีกลับ — หัวหน้าโครงการเท่านั้น (ของเจ้าของอนุมัติเองตั้งแต่คีย์)
    !isOwner
      ? sb
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .eq('created_by', me.id)
          .eq('status', 'rejected')
      : Promise.resolve({ count: 0, error: null }),
  ])

  const loadError = tErr ?? tcErr ?? aErr ?? oErr ?? rErr
  if (loadError) {
    console.error('[overview] โหลดงานวันนี้ไม่ได้', loadError.message)
    return (
      <section className="mb-6">
        <DataError message="โหลดงานวันนี้ไม่สำเร็จ" />
      </section>
    )
  }

  const txns = todayTxns ?? []
  const txnCount = todayTxnCount ?? txns.length
  // แถวของวันเดียวเกินเพดานที่ดึงมา = ยอดที่บวกได้ไม่ครบ ต้องบอกตรง ๆ
  const sumsPartial = txnCount > txns.length
  const sumOf = (kind: 'income' | 'expense') =>
    txns
      .filter((t) => t.kind === kind && t.status !== 'rejected')
      .reduce((s, t) => s + Number(t.amount), 0)
  const todayIncome = sumOf('income')
  const todayExpense = sumOf('expense')
  const todayPendingOfMine = txns.filter((t) => t.status === 'pending').length

  const attRows = todayAtt ?? []
  const attPeople = attRows.length
  const attSites = new Set(attRows.map((r) => r.site_id)).size

  // อายุของรายการที่รอนานที่สุด — เทียบกับสิ้นวันนี้เวลาไทย เพื่อให้ของเมื่อวานนับเป็น 1 วัน
  const oldestAt = oldestPending?.[0]?.created_at
  const oldestDays = oldestAt
    ? Math.max(
        0,
        Math.floor((Date.parse(`${today}T23:59:59+07:00`) - Date.parse(oldestAt)) / 86_400_000),
      )
    : 0

  const unsignedSites = Math.max(0, activeCount - attSites)
  const rejected = rejectedCount ?? 0

  return (
    <section className="panel mb-6">
      <div className="panel-head">
        งานวันนี้
        <span className="ml-auto text-xs font-normal text-muted-token">{fmtDate(today)}</span>
      </div>

      {isOwner ? (
        <>
          {/* 🔴 ยอดรออนุมัติต้องมีที่ของตัวเอง ไม่ใช่หายไปเฉย ๆ (DESIGN.md §5.3)
              แถบเงินข้างล่างนับเฉพาะ approved — ตรงนี้คือที่ที่เงินค้างคิวถูกมองเห็น */}
          <TodayTaskRow
            href="/approvals"
            icon={Inbox}
            tone={pendingCount === 0 ? 'done' : oldestDays >= 2 ? 'urgent' : 'progress'}
            title="รออนุมัติ"
            status={
              pendingCount > 0
                ? `${pendingCount} รายการ · รวม ${fmtBaht(pendingTotal)}` +
                  (oldestDays >= 1 ? ` · เก่าสุดค้าง ${oldestDays} วัน` : '')
                : 'ไม่มีรายการค้าง — เคลียร์หมดแล้ว'
            }
          />
          <TodayTaskRow
            href="/attendance"
            icon={CalendarDays}
            tone={activeCount === 0 ? 'muted' : unsignedSites > 0 ? 'progress' : 'done'}
            title="คนเข้าโครงการวันนี้"
            status={
              activeCount === 0
                ? 'ยังไม่มีโครงการที่กำลังก่อสร้าง'
                : attPeople === 0
                  ? 'ยังไม่มีโครงการไหนลงชื่อวันนี้ — แตะเพื่อลง'
                  : `ลงแล้ว ${Math.min(attSites, activeCount)} จาก ${activeCount} โครงการ · รวม ${attPeople} คน` +
                    (unsignedSites > 0 ? ` · ยังไม่ลง ${unsignedSites} โครงการ` : '')
            }
          />
          <TodayTaskRow
            href={`/ledger?from=${today}&to=${today}`}
            icon={Receipt}
            tone={txnCount > 0 ? 'brand' : 'muted'}
            title="รายการเงินวันนี้"
            status={
              txnCount > 0
                ? `${txnCount} รายการ · เข้า ${fmtBaht(todayIncome)} · ออก ${fmtBaht(todayExpense)}` +
                  (sumsPartial ? ' (บางส่วน)' : '')
                : 'ยังไม่มีรายการวันนี้'
            }
          />
        </>
      ) : (
        <>
          <TodayTaskRow
            href="/attendance"
            icon={CalendarDays}
            tone={attPeople > 0 ? 'done' : 'progress'}
            title="ลงชื่อคนเข้าโครงการ"
            status={
              attPeople > 0
                ? `วันนี้ลงแล้ว ${attPeople} คน — แตะเพื่อเพิ่มหรือแก้`
                : 'ยังไม่ได้ลงชื่อวันนี้ — แตะเพื่อลง'
            }
          />
          <TodayTaskRow
            href="/entry"
            icon={Wallet}
            tone={txnCount > 0 ? 'brand' : 'muted'}
            title="บันทึกรายจ่าย"
            status={
              txnCount > 0
                ? `วันนี้คีย์แล้ว ${txnCount} รายการ · ${fmtBaht(todayExpense)}` +
                  (todayPendingOfMine > 0 ? ` · รออนุมัติ ${todayPendingOfMine}` : '') +
                  (sumsPartial ? ' (บางส่วน)' : '')
                : 'ยังไม่มี — แตะเพื่อบันทึกรายการแรก'
            }
          />
          {rejected > 0 && (
            <TodayTaskRow
              href="/ledger?status=rejected"
              icon={Undo2}
              tone="urgent"
              title="ตีกลับที่ต้องแก้"
              status={`${rejected} รายการ — แตะเพื่อดูเหตุผลแล้วคีย์ใหม่`}
            />
          )}
        </>
      )}
    </section>
  )
}

/** สีของช่องไอคอนในการ์ดงานวันนี้ — ความหมายเดียวกับ Badge ทั้งระบบ */
const TASK_TONE = {
  done: 'bg-status-done-bg text-status-done',
  progress: 'bg-status-progress-bg text-status-progress',
  urgent: 'bg-urgent-bg text-urgent',
  brand: 'bg-brand-tint text-brand-on-tint',
  muted: 'bg-surface-3 text-muted-token',
} as const

const TASK_STATUS_TEXT = {
  done: 'text-status-done',
  progress: 'text-status-progress',
  urgent: 'text-urgent',
  brand: 'text-ink-2',
  muted: 'text-muted-token',
} as const

/**
 * หนึ่งแถวของ "งานวันนี้" — ชื่องาน + สถานะที่บวกจากข้อมูลจริง + แตะเพื่อไปทำต่อ
 * ทั้งแถวเป็นลิงก์ (เป้าแตะสูง ~64px) ไม่ใช่ปุ่มเล็ก ๆ ท้ายแถว
 */
function TodayTaskRow({
  href,
  icon: Icon,
  tone,
  title,
  status,
}: {
  href: string
  icon: LucideIcon
  tone: keyof typeof TASK_TONE
  title: string
  status: string
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 border-b border-line-soft px-3.5 py-3 transition-colors duration-100 last:border-b-0 hover:bg-surface-2 active:bg-surface-2 md:px-4"
    >
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${TASK_TONE[tone]}`}
      >
        <Icon className="size-5" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-ink">{title}</span>
        <span className={`block truncate text-sm tnum ${TASK_STATUS_TEXT[tone]}`}>{status}</span>
      </span>
      <ChevronRight className="size-4.5 shrink-0 text-muted-token" strokeWidth={1.8} />
    </Link>
  )
}
