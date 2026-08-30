import { HardHat } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import { APP_NAME, APP_TAGLINE } from '@/lib/constants'

/** โทเคนที่ต้องมองเห็นด้วยตาว่าถูกต้องทั้งสองโหมด ไม่ใช่แค่ผ่านสคริปต์วัด */
const SWATCHES = [
  { name: 'brand', cls: 'bg-brand' },
  { name: 'brand-solid', cls: 'bg-brand-solid' },
  { name: 'income', cls: 'bg-income' },
  { name: 'expense', cls: 'bg-expense' },
  { name: 'bar-time', cls: 'bg-bar-time' },
  { name: 'bar-paid', cls: 'bg-bar-paid' },
  { name: 'bar-cost', cls: 'bg-bar-cost' },
  { name: 'sidebar', cls: 'bg-sidebar' },
]

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <div className="mb-6 flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-sidebar text-white">
          <HardHat className="size-6" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight text-ink">{APP_NAME}</h1>
          <p className="mt-0.5 text-sm text-muted-token">{APP_TAGLINE}</p>
        </div>
        <ThemeToggle />
      </div>

      <div className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink-2">P0 · ฐานระบบ</h2>
        <p className="mb-4 text-sm text-muted-token">
          Next.js 16 · Tailwind v4 · โทเคน Navy &amp; White ผ่านการวัดคอนทราสต์ 58 คู่ ทั้งสองโหมด
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SWATCHES.map((s) => (
            <div key={s.name} className="rounded-md border border-line-soft p-2">
              <div className={`mb-1.5 h-9 rounded-xs ${s.cls}`} />
              <div className="truncate text-xs text-muted-token">{s.name}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary">ปุ่มหลัก</button>
          <button className="btn-secondary">ปุ่มรอง</button>
          <button className="btn-danger">ปุ่มลบ</button>
        </div>
      </div>
    </main>
  )
}
