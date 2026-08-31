import { NextResponse } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * DELETE /api/settings/mcp-keys/[id] — เพิกถอนคีย์
 *
 * 🔴 ตั้ง `revoked_at` ไม่ใช่ลบแถว — `mcp_call_log` ยังอ้างถึงอยู่
 * และประวัติว่าเคยมีคีย์ใบนี้คือส่วนหนึ่งของร่องรอย
 *
 * 🔴 ต้อง `.select()` กลับมาด้วย — RLS ที่บล็อกการอัปเดตจะแมตช์ **ศูนย์แถว
 * และไม่คืน error** แอปจะรายงานว่าสำเร็จทั้งที่ไม่มีอะไรถูกเขียน
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await params
  const sb = await getSupabaseServer()

  const { data, error } = await sb
    .from('mcp_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[mcp-keys] เพิกถอนไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'REVOKE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
