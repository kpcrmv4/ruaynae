import { NextResponse } from 'next/server'
import { getBranding } from '@/lib/branding'

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
      short_name: b.companyName.slice(0, 12),
      description: 'ระบบบันทึกรายรับ-รายจ่ายงานรับเหมาก่อสร้าง',
      lang: 'th',
      dir: 'ltr',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      // พื้นหลังตอนเปิดแอปใช้สีพื้นของธีมสว่าง · theme_color เป็นกรมท่าของ sidebar
      background_color: '#f7f8fa',
      theme_color: '#12213f',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' } },
  )
}
