'use client'

import * as Dialog from '@radix-ui/react-dialog'
import {
  Activity,
  AlertTriangle,
  Building2,
  Check,
  Copy,
  Info,
  KeyRound,
  Layers,
  Loader2,
  Plus,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/ui/states'
import { PageHeader } from '@/components/ui/page-header'
import { LOCALE, TZ } from '@/lib/constants'

type KeyRow = {
  id: string
  label: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
}
type CallRow = { id: string; tool: string; ok: boolean; ms: number | null; at: string }

/** ทุก formatter ผูกเขตเวลาไทยชัดเจน — เซิร์ฟเวอร์รันเป็น UTC */
const fmt = (iso: string) =>
  new Date(iso).toLocaleString(LOCALE, {
    timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

export function McpClient({
  origin,
  isLocalOrigin,
  initialKeys,
  calls,
}: {
  origin: string
  isLocalOrigin: boolean
  initialKeys: KeyRow[]
  calls: CallRow[]
}) {
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  /** เปิดกล่องยืนยันเพิกถอนของแถวไหนอยู่ — คุมเองแทนปล่อยให้ Dialog.Close ปิดทันที
   * ที่กด เพื่อให้กล่องยังอยู่ระหว่างรอผล DELETE และปิดเฉพาะตอนสำเร็จเท่านั้น */
  const [openRevokeId, setOpenRevokeId] = useState<string | null>(null)
  /**
   * 🔴 คีย์เต็มอยู่ใน state ตัวนี้เท่านั้น และไม่ถูกเก็บที่ไหนอีกเลย
   * ปิดหน้าหรือรีเฟรชแล้วหายถาวร — ตั้งใจให้เป็นแบบนั้น
   */
  const [freshUrl, setFreshUrl] = useState<string | null>(null)

  const create = async () => {
    const name = label.trim()
    if (!name) return toast.error('กรุณาตั้งชื่อเครื่องที่จะเชื่อมต่อ')
    if (busy) return
    setBusy('new')
    try {
      const r = await fetch('/api/settings/mcp-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: name }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(
          b.error === 'TOO_MANY_KEYS'
            ? 'มีคีย์ที่ใช้งานอยู่ครบจำนวนแล้ว กรุณาเพิกถอนใบที่ไม่ใช้ก่อน'
            : b.error === 'LABEL_REQUIRED'
              ? 'กรุณาตั้งชื่อเครื่องที่จะเชื่อมต่อ'
              : 'ออกคีย์ไม่สำเร็จ กรุณาลองใหม่',
        )
        return
      }
      setFreshUrl(`${origin}/api/mcp/${b.key}`)
      setLabel('')
      setCopied(false)
      toast.success('ออกคีย์แล้ว — คัดลอกเก็บไว้ตอนนี้')
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  const revoke = async (id: string) => {
    if (busy) return
    setBusy(id)
    try {
      const r = await fetch(`/api/settings/mcp-keys/${id}`, { method: 'DELETE' })
      if (!r.ok) {
        toast.error('เพิกถอนไม่สำเร็จ กรุณาลองใหม่')
        return
      }
      toast.success('เพิกถอนคีย์แล้ว — เครื่องที่ใช้คีย์นี้จะเชื่อมต่อไม่ได้ทันที')
      setOpenRevokeId(null)
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  const copy = async () => {
    if (!freshUrl) return
    try {
      await navigator.clipboard.writeText(freshUrl)
      setCopied(true)
      toast.success('คัดลอกแล้ว')
    } catch {
      // clipboard ถูกปฏิเสธได้ (http ที่ไม่ใช่ localhost, สิทธิ์เบราว์เซอร์)
      // ต้องบอกทางออก ไม่ใช่เงียบ — ข้อความในกล่องเลือกคัดลอกเองได้อยู่แล้ว
      toast.error('คัดลอกอัตโนมัติไม่ได้ กรุณาลากเลือกข้อความแล้วคัดลอกเอง')
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="เชื่อมต่อ AI"
        subtitle="ให้ Claude หรือ ChatGPT อ่านตัวเลขของคุณเพื่อตอบคำถาม — อ่านอย่างเดียว แก้ไขอะไรไม่ได้"
      />

      {/* 🔴 Claude เรียกจากคลาวด์ ไม่ใช่จากเครื่องผู้ใช้ — ไม่เตือนตรงนี้
          เจ้าของจะคัดลอก localhost ไปวางแล้วมาบอกว่าเซิร์ฟเวอร์เสีย */}
      {isLocalOrigin && (
        <div
          data-testid="mcp-origin-warning"
          className="flex gap-3 rounded-lg border border-urgent-ring bg-urgent-bg px-4 py-3"
        >
          <AlertTriangle className="size-5 shrink-0 text-urgent" strokeWidth={1.8} />
          <p className="text-sm leading-6 text-ink-2">
            ที่อยู่ตอนนี้เป็น <span className="font-mono">{origin}</span> ซึ่งเป็นเครื่องในบ้าน
            — Claude เรียกจากอินเทอร์เน็ตมาไม่ถึง
            <br />
            ต้องนำระบบขึ้นเซิร์ฟเวอร์จริงก่อน คีย์ที่ออกตอนนี้จึงใช้ต่อจากแอปไม่ได้
          </p>
        </div>
      )}

      {/* ── ออกคีย์ใหม่ ─────────────────────────────────────────── */}
      <section className="panel p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label htmlFor="mcp-label" className="label-base">
              ชื่อเครื่องที่จะเชื่อมต่อ
            </label>
            <input
              id="mcp-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="เช่น โน้ตบุ๊กเจ้าของ"
              className="input-base"
            />
          </div>
          <button type="button" onClick={create} disabled={busy !== null} className="btn-primary">
            {busy === 'new' ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            ออกคีย์ใหม่
          </button>
        </div>

        {freshUrl && (
          <div className="mt-4 rounded-lg border border-brand bg-surface-2 p-3">
            <p className="mb-2 text-sm font-bold text-ink">
              คัดลอกเก็บไว้ตอนนี้ — ปิดหน้านี้แล้วจะไม่เห็นค่านี้อีก
            </p>
            {/* URL ยาวมาก ต้อง break ไม่ใช่ดันหน้าจอกว้างออกไป */}
            <p className="mb-3 break-all rounded-xs bg-surface px-3 py-2 font-mono text-xs leading-5 text-ink-2">
              {freshUrl}
            </p>
            <button type="button" onClick={copy} className="btn-secondary">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
            </button>
          </div>
        )}
      </section>

      {/* ── คีย์ที่ใช้งานอยู่ ────────────────────────────────────── */}
      {initialKeys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          message="ยังไม่มีคีย์ — กดออกคีย์ใหม่ด้านบน แล้วนำ URL ที่ได้ไปใส่ใน Claude หรือ ChatGPT"
        />
      ) : (
        <section className="panel">
          {initialKeys.map((k) => (
            <div key={k.id} className="flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{k.label}</span>
                <span className="block font-mono text-xs text-muted-token">{k.key_prefix}…</span>
                <span className="block text-xs text-muted-token">
                  ออกเมื่อ {fmt(k.created_at)} ·{' '}
                  {k.last_used_at ? `ใช้ล่าสุด ${fmt(k.last_used_at)}` : 'ยังไม่เคยใช้'}
                </span>
              </span>

              {/* ห้าม confirm() — CLAUDE.md §15 บังคับ radix สำหรับการยืนยัน
                  🔴 คุม open เอง แล้วปิดเฉพาะตอนสำเร็จ — เดิม Dialog.Close ครอบปุ่ม
                  ยืนยันทำให้กล่องหายทันทีที่กด ก่อน DELETE จะเสร็จ ความล้มเหลวเลย
                  โผล่เป็น toast หลังกล่องปิดไปแล้ว ซึ่งงงสำหรับคนที่ไม่ชำนาญคอม
                  (แพตเทิร์นเดียวกับ approvals-client.tsx / sites-client.tsx) */}
              <Dialog.Root
                open={openRevokeId === k.id}
                onOpenChange={(v) => {
                  if (busy) return
                  setOpenRevokeId(v ? k.id : null)
                }}
              >
                <Dialog.Trigger asChild>
                  <button type="button" disabled={busy !== null} className="btn-danger shrink-0">
                    <Trash2 className="size-4" />
                    เพิกถอน
                  </button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="fixed inset-0 bg-black/40" />
                  <Dialog.Content className="panel fixed left-1/2 top-1/2 w-[min(28rem,92vw)] -translate-x-1/2 -translate-y-1/2 p-5">
                    <Dialog.Title className="text-base font-bold text-ink">
                      เพิกถอน “{k.label}” ?
                    </Dialog.Title>
                    <Dialog.Description className="mt-2 text-sm leading-6 text-muted-token">
                      เครื่องที่ใช้คีย์นี้จะเชื่อมต่อไม่ได้ทันที และย้อนกลับไม่ได้
                      ถ้าต้องการใช้อีกต้องออกคีย์ใบใหม่
                    </Dialog.Description>
                    <div className="mt-4 flex justify-end gap-2">
                      <Dialog.Close disabled={busy !== null} className="btn-secondary">
                        ยกเลิก
                      </Dialog.Close>
                      <button
                        type="button"
                        onClick={() => revoke(k.id)}
                        disabled={busy !== null}
                        className="btn-danger disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {busy === k.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                        เพิกถอน
                      </button>
                    </div>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
            </div>
          ))}
        </section>
      )}

      {/* ── คู่มือเชื่อมต่อ ──────────────────────────────────────── */}
      <section className="panel">
        <div className="panel-head">คู่มือเชื่อมต่อกับ Claude</div>
        <div className="space-y-4 p-4">
          {/* 🔴 ข้อที่พลาดบ่อยที่สุด — บอกก่อนเรื่องอื่นทั้งหมด ไม่งั้นเจ้าของจะไป
              ไล่หาปุ่มในแอปมือถือจนท้อแล้วเลิก */}
          <div className="flex gap-3 rounded-lg border border-urgent-ring bg-urgent-bg px-4 py-3">
            <Smartphone className="size-5 shrink-0 text-urgent" strokeWidth={1.8} />
            <p className="text-sm leading-6 text-ink-2">
              <span className="font-bold text-ink">แอปมือถือเพิ่มการเชื่อมต่อเองไม่ได้</span> —
              ต้องเปิด <span className="font-mono">claude.ai</span> บนคอมพิวเตอร์หรือเบราว์เซอร์ก่อน
              ทำขั้นตอนนี้ครั้งเดียวที่นั่น แล้วมันจะซิงก์ลงแอปมือถือให้เองโดยไม่ต้องทำซ้ำ
            </p>
          </div>

          <div className="flex gap-3 rounded-lg border border-line bg-surface-2 p-3">
            <Layers className="size-5 shrink-0 text-muted-token" strokeWidth={1.8} />
            <p className="text-sm leading-6 text-ink-2">
              <span className="font-semibold text-ink">แผนฟรีเพิ่มได้ 1 ตัว:</span>{' '}
              ไม่ใช่ฟีเจอร์ที่ต้องเสียเงินถึงจะใช้ได้ — แผนฟรีของ Claude เพิ่ม custom connector
              ได้ 1 ตัว ถ้ามีตัวเดิมอยู่แล้วต้องลบทิ้งก่อนถึงจะเพิ่มใหม่ได้
              ส่วนแผนเสียเงิน (Pro ขึ้นไป) เพิ่มได้หลายตัวพร้อมกัน
            </p>
          </div>

          <ol className="list-decimal space-y-3 pl-5 text-sm leading-6 text-ink-2">
            <li>
              เปิด <span className="font-mono">claude.ai</span> แล้วไปที่{' '}
              <span className="font-semibold text-ink">
                Settings → <span className="underline decoration-2 underline-offset-2">Customize</span> → Connectors → + → Add custom connector
              </span>
              <br />
              <span className="text-xs text-muted-token">
                จุดที่คนพลาดมากที่สุดคือมองข้ามคำว่า “Customize” — เมนู Connectors ซ่อนอยู่ในนั้น
                ไม่ได้อยู่หน้าแรกของ Settings ถ้าหาไม่เจอ ให้กลับมาดูคำนี้ก่อน
              </span>
            </li>
            <li>ตั้งชื่อการเชื่อมต่อ แล้ววาง URL ที่คัดลอกไว้ด้านบนลงในช่อง URL</li>
            <li>
              ที่ช่อง Authentication เลือก <span className="font-mono font-semibold text-ink">None</span>
              <br />
              <span className="text-xs text-muted-token">
                เลือกโหมดอื่นแล้วระบบจะรอปุ่ม Connect ที่กดผ่านไม่ได้เลย — คีย์ที่ฝังอยู่ใน URL
                ทำหน้าที่ยืนยันตัวตนอยู่แล้วในตัวเอง
              </span>
            </li>
            <li>
              กด Add แล้ว <span className="font-bold text-ink">สลับเครื่องมือทั้งหมดเป็น “Always allow” ทันที</span>
              <br />
              <span className="text-xs text-muted-token">
                ค่าเริ่มต้นหลังกด Add คือ “Needs approval” เจ้าของส่วนใหญ่เห็นข้อความนี้แล้วเข้าใจว่า
                เชื่อมต่อพัง — สลับเป็น Always allow แล้วถามคำถามได้ตามปกติทันที
              </span>
            </li>
          </ol>

          <div className="flex gap-3 rounded-lg border border-line bg-surface-2 p-3">
            <Building2 className="size-5 shrink-0 text-muted-token" strokeWidth={1.8} />
            <p className="text-sm leading-6 text-ink-2">
              <span className="font-semibold text-ink">ใช้บัญชีทีมหรือองค์กร (Team / Enterprise):</span>{' '}
              คนละเส้นทางและคนละคนกด —{' '}
              <span className="font-mono">Organization settings → Connectors → Add → ชี้ที่ Custom → Web</span>
              {' '}และ<span className="font-semibold text-ink">ต้องเป็นเจ้าของบัญชีองค์กรเท่านั้น</span>
              ที่ทำได้ สมาชิกทั่วไปจะไม่เจอเมนูนี้เลยไม่ว่าจะหาแค่ไหน
            </p>
          </div>

          <div className="flex gap-3 rounded-lg border border-line bg-surface-2 p-3">
            <Info className="size-5 shrink-0 text-muted-token" strokeWidth={1.8} />
            <p className="text-sm leading-6 text-ink-2">
              <span className="font-semibold text-ink">ใช้กับ ChatGPT แทน:</span>{' '}
              <span className="font-mono">Settings → Connectors → Advanced → เปิด Developer mode</span>
              {' '}แล้วสร้างการเชื่อมต่อใหม่ด้วย URL เดียวกันนี้
              <br />
              <span className="text-xs text-muted-token">
                เส้นทางฝั่ง Claude ด้านบนคือเส้นทางที่ตรวจกับหน้าจอจริงแล้ว — เมนูของ ChatGPT
                เปลี่ยนบ่อยกว่าและยังไม่ได้ตรวจซ้ำ
              </span>
            </p>
          </div>

          <p className="text-xs text-muted-token">
            ตรวจกับหน้าจอจริงของ claude.ai เมื่อ 31 ส.ค. 2569 — ถ้าเมนูจริงบนหน้าจอไม่ตรงกับที่เขียนไว้นี้
            ให้ยึดหน้าจอจริงเป็นหลัก
          </p>
        </div>
      </section>

      {/* ── การใช้งานล่าสุด ──────────────────────────────────────── */}
      <section className="panel">
        <div className="panel-head">
          การใช้งานล่าสุด
          <span className="ml-auto text-xs font-normal text-muted-token">{calls.length} รายการ</span>
        </div>
        {calls.length === 0 ? (
          <EmptyState icon={Activity} message="ยังไม่มีการเรียกใช้จาก AI" />
        ) : (
          <ul>
            {calls.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-b-0"
              >
                {c.ok ? (
                  <Check className="size-4 shrink-0 text-brand" strokeWidth={2} aria-label="สำเร็จ" />
                ) : (
                  <X className="size-4 shrink-0 text-urgent" strokeWidth={2} aria-label="ล้มเหลว" />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-ink">{c.tool}</span>
                <span className="shrink-0 text-xs tnum text-muted-token">
                  {c.ms != null ? `${c.ms} ms` : '—'}
                </span>
                <span className="shrink-0 text-xs text-muted-token">{fmt(c.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
