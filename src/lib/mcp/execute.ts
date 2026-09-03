import 'server-only'

import { asUuid, clampLimit, clampOffset, parseIsoDate, pickEnum } from '@/lib/mcp/args-core'
import { callMcpRpc, type ExecResult } from '@/lib/mcp/rpc'
import { searchTerms } from '@/lib/search-core'
import { METRIC_DEFINITIONS } from '@/lib/mcp/tools'
import { isWriteTool } from '@/lib/mcp/tool-names'
import { executeLookupTool, executeWriteTool } from '@/lib/mcp/write'

/**
 * ทางเข้าเดียวของ `tools/call` — แจกไปยังฝั่งอ่าน (ในไฟล์นี้) ฝั่งค้นหา id
 * และฝั่งเขียน (`write.ts`) · การคุยกับฐานข้อมูลอยู่ที่ `rpc.ts` ที่เดียว
 *
 * 🔴 พารามิเตอร์ทุกตัวถูกบีบให้อยู่ในกรอบ **ก่อน** ถึงฐานข้อมูล
 * โมเดลส่ง `limit: "ทั้งหมด"` หรือ `from: "2569-01-01"` มาได้ และมันไม่รู้ตัว
 * · ค่าที่ไม่ผ่านตัวตรวจกลายเป็น "ไม่กรอง" ไม่ใช่ "กรองด้วยของที่แต่งขึ้น"
 *
 * ⚠️ ความล้มเหลวคืนเป็นข้อความ ไม่ใช่ throw — คนเรียกต้องแปลงเป็น
 * `isError: true` ใน 200 เพื่อให้โมเดลอธิบายให้ผู้ใช้ฟังได้ ไม่ใช่ให้เซสชันตาย
 */
export type { ExecResult }

const SITE_STATUS = ['planning', 'active', 'paused', 'done', 'cancelled'] as const
const TXN_KIND = ['income', 'expense'] as const
const TXN_STATUS = ['pending', 'approved', 'rejected'] as const

export async function executeTool(
  actorId: string,
  keyId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<ExecResult> {
  // ไม่แตะฐานข้อมูลเลย — เป็นคำอธิบายกติกา ไม่ใช่ข้อมูล
  if (tool === 'get_metric_definitions') return { ok: true, data: METRIC_DEFINITIONS }

  // 🔴 ฝั่งเขียนอยู่คนละไฟล์และรับ `keyId` ไปด้วยเสมอ — ทุกแถวที่ AI คีย์
  // ต้องมีร่องรอยว่ามาจากคีย์ใบไหน ไม่ใช่แค่ว่ามาจากเจ้าของ (R6)
  if (isWriteTool(tool)) return executeWriteTool(actorId, keyId, tool, args)
  if (tool === 'list_categories' || tool === 'list_employees') {
    return executeLookupTool(actorId, tool, args)
  }

  const call = (fn: string, params: Record<string, unknown>): Promise<ExecResult> =>
    callMcpRpc(fn, { p_actor: actorId, ...params }, 'อ่านข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')

  switch (tool) {
    case 'get_company_overview':
      return call('mcp_overview', { p_on: parseIsoDate(args.on_date) })

    case 'list_sites':
      return call('mcp_sites', {
        p_status: pickEnum(args.status, SITE_STATUS),
        p_limit: clampLimit(args.limit, 20, 100),
        p_offset: clampOffset(args.offset),
      })

    case 'get_site_detail': {
      const site = asUuid(args.site_id)
      if (!site) return { ok: false, message: 'ต้องระบุ site_id เป็น UUID — หาได้จาก list_sites' }
      const res = await call('mcp_site_detail', { p_site: site })
      // 🔴 โครงการที่ไม่มีอยู่จริงต้องบอกว่า "ไม่พบ" ไม่ใช่ส่งออบเจ็กต์ว่างกลับไป
      // `mcp_site_detail` ไม่ raise เมื่อหาไม่เจอ มันคืน `{"site": null, …}` พร้อม
      // อาร์เรย์ว่างครบทุกคีย์ · โมเดลอ่านชุดนี้ว่า "โครงการนี้มีอยู่แต่ยังไม่มีข้อมูล"
      // แล้วรายงานให้เจ้าของฟังด้วยความมั่นใจ — คำตอบผิดที่ฟังดูถูก ไม่มี error ที่ไหนเลย
      if (res.ok && (res.data as { site?: unknown } | null)?.site == null) {
        return { ok: false, message: 'ไม่พบโครงการตาม site_id นี้ — ใช้ list_sites เพื่อดู site_id ที่ถูกต้อง' }
      }
      return res
    }

    case 'search_transactions': {
      // แยกคำด้วยตัวเดียวกับหน้า /ledger — ไม่งั้นถาม AI ได้คำตอบนึง
      // เปิดหน้าจอเห็นอีกอย่างนึง
      const terms = typeof args.q === 'string' ? searchTerms(args.q) : []
      return call('mcp_transactions', {
        p_from: parseIsoDate(args.from),
        p_to: parseIsoDate(args.to),
        p_kind: pickEnum(args.kind, TXN_KIND),
        p_status: pickEnum(args.status, TXN_STATUS),
        p_site: asUuid(args.site_id),
        p_terms: terms.length ? terms : null,
        p_limit: clampLimit(args.limit, 30, 100),
        p_offset: clampOffset(args.offset),
      })
    }

    case 'get_pending_approvals':
      return call('mcp_pending', { p_limit: clampLimit(args.limit, 20, 100) })

    case 'get_payroll_summary':
      return call('mcp_payroll', { p_limit: clampLimit(args.limit, 10, 50) })

    default:
      return { ok: false, message: `ไม่มีเครื่องมือชื่อ ${tool}` }
  }
}
