import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { clampLimit, clampOffset, parseIsoDate, pickEnum } from '@/lib/mcp/args-core'
import { searchTerms } from '@/lib/search-core'
import { METRIC_DEFINITIONS } from '@/lib/mcp/tools'

/**
 * เรียกฟังก์ชัน `mcp_*` — ที่เดียวที่แตะฐานข้อมูลของฝั่ง MCP
 *
 * 🔴 พารามิเตอร์ทุกตัวถูกบีบให้อยู่ในกรอบ **ก่อน** ถึงฐานข้อมูล
 * โมเดลส่ง `limit: "ทั้งหมด"` หรือ `from: "2569-01-01"` มาได้ และมันไม่รู้ตัว
 * · ค่าที่ไม่ผ่านตัวตรวจกลายเป็น "ไม่กรอง" ไม่ใช่ "กรองด้วยของที่แต่งขึ้น"
 *
 * ⚠️ ความล้มเหลวคืนเป็นข้อความ ไม่ใช่ throw — คนเรียกต้องแปลงเป็น
 * `isError: true` ใน 200 เพื่อให้โมเดลอธิบายให้ผู้ใช้ฟังได้ ไม่ใช่ให้เซสชันตาย
 */
export type ExecResult = { ok: true; data: unknown } | { ok: false; message: string }

const SITE_STATUS = ['planning', 'active', 'paused', 'done', 'cancelled'] as const
const TXN_KIND = ['income', 'expense'] as const
const TXN_STATUS = ['pending', 'approved', 'rejected'] as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const asUuid = (v: unknown): string | null =>
  typeof v === 'string' && UUID_RE.test(v.trim()) ? v.trim() : null

export async function executeTool(
  actorId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<ExecResult> {
  // ไม่แตะฐานข้อมูลเลย — เป็นคำอธิบายกติกา ไม่ใช่ข้อมูล
  if (tool === 'get_metric_definitions') return { ok: true, data: METRIC_DEFINITIONS }

  const admin = getSupabaseAdmin()

  const call = async (fn: string, params: Record<string, unknown>): Promise<ExecResult> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ชื่อ RPC เป็นค่าที่คำนวณ
    const { data, error } = await (admin.rpc as any)(fn, { p_actor: actorId, ...params })
    if (error) {
      console.error(`[mcp] ${fn} ล้มเหลว`, error.message)
      // ข้อความจากฐานข้อมูลอาจมีรายละเอียดภายใน — ส่งกลับเฉพาะสิ่งที่โมเดลใช้ได้
      if (error.message.includes('MCP_ACTOR_NOT_OWNER')) {
        return { ok: false, message: 'คีย์นี้ไม่มีสิทธิ์อ่านข้อมูลแล้ว กรุณาออกคีย์ใหม่' }
      }
      return { ok: false, message: 'อ่านข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }
    }
    return { ok: true, data }
  }

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
      return call('mcp_site_detail', { p_site: site })
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
