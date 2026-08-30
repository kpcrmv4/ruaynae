import 'server-only'

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

/**
 * client ที่ใช้ secret key — **ข้ามผ่าน RLS ทั้งหมด**
 *
 * `import 'server-only'` ด้านบนทำให้ build พังทันทีถ้ามีใครเผลอ import
 * ไฟล์นี้เข้า client component แทนที่จะรู้ตัวตอนคีย์หลุดไปอยู่ในบันเดิลแล้ว
 *
 * ใช้ได้เฉพาะ: สร้าง/แก้ผู้ใช้ผ่าน Admin API · อ่านคอลัมน์ที่ถูก revoke (เช่น pin)
 * · งานเบื้องหลังที่ต้องข้าม RLS จริง ๆ
 * ห้ามใช้เป็นทางลัดเพื่อเลี่ยงการเขียน policy ให้ถูก
 */
export function getSupabaseAdmin() {
  const key = process.env.SUPABASE_SECRET_KEY
  if (!key) throw new Error('SUPABASE_SECRET_KEY is not configured')

  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
