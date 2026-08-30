'use client'

import { Bell, BellOff, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

/**
 * base64url ของ VAPID → ArrayBuffer ที่ `pushManager.subscribe` ต้องการ
 *
 * คืน `ArrayBuffer` ไม่ใช่ `Uint8Array` เพราะชนิดของ DOM รับเฉพาะ
 * `ArrayBufferView<ArrayBuffer>` ซึ่ง `Uint8Array` ทั่วไปไม่ตรง
 * (มันอาจอยู่บน `SharedArrayBuffer` ได้ในทางทฤษฎี)
 */
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const buf = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return buf
}

type State = 'loading' | 'unsupported' | 'denied' | 'off' | 'on'

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
  const [state, setState] = useState<State>('loading')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !vapidPublicKey) {
        if (!cancelled) setState('unsupported')
        return
      }
      if (Notification.permission === 'denied') {
        if (!cancelled) setState('denied')
        return
      }
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (!cancelled) setState(sub ? 'on' : 'off')
      } catch {
        if (!cancelled) setState('unsupported')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [vapidPublicKey])

  async function enable() {
    if (busy) return
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off')
        toast.error('ยังไม่ได้อนุญาตให้แจ้งเตือน')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(vapidPublicKey),
      })
      const r = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      if (!r.ok) {
        // เก็บฝั่งเราไม่สำเร็จ = เครื่องนี้จะไม่มีวันได้รับ push
        // ต้องถอน subscription ทิ้งด้วย ไม่งั้นหน้าจอจะบอกว่า "เปิดแล้ว" ทั้งที่ไม่
        await sub.unsubscribe().catch(() => {})
        toast.error('บันทึกการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่')
        setState('off')
        return
      }
      setState('on')
      toast.success('เปิดแจ้งเตือนบนเครื่องนี้แล้ว')
    } catch {
      toast.error('เปิดแจ้งเตือนไม่สำเร็จ')
      setState('off')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    if (busy) return
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setState('off')
      toast.success('ปิดแจ้งเตือนบนเครื่องนี้แล้ว')
    } catch {
      toast.error('ปิดแจ้งเตือนไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
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
