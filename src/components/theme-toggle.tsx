'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useIsClient } from '@/lib/use-is-client'

/**
 * ธีมที่ใช้อยู่จริงรู้ได้เฉพาะบนเบราว์เซอร์ — เรนเดอร์ไอคอนตั้งแต่ฝั่งเซิร์ฟเวอร์
 * จะได้ hydration mismatch และ React จะทิ้ง DOM ฝั่งเซิร์ฟเวอร์ทั้งก้อน
 * จึงรอ mount ก่อน แล้วค่อยตัดสินใจว่าจะโชว์ดวงอาทิตย์หรือดวงจันทร์
 */
export function ThemeToggle() {
  const mounted = useIsClient()
  const { resolvedTheme, setTheme } = useTheme()

  const isDark = resolvedTheme === 'dark'

  /**
   * 🔴 `aria-label` ต้องผ่าน `mounted` เหมือนไอคอนและข้อความ ห้ามอ่าน `isDark` ตรง ๆ
   *
   * ฝั่งเซิร์ฟเวอร์ `resolvedTheme` เป็น `undefined` เสมอ → ได้ "เปลี่ยนเป็นโหมดมืด"
   * พอเครื่องผู้ใช้ตั้งโหมดมืดไว้ ฝั่งเบราว์เซอร์จะได้ค่าตรงข้ามตั้งแต่เรนเดอร์แรก
   * แล้ว React ฟ้อง hydration mismatch แล้ว**ทิ้ง DOM ฝั่งเซิร์ฟเวอร์ก้อนนั้น**
   *
   * ที่หลุดรอดมานานเพราะมันเป็นแอตทริบิวต์ ไม่ใช่ข้อความบนจอ — ตาดูไม่เห็น
   * เห็นได้ทางเดียวคือคอนโซล และเห็นเฉพาะตอนเครื่องที่เปิดตั้งเป็นโหมดมืด
   */
  const label = mounted
    ? isDark
      ? 'เปลี่ยนเป็นโหมดสว่าง'
      : 'เปลี่ยนเป็นโหมดมืด'
    : 'สลับโหมดสว่างและมืด'

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={label}
      className="inline-flex shrink-0 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink-2 transition-colors hover:border-brand hover:text-brand"
    >
      {/* ก่อน mount ยังไม่รู้ธีม — จองพื้นที่ไว้ก่อนเพื่อไม่ให้ layout ขยับตอนไอคอนโผล่ */}
      <span className="size-4">
        {mounted ? isDark ? <Sun className="size-4" /> : <Moon className="size-4" /> : null}
      </span>
      <span className="hidden sm:inline">{mounted && isDark ? 'สว่าง' : 'มืด'}</span>
    </button>
  )
}
