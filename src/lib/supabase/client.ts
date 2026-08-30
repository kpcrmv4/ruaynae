'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/database.types'

/**
 * client สำหรับ client component — singleton
 *
 * สร้างใหม่ทุกครั้งที่เรนเดอร์ = เปิด websocket ของ realtime ซ้ำและหลุด session
 * ระหว่างแท็บ จึงต้องเก็บตัวเดิมไว้
 */
let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined

export function getSupabaseBrowser() {
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    )
  }
  return browserClient
}
