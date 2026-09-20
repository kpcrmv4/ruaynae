import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  Banknote,
  CalendarDays,
  FileCheck,
  FileText,
  Phone,
  MapPin,
  Receipt,
  ShieldCheck,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { fmtBaht, fmtDate, fmtDateLong, todayInBangkok } from '@/lib/format'
import { SITE_STATUS_LABEL, SITE_STATUS_TONE, timeProgress } from '@/lib/sites'
import { asNullableNumber, moneyBars } from '@/lib/money'
import { Badge } from '@/components/ui/badge'
import { Metric, MetricBar } from '@/components/ui/metric'
import { MoneyBars, OverrunBadge, SiteSummary } from '@/components/sites/money-bars'
import { CategoryTotals } from '@/components/sites/category-totals'
import { TxnDetailProvider } from '@/components/ledger/txn-detail'
import { TxnEditProvider } from '@/components/ledger/txn-edit'
import { TxnRow } from '@/components/ledger/txn-row'
import { DOC_KINDS, DOC_KIND_SHORT } from '@/lib/documents'
import { DocRow } from '@/components/documents/doc-row'
import {
  BOND_KIND_LABEL, BOND_STATUS_LABEL, BOND_STATUS_TONE, WARRANTY_DEFAULT_MONTHS, bondStatusOf,
} from '@/lib/bonds'
import { SiteDetailActions } from './site-detail-client'
import { BondReturnButton } from './bond-return'
import { PageHeader } from '@/components/ui/page-header'
import { DataError } from '@/components/ui/data-error'

/** กี่แถวล่าสุดที่โชว์ในหน้าโครงการ — ที่เหลืออยู่ที่ /ledger ซึ่งมีตัวกรองครบ */
const RECENT_TXN = 10

/** เอกสารล่าสุดของโครงการ — ที่เหลืออยู่ที่ /documents ซึ่งกรองตามโครงการได้ */
const RECENT_DOC = 5

export const metadata = { title: 'รายละเอียดโครงการ' }

export default async function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [me, { id }] = await Promise.all([getCurrentUser(), params])
  const sb = await getSupabaseServer()

  const { data: site, error } = await sb
    .from('sites')
    .select('id, name, client_name, client_phone, address, start_date, end_date, status')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[sites] อ่านโครงการไม่ได้', error.message)
    return (
      <DataError message="โหลดข้อมูลโครงการไม่สำเร็จ" />
    )
  }
  // 🔴 หัวหน้าโครงการที่ไม่ได้ดูแลโครงการนี้จะได้ 0 แถวจาก RLS → 404 ไม่ใช่หน้าเปล่า
  // หน้าเปล่าอ่านเหมือนระบบพัง และยังบอกใบ้ด้วยว่า "โครงการนี้มีอยู่จริงนะ"
  if (!site) notFound()

  const isOwner = me.role === 'owner'

  const [
    { data: crew },
    { data: milestones },
    people,
    money,
    txnResult,
    pickerSites,
    pickerCategories,
    catTotals,
    docResult,
    bondRow,
  ] = await Promise.all([
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
    // รายชื่อสำหรับกล่องมอบหมาย — หัวหน้าโครงการอ่าน profiles คนอื่นไม่ได้ตาม RLS
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
            if (pErr) console.error('[sites] อ่านรายชื่อหัวหน้าโครงการไม่ได้', pErr.message)
            return data ?? []
          })
      : Promise.resolve([]),
    // ยอดเงินของโครงการนี้ · RPC เป็น `security invoker` จึงคืน `null` ให้หัวหน้าโครงการ
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
          material: Number(row?.cost_material ?? 0),
          attendanceDays: Number(row?.attendance_days ?? 0),
        }
      }),
    // ── รายรับ-รายจ่ายล่าสุดของโครงการนี้ ────────────────────────────────
    // 🔴 ไม่มี `.eq('kind', …)` — RLS เป็นคนตัดสินว่าใครเห็นอะไร หัวหน้าโครงการ
    // จึงเห็นเฉพาะรายจ่ายโดยอัตโนมัติ ส่วนเจ้าของเห็นทั้งสองฝั่ง
    // ดึงเกินมา 1 แถวเพื่อรู้ว่ายังมีต่อ โดยไม่ต้องนับทั้งตาราง
    sb
      .from('transactions')
      .select(`
        id, kind, amount, txn_date, pay_method, status, note, income_kind, installment_no,
        rejected_reason, site_id, created_by, created_at, category_id, mcp_key_id, sites(name),
        categories(name), profiles!transactions_created_by_fkey(full_name), attachments(id)
      `)
      .eq('site_id', id)
      .order('txn_date', { ascending: false })
      .order('id', { ascending: false })
      .range(0, RECENT_TXN),
    // ตัวเลือกของกล่องแก้ไข — ชุดเดียวกับ `/entry` และ `/ledger`
    sb
      .from('sites')
      .select('id, name')
      .in('status', ['planning', 'active', 'paused'])
      .order('name', { ascending: true })
      .range(0, PAGE_SIZE - 1)
      .then(({ data, error: e }) => {
        if (e) console.error('[sites] อ่านรายชื่อโครงการไม่ได้', e.message)
        return data ?? []
      }),
    sb
      .from('categories')
      .select('id, name, kind')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .range(0, PAGE_SIZE * 4 - 1)
      .then(({ data, error: e }) => {
        if (e) console.error('[sites] อ่านหมวดไม่ได้', e.message)
        return data ?? []
      }),
    // ── ยอดรวมแยกหมวดของ **ทั้งโครงการ** ──────────────────────────────
    // 🔴 ไม่ใช่ผลบวกของ 10 แถวล่าสุดที่วาดอยู่ข้างล่าง — สรุปที่บวกมาจาก
    // หน้าต่างที่ตัดแล้วคือตัวเลขที่ผิดโดยดูน่าเชื่อถือ · ส่ง null ทั้งช่วงวัน
    // = ไม่จำกัดช่วง · RPC เป็น `security invoker` + เช็ค is_owner() ข้างใน
    // จึงคืน 0 แถวให้หัวหน้าโครงการเอง ไม่ต้องมี if ตรงนี้
    sb
      .rpc('report_by_category', { p_site: id })
      .order('total', { ascending: false })
      .range(0, PAGE_SIZE * 2 - 1)
      .then(({ data, error: e }) => {
        if (e) console.error('[sites] อ่านยอดรวมแยกหมวดไม่ได้', e.message)
        return data ?? []
      }),
    // เอกสารของโครงการนี้ (R12) — RLS ของ `documents` เป็น owner-only
    // หัวหน้าโครงการจึงได้ 0 แถวเอง ไม่ต้องมี if ตรงนี้ · ดึงเกินมา 1 แถว
    // เพื่อรู้ว่ายังมีต่อโดยไม่ต้องนับทั้งตาราง (§7)
    sb
      .from('documents')
      .select('id, kind, doc_no, status, doc_date, customer_name, total')
      .eq('site_id', id)
      .order('doc_date', { ascending: false })
      .order('id', { ascending: false })
      .range(0, RECENT_DOC)
      .then(({ data, error: e }) => {
        if (e) console.error('[sites] อ่านเอกสารของโครงการไม่ได้', e.message)
        return { rows: data ?? [], failed: Boolean(e) }
      }),
    // หลักประกันสัญญา (R11) — `site_finance` owner-only · หัวหน้าโครงการได้ null เอง
    sb
      .from('site_finance')
      .select(
        'contract_no, contract_date, bond_kind, bond_amount, bond_ref, handover_date, warranty_months, warranty_end, bond_returned_at, bond_returned_amount',
      )
      .eq('site_id', id)
      .maybeSingle()
      .then(({ data, error: e }) => {
        if (e) console.error('[sites] อ่านหลักประกันไม่ได้', e.message)
        return data ?? null
      }),
  ])

  const today = todayInBangkok()
  const bond = bondRow
    ? {
        contract_no: bondRow.contract_no,
        contract_date: bondRow.contract_date,
        bond_kind: bondRow.bond_kind,
        bond_amount: Number(bondRow.bond_amount),
        bond_ref: bondRow.bond_ref,
        handover_date: bondRow.handover_date,
        warranty_months: bondRow.warranty_months ?? WARRANTY_DEFAULT_MONTHS,
        warranty_end: bondRow.warranty_end,
        bond_returned_at: bondRow.bond_returned_at,
        bond_returned_amount: bondRow.bond_returned_amount === null ? null : Number(bondRow.bond_returned_amount),
      }
    : null
  const bondState = bond ? bondStatusOf(bond, today) : null
  // สถานะที่ปลายทางของปุ่มลัดยอมรับโครงการนี้ — ต้องตรงกับกล่องเลือกโครงการของสองหน้านั้น
  const canRecord = ['planning', 'active', 'paused'].includes(site.status)
  const canAttend = ['planning', 'active'].includes(site.status)
  const progress = timeProgress(site.start_date, site.end_date, today)
  const plannedTotal = (milestones ?? []).reduce((sum, m) => sum + Number(m.planned_amount), 0)
  const bars = moneyBars(money)
  const txnRows = txnResult.data ?? []
  const hasMoreTxn = txnRows.length > RECENT_TXN
  const recentTxns = hasMoreTxn ? txnRows.slice(0, RECENT_TXN) : txnRows
  const hasMoreDoc = docResult.rows.length > RECENT_DOC
  const recentDocs = hasMoreDoc ? docResult.rows.slice(0, RECENT_DOC) : docResult.rows

  return (
    <>
      {/* ลิงก์ "โครงการทั้งหมด" ที่เคยลอยอยู่เหนือหัวข้อถูกยุบมาเป็นปุ่มย้อนกลับ
          ในแถวหัวข้อแทน (คำสั่งเจ้าของ 20 ก.ย. 2569) — ลูกศรสองอันซ้อนกันคนละที่
          บนหน้าเดียวคือความสับสน · ปุ่มถอยตามประวัติจริง และถ้าเปิดลิงก์ตรงเข้ามา
          จะพาไป `/sites` เหมือนลิงก์เดิมทุกประการ */}
      <PageHeader
        title={site.name}
        titleExtra={
          <Badge tone={SITE_STATUS_TONE[site.status]} dot>
            {SITE_STATUS_LABEL[site.status]}
          </Badge>
        }
        /* ไม่มีชื่อลูกค้า = ไม่เขียนอะไรเลย · "ยังไม่ได้ระบุ" กินบรรทัดเท่าข้อมูลจริง
           แต่ไม่ได้บอกอะไรใหม่ (เจ้าของสั่ง 4 ก.ย. 2569) */
        subtitle={site.client_name ? `ลูกค้า: ${site.client_name}` : undefined}
        action={
          isOwner ? (
            <SiteDetailActions
              site={site}
              contractAmount={money.contract ?? 0}
              bond={{
                contract_no: bond?.contract_no ?? null,
                contract_date: bond?.contract_date ?? null,
                bond_kind: bond?.bond_kind ?? null,
                bond_amount: bond?.bond_amount ?? 0,
                bond_ref: bond?.bond_ref ?? null,
                handover_date: bond?.handover_date ?? null,
                warranty_months: bond?.warranty_months ?? WARRANTY_DEFAULT_MONTHS,
              }}
              crew={crew ?? []}
              milestones={milestones ?? []}
              people={people}
            />
          ) : undefined
        }
        backHref="/sites"
      />

      {/* ── ปุ่มลัดของโครงการนี้ ─────────────────────────────────────────
          เปิดหน้าโครงการแล้วงานถัดไปเกือบทุกครั้งคือ "บันทึกของโครงการนี้" —
          เดิมต้องถอยออกไปเมนูรวมแล้วเลือกโครงการเดิมซ้ำอีกรอบ · ทุกปุ่มพาไปหน้าเดิม
          ของระบบพร้อมโครงการนี้ถูกเลือกไว้ให้แล้ว (สิทธิ์และลอจิกปลายทางเหมือนเดิมทุกอย่าง)

          🔴 ปุ่มบันทึก/ลงชื่อโผล่เฉพาะสถานะที่ปลายทาง**รับโครงการนี้ได้จริง** —
          กล่องเลือกโครงการของ `/entry` มีแค่ planning/active/paused และของ
          `/attendance` มีแค่ active/planning · ถ้าโชว์ปุ่มบนโครงการที่ปิดงานแล้ว
          กดไปจะเด้งไปโครงการอื่นเงียบ ๆ แล้วคนคีย์ลงผิดโครงการโดยไม่มีอะไรเตือน */}
      <nav aria-label="ทางลัดของโครงการนี้" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {canRecord && (
          <SiteAction
            href={`/entry?site=${site.id}`}
            icon={Wallet}
            tone="expense"
            label="บันทึกรายจ่าย"
          />
        )}
        {canRecord && isOwner && (
          <SiteAction
            href={`/entry?site=${site.id}&kind=income`}
            icon={Banknote}
            tone="income"
            label="บันทึกรายรับ"
          />
        )}
        {canAttend && (
          <SiteAction
            href={`/attendance?site=${site.id}`}
            icon={CalendarDays}
            tone="brand"
            label="ลงชื่อคนเข้าโครงการ"
          />
        )}
        <SiteAction
          href={`/ledger?site=${site.id}`}
          icon={Receipt}
          tone="brand"
          label="รายการของโครงการนี้"
        />
      </nav>

      {/* ── ความคืบหน้า — สามแถบ (DESIGN.md §5.1) ─────────────────────
          เวลา · เบิกเงินสะสม · ต้นทุนสะสม
          หัวหน้าโครงการเห็นแค่ยอดรายจ่าย ไม่มีเปอร์เซ็นต์ เพราะเปอร์เซ็นต์
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
        <SiteSummary bars={bars} />

        {bars.kind === 'ok' && bars.overrun && (
          <div className="mt-3">
            <OverrunBadge />
          </div>
        )}

        {bars.kind !== 'hidden' && (
          <p className="mt-3 border-t border-line-soft pt-3 text-xs text-muted-token">
            ต้นทุนนับจากรายจ่ายที่อนุมัติแล้ว บวกค่าแรงจากการลงชื่อคนเข้าโครงการ
            ซึ่งเกิดขึ้นทันทีที่ติ๊ก ไม่ต้องรออนุมัติ
          </p>
        )}
      </section>

      {/* ── ตัวเลขเงินสี่ตัว — เจ้าของเท่านั้น ─────────────────────────
          `hidden` = ไม่มีสิทธิ์เห็น → ไม่วาดอะไรเลย ดีกว่าวาด ฿0 ให้เข้าใจผิด */}
      {bars.kind !== 'hidden' && (
        <MetricBar>
          <Metric
            label="ค่างานตามสัญญา"
            value={bars.kind === 'ok' ? fmtBaht(bars.contract) : 'ยังไม่ได้ตั้ง'}
          />
          <Metric label="เบิกเงินสะสม" value={fmtBaht(bars.income)} tone="done" />
          <Metric label="ต้นทุนสะสม" value={fmtBaht(bars.cost)} />
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

      {/* ── หลักประกันสัญญา · ประกันผลงาน (R11) — เจ้าของเท่านั้น ──────────
          สถานะคิดจากวันที่ตอนอ่าน (สูตรเดียวกับ RPC bond_status) · ไม่มีคอลัมน์สถานะ
          ให้ใครต้องคอยอัปเดต · แถวที่ยังไม่ตั้งอะไรเลยไม่วาด — งานเอกชนไม่มีเรื่องนี้ */}
      {isOwner && bond && bondState && (bond.contract_no || bondState.status !== 'none') && (
        <section
          className={`panel mb-4 ${
            bondState.status === 'overdue'
              ? 'border-urgent-ring'
              : bondState.status === 'due_soon'
                ? 'border-status-progress-ring'
                : ''
          }`}
        >
          <div className="panel-head">
            <ShieldCheck className="size-4 shrink-0 text-muted-token" strokeWidth={1.8} />
            หลักประกันสัญญา · ประกันผลงาน
            {bondState.status !== 'none' && (
              <span className="ml-auto">
                <Badge tone={BOND_STATUS_TONE[bondState.status]} dot>
                  {BOND_STATUS_LABEL[bondState.status]}
                </Badge>
              </span>
            )}
          </div>

          {/* แถบสรุปตัวเลขที่ต้องเห็นก่อน — เลยมาแล้ว/เหลืออีกกี่วัน */}
          {(bondState.status === 'overdue' || bondState.status === 'due_soon') && bondState.daysLeft !== null && (
            <div
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 text-sm ${
                bondState.status === 'overdue'
                  ? 'border-urgent-ring bg-urgent-bg text-urgent'
                  : 'border-status-progress-ring bg-status-progress-bg text-status-progress'
              }`}
            >
              <span className="font-semibold">
                {bondState.status === 'overdue'
                  ? `ครบประกันผลงานมาแล้ว ${Math.abs(bondState.daysLeft)} วัน — ไปขอหลักประกันคืนได้`
                  : `อีก ${bondState.daysLeft} วันจะครบประกันผลงาน`}
              </span>
              <span className="tnum">· {fmtBaht(bond.bond_amount)}</span>
            </div>
          )}

          <dl className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-muted-token">เลขที่สัญญา · วันลงนาม</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 text-base text-ink">
                <FileCheck className="size-4 shrink-0 text-muted-token" />
                {bond.contract_no ?? <span className="text-muted-token">ยังไม่ได้ระบุ</span>}
                {bond.contract_date && (
                  <span className="text-sm text-muted-token">· {fmtDate(bond.contract_date)}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-token">หลักประกัน</dt>
              <dd className="mt-0.5 text-base text-ink">
                {bond.bond_kind ? (
                  <>
                    <span className="font-semibold tnum">{fmtBaht(bond.bond_amount)}</span>
                    <span className="text-sm text-muted-token"> · {BOND_KIND_LABEL[bond.bond_kind]}</span>
                    {bond.bond_ref && <span className="block text-sm text-muted-token">{bond.bond_ref}</span>}
                  </>
                ) : (
                  <span className="text-muted-token">ไม่มี</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-token">ส่งมอบงวดสุดท้าย → ครบประกัน</dt>
              <dd className="mt-0.5 text-base tnum text-ink">
                {bond.handover_date ? (
                  <>
                    {fmtDate(bond.handover_date)} → {fmtDate(bond.warranty_end)}
                    <span className="text-sm text-muted-token"> ({bond.warranty_months} เดือน)</span>
                  </>
                ) : (
                  <span className="text-muted-token">ยังไม่ได้ระบุวันส่งมอบ — ใส่ในกล่องแก้ไข</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-token">ได้รับคืน</dt>
              <dd className="mt-0.5 text-base text-ink">
                {bond.bond_returned_at ? (
                  <>
                    <span className="tnum">{fmtDate(bond.bond_returned_at)}</span>
                    {bond.bond_returned_amount !== null && (
                      <span className="font-semibold tnum text-income"> · {fmtBaht(bond.bond_returned_amount)}</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-token">ยังไม่ได้รับคืน</span>
                )}
              </dd>
            </div>
          </dl>

          {bond.bond_kind && bond.bond_amount > 0 && (bond.handover_date || bond.bond_returned_at) && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-4 py-3">
              <BondReturnButton
                siteId={site.id}
                bondKind={bond.bond_kind}
                bondAmount={bond.bond_amount}
                today={today}
                returned={
                  bond.bond_returned_at
                    ? { at: bond.bond_returned_at, amount: bond.bond_returned_amount ?? bond.bond_amount }
                    : null
                }
              />
              {!bond.bond_returned_at && bond.bond_kind === 'cash' && (
                <span className="text-xs text-muted-token">กดแล้วระบบลงรายรับของโครงการนี้ให้ทันที</span>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── หัวหน้าโครงการ ────────────────────────────────────────────── */}
      <section className="panel mb-4">
        <div className="panel-head">
          หัวหน้าโครงการ
          <span className="ml-auto text-xs font-normal text-muted-token">
            {(crew ?? []).length} รายการ
          </span>
        </div>
        {(crew ?? []).length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-token">
            ยังไม่มีใครดูแลโครงการนี้ — หัวหน้าโครงการจะเห็นและคีย์รายจ่ายของโครงการนี้ได้หลังถูกมอบหมาย
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
                      คนจะหายจากโครงการทันทีที่บันทึกการย้าย ทั้งที่ยังไม่ถึงวัน */}
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

      {/* ── เอกสารของโครงการนี้ (R12) — เจ้าของเท่านั้น ────────────────────
          ใบเสนอราคากับใบเสร็จของงานเดียวกันควรอยู่ตรงที่คนเปิดดูงานนั้น
          ไม่ใช่ให้เดินออกไปหน้ารวมแล้วกรองกลับมาเอง · ใบที่ไม่ผูกโครงการ
          (งานนอก ขายของเบ็ดเตล็ด) ไม่โผล่ตรงนี้ตามการออกแบบ */}
      {isOwner && (
        <section className="panel mt-4">
          <div className="panel-head">
            <FileText className="size-4 shrink-0 text-muted-token" strokeWidth={1.8} />
            เอกสารของโครงการนี้
            <Link
              href={`/documents?site=${site.id}`}
              className="ml-auto text-xs font-semibold text-brand hover:underline"
            >
              ดูทั้งหมด
            </Link>
          </div>

          {docResult.failed ? (
            <DataError message="โหลดเอกสารของโครงการนี้ไม่สำเร็จ" />
          ) : recentDocs.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-muted-token">
                ยังไม่มีเอกสารที่ผูกกับโครงการนี้
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {DOC_KINDS.map((k) => (
                  <Link
                    key={k}
                    href={`/documents/new?kind=${k}&site=${site.id}`}
                    className="btn-secondary"
                  >
                    สร้าง{DOC_KIND_SHORT[k]}
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <>
              <ul>
                {recentDocs.map((d) => (
                  <DocRow key={d.id} doc={d} showSite={false} showKind />
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-4 py-3">
                {DOC_KINDS.map((k) => (
                  <Link
                    key={k}
                    href={`/documents/new?kind=${k}&site=${site.id}`}
                    className="btn-secondary"
                  >
                    สร้าง{DOC_KIND_SHORT[k]}
                  </Link>
                ))}
                {hasMoreDoc && (
                  <Link
                    href={`/documents?site=${site.id}`}
                    className="ml-auto text-xs font-semibold text-brand hover:underline"
                  >
                    ยังมีอีก — ดูทั้งหมด
                  </Link>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {/* ── รายรับ-รายจ่ายของโครงการนี้ ──────────────────────────────────
          เดิมหน้านี้บอกแค่ "ยอดรวมเท่าไร" แล้วให้เดินออกไปอีกหน้าเพื่อดูว่า
          ยอดนั้นมาจากอะไร · ตัวเลขที่ไล่ที่มาไม่ได้คือตัวเลขที่ไม่มีใครเชื่อ
          · โชว์ล่าสุดแค่ RECENT_TXN แถว ที่เหลืออยู่ที่ /ledger ซึ่งมีตัวกรอง
          และแบ่งหน้าครบอยู่แล้ว — ลิสต์ยาวไม่จำกัดบนหน้าที่มีอย่างอื่นด้วย
          คือหน้าที่เลื่อนไม่จบ */}
      <TxnEditProvider
        me={{ id: me.id, role: me.role }}
        today={today}
        sites={pickerSites}
        categories={pickerCategories}
      >
       <TxnDetailProvider>
        <section className="panel mt-4">
          <div className="panel-head">
            รายรับ-รายจ่ายล่าสุด
            <Link
              href={`/ledger?site=${site.id}`}
              className="ml-auto text-xs font-semibold text-brand hover:underline"
            >
              ดูทั้งหมด
            </Link>
          </div>

          <CategoryTotals rows={catTotals} />

          {txnResult.error ? (
            <DataError message="โหลดรายการของโครงการนี้ไม่สำเร็จ" />
          ) : recentTxns.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-token">
              ยังไม่มีรายการของโครงการนี้
              {canRecord && ' — กดปุ่มบันทึกรายจ่ายด้านบนเพื่อเริ่มรายการแรก'}
            </p>
          ) : (
            <>
              {recentTxns.map((t) => (
                <TxnRow key={t.id} txn={t} showSite={false} showDate />
              ))}
              {hasMoreTxn && (
                <div className="px-4 py-3 text-center">
                  <Link href={`/ledger?site=${site.id}`} className="btn-secondary">
                    ดูรายการทั้งหมดของโครงการนี้
                  </Link>
                </div>
              )}
            </>
          )}
        </section>
       </TxnDetailProvider>
      </TxnEditProvider>
    </>
  )
}

/** สีกล่องไอคอนของปุ่มลัด — คำศัพท์เดียวกับแผ่น "บันทึกประจำวัน" ของแถบล่าง */
const ACTION_TONE = {
  expense: 'bg-expense-bg text-expense',
  income: 'bg-income-bg text-income',
  brand: 'bg-brand-tint text-brand-on-tint',
} as const

/** ปุ่มลัดหนึ่งช่อง — ทั้งช่องเป็นลิงก์ สูงพอสำหรับนิ้วโป้ง (≥56px) */
function SiteAction({
  href,
  icon: Icon,
  tone,
  label,
}: {
  href: string
  icon: LucideIcon
  tone: keyof typeof ACTION_TONE
  label: string
}) {
  return (
    <Link
      href={href}
      className="flex min-h-14 min-w-0 items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-e1 transition-colors duration-100 hover:border-brand active:bg-surface-2"
    >
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-md ${ACTION_TONE[tone]}`}
      >
        <Icon className="size-4.5" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{label}</span>
    </Link>
  )
}
