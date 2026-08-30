import { BottomNav } from '@/components/shell/bottom-nav'
import { Sidebar } from '@/components/shell/sidebar'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getBranding } from '@/lib/branding'

const ROLE_LABEL = {
  owner: 'เห็นทุกไซต์ · อนุมัติได้',
  site_supervisor: 'เห็นเฉพาะไซต์ที่ดูแล',
} as const

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  // ยิงคู่กัน ไม่ต่อคิว — สองอันนี้ไม่ได้ขึ้นต่อกัน
  const [user, branding] = await Promise.all([getCurrentUser(), getBranding()])

  return (
    <div className="flex min-h-svh">
      <Sidebar
        role={user.role}
        userName={user.fullName}
        roleLabel={ROLE_LABEL[user.role]}
        companyName={branding.companyName}
      />
      {/* min-w-0 บนคอลัมน์เนื้อหา ไม่งั้นตารางกว้าง ๆ จะดันทั้งหน้าให้เลื่อนออกด้านข้าง
          แทนที่จะเลื่อนอยู่ในกล่องของตัวเอง */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-5xl flex-1 p-4 lg:p-6">{children}</main>
        <BottomNav role={user.role} />
      </div>
    </div>
  )
}
