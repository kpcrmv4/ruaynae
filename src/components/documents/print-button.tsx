'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, Printer, Send } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

/**
 * ปุ่มพิมพ์ + คำถามเดียวที่ถามหลังพิมพ์: ส่งให้ลูกค้าแล้วหรือยัง
 *
 * 🔴 ไม่ติ๊ก "ส่งแล้ว" ให้อัตโนมัติตอนกดพิมพ์ — คนพิมพ์มาตรวจทานเฉย ๆ ก็มี
 * และการติ๊กนี้คือตัวล็อกยอดของเอกสาร ถ้าติ๊กให้เองจะกลายเป็นการล็อกที่
 * ผู้ใช้ไม่ได้สั่ง แล้วแก้คำผิดไม่ได้ทั้งที่ยังไม่ได้ส่งใคร
 */
export function PrintButton({ docId, canMarkSent }: { docId: string; canMarkSent: boolean }) {
  const router = useRouter()
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => {
          window.print()
          if (canMarkSent) setAsk(true)
        }}
        className="btn-primary"
      >
        <Printer className="size-4" />
        พิมพ์
      </button>

      <Dialog.Root open={ask} onOpenChange={(v) => { if (!busy) setAsk(v) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
            <Dialog.Title className="text-lg font-bold text-ink">ส่งให้ลูกค้าแล้วหรือยัง</Dialog.Title>
            <Dialog.Description className="mt-0.5 text-sm text-muted-token">
              ทำเครื่องหมายว่าส่งแล้ว จะ<span className="font-semibold text-ink">ล็อกยอดของใบนี้</span>
              — แก้ไม่ได้อีก เพราะลูกค้าถือกระดาษอยู่ · ถ้ายังแค่พิมพ์มาดู กด &ldquo;ยังไม่ส่ง&rdquo;
            </Dialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setAsk(false)} disabled={busy} className="btn-secondary">
                ยังไม่ส่ง
              </button>
              <button
                type="button"
                onClick={async () => {
                  setBusy(true)
                  try {
                    const r = await fetch(`/api/documents/${docId}/send`, { method: 'POST' })
                    if (!r.ok) {
                      toast.error('ทำเครื่องหมายไม่สำเร็จ กรุณาลองใหม่')
                      return
                    }
                    toast.success('ทำเครื่องหมายว่าส่งแล้ว')
                    setAsk(false)
                    router.refresh()
                  } catch {
                    toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
                  } finally {
                    setBusy(false)
                  }
                }}
                disabled={busy}
                className="btn-primary disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                ส่งแล้ว
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
