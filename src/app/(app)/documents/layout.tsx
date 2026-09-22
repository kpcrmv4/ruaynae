import type { ReactNode } from 'react'
import { OwnerOnly } from '@/components/owner-only-layout'

/**
 * เอกสารมีค่างานและกำไรอยู่ในตัว จึงเป็นของเจ้าของเหมือน `site_finance`
 * · เช็ค role ที่ layout ไม่ใช่ที่ page — ไม่งั้น `loading.tsx` จะกลืนการเด้ง
 *   แล้วหัวข้อความกลายเป็น 200 (CLAUDE.md §17 ข้อ 6)
 */
export default function Layout({ children }: { children: ReactNode }) {
  return <OwnerOnly>{children}</OwnerOnly>
}
