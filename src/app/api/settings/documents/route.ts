import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { DOC_KINDS, docNoSeq, parseDocNo } from '@/lib/documents'
import type { Database } from '@/lib/database.types'

export const runtime = 'nodejs'

/**
 * PATCH /api/settings/documents — ตั้งเลขที่เอกสารและข้อมูลผู้ขายบนกระดาษ
 *
 * 🔴 เจ้าของกรอก **เลขล่าสุดที่ออกไปแล้ว** (`RC1140`) ไม่ใช่เลขถัดไป
 * (คำสั่งเจ้าของ 20 ก.ย. 2569) — คนไม่ต้องบวกเอง และไม่ต้องเดาว่าระบบ
 * จะเริ่มที่เลขไหน · จำนวนหลักมาจากที่พิมพ์ (`CM011` = 3 หลัก → `CM012`)
 *
 * 🔴 ตั้งเลขย้อนหลังไปทับใบที่ออกไปแล้วไม่ได้ — `unique(kind, doc_no)` จะเด้ง
 * ตอนออกใบถัดไป ซึ่งเป็นตอนที่สายเกินจะอธิบาย ให้ปฏิเสธตั้งแต่ตอนตั้งค่าเลย
 */
export async function PATCH(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const sb = await getSupabaseServer()

  for (const kind of DOC_KINDS) {
    const raw = body[`${kind}LastNo`]
    if (raw === undefined || raw === null || String(raw).trim() === '') continue

    const parts = parseDocNo(String(raw))
    if (!parts) {
      return NextResponse.json({ error: 'DOC_NO_FORMAT', kind }, { status: 422 })
    }

    // ใบที่ออกไปแล้วของชนิดนี้ มีเลขไหนสูงกว่าหรือเท่ากับที่กำลังจะตั้งไหม
    const { data: rows } = await sb
      .from('documents')
      .select('doc_no')
      .eq('kind', kind)
      .not('doc_no', 'is', null)
      .order('doc_no', { ascending: false })
      .range(0, 199)
    const highest = (rows ?? []).reduce((max, r) => Math.max(max, docNoSeq(r.doc_no ?? '')), -1)
    if (highest >= 0 && parts.lastNo < highest) {
      return NextResponse.json(
        { error: 'DOC_NO_BEHIND', kind, highest },
        { status: 409 },
      )
    }

    const { error } = await sb
      .from('doc_counters')
      .upsert(
        { kind, prefix: parts.prefix, pad: parts.pad, last_no: parts.lastNo, updated_at: new Date().toISOString() },
        { onConflict: 'kind' },
      )
    if (error) {
      console.error('[settings/documents] ตั้งเลขไม่สำเร็จ', error.message)
      return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
    }
  }

  // ── ข้อมูลผู้ขายที่กระดาษต้องมี ────────────────────────────────────
  const patch: Database['public']['Tables']['app_settings']['Update'] = {}
  for (const [key, col] of [
    ['phone', 'phone'], ['email', 'email'], ['branchLabel', 'branch_label'],
    ['bankAccount', 'bank_account'], ['docFooter', 'doc_footer'],
  ] as const) {
    if (body[key] !== undefined) patch[col] = String(body[key] ?? '').trim().slice(0, 200) || null
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await sb.from('app_settings').update(patch).eq('id', true)
    if (error) {
      console.error('[settings/documents] บันทึกข้อมูลผู้ขายไม่สำเร็จ', error.message)
      return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
