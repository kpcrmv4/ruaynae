import { HardHat } from 'lucide-react'
import type { Metadata } from 'next'
import { LoginForm } from './login-form'
import { APP_TAGLINE } from '@/lib/constants'
import { getBranding } from '@/lib/branding'

export const metadata: Metadata = { title: 'เข้าสู่ระบบ' }

export default async function LoginPage() {
  const branding = await getBranding()
  // 🔴 อ่านสวิตช์ฝั่งเซิร์ฟเวอร์แล้วส่งลงไปเป็น prop
  // ห้ามมีฝาแฝด NEXT_PUBLIC_ เพราะปุ่มกับ route จะ drift จากกันได้
  // (ปุ่มหายแต่ route ยังเปิด หรือปุ่มโผล่แต่ route ตอบ 404)
  const demoEnabled = process.env.ENABLE_DEMO_LOGIN === '1'

  return (
    <main className="flex min-h-svh items-start justify-center px-4 py-10 sm:items-center">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          {/* ชื่อมาจากตาราง branding ซึ่ง anon อ่านได้ — หน้านี้ทำงานตอนยังไม่ล็อกอิน
              อ่านไม่ได้จะได้ค่าสำรองแทน หน้าล็อกอินห้ามพังเพราะโหลดชื่อบริษัทไม่ได้ */}
          <span className="mx-auto mb-3 flex size-14 items-center justify-center rounded-lg bg-sidebar text-white">
            <HardHat className="size-8" strokeWidth={1.6} />
          </span>
          <h1 className="text-lg font-bold text-ink">{branding.companyName}</h1>
          <p className="mt-0.5 text-sm text-muted-token">{APP_TAGLINE}</p>
        </div>

        <div className="rounded-lg border border-line bg-surface p-5 shadow-e1">
          <LoginForm demoEnabled={demoEnabled} />
        </div>
      </div>
    </main>
  )
}
