'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * สถานะการติดตั้งแอป (PWA) — เก็บไว้ที่เดียวทั้งแอป
 *
 * 🔴 `beforeinstallprompt` ยิงครั้งเดียวและยิง **ก่อน** React จะ mount เกือบทุกครั้ง
 * ถ้าให้แต่ละคอมโพเนนต์ไปดักเอง ตัวที่ mount ทีหลังจะไม่ได้ event เลย
 * แล้วปุ่ม "ติดตั้ง" จะหายไปโดยไม่มีใครรู้ว่าทำไม · โมดูลนี้ดักตั้งแต่ตอน import
 * (ก่อน mount) แล้วแจกให้ทุกที่ที่ subscribe
 *
 * 🔴 iOS ไม่มี event นี้เลยตามการออกแบบของ Safari — ต้องบอกวิธีติดตั้งด้วยมือแทน
 * ไม่ใช่ปล่อยให้คนใช้ไอโฟนไม่เห็นอะไรเลย
 *
 * 🔴 ทุกอย่างในไฟล์นี้อ่านผ่าน `useSyncExternalStore` ไม่ใช่ `useState` + `useEffect`
 * ค่าพวกนี้เป็นของ "เครื่องนี้" ซึ่งฝั่งเซิร์ฟเวอร์ไม่มีทางรู้ · เขียนเป็น
 * `setState` ใน effect คือการเรนเดอร์สองรอบทุกครั้งและ React 19 เตือนว่าเป็น
 * cascading render · `useSyncExternalStore` มีช่อง `getServerSnapshot` ให้
 * ตอบค่าฝั่งเซิร์ฟเวอร์แยกอยู่แล้ว ตรงกับปัญหานี้พอดี
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type Snapshot = { canPrompt: boolean; installed: boolean; isIos: boolean }

const SERVER_SNAPSHOT: Snapshot = { canPrompt: false, installed: false, isIos: false }

let deferred: InstallPromptEvent | null = null
let installed = false
let isIos = false
let snapshot: Snapshot = SERVER_SNAPSHOT
const subscribers = new Set<() => void>()

function publish() {
  // สร้างวัตถุใหม่เฉพาะตอนค่าเปลี่ยนจริง — `useSyncExternalStore` เทียบด้วย
  // `Object.is` ถ้าคืนวัตถุใหม่ทุกครั้งจะ re-render ไม่รู้จบ
  snapshot = { canPrompt: deferred !== null, installed, isIos }
  for (const fn of subscribers) fn()
}

/** เปิดจากหน้าจอโฮมอยู่หรือเปล่า — สองมาตรฐาน เพราะ iOS ใช้คนละตัว */
function detectInstalled(): boolean {
  if (typeof window === 'undefined') return false
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return standalone || iosStandalone
}

if (typeof window !== 'undefined') {
  installed = detectInstalled()
  // iOS ไม่มี `beforeinstallprompt` — ต้องดูจาก user agent เท่านั้น
  isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
  snapshot = { canPrompt: false, installed, isIos }

  window.addEventListener('beforeinstallprompt', (e) => {
    // กันแบนเนอร์ของเบราว์เซอร์เอง — เราชวนติดตั้งด้วยภาษาของเราเองในที่ที่เหมาะกว่า
    e.preventDefault()
    deferred = e as InstallPromptEvent
    publish()
  })

  window.addEventListener('appinstalled', () => {
    installed = true
    deferred = null
    publish()
  })
}

const subscribe = (fn: () => void) => {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

export function usePwaInstall() {
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT,
  )

  const install = useCallback(async () => {
    if (!deferred) return 'unavailable' as const
    const evt = deferred
    // ใช้ได้ครั้งเดียวต่อหนึ่ง event — เคลียร์ทันทีกันกดซ้ำแล้วเบราว์เซอร์โยน error
    deferred = null
    publish()
    try {
      await evt.prompt()
      const { outcome } = await evt.userChoice
      return outcome
    } catch {
      return 'dismissed' as const
    }
  }, [])

  return { ...state, install }
}

/**
 * จำว่าผู้ใช้ปิดคำชวนไปแล้ว — เก็บในเครื่อง ไม่ใช่ในฐานข้อมูล
 *
 * เป็นความชอบของ "เครื่องนี้" ไม่ใช่ของบัญชี · คนเดียวกันอาจติดตั้งบนมือถือ
 * แต่ไม่อยากติดตั้งบนคอมที่ออฟฟิศ · และ localStorage อ่านไม่ได้ในโหมดส่วนตัว
 * บางเบราว์เซอร์ จึงต้องห่อ try/catch ทุกครั้ง ไม่ใช่ปล่อยให้ทั้งแบนเนอร์พัง
 *
 * 🔴 snapshot ต้องเป็น boolean ล้วน ไม่ใช่วัตถุ — `useSyncExternalStore` เทียบ
 * ด้วย `Object.is` วัตถุใหม่ทุกครั้ง = re-render ไม่รู้จบ
 */
const dismissSubscribers = new Set<() => void>()

function readDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    // อ่านไม่ได้ (โหมดส่วนตัว/ปิดคุกกี้) = ยังไม่เคยปิด · แบนเนอร์แสดงได้ตามปกติ
    return false
  }
}

export function useDismissed(key: string) {
  const dismissed = useSyncExternalStore(
    (fn) => {
      dismissSubscribers.add(fn)
      return () => {
        dismissSubscribers.delete(fn)
      }
    },
    () => readDismissed(key),
    // ฝั่งเซิร์ฟเวอร์เดาว่า "ปิดแล้ว" เพื่อไม่ให้แบนเนอร์กระพริบขึ้นมาแล้วหายไป
    () => true,
  )

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(key, '1')
    } catch {
      // จำไม่ได้ก็ไม่เป็นไร — แค่แบนเนอร์จะกลับมาใหม่รอบหน้า
    }
    for (const fn of dismissSubscribers) fn()
  }, [key])

  return { dismissed, dismiss }
}
