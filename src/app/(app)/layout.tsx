import { AppHeader } from '@/components/shell/app-header'
import { PwaRegister } from '@/components/shell/pwa-register'
import { BottomNav } from '@/components/shell/bottom-nav'
import { InstallBanner } from '@/components/shell/install-banner'
import { Sidebar } from '@/components/shell/sidebar'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getBranding } from '@/lib/branding'
import { getSupabaseServer } from '@/lib/supabase/server'

const ROLE_LABEL = {
  owner: 'เห็นทุกไซต์ · อนุมัติได้',
  site_supervisor: 'เห็นเฉพาะไซต์ที่ดูแล',
} as const

/** กี่รายการในกล่องกระดิ่ง — เก่ากว่านั้นดูได้จากหน้าที่ลิงก์ไป */
const BELL_SIZE = 20

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  // ยิงคู่กัน ไม่ต่อคิว — สองอันนี้ไม่ได้ขึ้นต่อกัน
  const [user, branding] = await Promise.all([getCurrentUser(), getBranding()])
  const sb = await getSupabaseServer()

  // 🔴 RLS คุมอยู่แล้วว่าเห็นได้เฉพาะของตัวเอง — ไม่ต้องมี `.eq('user_id')`
  // แต่ `.order()` + `.range()` ยังต้องมีเสมอ ไม่พึ่งค่าเริ่มต้นของ PostgREST
  // 🔴 ตัวเลขบนกระดิ่งนับในฐานข้อมูล ไม่ใช่ `items.filter().length`
  // ซึ่งจะหยุดเพิ่มที่ 20 แล้วคนจะเชื่อว่าค้างอยู่แค่นั้น
  const [{ data: items, error: nErr }, { count, error: cErr }, { count: pendingCount, error: pErr }] =
    await Promise.all([
      sb
        .from('notifications')
        .select('id, kind, title, body, link, read_at, created_at')
        .order('created_at', { ascending: false })
        .range(0, BELL_SIZE - 1),
      sb
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null),
      // ตัวเลขค้างอนุมัติบนเมนู — เฉพาะเจ้าของ (ช่อง "รออนุมัติ" มีแค่ฝั่งนั้น)
      // หัวหน้าไซต์ไม่ยิง query นี้เลย ไม่ใช่ยิงแล้วเอาไปซ่อน
      user.role === 'owner'
        ? sb.from('transactions').select('id', { count: 'exact', head: true }).eq('status', 'pending')
        : Promise.resolve({ count: 0, error: null }),
    ])

  if (nErr || cErr || pErr) {
    // กระดิ่ง/ตัวเลขเมนูพังต้องไม่ทำให้ทั้งแอปพัง — บันทึกไว้แล้วแสดงเป็นค่าว่าง
    console.error('[shell] อ่านแจ้งเตือนไม่ได้', nErr?.message ?? cErr?.message ?? pErr?.message)
  }

  return (
    <div className="flex min-h-svh">
      {/* ลงทะเบียน service worker + ตั้งตัวเลขบนไอคอนแอป · ไม่มี UI */}
      <PwaRegister unread={count ?? 0} />
      <Sidebar
        role={user.role}
        userName={user.fullName}
        roleLabel={ROLE_LABEL[user.role]}
        companyName={branding.companyName}
        logoUrl={branding.logoUrl}
        pendingCount={pendingCount ?? 0}
      />
      {/* min-w-0 บนคอลัมน์เนื้อหา ไม่งั้นตารางกว้าง ๆ จะดันทั้งหน้าให้เลื่อนออกด้านข้าง
          แทนที่จะเลื่อนอยู่ในกล่องของตัวเอง */}
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          companyName={branding.companyName}
          logoUrl={branding.logoUrl}
          userId={user.id}
          items={items ?? []}
          unread={count ?? 0}
        />
        <main className="mx-auto w-full max-w-5xl flex-1 p-4 lg:p-6">
          {/* คำชวนติดตั้งแอป → หลังติดตั้งแล้วเปลี่ยนเป็นคำชวนเปิดแจ้งเตือน
              คีย์สาธารณะของ VAPID ถูกฝังใน JS ตามการออกแบบ ไม่ใช่ความลับ */}
          <InstallBanner vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''} />
          {children}
        </main>
        <BottomNav
          role={user.role}
          userName={user.fullName}
          roleLabel={ROLE_LABEL[user.role]}
          pendingCount={pendingCount ?? 0}
        />
      </div>
    </div>
  )
}
