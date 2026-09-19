'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Bell, BellOff, Check, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase/client'

export type NotificationItem = {
  id: string
  kind: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
  /** รายการที่แจ้งเตือนใบนี้พูดถึง — null ได้ (เช่นสรุปประจำวัน) */
  txn_id: string | null
}

/**
 * ลิงก์ของแจ้งเตือนหนึ่งใบ
 *
 * 🔴 ลิงก์ในฐานข้อมูลชี้ได้แค่ระดับ "หน้า" (`/ledger?status=rejected`) ซึ่งกดแล้ว
 * เจอลิสต์ยาว ๆ ที่ไม่มีอะไรบอกว่าใบไหนคือใบที่เพิ่งถูกตีกลับ · ต่อ `focus`
 * ให้หน้าปลายทางไฮไลท์และเลื่อนไปหาแถวนั้นเอง
 */
function hrefOf(n: NotificationItem): string {
  if (!n.link) return '#'
  if (!n.txn_id || !n.link.startsWith('/ledger')) return n.link
  return `${n.link}${n.link.includes('?') ? '&' : '?'}focus=${n.txn_id}`
}

/** เมื่อไหร่ — สั้น ๆ พอให้รู้ว่าเมื่อกี้หรือเมื่อวาน */
function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'เมื่อสักครู่'
  if (mins < 60) return `${mins} นาทีที่แล้ว`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} ชั่วโมงที่แล้ว`
  return `${Math.round(hrs / 24)} วันที่แล้ว`
}

export function NotificationBell({
  userId,
  items,
  unread,
}: {
  userId: string
  items: NotificationItem[]
  unread: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const refresh = useRef(router.refresh)
  refresh.current = router.refresh

  // ── realtime ────────────────────────────────────────────────────────
  // 🔴 ต้อง **ลองใหม่** ไม่ใช่ยอมแพ้ที่ CHANNEL_ERROR ครั้งแรก
  // ครั้งแรกที่โปรเจ็คหนึ่งใช้ Realtime จะได้ `MissingPartition` เสมอ
  // (Realtime สร้าง partition ของ `realtime.messages` ให้ตอนนั้นเอง)
  // ยอมแพ้ครั้งเดียวแล้วจบ = กระดิ่งเงียบไปทั้งวันโดยไม่มีอะไรฟ้อง
  useEffect(() => {
    const sb = getSupabaseBrowser()
    let cancelled = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let channel: ReturnType<typeof sb.channel> | null = null

    const connect = async () => {
      if (cancelled) return
      const { data } = await sb.auth.getSession()
      const token = data.session?.access_token
      if (!token || cancelled) return
      await sb.realtime.setAuth(token)

      channel = sb
        .channel(`notif:${userId}`, { config: { private: true } })
        .on('broadcast', { event: 'new' }, () => refresh.current())
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            attempt = 0
            return
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (cancelled || attempt >= 5) return
            // ถอยเป็นเท่าตัว 1·2·4·8·16 วินาที — ไม่รัวจนกลายเป็นการถล่มตัวเอง
            const wait = 1000 * 2 ** attempt
            attempt += 1
            if (channel) sb.removeChannel(channel)
            channel = null
            timer = setTimeout(connect, wait)
          }
        })
    }

    void connect()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      if (channel) sb.removeChannel(channel)
    }
  }, [userId])

  async function markRead(payload: { id: string } | { all: true }) {
    if (busy) return
    setBusy(true)
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      router.refresh()
    } catch {
      // เงียบโดยตั้งใจ — "ทำเป็นอ่านแล้ว" ล้มเหลวไม่ใช่เรื่องที่ต้องขัดจังหวะคนใช้
      // ตัวเลขจะยังอยู่ ซึ่งบอกความจริงว่ายังไม่ได้อ่าน
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label={unread > 0 ? `แจ้งเตือน ${unread} รายการที่ยังไม่ได้อ่าน` : 'แจ้งเตือน'}
        className="relative inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface text-ink-2 transition-colors hover:border-brand hover:text-brand"
      >
        <Bell className="size-4.5" />
        {/* 🔴 ไม่มีแจ้งเตือนค้าง = ไม่มีป้าย · ป้าย "0" อ่านเหมือนของเสีย
            พื้นใช้ --urgent-solid ซึ่งเข้มพอให้ตัวขาวอ่านออกทั้งสองธีม */}
        {unread > 0 && (
          <span
            data-unread={unread}
            className="absolute -right-1.5 -top-1.5 min-w-4.5 rounded-full bg-urgent-solid px-1 text-center text-[11px] font-bold leading-4.5 tnum text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85svh] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line bg-surface shadow-e3 animate-pop-in">
          <div className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
            <Dialog.Title className="text-base font-bold text-ink">แจ้งเตือน</Dialog.Title>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markRead({ all: true })}
                disabled={busy}
                className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-brand transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                อ่านทั้งหมด
              </button>
            )}
          </div>
          <Dialog.Description className="sr-only">
            รายการแจ้งเตือนล่าสุดของคุณ
          </Dialog.Description>

          {items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <BellOff className="mx-auto size-7 text-muted-token" strokeWidth={1.6} />
              <p className="mt-2 text-sm text-muted-token">ยังไม่มีแจ้งเตือน</p>
            </div>
          ) : (
            <ul>
              {items.map((n) => {
                const isUnread = n.read_at === null
                return (
                  <li key={n.id} className="border-b border-line-soft last:border-b-0">
                    <a
                      href={hrefOf(n)}
                      onClick={() => {
                        setOpen(false)
                        if (isUnread) void markRead({ id: n.id })
                      }}
                      className={`block px-4 py-3 transition-colors hover:bg-surface-2 ${
                        isUnread ? 'bg-brand-tint/40' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {isUnread && (
                          <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" />
                        )}
                        <div className="min-w-0">
                          <div className={`text-sm ${isUnread ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                            {n.title}
                          </div>
                          {n.body && (
                            <div className="mt-0.5 text-sm text-muted-token">{n.body}</div>
                          )}
                          <div className="mt-0.5 text-xs text-muted-token">{ago(n.created_at)}</div>
                        </div>
                      </div>
                    </a>
                  </li>
                )
              })}
            </ul>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
