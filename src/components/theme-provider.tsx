'use client'

import { ThemeProvider as NextThemes } from 'next-themes'
import type { ReactNode } from 'react'

/**
 * โหมดสว่าง/มืดด้วยกลยุทธ์ class — ต้องตรงกับ `@custom-variant dark (&:where(.dark, .dark *))`
 * ใน globals.css · ถ้าเปลี่ยนเป็น attribute เมื่อไหร่ โทเคนโหมดมืดจะไม่ทำงานทั้งชุดโดยไม่มี error
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemes>
  )
}
