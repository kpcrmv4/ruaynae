import type { ReactNode } from 'react'
import { OwnerOnly } from '@/components/owner-only-layout'

/**
 * 🔴 role เช็คที่นี่ ไม่ใช่ใน page.tsx — segment ที่มี loading.tsx ถูกห่อด้วย
 * Suspense แล้วส่งหัว 200 ออกไปก่อน page จะได้ทำงาน `redirect()` ใน page
 * จึงกลายเป็นการเด้งฝั่ง client และหน้าตอบ 200 (CLAUDE.md §17 ข้อ 6)
 */
export default function McpLayout({ children }: { children: ReactNode }) {
  return <OwnerOnly>{children}</OwnerOnly>
}
