import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { objectKey, presignPut } from '@/lib/r2'

export const runtime = 'nodejs'

/** ชนิดไฟล์ที่รับ → นามสกุลที่จะใช้ตั้งชื่อ */
const ALLOWED: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

/**
 * POST /api/uploads/sign — ขอลิงก์อัปโหลดตรงเข้า R2
 *
 * เบราว์เซอร์ PUT ไปที่ลิงก์นี้เอง ไบต์ไม่ผ่าน Vercel เลย
 * 🔴 R2 ไม่มี RLS — สิทธิ์ทั้งหมดตัดสินที่นี่ที่เดียว
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUserOrNull()
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  let purpose = ''
  let contentType = ''
  try {
    const body = await req.json()
    purpose = String(body?.purpose ?? '')
    contentType = String(body?.contentType ?? '')
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const ext = ALLOWED[contentType]
  if (!ext) return NextResponse.json({ error: 'UNSUPPORTED_TYPE' }, { status: 415 })

  // โลโก้เป็นของทั้งบริษัท เจ้าของเท่านั้นที่เปลี่ยนได้
  if (purpose === 'logo' && user.role !== 'owner') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  if (purpose !== 'logo') {
    // 'slip' จะเปิดใน P2 พร้อมการเช็คว่าคนคีย์ดูแลไซต์นั้นจริง
    return NextResponse.json({ error: 'UNSUPPORTED_PURPOSE' }, { status: 400 })
  }

  const key = objectKey('branding', ext)
  const url = await presignPut(key, contentType)

  return NextResponse.json({ key, url, contentType })
}
