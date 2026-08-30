import { NextResponse, type NextRequest } from 'next/server'
import { createResponseClient } from '@/lib/auth/response-client'

export const runtime = 'nodejs'

/** POST /api/auth/logout — ออกจากระบบเฉพาะเครื่องนี้ */
export async function POST(req: NextRequest) {
  const { client, applyCookies } = createResponseClient(req)

  const { data, error: uErr } = await client.auth.getUser()
  if (uErr || !data.user) {
    // 🔴 ต้องเป็น 401 JSON ไม่ใช่ 307 ไปหน้า login
    // route กลุ่ม /api ตรวจสิทธิ์เองและตอบ JSON เสมอ
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  }

  // scope 'local' — ค่าเริ่มต้นคือ 'global' ซึ่งจะเตะทุกอุปกรณ์ออกพร้อมกัน
  // กดออกจากระบบบนมือถือแล้วเครื่องที่ออฟฟิศหลุดด้วย คือเรื่องที่ไม่มีใครคาด
  const { error } = await client.auth.signOut({ scope: 'local' })
  if (error) {
    console.error('[logout] signOut ล้มเหลว', error.message)
    return NextResponse.json({ error: 'SIGNOUT_FAILED' }, { status: 500 })
  }

  return applyCookies(NextResponse.json({ ok: true }))
}
