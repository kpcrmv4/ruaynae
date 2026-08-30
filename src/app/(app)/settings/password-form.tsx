'use client'

import { useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

const MESSAGES: Record<string, string> = {
  CURRENT_PASSWORD_REQUIRED: 'กรุณากรอกรหัสผ่านปัจจุบัน',
  INVALID_CREDENTIALS: 'รหัสผ่านปัจจุบันไม่ถูกต้อง',
  PASSWORD_TOO_SHORT: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร',
  PASSWORD_UNCHANGED: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม',
  RATE_LIMITED: 'ลองผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
  FORBIDDEN: 'บัญชีนี้เข้าระบบด้วย PIN — ให้เจ้าของตั้ง PIN ใหม่ให้แทน',
}
const fail = (code?: string) => MESSAGES[code ?? ''] ?? 'เปลี่ยนรหัสผ่านไม่สำเร็จ'

/**
 * เปลี่ยนรหัสผ่านของตัวเอง — **ถามรหัสปัจจุบันเสมอ**
 *
 * ไม่ใช่พิธีกรรม: เซสชันที่เปิดค้างอยู่บนเครื่องที่วางไว้ (หรือเซสชันจากปุ่ม
 * เข้าใช้แบบเดโม่ ซึ่งเจ้าของเซสชันไม่เคยเห็นรหัสผ่านเลย) ก็เปลี่ยนรหัสได้
 * ถ้าไม่ถาม แล้วเจ้าของตัวจริงจะเข้าระบบไม่ได้อีก
 */
export function PasswordForm() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(fail(b.error))
        return
      }
      toast.success('เปลี่ยนรหัสผ่านแล้ว')
      setCurrent('')
      setNext('')
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 px-4 py-4">
      <div>
        <label htmlFor="currentPassword" className="label-base">
          รหัสผ่านปัจจุบัน
        </label>
        <input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className="input-base"
        />
      </div>
      <div>
        <label htmlFor="newPassword" className="label-base">
          รหัสผ่านใหม่
        </label>
        <input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className="input-base"
        />
        <p className="mt-1 text-xs text-muted-token">อย่างน้อย 8 ตัวอักษร</p>
      </div>
      <button type="submit" disabled={busy} className="btn-primary">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
        {busy ? 'กำลังเปลี่ยน…' : 'เปลี่ยนรหัสผ่าน'}
      </button>
    </form>
  )
}
