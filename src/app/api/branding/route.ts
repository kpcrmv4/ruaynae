import { NextResponse } from 'next/server'
import { getBranding } from '@/lib/branding'

export const runtime = 'nodejs'
// ชื่อบริษัทเปลี่ยนได้จากหน้าตั้งค่า — แคชไว้จะทำให้แก้แล้วไม่เปลี่ยน
export const dynamic = 'force-dynamic'

/**
 * GET /api/branding — ชื่อบริษัทและโลโก้ · **ไม่ต้องล็อกอิน**
 *
 * ใครเรียกจริง: `manifest.webmanifest` และ service worker ซึ่งทำงานตอน
 * ยังไม่มี session · หน้า login กับ shell อ่านจากฐานข้อมูลตรงผ่าน
 * `lib/branding.ts` ไม่ผ่าน endpoint นี้ เพราะเป็น Server Component อยู่แล้ว
 *
 * 🔴 ตาราง `branding` ห้ามมีคอลัมน์ที่เป็นความลับ — ทุกอย่างที่ออกทางนี้
 * เป็นข้อมูลสาธารณะโดยนิยาม · ของลับอยู่ `app_settings` คนละตาราง
 */
export async function GET() {
  const b = await getBranding()
  return NextResponse.json({
    companyName: b.companyName,
    logoUrl: b.logoUrl,
  })
}
