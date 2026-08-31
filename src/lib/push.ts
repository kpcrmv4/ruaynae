'use client'

/**
 * เปิด/ปิดการแจ้งเตือนของ **เครื่องนี้** — ตรรกะอยู่ที่เดียว
 *
 * 🔴 มีสองที่ที่เปิดแจ้งเตือนได้ (การ์ดในหน้าตั้งค่า และคำชวนหลังติดตั้งแอป)
 * ก๊อปโค้ดไปสองที่แล้ววันหนึ่งจะเหลือที่เดียวที่ถอน subscription ทิ้งตอนบันทึกฝั่ง
 * เราไม่สำเร็จ — แล้วหน้าจอจะบอกว่า "เปิดแล้ว" ทั้งที่เครื่องนั้นจะไม่มีวันได้รับ push
 *
 * 🔴 "เปิดแล้ว" อ่านจาก `pushManager.getSubscription()` ของเบราว์เซอร์เสมอ
 * ไม่ใช่จากฐานข้อมูล — คนหนึ่งคนใช้หลายเครื่อง อ่านจากฐานแล้วเครื่องที่ยังไม่ได้
 * เปิดจะโชว์ว่าเปิดแล้ว
 */
export type PushState = 'loading' | 'unsupported' | 'denied' | 'off' | 'on'

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

export async function readPushState(vapidPublicKey: string): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !vapidPublicKey) {
    return 'unsupported'
  }
  // ถูกปฏิเสธแล้วขอใหม่ไม่ได้ — เบราว์เซอร์จำคำตอบไว้ · ต้องบอกวิธีแก้
  // ไม่ใช่ให้ปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้น
  if (Notification.permission === 'denied') return 'denied'
  try {
    const reg = await navigator.serviceWorker.ready
    return (await reg.pushManager.getSubscription()) ? 'on' : 'off'
  } catch {
    return 'unsupported'
  }
}

export type EnableResult = 'on' | 'denied' | 'off' | 'failed'

export async function enablePush(vapidPublicKey: string): Promise<EnableResult> {
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'

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
      return 'failed'
    }
    return 'on'
  } catch {
    return 'failed'
  }
}

export async function disablePush(): Promise<boolean> {
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
    return true
  } catch {
    return false
  }
}
