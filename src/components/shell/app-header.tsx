import { HardHat } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import { NotificationBell, type NotificationItem } from '@/components/shell/notification-bell'

/**
 * แถบบนสุดของแอป — กระดิ่งกับปุ่มสลับธีม
 *
 * บนจอเล็กไม่มี sidebar ให้เห็นชื่อบริษัท แถบนี้จึงรับหน้าที่เป็น "หัวระบบ"
 * ของมือถือด้วย (DESIGN.md §5.7) · บนเดสก์ท็อป sidebar โชว์แบรนด์อยู่แล้ว
 * จึงเหลือแค่ปุ่มทางขวา ไม่ซ้ำซ้อน
 */
export function AppHeader({
  companyName,
  logoUrl,
  userId,
  items,
  unread,
}: {
  companyName: string
  logoUrl: string | null
  userId: string
  items: NotificationItem[]
  unread: number
}) {
  return (
    <header className="print-hide sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-canvas/90 px-4 py-2.5 backdrop-blur lg:px-6">
      <div className="flex min-w-0 items-center gap-2 lg:hidden">
        {/* พื้นขาวเมื่อมีโลโก้ · กรมท่าเมื่อยังไม่มี — เหตุผลเดียวกับหน้าล็อกอิน:
            โลโก้พื้นขาวบนกล่องเข้มอ่านออกเป็นรูปที่โหลดพัง ไม่ใช่แบรนด์ */}
        <span
          className={`flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-sm ${
            logoUrl ? 'border border-line bg-white' : 'bg-sidebar text-white'
          }`}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="size-full object-contain" />
          ) : (
            <HardHat className="size-4" strokeWidth={1.8} />
          )}
        </span>
        <span className="truncate text-sm font-bold text-ink">{companyName}</span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <NotificationBell userId={userId} items={items} unread={unread} />
        <ThemeToggle />
      </div>
    </header>
  )
}
