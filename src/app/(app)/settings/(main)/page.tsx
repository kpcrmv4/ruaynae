import { CalendarClock, ChevronRight, HardHat, Lock, SlidersHorizontal, Tags, Users } from 'lucide-react'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/current-user'
import { PushToggle } from '../push-client'
import { PwaCard } from '../pwa-card'
import { getBranding } from '@/lib/branding'
import { BrandingForm } from '../branding-form'
import { PasswordForm } from '../password-form'
import { StorageCard } from '../storage-card'

export const metadata = { title: 'ตั้งค่า' }

export default async function SettingsPage() {
  const [user, branding] = await Promise.all([getCurrentUser(), getBranding()])
  const isOwner = user.role === 'owner'

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-ink">ตั้งค่า</h1>
        <p className="mt-0.5 text-sm text-muted-token">แบรนด์ ผู้ใช้ แจ้งเตือน และหมวดค่าใช้จ่าย</p>
      </div>

      <section className="rounded-lg border border-line bg-surface">
        <div className="border-b border-line-soft px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">ชื่อบริษัทและโลโก้</h2>
          <p className="mt-0.5 text-xs text-muted-token">แสดงบนหน้าล็อกอินและหัวระบบ</p>
        </div>

        {isOwner ? (
          <BrandingForm initialName={branding.companyName} initialLogoUrl={branding.logoUrl} />
        ) : (
          /* ⚠️ ซ่อนฟอร์มคือความสุภาพ ไม่ใช่การควบคุมสิทธิ์
             สิทธิ์จริงอยู่ที่ RLS ของตาราง branding และการเช็ค role ใน API */
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-token">
            <Lock className="size-4 shrink-0" />
            เฉพาะเจ้าของกิจการเท่านั้นที่แก้ไขส่วนนี้ได้
          </p>
        )}
      </section>

      {/* บัญชี PIN ไม่มีรหัสผ่านให้เปลี่ยน — และไม่ควรมีปุ่มที่กดแล้วได้ 403
          กลับมา (§15: ทุก endpoint ต้องมีปุ่มที่เรียกมันจริง และ role ที่
          อนุญาตต้องตรงกับที่ปุ่มนั้นอยู่) */}
      {isOwner && (
        <section className="rounded-lg border border-line bg-surface">
          <div className="border-b border-line-soft px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">รหัสผ่านของคุณ</h2>
            <p className="mt-0.5 text-xs text-muted-token">
              ต้องกรอกรหัสปัจจุบันด้วย — เซสชันที่เปิดค้างอยู่ไม่ถือว่ารู้รหัส
            </p>
          </div>
          <PasswordForm />
        </section>
      )}

      {isOwner && (
        <Link
          href="/settings/users"
          className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3.5 transition-colors hover:border-brand"
        >
          <Users className="size-5 shrink-0 text-brand" strokeWidth={1.8} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">ผู้ใช้ระบบ</span>
            <span className="block text-xs text-muted-token">เพิ่ม แก้ไข ตั้ง PIN ใหม่ และปิดใช้งาน</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-token" />
        </Link>
      )}

      {/* คนงานเป็นคนละเรื่องกับผู้ใช้ระบบ (CLAUDE.md §5) — คนงานคือคนที่มีค่าแรง
          ต้องจ่าย ส่วนผู้ใช้ระบบคือคนที่ล็อกอินได้ · เจ้าของเข้าหน้าคนงานบ่อยกว่ามาก
          (จ้างเพิ่ม ปรับค่าแรง) จึงควรมีปุ่มของตัวเอง ไม่ใช่ซ่อนอยู่หลังแท็บ */}
      {isOwner && (
        <Link
          href="/settings/users?tab=workers"
          className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3.5 transition-colors hover:border-brand"
        >
          <HardHat className="size-5 shrink-0 text-brand" strokeWidth={1.8} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">คนงาน</span>
            <span className="block text-xs text-muted-token">เพิ่มคนงาน ตั้งค่าแรงรายคน และปิดใช้งาน</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-token" />
        </Link>
      )}

      {isOwner && (
        <Link
          href="/settings/categories"
          className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3.5 transition-colors hover:border-brand"
        >
          <Tags className="size-5 shrink-0 text-brand" strokeWidth={1.8} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">หมวดรายรับ-รายจ่าย</span>
            <span className="block text-xs text-muted-token">เพิ่ม เปลี่ยนลำดับ และปิดหมวดที่ไม่ใช้แล้ว</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-token" />
        </Link>
      )}

      {/* รายการปรับค่าแรง (OT · เบี้ยเลี้ยง · มาสาย) — ของที่กล่อง "ปรับค่าแรง"
          ในหน้าคนเข้าโครงการดึงไปใช้ · เป็นเงิน จึงเจ้าของเท่านั้น */}
      {isOwner && (
        <Link
          href="/settings/wage-adjustments"
          className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3.5 transition-colors hover:border-brand"
        >
          <SlidersHorizontal className="size-5 shrink-0 text-brand" strokeWidth={1.8} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">รายการปรับค่าแรง</span>
            <span className="block text-xs text-muted-token">
              OT เบี้ยเลี้ยง มาสาย — ตั้งยอดเริ่มต้นไว้ แล้วเลือกใช้ตอนติ๊กคนเข้าโครงการ
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-token" />
        </Link>
      )}

      {isOwner && (
        <Link
          href="/settings/recurring"
          className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3.5 transition-colors hover:border-brand"
        >
          <CalendarClock className="size-5 shrink-0 text-brand" strokeWidth={1.8} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">ค่าใช้จ่ายรายเดือน</span>
            <span className="block text-xs text-muted-token">
              เงินเดือน ค่าเช่า ค่าเน็ต — ตั้งครั้งเดียว ระบบลงให้ทุกเดือน
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-token" />
        </Link>
      )}

      {/* ติดตั้งแอปกับแจ้งเตือนเป็นเรื่องเดียวกันในหัวคนใช้ — วางติดกัน
          และเรียงตามลำดับที่ควรทำ: ติดตั้งก่อน แล้วค่อยเปิดแจ้งเตือน */}
      <PwaCard />

      {/* คีย์สาธารณะของ VAPID ถูกฝังใน JavaScript ตามการออกแบบ —
          มันเป็นคีย์สาธารณะ ไม่ใช่ความลับ · คีย์ส่วนตัวอยู่ฝั่งเซิร์ฟเวอร์เท่านั้น */}
      <PushToggle vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''} />

      {/* พื้นที่เก็บรูปเป็นเรื่องของค่าใช้จ่าย → เจ้าของเท่านั้น
          หัวหน้าโครงการไม่ได้ตัดสินใจเรื่องโควตาและไม่ควรเห็นภาพรวมทั้งระบบ */}
      {isOwner && <StorageCard />}
    </div>
  )
}
