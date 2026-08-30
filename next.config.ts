import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Next 16 บล็อก chunk ที่มาจาก origin อื่นตอน dev — ถ้าไม่ประกาศไว้
  // หน้าเว็บจะโหลดขึ้นแต่ hydrate ไม่สำเร็จ ปุ่มทุกปุ่มจะกดไม่ติดโดยไม่มี error
  // ให้เห็นในคอนโซล (nextjs-gotchas §1)
  allowedDevOrigins: ['localhost', '127.0.0.1', '*.localhost'],

  async headers() {
    return [
      {
        // service worker ต้องไม่ถูกแคช ไม่งั้นผู้ใช้จะค้างอยู่กับ SW ตัวเก่าตลอดไป
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

export default nextConfig
