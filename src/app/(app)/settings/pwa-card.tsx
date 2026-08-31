'use client'

import { CheckCircle2, Download, Share, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { usePwaInstall } from '@/lib/pwa-install'
import { useIsClient } from '@/lib/use-is-client'

/**
 * การ์ด "ติดตั้งแอป" ในหน้าตั้งค่า
 *
 * แบนเนอร์ชวนติดตั้งปิดได้และปิดแล้วจำไว้ — ต้องมีที่ที่กลับมากดได้เสมอ
 * ไม่งั้นคนที่เผลอกดปิดจะติดตั้งไม่ได้อีกเลยจนกว่าจะล้างข้อมูลเบราว์เซอร์
 *
 * 🔴 บนไอโฟนไม่มีปุ่มติดตั้งให้กด — Safari ไม่ยิง `beforeinstallprompt` เลย
 * ต้องเขียนขั้นตอนให้อ่าน ไม่ใช่โชว์ปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้น
 */
export function PwaCard() {
  const { canPrompt, installed, isIos, install } = usePwaInstall()
  const ready = useIsClient()

  // ก่อนถึงเบราว์เซอร์ยังไม่รู้สถานะของเครื่องนี้ — จองพื้นที่ไว้ไม่ให้หน้ากระตุก
  const status = !ready
    ? 'กำลังตรวจสอบ…'
    : installed
      ? 'ติดตั้งแล้ว — เปิดจากไอคอนบนหน้าจอโฮมได้เลย'
      : canPrompt
        ? 'เปิดได้เร็วกว่า เต็มจอ ไม่มีแถบเบราว์เซอร์ และรับแจ้งเตือนได้'
        : isIos
          ? 'บนไอโฟน/ไอแพด: แตะปุ่มแชร์ของ Safari แล้วเลือก "เพิ่มไปยังหน้าจอโฮม"'
          : 'เบราว์เซอร์นี้ยังไม่พร้อมให้ติดตั้ง — ลองเปิดด้วย Chrome บนมือถือ'

  return (
    <section
      data-pwa-state={ready ? (installed ? 'installed' : canPrompt ? 'ready' : 'manual') : 'loading'}
      className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3.5"
    >
      {ready && installed ? (
        <CheckCircle2 className="size-5 shrink-0 text-status-done" strokeWidth={1.8} />
      ) : (
        <Smartphone className="size-5 shrink-0 text-brand" strokeWidth={1.8} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">ติดตั้งแอปบนเครื่องนี้</span>
        <span className="block text-xs leading-5 text-muted-token">{status}</span>
      </span>

      {ready && !installed && canPrompt && (
        <button
          type="button"
          onClick={async () => {
            const outcome = await install()
            if (outcome === 'accepted') toast.success('กำลังติดตั้งแอป…')
          }}
          className="btn-primary shrink-0"
        >
          <Download className="size-4" />
          ติดตั้ง
        </button>
      )}
      {ready && !installed && !canPrompt && isIos && (
        <Share className="size-5 shrink-0 text-muted-token" strokeWidth={1.8} />
      )}
    </section>
  )
}
