'use client'

import { Bell, BellOff, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { disablePush, enablePush, readPushState, type PushState } from '@/lib/push'

/**
 * เปิด/ปิดการแจ้งเตือนบนเครื่องนี้
 *
 * 🔴 "บนเครื่องนี้" ไม่ใช่ "ของบัญชีนี้" — คนหนึ่งคนอาจใช้สองเครื่อง
 * สถานะจึงอ่านจาก `pushManager.getSubscription()` ของเบราว์เซอร์
 * ไม่ใช่จากฐานข้อมูล · อ่านจากฐานแล้วเครื่องที่ยังไม่ได้เปิดจะโชว์ว่าเปิดแล้ว
 *
 * 🔴 ถูกปฏิเสธสิทธิ์แล้วขอใหม่ไม่ได้ — เบราว์เซอร์จำคำตอบไว้ · ต้องบอกวิธีแก้
 * ไม่ใช่ให้ปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้น
 */
export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [state, setState] = useState<PushState>('loading')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void readPushState(vapidPublicKey).then((next) => {
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
    }
  }, [vapidPublicKey])

  async function enable() {
    if (busy) return
    setBusy(true)
    const result = await enablePush(vapidPublicKey)
    if (result === 'on') {
      setState('on')
      toast.success('เปิดแจ้งเตือนบนเครื่องนี้แล้ว')
    } else if (result === 'denied') {
      setState('denied')
      toast.error('ยังไม่ได้อนุญาตให้แจ้งเตือน')
    } else {
      setState('off')
      toast.error(result === 'failed' ? 'เปิดแจ้งเตือนไม่สำเร็จ' : 'ยังไม่ได้อนุญาตให้แจ้งเตือน')
    }
    setBusy(false)
  }

  async function disable() {
    if (busy) return
    setBusy(true)
    const ok = await disablePush()
    if (ok) {
      setState('off')
      toast.success('ปิดแจ้งเตือนบนเครื่องนี้แล้ว')
    } else {
      toast.error('ปิดแจ้งเตือนไม่สำเร็จ')
    }
    setBusy(false)
  }

  return (
    <section
      data-push-state={state}
      className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3.5"
    >
      {state === 'on' ? (
        <Bell className="size-5 shrink-0 text-brand" strokeWidth={1.8} />
      ) : (
        <BellOff className="size-5 shrink-0 text-muted-token" strokeWidth={1.8} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">แจ้งเตือนบนเครื่องนี้</span>
        <span className="block text-xs text-muted-token">
          {state === 'unsupported' && 'เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน'}
          {state === 'denied' &&
            'เคยกดไม่อนุญาตไว้ — ต้องเปิดจากการตั้งค่าของเบราว์เซอร์เอง'}
          {state === 'off' && 'เด้งเตือนแม้ปิดแอปอยู่ เมื่อมีรายการรออนุมัติหรือถูกตีกลับ'}
          {state === 'on' && 'เปิดอยู่ — จะได้รับแจ้งเตือนแม้ปิดแอป'}
          {state === 'loading' && 'กำลังตรวจสอบ…'}
        </span>
      </span>
      {(state === 'off' || state === 'on') && (
        <button
          type="button"
          onClick={state === 'on' ? disable : enable}
          disabled={busy}
          className={`${state === 'on' ? 'btn-secondary' : 'btn-primary'} shrink-0 disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {state === 'on' ? 'ปิด' : 'เปิด'}
        </button>
      )}
    </section>
  )
}
