import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { generateKey, keyPrefix } from '@/lib/mcp/keys-core'
import { hashKeyWithPepper } from '@/lib/mcp/keys'

export const runtime = 'nodejs'

const MAX_LABEL = 60
/** กันคีย์งอกไม่จำกัด — เจ้าของคนเดียวไม่มีเหตุต้องมีเกินนี้ */
const MAX_ACTIVE_KEYS = 10

/** POST /api/settings/mcp-keys — ออกคีย์ใหม่ (เจ้าของเท่านั้น) */
export async function POST(req: NextRequest) {
  // 🔴 route นี้ต้องรู้ว่า **ใคร** เป็นคนออกคีย์ จึงใช้ `getCurrentUserOrNull()`
  // แทน `denyUnlessOwner()` — แบบเดียวกับ `src/app/api/sites/route.ts`
  // ห้ามเรียก `sb.auth.getUser()` ซ้ำเพื่อเอา id: มันเป็น call ที่ไม่มีใครเช็ค
  // `error` และต้องจบด้วย `user!` ซึ่งจะโยนอยู่ใน argument ของ `.insert()`
  // ก่อน query จะได้รัน แล้ว route ตาย 500 แทนที่จะตอบ JSON ตามรูปแบบของระบบ
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  let label = ''
  try {
    const b = await req.json()
    label = String(b?.label ?? '').trim().slice(0, MAX_LABEL)
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  if (!label) return NextResponse.json({ error: 'LABEL_REQUIRED' }, { status: 400 })

  const sb = await getSupabaseServer()

  const { count, error: cErr } = await sb
    .from('mcp_keys')
    .select('id', { count: 'exact', head: true })
    .is('revoked_at', null)
  if (cErr) {
    console.error('[mcp-keys] นับคีย์ไม่ได้', cErr.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  if ((count ?? 0) >= MAX_ACTIVE_KEYS) {
    return NextResponse.json({ error: 'TOO_MANY_KEYS' }, { status: 409 })
  }

  // 🔴 ค่านี้ไม่ถูกเก็บที่ไหนเลย — คืนให้ครั้งเดียวแล้วหายไปตลอดกาล
  const secret = generateKey()

  // เขียนผ่าน session ของเจ้าของ ไม่ใช่ admin — RLS เป็นตัวยืนยันสิทธิ์อีกชั้น
  // และ audit trigger จะได้บันทึกว่าใครเป็นคนออก
  const { data, error } = await sb
    .from('mcp_keys')
    .insert({
      label,
      key_hash: hashKeyWithPepper(secret),
      key_prefix: keyPrefix(secret),
      created_by: me.id,
    })
    .select('id, label, key_prefix, created_at, last_used_at')
    .maybeSingle()

  if (error) {
    console.error('[mcp-keys] ออกคีย์ไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true, key: secret, row: data }, { status: 201 })
}
