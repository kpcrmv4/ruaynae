import { headers } from 'next/headers'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/page-header'
import { DataError } from '@/components/ui/data-error'
import { McpClient } from './mcp-client'

export const metadata = { title: 'เชื่อมต่อ AI' }

/**
 * 🔴 Claude เรียกเซิร์ฟเวอร์เราจาก **คลาวด์ของ Anthropic ไม่ใช่จากเครื่องผู้ใช้**
 * `http://localhost:3000/...` จึงไปตกที่เครื่องของ Anthropic แล้วล้มเหลว
 * ถ้าไม่เตือนตรงนี้ เจ้าของจะคัดลอก URL ไปวางแล้วมาบอกว่าเซิร์ฟเวอร์เสีย
 */
const PRIVATE_ORIGIN =
  /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/

export default async function McpPage() {
  const h = await headers()
  const host = h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const origin = `${proto}://${host}`

  const sb = await getSupabaseServer()

  // ทุกลิสต์ต้องมี order + range — ห้ามพึ่งค่าเริ่มต้นที่ตัดเงียบที่ 1,000 แถว
  const [{ data: keys, error: kErr }, { data: calls, error: cErr }] = await Promise.all([
    sb
      .from('mcp_keys')
      .select('id, label, key_prefix, created_at, last_used_at')
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .range(0, 49),
    sb
      .from('mcp_call_log')
      .select('id, tool, ok, ms, at')
      .order('at', { ascending: false })
      .range(0, 19),
  ])

  if (kErr || cErr) {
    console.error('[mcp] โหลดหน้าไม่สำเร็จ', kErr?.message ?? cErr?.message)
    return (
      <div className="space-y-5">
        <PageHeader title="เชื่อมต่อ AI" />
        <DataError message="โหลดรายการคีย์ไม่สำเร็จ" />
      </div>
    )
  }

  return (
    <McpClient
      origin={origin}
      isLocalOrigin={PRIVATE_ORIGIN.test(origin)}
      initialKeys={keys ?? []}
      calls={calls ?? []}
    />
  )
}
