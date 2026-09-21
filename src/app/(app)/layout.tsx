import { AppHeader } from '@/components/shell/app-header'
import { PwaRegister } from '@/components/shell/pwa-register'
import { BottomNav } from '@/components/shell/bottom-nav'
import { InstallBanner } from '@/components/shell/install-banner'
import { Sidebar } from '@/components/shell/sidebar'
import type { NavBadges } from '@/components/shell/nav'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getBranding } from '@/lib/branding'
import { getSupabaseServer } from '@/lib/supabase/server'

const ROLE_LABEL = {
  owner: 'เห็นทุกโครงการ · อนุมัติได้',
  site_supervisor: 'เห็นเฉพาะโครงการที่ดูแล',
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
  const [
    { data: items, error: nErr },
    { count, error: cErr },
    { count: pendingCount, error: pErr },
    { count: rejectedCount, error: rErr },
    { count: advancePendingCount, error: apErr },
    { count: advanceRejectedCount, error: arErr },
  ] = await Promise.all([
      sb
        .from('notifications')
        // 🔴 `txn_id` มาด้วยเสมอ — กระดิ่งเอาไปต่อท้ายลิงก์เป็น `?focus=<id>`
        // เพื่อให้หน้าปลายทางชี้ได้ว่า "ใบนี้แหละที่แจ้งเตือนถึง" ไม่ใช่โยน
        // คนอ่านไปที่ลิสต์ยาว ๆ แล้วให้ไล่หาเอง
        .select('id, kind, title, body, link, read_at, created_at, txn_id')
        .order('created_at', { ascending: false })
        .range(0, BELL_SIZE - 1),
      sb
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null),
      // ตัวเลขค้างอนุมัติบนเมนู — เฉพาะเจ้าของ (ช่อง "รออนุมัติ" มีแค่ฝั่งนั้น)
      // หัวหน้าโครงการไม่ยิง query นี้เลย ไม่ใช่ยิงแล้วเอาไปซ่อน
      user.role === 'owner'
        ? sb.from('transactions').select('id', { count: 'exact', head: true }).eq('status', 'pending')
        : Promise.resolve({ count: 0, error: null }),
      // ตัวเลขของค้างบนเมนู "รายรับ-รายจ่าย" = รายการที่ถูกตีกลับและยังไม่ถูกแก้
      // 🔴 ไม่มีเงื่อนไข role — RLS เป็นคนกำหนดขอบเขตให้เอง: เจ้าของเห็นทุกใบ
      // ที่ตีกลับไปแล้วยังค้าง · หัวหน้าโครงการเห็นเฉพาะของโครงการตัวเองซึ่งเป็นใบ
      // ที่ต้องแก้แล้วส่งใหม่ · ทั้งสองคนอ่านได้ประโยคเดียวกันว่า "ค้างอยู่"
      sb.from('transactions').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
      // คำขอเบิกค่าแรงที่รอเจ้าของกด (R14) — บวกเข้าป้ายเดียวกับรายจ่ายที่คิว
      // "รออนุมัติ" เพราะมันคือกองงานกองเดียวกันของคนคนเดียวกัน
      user.role === 'owner'
        ? sb.from('advances').select('id', { count: 'exact', head: true }).eq('status', 'pending')
        : Promise.resolve({ count: 0, error: null }),
      // ของค้างของหัวหน้าโครงการ = คำขอที่ถูกตีกลับและยังไม่ได้แก้ส่งใหม่
      // 🔴 ไม่มีเงื่อนไข role — RLS เป็นคนกำหนดขอบเขต: เจ้าของเห็นทุกใบที่
      // ตีกลับไปแล้วยังค้าง · หัวหน้าโครงการเห็นเฉพาะของตัวเอง
      sb.from('advances').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
    ])

  if (nErr || cErr || pErr || rErr || apErr || arErr) {
    // กระดิ่ง/ตัวเลขเมนูพังต้องไม่ทำให้ทั้งแอปพัง — บันทึกไว้แล้วแสดงเป็นค่าว่าง
    console.error(
      '[shell] อ่านแจ้งเตือนไม่ได้',
      nErr?.message ?? cErr?.message ?? pErr?.message ?? rErr?.message
        ?? apErr?.message ?? arErr?.message,
    )
  }

  // ป้ายตัวเลขของทุกเมนู อยู่ที่เดียว — sidebar กับแถบล่างอ่านชุดเดียวกัน
  // เพิ่มเมนูที่มีของค้างในอนาคตให้เติมคีย์ตรงนี้ที่เดียว แล้วมันจะไปโผล่
  // ครบทั้งสองแถบ และถูกรวมยอดขึ้นปุ่ม "เพิ่มเติม" ให้เองถ้าเมนูนั้นถูกซ่อน
  const navBadges: NavBadges = {
    '/approvals': (pendingCount ?? 0) + (advancePendingCount ?? 0),
    '/ledger': rejectedCount ?? 0,
    '/advances': advanceRejectedCount ?? 0,
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
        badges={navBadges}
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
          badges={navBadges}
        />
      </div>
    </div>
  )
}
