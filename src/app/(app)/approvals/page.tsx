import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ClipboardCheck, Inbox } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { fmtBaht, fmtDate, todayInBangkok } from '@/lib/format'
import { INCOME_KIND_LABEL, PAY_METHOD_LABEL } from '@/lib/transactions'
import { EmptyState } from '@/components/ui/states'
import { DataError } from '@/components/ui/data-error'
import { ApprovalActions } from './approvals-client'

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

  const [{ data: rows, error }, { count }] = await Promise.all([
    q
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(0, PAGE_SIZE),
    sb.from('transactions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ])

  if (error) {
    console.error('[approvals] อ่านคิวไม่ได้', error.message)
    return (
      <DataError message="โหลดคิวอนุมัติไม่สำเร็จ" />
    )
  }

  const all = rows ?? []
  const hasMore = all.length > PAGE_SIZE
  const page = hasMore ? all.slice(0, PAGE_SIZE) : all
  const last = page[page.length - 1]

  // อายุของรายการในคิว — เทียบกับสิ้นวันนี้เวลาไทย ให้ของเมื่อวานนับเป็น 1 วัน
  // ค้างนานคือสัญญาณว่าหัวหน้าไซต์กำลังรอคำตอบ ไม่ใช่แค่ตัวเลขประดับ
  const endOfToday = Date.parse(`${todayInBangkok()}T23:59:59+07:00`)
  const ageDays = (iso: string) =>
    Math.max(0, Math.floor((endOfToday - Date.parse(iso)) / 86_400_000))

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink">รออนุมัติ</h1>
          <p className="mt-0.5 text-sm text-muted-token">
            รายจ่ายที่หัวหน้าไซต์คีย์เข้ามา · เรียงคนที่รอนานที่สุดไว้บนสุด
          </p>
        </div>
        {(count ?? 0) > 0 && (
          <span className="chip text-status-progress bg-status-progress-bg ring-status-progress-ring">
            <ClipboardCheck className="size-3.5" />
            <span className="tnum">{count}</span> รายการ
          </span>
        )}
      </div>

      {page.length === 0 ? (
        <EmptyState
          icon={Inbox}
          message="ไม่มีรายการรออนุมัติ — ทุกอย่างที่หัวหน้าไซต์คีย์เข้ามาถูกตรวจครบแล้ว"
          action={
            <Link href="/ledger" className="btn-secondary">
              ดูรายการทั้งหมด
            </Link>
          }
        />
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
                        {t.sites?.name ?? 'ไซต์'}
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

                <ApprovalActions id={t.id} amount={Number(t.amount)} />
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
