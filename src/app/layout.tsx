import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans_Thai } from 'next/font/google'
import { Toaster } from 'sonner'
import { ThemeProvider } from '@/components/theme-provider'
import { APP_TAGLINE, SYSTEM_NAME } from '@/lib/constants'
import './globals.css'

// น้ำหนัก 300 ไม่ได้ใช้ในดีไซน์ที่อนุมัติ — โหลดเฉพาะที่ใช้จริงเพื่อลดขนาด
const plexThai = IBM_Plex_Sans_Thai({
  variable: '--font-thai',
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: SYSTEM_NAME, template: `%s · ${SYSTEM_NAME}` },
  description: APP_TAGLINE,
  // manifest เป็น route แบบไดนามิก เพราะชื่อบริษัทมาจากฐานข้อมูล
  manifest: '/manifest.webmanifest',
  // 🔴 Safari ไม่อ่านไอคอนจาก manifest — ต้องมี apple-touch-icon เป็น PNG
  // ไม่งั้นไอโฟนที่ติดตั้งแอปจะได้ไอคอนเปล่า โดยไม่มีอะไรฟ้อง
  appleWebApp: { capable: true, statusBarStyle: 'default', title: SYSTEM_NAME },
  // เรียงจากเล็กไปใหญ่ — เบราว์เซอร์เลือกอันที่พอดีกับที่มันต้องใช้จริง
  // แท็บต้องการ ~16–32px การส่งแต่ไฟล์ 512px ให้มันคือดาวน์โหลดเกินทุกครั้ง
  //
  // 🔴 ไม่ประกาศ `favicon.svg` ที่ผู้ใช้ส่งมา — ไฟล์นั้นเป็น **รูปแรสเตอร์
  // ที่ฝัง base64 ไว้ในเปลือก SVG ขนาด 938 KB** ไม่ใช่เวกเตอร์จริง
  // เบราว์เซอร์ที่ชอบ SVG มากกว่าจะโหลดเกือบหนึ่งเมกะไบต์มาวาดไอคอน 16px
  icons: {
    icon: [
      { url: '/icons/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
}

// color-scheme ต้องประกาศทั้งสองค่า ไม่งั้น Chrome จะบังคับ force-dark
// ทับสีที่เราคุมเอง แล้วโทเคนที่วัดคอนทราสต์มาแล้วจะเพี้ยนทั้งชุด
export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f5fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1017' },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="th" suppressHydrationWarning className={`${plexThai.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          {children}
          {/* toast แทน alert() เสมอ · richColors ให้สีสำเร็จ/ผิดพลาดต่างกันชัด */}
          <Toaster position="bottom-center" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  )
}
