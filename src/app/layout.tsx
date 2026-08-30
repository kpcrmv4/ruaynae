import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans_Thai } from 'next/font/google'
import { ThemeProvider } from '@/components/theme-provider'
import { APP_NAME, APP_TAGLINE } from '@/lib/constants'
import './globals.css'

// น้ำหนัก 300 ไม่ได้ใช้ในดีไซน์ที่อนุมัติ — โหลดเฉพาะที่ใช้จริงเพื่อลดขนาด
const plexThai = IBM_Plex_Sans_Thai({
  variable: '--font-thai',
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_TAGLINE,
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
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
