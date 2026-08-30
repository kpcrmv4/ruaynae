'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

/**
 * ธีมที่ใช้อยู่จริงรู้ได้เฉพาะบนเบราว์เซอร์ — เรนเดอร์ไอคอนตั้งแต่ฝั่งเซิร์ฟเวอร์
 * จะได้ hydration mismatch และ React จะทิ้ง DOM ฝั่งเซิร์ฟเวอร์ทั้งก้อน
 * จึงรอ mount ก่อน แล้วค่อยตัดสินใจว่าจะโชว์ดวงอาทิตย์หรือดวงจันทร์
 */
export function ThemeToggle() {
  const [mounted, setMounted] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  useEffect(() => setMounted(true), [])

  const isDark = resolvedTheme === 'dark'

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
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
