import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { fmtBaht, todayInBangkok } from '@/lib/format'
import { TXN_STATUS_LABEL, TXN_STATUS_TONE } from '@/lib/transactions'
import { Badge } from '@/components/ui/badge'
import { EntryForm } from './entry-form'
import { DataError } from '@/components/ui/data-error'

export const metadata = { title: 'บันทึกรายรับ-รายจ่าย' }

type Search = { kind?: string; site?: string }

export default async function EntryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [me, sp] = await Promise.all([getCurrentUser(), searchParams])
  const sb = await getSupabaseServer()
  const today = todayInBangkok()
  const isOwner = me.role === 'owner'

  // 🔴 รายชื่อโครงการมาจาก RLS ไม่ใช่จาก where ที่เขียนเอง — หัวหน้าโครงการจึงเห็น
  // เฉพาะโครงการที่ดูแล **ณ วันนี้** โดยอัตโนมัติ · คนที่เพิ่งถูกย้ายออกจะไม่เห็น
  // โครงการเดิมในกล่องเลือกทันที โดยไม่ต้องมีโค้ดตรงนี้รู้เรื่องนั้นเลย
  const [{ data: sites, error: sErr }, { data: categories, error: cErr }, { data: mine, error: mErr }] =
    await Promise.all([
      sb
        .from('sites')
        .select('id, name')
        .in('status', ['planning', 'active', 'paused'])
        .order('name', { ascending: true })
        .range(0, PAGE_SIZE - 1),
      sb
        .from('categories')
        .select('id, name, kind')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .range(0, PAGE_SIZE * 4 - 1),
      // รายการที่ฉันคีย์วันนี้ — โชว์ใต้ฟอร์มให้เห็นว่า "คีย์ไปถึงไหนแล้ว"
      // บันทึกเสร็จ router.refresh() จะทำให้ลิสต์นี้อัปเดตเองโดยไม่ต้องมี state
      sb
        .from('transactions')
        .select('id, kind, amount, status, note, categories(name)')
        .eq('txn_date', today)
        .eq('created_by', me.id)
        .order('created_at', { ascending: false })
        .range(0, PAGE_SIZE - 1),
    ])

  if (sErr || cErr || mErr) {
    console.error('[entry] โหลดตัวเลือกไม่ได้', sErr?.message ?? cErr?.message ?? mErr?.message)
    return <DataError message="โหลดหน้าบันทึกไม่สำเร็จ" />
  }

  const todayRows = mine ?? []
  // ยอดสะสมของวัน — ไม่รวมที่ถูกตีกลับ (มันไม่นับเข้ายอดไหนแล้ว)
  const daySum = (kind: 'income' | 'expense') =>
    todayRows
      .filter((t) => t.kind === kind && t.status !== 'rejected')
      .reduce((s, t) => s + Number(t.amount), 0)
  const dayExpense = daySum('expense')
  const dayIncome = daySum('income')

  // 🔴 `?site=` ต้องอยู่ในลิสต์ที่ RLS คืนมาจริงเท่านั้น — ไม่เชื่อค่าจาก URL
  // ตรง ๆ · โครงการที่ปิดงานแล้วหรือโครงการที่คนนี้ไม่ได้ดูแลจะตกไปใช้ค่าเริ่มต้นเดิม
  // (กล่องเลือกโครงการในฟอร์มแสดงชื่อโครงการที่จะบันทึกจริงเสมอ)
  const requestedSite = (sites ?? []).some((s) => s.id === sp.site) ? sp.site : undefined

  return (
    <>
      <EntryForm
        role={me.role}
        today={today}
        sites={sites ?? []}
        categories={categories ?? []}
        initialKind={isOwner && sp.kind === 'income' ? 'income' : 'expense'}
        initialSiteId={requestedSite}
      />

      {/* ── ที่คีย์ไปแล้ววันนี้ — จังหวะ "บันทึกต่อเนื่อง" ────────────────
          คีย์บิลเป็นตั้งแล้วเห็นทันทีว่าลงครบไหม รายการไหนรออนุมัติ/ถูกตีกลับ
          โดยไม่ต้องเดินออกไปหน้า ledger */}
      {todayRows.length > 0 && (
        <section className="mx-auto mt-5 w-full max-w-xl">
          <div className="panel">
            <div className="panel-head">
              วันนี้คีย์แล้ว {todayRows.length} รายการ
              <span className="ml-auto text-xs font-normal tnum text-muted-token">
                {dayExpense > 0 && `ออก ${fmtBaht(dayExpense)}`}
                {dayExpense > 0 && dayIncome > 0 && ' · '}
                {dayIncome > 0 && `เข้า ${fmtBaht(dayIncome)}`}
              </span>
            </div>
            <ul>
              {todayRows.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-3 border-b border-line-soft px-3.5 py-2.5 last:border-b-0 md:px-4"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {t.note?.trim() || t.categories?.name || 'ไม่มีหมวด'}
                    </span>
                    {t.note?.trim() && (
                      <span className="block truncate text-xs text-muted-token">
                        {t.categories?.name ?? 'ไม่มีหมวด'}
                      </span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 text-sm font-bold tnum ${
                      t.kind === 'income' ? 'text-income' : 'text-expense'
                    }`}
                  >
                    {t.kind === 'income' ? '+' : '−'}
                    {fmtBaht(Number(t.amount))}
                  </span>
                  <Badge tone={TXN_STATUS_TONE[t.status]}>{TXN_STATUS_LABEL[t.status]}</Badge>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  )
}
