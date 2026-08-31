import { handleMcpPost, mcpMethodNotAllowed } from '@/lib/mcp/handler'

/** ต้องเป็น nodejs — `node:crypto` สำหรับ HMAC */
export const runtime = 'nodejs'
/** ห้ามแคช — ทุกคำขอต้องเช็คคีย์และอ่านตัวเลขใหม่ */
export const dynamic = 'force-dynamic'

/**
 * ทางเข้าหลักที่คู่มือของเจ้าของใช้ — คีย์อยู่ใน path
 * 🔴 ถือว่า URL นี้เป็นรหัสผ่าน · หน้า /mcp เตือนเรื่องการแคปหน้าจอส่งต่อไว้แล้ว
 */
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  return handleMcpPost(req, key)
}

/** อย่าเปิดสตรีม SSE ที่เราไม่เคยเขียนอะไรลงไป */
export function GET() {
  return mcpMethodNotAllowed()
}
