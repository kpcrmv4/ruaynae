import { ChevronRight, Lock, Users } from 'lucide-react'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getBranding } from '@/lib/branding'
import { BrandingForm } from './branding-form'

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

      <section className="rounded-lg border border-line bg-surface px-4 py-6 text-center">
        <p className="text-sm text-muted-token">
          ส่วนแจ้งเตือน หมวดค่าใช้จ่าย และพื้นที่เก็บรูป จะเพิ่มในเฟสถัดไป
        </p>
      </section>
    </div>
  )
}
