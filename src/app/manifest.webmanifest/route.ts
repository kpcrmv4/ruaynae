import { NextResponse } from 'next/server'
import { getBranding, shortName } from '@/lib/branding'

export const runtime = 'nodejs'
// ชื่อบริษัทเปลี่ยนได้ — manifest ที่แคชไว้จะโชว์ชื่อเก่าบนหน้าจอโฮมตลอดไป
export const dynamic = 'force-dynamic'

/**
 * manifest ของ PWA — ชื่อมาจากฐานข้อมูล ไม่ใช่ค่าคงที่ในโค้ด
 *
 * 🔴 ต้องอยู่นอก matcher ของ `proxy.ts` — 307 ไป /login เมื่อไหร่
 * คนที่ยังไม่ล็อกอินจะติดตั้งแอปไม่ได้ และไม่มี error ให้เห็นที่ไหนเลย
 */
export async function GET() {
  const b = await getBranding()
  return NextResponse.json(
    {
      name: b.companyName,
      short_name: shortName(b.companyName),
      description: 'ระบบบันทึกรายรับ-รายจ่ายงานรับเหมาก่อสร้าง',
      lang: 'th',
      dir: 'ltr',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      // 🔴 สามค่านี้อยู่นอก `globals.css` จึงไม่ขยับตามตอนเปลี่ยนชุดสี และไม่มี
      // ตัวตรวจไหนจับได้ — เห็นได้ตอนติดตั้งแอปจริงบนมือถือเท่านั้น
      // background_color = `--canvas` โหมดสว่าง · theme_color = `--sidebar`
      background_color: '#f1f7f3',
      theme_color: '#123328',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' } },
  )
}
