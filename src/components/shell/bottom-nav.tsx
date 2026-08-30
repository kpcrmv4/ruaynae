'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { LogOut, MoreHorizontal, Plus } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { BOTTOM_NAV, PRIMARY_ACTION, navFor, type Role } from '@/components/shell/nav'

/**
 * แถบล่างมือถือ 5 ช่อง
 *  1-2  เมนูหลัก
 *  3    ปุ่มกลมยกลอย — **ไอคอนอย่างเดียว ไม่มีป้าย** (งานที่ทำบ่อยที่สุด)
 *  4    เมนูหลัก
 *  5    "เพิ่มเติม" เสมอ → เปิดแผ่นเลื่อนขึ้นที่มีเมนูที่เหลือ
 */
export function BottomNav({ role }: { role: Role }) {
  // เหตุผลเดียวกับ Sidebar — icon เป็นฟังก์ชัน ส่งข้ามเส้นไม่ได้
  const groups = navFor(role)
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href))

  // เมนูที่ไม่ได้อยู่ใน 4 ช่องแรก ไปรวมกันใน "เพิ่มเติม"
  const inBar = new Set(BOTTOM_NAV.map((i) => i.href))
  const overflow = groups.map((g) => ({
    ...g,
    items: g.items.filter((i) => !inBar.has(i.href)),
  })).filter((g) => g.items.length > 0)

  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    const r = await fetch('/api/auth/logout', { method: 'POST' })
    if (r.ok) {
      router.refresh()
      router.push('/login')
    } else {
      setSigningOut(false)
    }
  }

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        {BOTTOM_NAV.slice(0, 2).map((i) => (
          <Slot key={i.href} href={i.href} label={i.label} active={isActive(i.href)}>
            <i.icon className="size-5.5" strokeWidth={1.8} />
          </Slot>
        ))}

        <Link
          href={PRIMARY_ACTION.href}
          aria-label={PRIMARY_ACTION.label}
          className="relative flex items-center justify-center"
        >
          <span className="absolute -top-5.5 flex size-14 items-center justify-center rounded-full border-3 border-surface bg-brand-solid text-white shadow-[0_6px_16px_rgb(0_0_0/0.28)] transition-transform active:scale-90">
            <Plus className="size-6.5" strokeWidth={2.2} />
          </span>
        </Link>

        {BOTTOM_NAV.slice(2).map((i) => (
          <Slot key={i.href} href={i.href} label={i.label} active={isActive(i.href)}>
            <i.icon className="size-5.5" strokeWidth={1.8} />
          </Slot>
        ))}

        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger
            aria-expanded={open}
            className="flex flex-col items-center justify-center gap-0.5 text-[10.5px] text-muted-token"
          >
            <MoreHorizontal className="size-5.5" strokeWidth={1.8} />
            เพิ่มเติม
          </Dialog.Trigger>

          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
            <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[80svh] overflow-y-auto rounded-t-xl border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
              <Dialog.Title className="px-4 pt-4 pb-1 text-base font-semibold text-ink">
                เพิ่มเติม
              </Dialog.Title>
              <Dialog.Description className="px-4 pb-3 text-sm text-muted-token">
                เมนูที่เหลือทั้งหมด
              </Dialog.Description>

              {overflow.map((g) => (
                <div key={g.heading}>
                  <div className="px-4 pt-2 pb-1 text-xs font-medium text-muted-token">
                    {g.heading}
                  </div>
                  {g.items.map((i) => (
                    <Link
                      key={i.href}
                      href={i.href}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 border-b border-line-soft px-4 py-3.5 last:border-b-0"
                    >
                      <i.icon className="size-5 shrink-0 text-brand" strokeWidth={1.8} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {i.label}
                        </span>
                        <span className="block truncate text-xs text-muted-token">{i.sub}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              ))}

              <div className="p-4">
                <button onClick={signOut} disabled={signingOut} className="btn-secondary w-full">
                  <LogOut className="size-4" />
                  {signingOut ? 'กำลังออกจากระบบ' : 'ออกจากระบบ'}
                </button>
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

function Slot({
  href,
  label,
  active,
  children,
}: {
  href: string
  label: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex min-w-0 flex-col items-center justify-center gap-0.5 text-[10.5px] ${
        active ? 'font-semibold text-brand' : 'text-muted-token'
      }`}
    >
      {children}
      <span className="truncate px-1">{label}</span>
    </Link>
  )
}
