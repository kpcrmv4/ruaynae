'use client'

import { HardHat } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { navFor, type Role } from '@/components/shell/nav'

/**
 * sidebar เดสก์ท็อป — แผงกรมท่าเข้ม ไม่ใช่สีแบรนด์
 * แผงสีแบรนด์เต็ม ๆ คือสนามสีที่ใหญ่ที่สุดบนจอ วางตรงที่คนมองน้อยที่สุด
 * แล้วแย่งความสนใจไปจากพื้นที่เนื้องาน
 */
export function Sidebar({
  role,
  userName,
  roleLabel,
  companyName,
}: {
  role: Role
  userName: string
  roleLabel: string
  companyName: string
}) {
  // 🔴 คำนวณเมนูในฝั่ง client เอง ห้ามรับเป็น prop จาก Server Component
  // เพราะ icon เป็นคอมโพเนนต์ (ฟังก์ชัน) ซึ่งข้ามเส้น server→client ไม่ได้
  // อาการคือหน้า 500 พร้อมข้อความ "Functions cannot be passed directly to Client Components"
  const groups = navFor(role)
  const pathname = usePathname()
  // "/" ต้องเทียบแบบตรงตัว ไม่งั้นมันจะ active ทุกหน้า
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href))

  return (
    <nav className="sticky top-0 hidden h-svh w-61 shrink-0 flex-col overflow-y-auto border-r border-sidebar-line bg-sidebar px-2.5 py-4 lg:flex">
      <div className="flex items-center gap-2.5 px-2.5 pb-4">
        <span className="flex size-8.5 shrink-0 items-center justify-center rounded-md bg-white text-sidebar">
          <HardHat className="size-5" strokeWidth={1.8} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold text-sidebar-title">{companyName}</span>
          <span className="block truncate text-xs text-sidebar-fg-dim">ระบบรายรับ-รายจ่ายโปรเจ็ค</span>
        </span>
      </div>

      {groups.map((g) => (
        <div key={g.heading}>
          <div className="px-2.5 pt-4 pb-1.5 text-[11px] font-medium tracking-wide text-sidebar-fg-dim">
            {g.heading}
          </div>
          {g.items.map((item) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`mb-px flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-sm transition-colors ${
                  active
                    ? 'bg-sidebar-active-bg font-semibold text-sidebar-active-fg'
                    : 'text-sidebar-fg hover:bg-sidebar-hover'
                }`}
              >
                <item.icon className="size-5 shrink-0" strokeWidth={1.8} />
                {/* min-w-0 จำเป็น ไม่งั้น truncate ในลูกจะไม่ทำงานเพราะ flex item
                    มีความกว้างขั้นต่ำเท่าเนื้อหา */}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate leading-tight">{item.label}</span>
                  <span
                    className={`truncate text-[11px] font-normal leading-tight ${
                      active ? 'text-sidebar-active-fg/65' : 'text-sidebar-fg-dim'
                    }`}
                  >
                    {item.sub}
                  </span>
                </span>
              </Link>
            )
          })}
        </div>
      ))}

      <div className="mt-auto border-t border-sidebar-line px-2.5 pt-3">
        <div className="truncate text-sm font-semibold text-sidebar-title">{userName}</div>
        <div className="truncate text-xs text-sidebar-fg-dim">{roleLabel}</div>
      </div>
    </nav>
  )
}
