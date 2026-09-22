import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { PAGE_SIZE } from '@/lib/constants'
import {
  AUDIT_ACTIONS, AUDIT_ACTION_LABEL, AUDIT_ACTION_TONE,
  changedFields, fieldValue, isAuditAction, tableLabel,
} from '@/lib/audit'
import { Badge } from '@/components/ui/badge'
import { DataError } from '@/components/ui/data-error'
import { EmptyState } from '@/components/ui/states'
import { PageHeader } from '@/components/ui/page-header'

export const metadata = { title: 'ประวัติการแก้ไข' }

type Search = { table?: string; action?: string; after?: string }

const timeFmt = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const [me, sp] = await Promise.all([getCurrentUser(), searchParams])
  // ซ่อนเมนูอย่างเดียวไม่พอ — คนพิมพ์ URL ตรงได้ · RLS ก็กันอีกชั้น
  if (me.role !== 'owner') redirect('/')

  const sb = await getSupabaseServer()
  const action = isAuditAction(sp.action) ? sp.action : 'all'
  const table = typeof sp.table === 'string' && /^[a-z_]{1,40}$/.test(sp.table) ? sp.table : 'all'

  let q = sb
    .from('audit_log')
    .select('id, table_name, row_id, action, actor, before, after, at, mcp_key_id')
  if (action !== 'all') q = q.eq('action', action)
  if (table !== 'all') q = q.eq('table_name', table)

  // 🔴 keyset ไม่ใช่ offset — `audit_log` โตตลอดเวลา แถวใหม่แทรกเข้ามา
  // ระหว่างที่กำลังเลื่อนดู แล้ว offset จะทำให้แถวซ้ำหรือหายโดยไม่มีใครรู้
  if (sp.after) {
    const [atCursor, idCursor] = sp.after.split('|')
    if (atCursor && idCursor) {
      q = q.or(`at.lt.${atCursor},and(at.eq.${atCursor},id.lt.${idCursor})`)
    }
  }

  const { data: rows, error } = await q
    .order('at', { ascending: false })
    .order('id', { ascending: false })
    .range(0, PAGE_SIZE)

  if (error) {
    console.error('[audit] อ่านประวัติไม่ได้', error.message)
    return (
      <DataError message="โหลดประวัติการแก้ไขไม่สำเร็จ" />
    )
  }

  const all = rows ?? []
  const hasMore = all.length > PAGE_SIZE
  const page = hasMore ? all.slice(0, PAGE_SIZE) : all
  const last = page[page.length - 1]

  // ชื่อคนทำ — `profiles` ที่หัวหน้าโครงการอ่านไม่ได้ แต่หน้านี้เป็นของเจ้าของ
  // และเราต้องการชื่อของคนที่อาจถูกปิดบัญชีไปแล้วด้วย จึงใช้ admin client
  const actorIds = [...new Set(page.map((r) => r.actor).filter((v): v is string => Boolean(v)))]
  const names = new Map<string, string>()
  if (actorIds.length > 0) {
    const { data: people, error: pErr } = await getSupabaseAdmin()
      .from('profiles')
      .select('id, full_name')
      .in('id', actorIds)
      .order('id', { ascending: true })
      .range(0, actorIds.length - 1)
    if (pErr) console.error('[audit] อ่านชื่อผู้ใช้ไม่ได้', pErr.message)
    for (const p of people ?? []) names.set(p.id, p.full_name)
  }

  // ตารางที่มีประวัติจริง — ทำเป็นชิปกรอง ไม่ใช่ลิสต์ที่พิมพ์ไว้ตายตัว
  // ซึ่งจะล้าสมัยทันทีที่มีตารางใหม่
  const tables = [...new Set(all.map((r) => r.table_name))].sort()

  const keep = (next: Partial<Search>) => {
    const p = new URLSearchParams()
    const t = next.table ?? (table === 'all' ? undefined : table)
    const a = next.action ?? (action === 'all' ? undefined : action)
    if (t && t !== 'all') p.set('table', t)
    if (a && a !== 'all') p.set('action', a)
    const s = p.toString()
    return s ? `/audit?${s}` : '/audit'
  }

  const isFiltered = table !== 'all' || action !== 'all'

  return (
    <>
      <PageHeader
        title="ประวัติการแก้ไข"
        subtitle={
          <>
            ใครแก้อะไร เมื่อไหร่ · บันทึกที่ระดับฐานข้อมูล{' '}
            <span className="font-medium text-ink-2">แก้หรือลบไม่ได้แม้แต่เจ้าของ</span>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap gap-1.5">
        <FilterChip href={keep({ action: 'all' })} active={action === 'all'}>
          ทุกการกระทำ
        </FilterChip>
        {AUDIT_ACTIONS.map((a) => (
          <FilterChip key={a} href={keep({ action: a })} active={action === a}>
            {AUDIT_ACTION_LABEL[a]}
          </FilterChip>
        ))}
      </div>

      {tables.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <FilterChip href={keep({ table: 'all' })} active={table === 'all'}>
            ทุกตาราง
          </FilterChip>
          {tables.map((t) => (
            <FilterChip key={t} href={keep({ table: t })} active={table === t}>
              {tableLabel(t)}
            </FilterChip>
          ))}
        </div>
      )}

      {page.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          message={
            isFiltered
              ? 'ไม่พบประวัติที่ตรงกับเงื่อนไขนี้ ลองล้างตัวกรอง'
              : 'ยังไม่มีประวัติการแก้ไข — จะเริ่มบันทึกทันทีที่มีการเพิ่มหรือแก้ข้อมูล'
          }
          action={isFiltered ? <Link href="/audit" className="btn-secondary">ล้างตัวกรอง</Link> : undefined}
        />
      ) : (
        <>
          <div className="panel">
            {page.map((r) => {
              const changes = r.action === 'UPDATE' ? changedFields(r.before, r.after) : []
              return (
                <div
                  key={r.id}
                  data-audit-row={r.id}
                  className="border-b border-line-soft px-3.5 py-3 last:border-b-0 md:px-4"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone={AUDIT_ACTION_TONE[r.action as keyof typeof AUDIT_ACTION_TONE] ?? 'pending'}>
                      {AUDIT_ACTION_LABEL[r.action as keyof typeof AUDIT_ACTION_LABEL] ?? r.action}
                    </Badge>
                    <span className="font-semibold text-ink">{tableLabel(r.table_name)}</span>
                    <span className="ml-auto text-sm tnum text-muted-token">
                      {timeFmt.format(new Date(r.at))}
                    </span>
                  </div>
                  <div className="mt-0.5 text-sm text-muted-token">
                    โดย{' '}
                    <span className="font-medium text-ink-2">
                      {/* actor ว่าง = trigger/seed/cron ทำ ไม่ใช่คน — ต้องบอกให้ต่างกัน
                          ไม่งั้นคนอ่านจะคิดว่าข้อมูลหาย */}
                      {r.actor ? (names.get(r.actor) ?? 'ผู้ใช้ที่ถูกลบแล้ว') : 'ระบบ'}
                    </span>
                    {/* 🔴 แถวที่ AI ทำแทนมี actor เป็นเจ้าของเหมือนกันทุกประการ
                        เพราะฟังก์ชัน MCP สวมสิทธิ์เจ้าของก่อนเขียน — ถ้าไม่บอกตรงนี้
                        ประวัติจะอ่านว่าเจ้าของนั่งกดเองทั้งที่สั่งผ่านแชท */}
                    {r.mcp_key_id && <span className="text-ink-2"> · ผ่านการเชื่อมต่อ AI</span>}
                  </div>

                  {changes.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {changes.map((c) => (
                        <li key={c.field} className="text-sm">
                          <span className="text-muted-token">{c.field}: </span>
                          <span className="text-urgent line-through">{fieldValue(c.before)}</span>
                          <span className="text-muted-token"> → </span>
                          <span className="font-medium text-income">{fieldValue(c.after)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>

          {hasMore && last && (
            <div className="mt-3 text-center">
              <Link
                href={`${keep({})}${keep({}).includes('?') ? '&' : '?'}after=${encodeURIComponent(`${last.at}|${last.id}`)}`}
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

function FilterChip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`rounded-sm border px-2.5 py-1.5 text-sm font-medium transition-colors duration-100 ${
        active
          ? 'border-ink bg-ink text-canvas'
          : 'border-line-strong bg-surface text-ink-2 hover:border-ink-2 hover:text-ink'
      }`}
    >
      {children}
    </Link>
  )
}
