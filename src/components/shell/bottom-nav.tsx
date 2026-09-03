'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { ChevronRight, MoreHorizontal, Plus, UserRound } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  badgeOf,
  badgeText,
  badgeTotal,
  bottomNavFor,
  navFor,
  quickAddFor,
  type NavBadges,
  type QuickAddTone,
  type Role,
} from '@/components/shell/nav'
import { SignOutButton } from '@/components/shell/sign-out-button'
import { ThemeToggle } from '@/components/theme-toggle'

/**
 * แถบล่างมือถือ 5 ช่อง — จัดช่องตาม role (DESIGN.md §4.1)
 *  1    วันนี้ (หน้าแรก)
 *  2    งานประจำวันของ role นั้น — หัวหน้าโครงการ: คนเข้าโครงการ · เจ้าของ: รออนุมัติ
 *  3    ปุ่มกลมยกลอย **ไอคอนอย่างเดียว ไม่มีป้าย** → เปิดแผ่น "บันทึกประจำวัน"
 *  4    รายการ (/ledger) — คีย์เสร็จแล้วมาดูว่าลงไหม/โดนตีกลับไหม
 *  5    "เพิ่มเติม" เสมอ → แผ่นเลื่อนขึ้นที่มีเมนูที่เหลือ + ธีม + ออกจากระบบ
 *
 * ทุกช่องรับป้ายตัวเลขของค้างจาก `badges` (คีย์ = href) · ปุ่ม "เพิ่มเติม"
 * แสดง **ผลรวม**ของเมนูที่ถูกซ่อนอยู่ข้างใน
 */
export function BottomNav({
  role,
  userName,
  roleLabel,
  badges,
}: {
  role: Role
  userName: string
  roleLabel: string
  /** ตัวเลขของค้างต่อเมนู (คีย์ = href) — 0 หรือไม่มีคีย์ = ไม่วาดป้าย */
  badges: NavBadges
}) {
  // เหตุผลเดียวกับ Sidebar — icon เป็นฟังก์ชัน ส่งข้ามเส้น server→client ไม่ได้
  const groups = navFor(role)
  const slots = bottomNavFor(role)
  const quickAdd = quickAddFor(role)
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href))

  // เมนูที่ไม่ได้อยู่ในแถบล่าง ไปรวมกันใน "เพิ่มเติม"
  const inBar = new Set(slots.map((i) => i.href))
  const overflow = groups.map((g) => ({
    ...g,
    items: g.items.filter((i) => !inBar.has(i.href)),
  })).filter((g) => g.items.length > 0)

  // 🔴 ของค้างที่อยู่ในเมนูซึ่งถูกซ่อนไว้ในแผ่น "เพิ่มเติม" ต้องโผล่ที่ปุ่มด้วย
  // ไม่งั้นตัวเลขจะนอนรออยู่หลังปุ่มที่ไม่มีเหตุให้ใครกด
  const moreBadge = badgeTotal(overflow, badges)

  return (
    <>
      <nav
        data-nav="bottom"
        className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {slots.slice(0, 2).map((i) => (
          <Slot
            key={i.href}
            href={i.href}
            label={i.label}
            active={isActive(i.href)}
            badge={badgeOf(badges, i.href)}
          >
            <i.icon className="size-5.5" strokeWidth={1.8} />
          </Slot>
        ))}

        {/* ── ปุ่มกลาง: แผ่นบันทึกประจำวัน ─────────────────────────────
            ทุกการบันทึกที่ทำทุกวันอยู่ห่างไม่เกิน 2 แตะจากทุกหน้า
            ปุ่มใหญ่รายการแรกคือบันทึกรายจ่าย — งานที่ทำบ่อยที่สุดยังเร็วเท่าเดิม */}
        <Dialog.Root open={addOpen} onOpenChange={setAddOpen}>
          <Dialog.Trigger
            aria-label="บันทึกประจำวัน"
            aria-expanded={addOpen}
            className="relative flex items-center justify-center"
          >
            <span className="absolute -top-5.5 flex size-14 items-center justify-center rounded-full border-3 border-surface bg-brand-solid text-white shadow-[0_6px_16px_rgb(0_0_0/0.28)] transition-transform active:scale-90">
              <Plus className="size-6.5" strokeWidth={2.2} />
            </span>
          </Dialog.Trigger>

          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
            <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[80svh] overflow-y-auto rounded-t-xl border-t border-line bg-surface pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div aria-hidden className="mx-auto mt-2 h-1 w-9 rounded-full bg-line" />
              <Dialog.Title className="px-5 pt-2.5 text-base font-bold text-ink">
                บันทึกประจำวัน
              </Dialog.Title>
              <Dialog.Description className="px-5 pb-2 text-sm text-muted-token">
                {role === 'owner'
                  ? 'ทางลัดงานที่ต้องบันทึกทุกวัน — เริ่มได้จากทุกหน้า'
                  : 'ทางลัดงานที่ต้องบันทึกทุกวันของโครงการคุณ'}
              </Dialog.Description>

              {quickAdd.map((i) => (
                <Link
                  key={i.href}
                  href={i.href}
                  onClick={() => setAddOpen(false)}
                  className="flex items-center gap-3.5 border-t border-line-soft px-5 py-3.5 transition-colors duration-100 active:bg-surface-2"
                >
                  <span
                    className={`flex size-11 shrink-0 items-center justify-center rounded-lg ${TONE_BOX[i.tone]}`}
                  >
                    <i.icon className="size-5.5" strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold text-ink">
                      {i.label}
                    </span>
                    <span className="block truncate text-xs text-muted-token">{i.sub}</span>
                  </span>
                  <ChevronRight className="size-4.5 shrink-0 text-muted-token" strokeWidth={1.8} />
                </Link>
              ))}

              <div className="border-t border-line-soft p-4 pb-1">
                <Dialog.Close className="btn-secondary w-full">ปิด</Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {slots.slice(2).map((i) => (
          <Slot
            key={i.href}
            href={i.href}
            label={i.label}
            active={isActive(i.href)}
            badge={badgeOf(badges, i.href)}
          >
            <i.icon className="size-5.5" strokeWidth={1.8} />
          </Slot>
        ))}

        <Dialog.Root open={moreOpen} onOpenChange={setMoreOpen}>
          <Dialog.Trigger
            aria-expanded={moreOpen}
            aria-label={moreBadge > 0 ? `เพิ่มเติม · ค้าง ${moreBadge} รายการ` : undefined}
            className="flex flex-col items-center justify-center gap-0.5 text-[10.5px] text-muted-token"
          >
            <span className="relative flex">
              <MoreHorizontal className="size-5.5" strokeWidth={1.8} />
              {moreBadge > 0 && (
                <span
                  data-badge={moreBadge}
                  className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-urgent-solid px-1 text-[9.5px] font-bold leading-none text-white tnum"
                >
                  {badgeText(moreBadge)}
                </span>
              )}
            </span>
            เพิ่มเติม
          </Dialog.Trigger>

          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
            <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[80svh] overflow-y-auto rounded-t-xl border-t border-line bg-surface pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div aria-hidden className="mx-auto mt-2 h-1 w-9 rounded-full bg-line" />
              <Dialog.Title className="sr-only">เพิ่มเติม</Dialog.Title>
              <Dialog.Description className="sr-only">
                เมนูที่เหลือทั้งหมด และการตั้งค่าบัญชี
              </Dialog.Description>

              {/* ใครล็อกอินอยู่ เห็นในระดับไหน — บนเดสก์ท็อปมีท้าย sidebar บอก
                  บนมือถือไม่มี sidebar แผ่นนี้จึงรับหน้าที่นั้นแทน */}
              <div className="mx-4 mt-3 mb-1 flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3.5 py-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-on-tint">
                  <UserRound className="size-5" strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{userName}</span>
                  <span className="block truncate text-xs text-muted-token">{roleLabel}</span>
                </span>
                <ThemeToggle />
              </div>

              {overflow.map((g) => (
                <div key={g.heading}>
                  <div className="px-4 pt-2 pb-1 text-xs font-medium text-muted-token">
                    {g.heading}
                  </div>
                  {g.items.map((i) => {
                    const badge = badgeOf(badges, i.href)
                    return (
                      <Link
                        key={i.href}
                        href={i.href}
                        onClick={() => setMoreOpen(false)}
                        aria-label={badge > 0 ? `${i.label} · ค้าง ${badge} รายการ` : undefined}
                        className="flex items-center gap-3 border-b border-line-soft px-4 py-3.5 transition-colors duration-100 last:border-b-0 active:bg-surface-2"
                      >
                        <i.icon className="size-5 shrink-0 text-brand" strokeWidth={1.8} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">
                            {i.label}
                          </span>
                          <span className="block truncate text-xs text-muted-token">{i.sub}</span>
                        </span>
                        {/* ในแผ่นนี้ป้ายอยู่ในแถว ไม่ใช่มุมไอคอน — แถวกว้างเต็มจอ
                            ป้ายมุมไอคอนจะลอยอยู่กลางที่ว่างโดยไม่เกาะกับอะไร */}
                        {badge > 0 && (
                          <span
                            data-badge={badge}
                            className="shrink-0 rounded-full bg-urgent-solid px-1.5 py-px text-[11px] font-bold leading-tight text-white tnum"
                          >
                            {badgeText(badge)}
                          </span>
                        )}
                        <ChevronRight
                          className="size-4 shrink-0 text-muted-token"
                          strokeWidth={1.8}
                        />
                      </Link>
                    )
                  })}
                </div>
              ))}

              <div className="p-4">
                <SignOutButton className="btn-secondary w-full" />
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </nav>

      {/* กันเนื้อหาถูกแถบล่างบัง */}
      <div className="h-16 lg:hidden" aria-hidden />
    </>
  )
}

/** สีกล่องไอคอนของแผ่นบันทึกประจำวัน — รายจ่าย/รายรับใช้โทเคน MONEY ไม่ยืม status */
const TONE_BOX: Record<QuickAddTone, string> = {
  expense: 'bg-expense-bg text-expense',
  income: 'bg-income-bg text-income',
  brand: 'bg-brand-tint text-brand-on-tint',
}

function Slot({
  href,
  label,
  active,
  badge = 0,
  children,
}: {
  href: string
  label: string
  active: boolean
  /** ตัวเลขแดงมุมไอคอน — 0 = ไม่แสดง */
  badge?: number
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      aria-label={badge > 0 ? `${label} · ค้าง ${badge} รายการ` : undefined}
      className={`flex min-w-0 flex-col items-center justify-center gap-0.5 text-[10.5px] ${
        active ? 'font-semibold text-brand' : 'text-muted-token'
      }`}
    >
      <span className="relative flex">
        {children}
        {badge > 0 && (
          <span
            data-badge={badge}
            className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-urgent-solid px-1 text-[9.5px] font-bold leading-none text-white tnum"
          >
            {badgeText(badge)}
          </span>
        )}
      </span>
      <span className="truncate px-1">{label}</span>
    </Link>
  )
}
