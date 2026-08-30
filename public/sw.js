/* eslint-disable no-undef */
/**
 * Service worker — เขียนเอง ไม่ใช้ next-pwa
 *
 * ทำสามอย่างเท่านั้น:
 *   1. ให้หน้าเปิดได้ตอนเน็ตหลุด (network-first + หน้า fallback)
 *   2. รับ push แล้วแสดงแจ้งเตือน
 *   3. กดแจ้งเตือนแล้วเปิดหน้าที่ถูก (โฟกัสแท็บเดิมถ้ามี ไม่เปิดใหม่ซ้อน)
 *
 * 🔴 อย่าแคชคำตอบของ API หรือหน้าเว็บที่มีข้อมูล — แอปนี้เป็นเรื่องเงิน
 * ตัวเลขเก่าที่ดูเหมือนของใหม่แย่กว่าหน้าที่โหลดไม่ขึ้น
 */

const VERSION = 'v1'
const SHELL = `shell-${VERSION}`
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll([OFFLINE_URL, '/icons/icon-192.png'])),
  )
  // SW ใหม่ต้องมาแทนตัวเก่าทันที ไม่ต้องรอปิดทุกแท็บ
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  // เฉพาะการเปิดหน้าเท่านั้น — API และไฟล์อื่นปล่อยผ่านไปตามปกติ
  if (request.mode !== 'navigate') return
  event.respondWith(
    fetch(request).catch(() =>
      caches.match(OFFLINE_URL).then((r) => r ?? Response.error()),
    ),
  )
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'มีการแจ้งเตือนใหม่' }
  }

  const title = payload.title || 'แจ้งเตือน'
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    lang: 'th',
    // แจ้งเตือนของรายการเดียวกันทับกัน ไม่ซ้อนกันเป็นตั้ง
    tag: payload.tag || 'cpie',
    renotify: true,
    data: { link: payload.link || '/' },
  }

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options)
      // ตัวเลขบนไอคอนแอป — ต้องตั้งทั้งตอนอยู่ในแอปและใน push handler
      // ตั้งแค่ในแอปแปลว่าเลขไม่ขึ้นเลยตอนแอปปิดอยู่ ซึ่งเป็นตอนที่ต้องใช้
      if (typeof payload.unread === 'number' && 'setAppBadge' in self.navigator) {
        try {
          if (payload.unread > 0) await self.navigator.setAppBadge(payload.unread)
          else await self.navigator.clearAppBadge()
        } catch {
          // บางเบราว์เซอร์ไม่รองรับ — ไม่ใช่เหตุให้ push ล้ม
        }
      }
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // มีแท็บของแอปเปิดอยู่แล้ว → พาไปหน้านั้นในแท็บเดิม
      // เปิดแท็บใหม่ทุกครั้งที่กดแจ้งเตือนคือวิธีที่เร็วที่สุดในการมีสิบแท็บ
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(link)
          return client.focus()
        }
      }
      return self.clients.openWindow(link)
    }),
  )
})
