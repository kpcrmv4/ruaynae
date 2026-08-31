import { handleMcpPost, mcpMethodNotAllowed } from '@/lib/mcp/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ทางเข้าที่คีย์อยู่ใน `Authorization: Bearer` — ไว้ให้ Claude Code / Codex
 * ⚠️ **ไม่เขียนทางนี้ในคู่มือหน้า /mcp** · ให้ผู้ใช้ที่ไม่ชำนาญคอมเลือกสองทาง
 * คือการสร้างสายโทรเข้า (สเปก §2)
 */
export async function POST(req: Request) {
  return handleMcpPost(req, null)
}

export function GET() {
  return mcpMethodNotAllowed()
}
