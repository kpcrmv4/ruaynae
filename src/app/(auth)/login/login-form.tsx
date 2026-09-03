'use client'

import { Delete, Loader2, LogIn } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PIN_LENGTH } from '@/lib/pin-core'

type Tab = 'pin' | 'email'

/** ข้อความไทยของรหัสเหตุผลที่ API คืนมา — ไม่โชว์รหัสดิบให้ผู้ใช้เห็น */
const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  INVALID_PIN: 'PIN ไม่ถูกต้อง',
  PIN_LENGTH: `PIN ต้องเป็นตัวเลข ${PIN_LENGTH} หลัก`,
  ACCOUNT_DISABLED: 'บัญชีนี้ถูกปิดใช้งาน ติดต่อเจ้าของกิจการ',
  RATE_LIMITED: 'ลองผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่',
  PROFILE_UNAVAILABLE: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่',
  DEMO_UNAVAILABLE: 'บัญชีเดโม่ยังไม่พร้อมใช้งาน',
  NOT_FOUND: 'ปิดการเข้าใช้แบบเดโม่อยู่',
}
const fallbackMessage = 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่'

export function LoginForm({ demoEnabled }: { demoEnabled: boolean }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('pin')
  const [pin, setPin] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // กัน double-submit จากทั้งการกดรัวและการยิงอัตโนมัติตอนกดครบ 6 หลัก
  // useState อย่างเดียวไม่พอ เพราะ state ยังไม่ทันอัปเดตในจังหวะที่คลิกที่สองมาถึง
  const inFlight = useRef(false)

  const submit = useCallback(
    async (path: string, body: unknown) => {
      if (inFlight.current) return
      inFlight.current = true
      setPending(true)
      setError(null)
      try {
        const r = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await r.json().catch(() => ({}))
        if (!r.ok) {
          setError(MESSAGES[data?.error as string] ?? fallbackMessage)
          setPin('')
          return
        }
        // refresh ก่อน push เพื่อให้ Server Component อ่านคุกกี้ใหม่ที่เพิ่งได้มา
        router.refresh()
        router.push('/')
      } catch {
        setError('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
        setPin('')
      } finally {
        inFlight.current = false
        setPending(false)
      }
    },
    [router],
  )

  // ครบ 6 หลักแล้วส่งเอง ไม่ต้องมีปุ่มยืนยัน — คนกดบนมือถือกลางโครงการ
  useEffect(() => {
    if (pin.length === PIN_LENGTH && !inFlight.current) void submit('/api/auth/pin', { pin })
  }, [pin, submit])

  const press = (d: string) => {
    if (pending) return
    setError(null)
    setPin((p) => (p.length >= PIN_LENGTH ? p : p + d))
  }

  return (
    <>
      <div role="tablist" className="mb-4 flex gap-1 border-b border-line">
        {(
          [
            ['pin', 'หัวหน้าโครงการ · PIN'],
            ['email', 'เจ้าของ · อีเมล'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id)
              setError(null)
            }}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm transition-colors ${
              tab === id
                ? 'border-brand font-semibold text-brand'
                : 'border-transparent text-muted-token hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'pin' ? (
        <div>
          <div className="mb-5 flex justify-center gap-3" aria-label={`กรอก PIN ${PIN_LENGTH} หลัก`}>
            {Array.from({ length: PIN_LENGTH }, (_, i) => (
              <span
                key={i}
                className={`size-3 rounded-full ${
                  i < pin.length ? 'bg-brand' : 'border border-line-strong'
                }`}
              />
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} onClick={() => press(d)} disabled={pending} className="keypad-key">
                {d}
              </button>
            ))}
            <span />
            <button onClick={() => press('0')} disabled={pending} className="keypad-key">
              0
            </button>
            <button
              onClick={() => setPin((p) => p.slice(0, -1))}
              disabled={pending || pin.length === 0}
              aria-label="ลบตัวเลขล่าสุด"
              className="keypad-key text-muted-token"
            >
              <Delete className="size-5" />
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit('/api/auth/login', { email, password })
          }}
        >
          <div className="mb-4">
            <label htmlFor="email" className="label-base">
              อีเมล
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-base"
            />
          </div>
          <div className="mb-4">
            <label htmlFor="password" className="label-base">
              รหัสผ่าน
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-base"
            />
          </div>
          <button type="submit" disabled={pending} className="btn-primary w-full">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
            เข้าสู่ระบบ
          </button>
        </form>
      )}

      {/* พื้นที่ข้อความคงที่ — ไม่ให้ layout กระตุกตอน error โผล่ */}
      <p
        role="status"
        aria-live="polite"
        className="mt-4 min-h-10 text-center text-sm text-urgent"
      >
        {error}
      </p>

      {pending && tab === 'pin' && (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-token">
          <Loader2 className="size-4 animate-spin" /> กำลังเข้าสู่ระบบ
        </p>
      )}

      {demoEnabled && (
        <button
          onClick={() => void submit('/api/auth/demo', {})}
          disabled={pending}
          className="btn-secondary mt-2 w-full"
        >
          เข้าใช้แบบเดโม่
        </button>
      )}
    </>
  )
}
