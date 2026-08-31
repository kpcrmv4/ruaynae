import 'server-only'

import { NextResponse } from 'next/server'
import { resolveKey, isRateLimited, logCall, type McpAuth } from '@/lib/mcp/keys'
import { TOOLS, PROMPTS, SERVER_INSTRUCTIONS } from '@/lib/mcp/tools'
import { executeTool } from '@/lib/mcp/execute'

/**
 * เซิร์ฟเวอร์ MCP แบบ Streamable HTTP เขียนเอง
 *
 * ไม่ลง `@modelcontextprotocol/sdk` — มันสร้างมาให้ `req`/`res` ของ Node
 * และลากเฟรมเวิร์กเซิร์ฟเวอร์เข้ามาเพื่อ handler ที่มี POST เดียว
 *
 * 🔴 กติกาสี่ข้อที่ผิดแล้วพังแบบไม่มี error ให้เห็น:
 * 1. **401 ห้ามมี `WWW-Authenticate`** — header นั้นคือสัญญาณ "เริ่ม OAuth
 *    discovery" client จะไปหา /.well-known/oauth-protected-resource เจอ 404
 *    แล้ว connector ค้างหลังปุ่ม Connect ที่กดยังไงก็ไม่ผ่าน · 403 ก็ห้ามมีเหมือนกัน
 * 2. `resources/list` และ `resources/templates/list` ต้องคืน **อาร์เรย์ว่าง**
 *    ไม่ใช่ -32601 · แอป Claude โชว์ -32601 เป็นข้อความแดงทั้งที่เราไม่ได้
 *    ประกาศ capability นั้น
 * 3. ข้อความที่ไม่มี `id` (notification) ตอบ **202 บอดี้ว่าง**
 * 4. **ไม่ออก `Mcp-Session-Id`** — stateless คือสิ่งที่ทำให้มันรอดบน serverless
 */

const JSONRPC = '2.0'
const FALLBACK_PROTOCOL = '2025-06-18'

type RpcId = string | number | null
type RpcRequest = { jsonrpc?: string; id?: RpcId; method?: string; params?: Record<string, unknown> }

const ok = (id: RpcId, result: unknown) =>
  NextResponse.json({ jsonrpc: JSONRPC, id, result })

const rpcError = (id: RpcId, code: number, message: string) =>
  NextResponse.json({ jsonrpc: JSONRPC, id, error: { code, message } })

/** 🔴 ห้ามเติม WWW-Authenticate ตรงนี้ไม่ว่าจะดู "ถูกต้องตามสเปก" แค่ไหน */
const unauthorized = () =>
  NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

export const mcpMethodNotAllowed = () =>
  NextResponse.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: { Allow: 'POST' } })

/** ผลของ tool เป็นข้อความ JSON — รูปแบบที่ client ทุกตัวอ่านได้แน่นอน */
const toolResult = (data: unknown, isError = false) => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
  ...(isError ? { isError: true } : {}),
})

function keyFromHeader(req: Request): string | null {
  const h = req.headers.get('authorization')
  if (!h) return null
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim())
  return m ? m[1] : null
}

export async function handleMcpPost(req: Request, keyFromPath: string | null): Promise<Response> {
  // path ก่อน header — คู่มือของเจ้าของใช้ทางนี้ ส่วน header ไว้ให้ Claude Code/Codex
  const auth: McpAuth | null = await resolveKey(keyFromPath ?? keyFromHeader(req))
  if (!auth) return unauthorized()

  let body: RpcRequest
  try {
    body = (await req.json()) as RpcRequest
  } catch {
    return rpcError(null, -32700, 'Parse error')
  }

  const id = body.id ?? null
  const method = body.method ?? ''

  // ไม่มี id = notification — ตอบ 202 บอดี้ว่าง ห้ามตอบ JSON-RPC กลับไป
  if (body.id === undefined || body.id === null) {
    return new Response(null, { status: 202 })
  }

  switch (method) {
    case 'initialize': {
      // 🔴 สะท้อนเวอร์ชันที่ client ขอมา ไม่ใช่ยัดเวอร์ชันของเราลงไป
      const asked = body.params?.protocolVersion
      return ok(id, {
        protocolVersion: typeof asked === 'string' ? asked : FALLBACK_PROTOCOL,
        capabilities: { tools: {}, prompts: {} },
        serverInfo: { name: 'construction-books', version: '1.0.0' },
        instructions: SERVER_INSTRUCTIONS,
      })
    }

    case 'ping':
      return ok(id, {})

    case 'tools/list':
      return ok(id, { tools: TOOLS })

    case 'prompts/list':
      return ok(id, {
        prompts: PROMPTS.map((p) => ({ name: p.name, title: p.title, arguments: [] })),
      })

    case 'prompts/get': {
      const name = body.params?.name
      const found = PROMPTS.find((p) => p.name === name)
      if (!found) return rpcError(id, -32602, `ไม่มี prompt ชื่อ ${String(name)}`)
      return ok(id, {
        description: found.title,
        messages: [{ role: 'user', content: { type: 'text', text: found.text } }],
      })
    }

    // ประกาศว่าไม่มี resources แต่ยังต้องตอบให้เรียบร้อย ไม่ใช่ -32601
    case 'resources/list':
      return ok(id, { resources: [] })
    case 'resources/templates/list':
      return ok(id, { resourceTemplates: [] })

    case 'tools/call': {
      const name = String(body.params?.name ?? '')
      const args = (body.params?.arguments ?? {}) as Record<string, unknown>

      if (!TOOLS.some((t) => t.name === name)) {
        await logCall(auth.keyId, name || '(ไม่ระบุ)', false, 0, 'UNKNOWN_TOOL')
        return ok(id, toolResult(`ไม่มีเครื่องมือชื่อ ${name}`, true))
      }

      if (await isRateLimited(auth.keyId)) {
        await logCall(auth.keyId, name, false, 0, 'RATE_LIMITED')
        return ok(id, toolResult('เรียกถี่เกินไป กรุณารอสักครู่แล้วลองใหม่', true))
      }

      const t0 = Date.now()
      const res = await executeTool(auth.actorId, name, args)
      const ms = Date.now() - t0

      // ⚠️ บันทึกเฉพาะชื่อ tool กับผล — ห้ามบันทึก args เพราะอาจมีชื่อลูกค้า
      await logCall(auth.keyId, name, res.ok, ms, res.ok ? undefined : 'TOOL_FAILED')

      // ล้มเหลวยังตอบ 200 พร้อม isError — โมเดลจะได้อธิบายแทนที่เซสชันจะตาย
      return ok(id, res.ok ? toolResult(res.data) : toolResult(res.message, true))
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}
