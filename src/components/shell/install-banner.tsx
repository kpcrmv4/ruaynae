'use client'

import { Bell, Download, Share, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useDismissed, usePwaInstall } from '@/lib/pwa-install'
import { useIsClient } from '@/lib/use-is-client'
import { enablePush, readPushState, type PushState } from '@/lib/push'

/**
 * แถบชวนติดตั้งแอป และ (หลังติดตั้งแล้ว) ชวนเปิดแจ้งเตือน
 *
 * ลำดับที่ตั้งใจ: **ติดตั้งก่อน แล้วค่อยขอสิทธิ์แจ้งเตือน**
 * ขอสิทธิ์ตอนเพิ่งเปิดเว็บครั้งแรกคือวิธีที่ทำให้คนกด "ไม่อนุญาต" มากที่สุด
 * และเบราว์เซอร์ **จำคำตอบนั้นไว้ถาวร** — ขอใหม่ไม่ได้อีกเลยจนกว่าจะไปแก้ในตั้งค่า
 * ของเบราว์เซอร์เอง · ตอนที่คนเพิ่งกดติดตั้งคือตอนที่เขาตั้งใจจะใช้จริง
 *
 * ปิดแล้วจำไว้ในเครื่อง (ไม่ใช่ในฐานข้อมูล) — เป็นความชอบของเครื่องนี้
 * · ยังเปิดจากหน้าตั้งค่าได้เสมอ แบนเนอร์เป็นทางลัด ไม่ใช่ทางเดียว
 */
export function InstallBanner({ vapidPublicKey }: { vapidPublicKey: string }) {
  const { canPrompt, installed, isIos, install } = usePwaInstall()
  const installBox = useDismissed('cpie:install-dismissed')
  const notifyBox = useDismissed('cpie:notify-dismissed')
  // ฝั่งเซิร์ฟเวอร์ยังไม่รู้ว่าเครื่องนี้ติดตั้งแล้วหรือยัง — รอให้ถึงเบราว์เซอร์ก่อน
  const ready = useIsClient()

  const [push, setPush] = useState<PushState>('loading')
  const [busy, setBusy] = useState(false)
  const [showIosHelp, setShowIosHelp] = useState(false)

  useEffect(() => {
    if (!installed) return
    let cancelled = false
    void readPushState(vapidPublicKey).then((s) => {
      if (!cancelled) setPush(s)
    })
    return () => {
      cancelled = true
    }
  }, [installed, vapidPublicKey])

  async function turnOnPush() {
    if (busy) return
    setBusy(true)
    const result = await enablePush(vapidPublicKey)
    if (result === 'on') {
      setPush('on')
      toast.success('เปิดแจ้งเตือนบนเครื่องนี้แล้ว')
    } else if (result === 'denied') {
      setPush('denied')
      toast.error('ยังไม่ได้อนุญาต — เปิดใหม่ได้จากการตั้งค่าของเบราว์เซอร์')
    } else {
      toast.error('เปิดแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่')
    }
    setBusy(false)
  }

  if (!ready) return null

  // ── ติดตั้งแล้ว → ชวนเปิดแจ้งเตือน ──────────────────────────────────
  if (installed) {
    if (push !== 'off' || notifyBox.dismissed) return null
    return (
      <Banner
        icon={<Bell className="size-5 shrink-0 text-brand" strokeWidth={1.8} />}
        title="เปิดแจ้งเตือนด้วยไหม"
        body="ติดตั้งแอปแล้ว — เปิดแจ้งเตือนเพื่อรู้ทันทีเมื่อมีรายการรออนุมัติหรือถูกตีกลับ แม้ปิดแอปอยู่"
        onDismiss={notifyBox.dismiss}
        action={
          <button onClick={turnOnPush} disabled={busy} className="btn-primary shrink-0">
            {busy ? 'กำลังเปิด…' : 'เปิดแจ้งเตือน'}
          </button>
        }
      />
    )
  }

  // ── ยังไม่ติดตั้ง → ชวนติดตั้ง ──────────────────────────────────────
  // Android/เดสก์ท็อป: มี event ให้กดติดตั้งได้เลย · iOS: ต้องบอกวิธีทำเอง
  if (installBox.dismissed || (!canPrompt && !isIos)) return null

  return (
    <Banner
      icon={<Download className="size-5 shrink-0 text-brand" strokeWidth={1.8} />}
      title="ติดตั้งแอปไว้บนหน้าจอโฮม"
      body={
        showIosHelp
          ? 'แตะปุ่มแชร์ด้านล่างของ Safari แล้วเลือก "เพิ่มไปยังหน้าจอโฮม" (Add to Home Screen)'
          : 'เปิดได้เร็วกว่า เต็มจอ ไม่มีแถบเบราว์เซอร์ และรับแจ้งเตือนได้'
      }
      onDismiss={installBox.dismiss}
      action={
        isIos && !canPrompt ? (
          <button
            onClick={() => setShowIosHelp((v) => !v)}
            className="btn-secondary shrink-0"
            aria-expanded={showIosHelp}
          >
            <Share className="size-4" />
            {showIosHelp ? 'เข้าใจแล้ว' : 'วิธีติดตั้ง'}
          </button>
        ) : (
          <button
            onClick={async () => {
              const outcome = await install()
              // ปฏิเสธไปแล้วอย่าตื๊อ — เก็บไว้ให้ไปกดเองที่หน้าตั้งค่า
              if (outcome === 'dismissed') installBox.dismiss()
            }}
            className="btn-primary shrink-0"
          >
            ติดตั้ง
          </button>
        )
      }
    />
  )
}

function Banner({
  icon,
  title,
  body,
  action,
  onDismiss,
}: {
  icon: React.ReactNode
  title: string
  body: string
  action: React.ReactNode
  onDismiss: () => void
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-lg border border-brand-tint-strong bg-brand-tint px-4 py-3">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-brand-on-tint">{title}</div>
        <div className="text-xs leading-5 text-brand-on-tint/80">{body}</div>
      </div>
      {action}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="ปิดคำแนะนำนี้"
        className="shrink-0 rounded-sm p-1.5 text-brand-on-tint transition-opacity hover:opacity-70"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
