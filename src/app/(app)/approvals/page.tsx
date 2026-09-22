import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ClipboardCheck, HandCoins, Inbox } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { fmtBaht, fmtDate, fmtDateTime, todayInBangkok } from '@/lib/format'
import { INCOME_KIND_LABEL, PAY_METHOD_LABEL } from '@/lib/transactions'
import { EmptyState } from '@/components/ui/states'
import { DataError } from '@/components/ui/data-error'
import { ApprovalActions } from './approvals-client'
import { ApprovalDetailButton } from './approval-detail'
import { PageHeader } from '@/components/ui/page-header'

export const metadata = { title: 'รออนุมัติ' }

type Search = { after?: string }

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const [me, sp] = await Promise.all([getCurrentUser(), searchParams])

  // ซ่อนเมนูอย่างเดียวไม่พอ — คนพิมพ์ URL ตรงได้ ต้องกันที่หน้าเองด้วย
  // (สิทธิ์จริงอยู่ที่ RLS และ guard trigger · ตรงนี้แค่ไม่พาไปหน้าที่ทำอะไรไม่ได้)
  if (me.role !== 'owner') redirect('/')

  const sb = await getSupabaseServer()

  // 🔴 คิวเรียง **เก่าก่อน** ไม่ใช่ใหม่ก่อน — คนที่รอมานานที่สุดควรได้คำตอบก่อน
  // และการไล่จากบนลงล่างจะทำให้คิวว่างจริง ไม่ใช่เหลือของเก่าตกค้างท้ายลิสต์
  let q = sb
    .from('transactions')
    .select(`
      id, kind, amount, txn_date, pay_method, note, income_kind, installment_no,
      site_id, created_at, sites(name), categories(name), profiles!transactions_created_by_fkey(full_name),
      attachments(id)
    `)
    .eq('status', 'pending')

  if (sp.after) {
    const [afterAt, afterId] = sp.after.split('|')
    if (afterAt && afterId) {
      q = q.or(`created_at.gt.${afterAt},and(created_at.eq.${afterAt},id.gt.${afterId})`)
    }
  }

  const [
    { data: rows, error },
    { count },
    { data: advanceRows, error: aErr, count: advanceCount },
    { data: balances, error: bErr },
  ] = await Promise.all([
    q
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(0, PAGE_SIZE),
    sb.from('transactions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    // 🔴 คำขอเบิกค่าแรงที่หัวหน้าโครงการยื่นเข้ามา (R14) — คนละตารางกับรายจ่าย
    // แต่เป็นคิวของคนเดียวกัน · เรียงเก่าก่อนด้วยเหตุผลเดียวกัน
    sb
      .from('advances')
      .select(`
        id, amount, advance_date, note, created_at, employee_id,
        employees(full_name), sites(name),
        profiles!advances_created_by_fkey(full_name)
      `, { count: 'exact' })
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(0, PAGE_SIZE),
    // ยอดค้างจ่ายของทุกคนในคำสั่งเดียว — ไม่ใช่ยิง employee_balance ทีละคน (N+1)
    // · คนที่ไม่มีทั้งค่าแรงค้างและยอดเบิกจะไม่อยู่ในผลลัพธ์ = คงเหลือ ฿0
    sb.rpc('payroll_balances'),
  ])

  if (error || aErr || bErr) {
    console.error('[approvals] อ่านคิวไม่ได้', error?.message ?? aErr?.message ?? bErr?.message)
    return (
      <DataError message="โหลดคิวอนุมัติไม่สำเร็จ" />
    )
  }

  const all = rows ?? []
  const hasMore = all.length > PAGE_SIZE
  const page = hasMore ? all.slice(0, PAGE_SIZE) : all
  const last = page[page.length - 1]

  // คำขอเบิกหน้าแรก · ที่เหลือรออยู่จนกดเคลียร์ของหน้านี้ก่อน (คิวสั้นโดยธรรมชาติ)
  const advAll = advanceRows ?? []
  const advPage = advAll.slice(0, PAGE_SIZE)
  // ค่าแรงค้างจ่ายของคนนั้น ณ ตอนนี้ — ใช้เตือนว่ากำลังจะอนุมัติเกินเท่าไหร่
  // 🔴 **เตือน ไม่ใช่ห้าม** — เบิกเกินได้ (คำสั่งเจ้าของ 20 ก.ย. 2569)
  // คนที่ไม่อยู่ในผลลัพธ์ของ `payroll_balances()` = ไม่มีทั้งค่าแรงค้างและยอดเบิก
  const balanceOf = new Map(
    (balances ?? []).map((b) => [b.employee_id, Number(b.balance)] as const),
  )
  const pendingTotal = (count ?? 0) + (advanceCount ?? 0)

  // อายุของรายการในคิว — เทียบกับสิ้นวันนี้เวลาไทย ให้ของเมื่อวานนับเป็น 1 วัน
  // ค้างนานคือสัญญาณว่าหัวหน้าโครงการกำลังรอคำตอบ ไม่ใช่แค่ตัวเลขประดับ
  const endOfToday = Date.parse(`${todayInBangkok()}T23:59:59+07:00`)
  const ageDays = (iso: string) =>
    Math.max(0, Math.floor((endOfToday - Date.parse(iso)) / 86_400_000))

  return (
    <>
      <PageHeader
        title="รออนุมัติ"
        titleExtra={
          pendingTotal > 0 ? (
            <span className="chip text-status-progress bg-status-progress-bg ring-status-progress-ring">
              <ClipboardCheck className="size-3.5" />
              <span className="tnum">{pendingTotal}</span> รายการ
            </span>
          ) : null
        }
        subtitle="รายจ่ายและคำขอเบิกค่าแรงที่หัวหน้าโครงการส่งเข้ามา · เรียงคนที่รอนานที่สุดไว้บนสุด"
      />

      {/* ── คำขอเบิกค่าแรง (R14) ────────────────────────────────────────
          อยู่บนคิวรายจ่ายเพราะมันคือ **คนกำลังรอเงินอยู่หน้างาน** ไม่ใช่เอกสาร
          ที่รอตรวจ · ใบละไม่กี่วินาทีในการตัดสินใจ แต่ค้างหนึ่งวันแปลว่า
          ลูกน้องของหัวหน้าโครงการยังไม่ได้เงิน */}
      {advPage.length > 0 && (
        <section className="panel mb-5">
          <div className="panel-head">
            <HandCoins className="size-4 text-brand" />
            คำขอเบิกค่าแรง
            <span className="ml-auto text-xs font-normal tnum text-muted-token">
              {advanceCount ?? advPage.length} รายการ
            </span>
          </div>
          {advPage.map((a) => {
            const balance = balanceOf.get(a.employee_id) ?? 0
            // เหลือให้เบิกเท่าไหร่ก่อนจะเกินค่าแรงที่เขาทำมาแล้ว
            const over = Number(a.amount) - balance
            return (
              <div
                key={a.id}
                className="flex flex-wrap items-start gap-x-3 gap-y-2.5 border-b border-line-soft px-3.5 py-3.5 last:border-b-0 md:px-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-base font-bold tnum text-ink">
                      {fmtBaht(Number(a.amount))}
                    </span>
                    <span className="truncate font-semibold text-ink">
                      {a.employees?.full_name ?? 'คนงานที่ถูกลบแล้ว'}
                    </span>
                    <span className="chip border border-brand-tint-strong bg-brand-tint text-brand-on-tint ring-0">
                      {a.sites?.name ?? 'ไม่ระบุโครงการ'}
                    </span>
                  </div>
                  <div className="mt-0.5 text-sm text-muted-token">
                    {fmtDate(a.advance_date)}
                    {' · ยื่นโดย '}
                    <span className="font-medium text-ink-2">
                      {a.profiles?.full_name ?? 'ผู้ใช้ที่ถูกลบแล้ว'}
                    </span>
                    {ageDays(a.created_at) >= 1 && (
                      <>
                        {' · '}
                        <span
                          className={
                            ageDays(a.created_at) >= 2 ? 'font-semibold text-urgent' : undefined
                          }
                        >
                          ค้าง {ageDays(a.created_at)} วัน
                        </span>
                      </>
                    )}
                  </div>
                  {a.note && <div className="mt-0.5 text-sm text-ink-2">{a.note}</div>}
                  {/* 🔴 ตัวเลขที่เจ้าของต้องเห็นก่อนกด — ไม่ได้ปิดปุ่ม เพราะ
                      เจ้าของสั่งเองว่า "เบิกเกินได้ เดี๋ยวผมจะอนุมัติอีกที" */}
                  <div
                    data-advance-warning={over > 0 ? 'over' : 'ok'}
                    className={`mt-1 text-sm ${over > 0 ? 'text-urgent' : 'text-muted-token'}`}
                  >
                    {over > 0 ? (
                      <>
                        เกินค่าแรงค้างจ่าย <span className="font-semibold tnum">{fmtBaht(over)}</span>
                        {' · ส่วนที่เกินจะถูกหักคืนจากค่าแรงงวดถัดไปจนครบ'}
                      </>
                    ) : (
                      <>
                        ค่าแรงค้างจ่ายของเขาตอนนี้{' '}
                        <span className="font-semibold tnum">{fmtBaht(balance)}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                  <ApprovalActions id={a.id} amount={Number(a.amount)} kind="advance" />
                </div>
              </div>
            )
          })}
        </section>
      )}

      {page.length === 0 ? (
        advPage.length === 0 ? (
          <EmptyState
            icon={Inbox}
            message="ไม่มีรายการรออนุมัติ — ทุกอย่างที่หัวหน้าโครงการส่งเข้ามาถูกตรวจครบแล้ว"
            action={
              <Link href="/ledger" className="btn-secondary">
                ดูรายการทั้งหมด
              </Link>
            }
          />
        ) : null
      ) : (
        <>
          <div className="panel">
            {page.map((t) => (
              <div
                key={t.id}
                className="flex flex-wrap items-start gap-x-3 gap-y-2.5 border-b border-line-soft px-3.5 py-3.5 last:border-b-0 md:px-4"
              >
                {t.attachments.length > 0 && (
                  // สลิปคือหลักฐานเดียวที่เจ้าของมี — ต้องเห็นก่อนกดอนุมัติ
                  // ไม่ใช่ต้องกดเข้าไปดูทีละรายการ
                  <a
                    href={`/api/uploads/${t.attachments[0].id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/uploads/${t.attachments[0].id}?thumb=1`}
                      alt="สลิป"
                      loading="lazy"
                      // จอเล็กรูปใหญ่ขึ้น — สลิปคือหลักฐานที่ต้องอ่านก่อนกด ไม่ใช่ของประดับ
                      className="size-16 rounded-sm border border-line object-cover transition-colors hover:border-brand sm:size-14"
                    />
                  </a>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-base font-bold tnum text-expense">
                      −{fmtBaht(t.amount)}
                    </span>
                    <span className="truncate font-semibold text-ink">
                      {t.categories?.name ?? 'ไม่มีหมวด'}
                    </span>
                    {t.site_id ? (
                      <span className="chip border border-brand-tint-strong bg-brand-tint text-brand-on-tint ring-0">
                        {t.sites?.name ?? 'โครงการ'}
                      </span>
                    ) : (
                      <span className="chip border border-dashed border-line-strong text-muted-token ring-0">
                        ส่วนกลาง
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-sm text-muted-token">
                    {fmtDate(t.txn_date)} · {PAY_METHOD_LABEL[t.pay_method]}
                    {t.income_kind && ` · ${INCOME_KIND_LABEL[t.income_kind]}`}
                    {' · คีย์โดย '}
                    <span className="font-medium text-ink-2">
                      {t.profiles?.full_name ?? 'ผู้ใช้ที่ถูกลบแล้ว'}
                    </span>
                    {ageDays(t.created_at) >= 1 && (
                      <>
                        {' · '}
                        <span
                          className={
                            ageDays(t.created_at) >= 2 ? 'font-semibold text-urgent' : undefined
                          }
                        >
                          ค้าง {ageDays(t.created_at)} วัน
                        </span>
                      </>
                    )}
                  </div>
                  {t.note && <div className="mt-0.5 text-sm text-ink-2">{t.note}</div>}
                </div>

                {/* ดูให้ครบก่อนตัดสินใจ แล้วกดอนุมัติ/ตีกลับได้จากในกล่องเลย
                    · ปุ่มคู่เดิมยังอยู่ท้ายแถวสำหรับใบที่ดูแวบเดียวก็ตัดสินใจได้ */}
                <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                  <ApprovalDetailButton
                    txn={{
                      id: t.id,
                      amount: Number(t.amount),
                      categoryName: t.categories?.name ?? null,
                      siteName: t.site_id ? (t.sites?.name ?? 'โครงการ') : null,
                      dateLabel: fmtDate(t.txn_date),
                      payMethodLabel: PAY_METHOD_LABEL[t.pay_method],
                      incomeKindLabel: t.income_kind
                        ? `${INCOME_KIND_LABEL[t.income_kind]}${t.installment_no ? ` ${t.installment_no}` : ''}`
                        : null,
                      note: t.note,
                      createdByName: t.profiles?.full_name ?? 'ผู้ใช้ที่ถูกลบแล้ว',
                      createdAtLabel: fmtDateTime(t.created_at),
                      ageDays: ageDays(t.created_at),
                      attachments: t.attachments,
                    }}
                  />
                  <ApprovalActions id={t.id} amount={Number(t.amount)} />
                </div>
              </div>
            ))}
          </div>

          {hasMore && last && (
            <div className="mt-3 text-center">
              <Link
                href={`/approvals?after=${encodeURIComponent(`${last.created_at}|${last.id}`)}`}
                className="btn-secondary"
              >
                โหลดเพิ่ม
              </Link>
            </div>
          )}
        </>
      )}
    </>
  )
}
