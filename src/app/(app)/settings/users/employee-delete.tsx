'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { employeeError } from '@/lib/employees'
import { fmtBaht } from '@/lib/format'

/**
 * ปุ่มลบคนงานหนึ่งคน พร้อมกล่องยืนยันที่ **บอกตัวเลขก่อนถาม**
 *
 * 🔴 กล่องที่ถามว่า "แน่ใจไหม" เฉย ๆ คือปุ่มที่คนกดผ่านโดยไม่อ่าน · ตัวเลข
 * ค้างจ่ายมากับหน้าตั้งแต่ตอนโหลด (`employees_delete_info()`) จึงขึ้นทันที
 * ไม่ต้องรอเน็ตหลังกด — กล่องที่ค้างรอก่อนบอกอะไรได้ ก็ถูกกดผ่านเหมือนกัน
 *
 * 🔴 คนที่เคยอยู่ในรอบจ่ายที่ปิดแล้ว **ไม่มีปุ่ม "ลบถาวร" ในกล่อง** — มีแต่คำอธิบาย
 * ว่าทำไมถึงลบไม่ได้และให้ใช้ "ปิดใช้งาน" แทน · ปุ่มที่กดยังไงก็ไม่ผ่านคือปุ่ม
 * ที่ไม่ควรมี (§15) แต่ "หายไปเฉย ๆ" ก็ตอบคำถามของเจ้าของไม่ได้ว่าทำไมลบไม่ได้
 */
export type DeleteInfo = {
  work_days: number
  unpaid_wage: number
  open_advance: number
  advance_count: number
  payroll_lines: number
}

export function EmployeeDelete({
  id,
  fullName,
  info,
  disabled,
}: {
  id: string
  fullName: string
  info: DeleteInfo | undefined
  disabled: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const paid = (info?.payroll_lines ?? 0) > 0
  const unpaid = Number(info?.unpaid_wage ?? 0)
  const advance = Number(info?.open_advance ?? 0)
  const days = Number(info?.work_days ?? 0)
  const hasHistory = days > 0 || advance > 0 || (info?.advance_count ?? 0) > 0

  const remove = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const r = await fetch(`/api/employees/${id}`, { method: 'DELETE' })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        const msg = employeeError(b.error)
        setError(msg)
        toast.error(msg)
        return
      }
      toast.success(`ลบ ${fullName} แล้ว`)
      setOpen(false)
      router.refresh()
    } catch {
      // ห้ามเอาข้อความของเบราว์เซอร์ขึ้นจอ (CLAUDE.md §17 ข้อ 13)
      setError('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!busy) { setOpen(v); setError('') } }}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`ลบ ${fullName}`}
          className="btn-danger disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 className="size-4" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
        <Dialog.Content className="panel fixed left-1/2 top-1/2 z-50 w-[min(30rem,92vw)] -translate-x-1/2 -translate-y-1/2 p-5 animate-pop-in">
          <Dialog.Title className="text-base font-bold text-ink">ลบ “{fullName}” ?</Dialog.Title>

          {paid ? (
            <Dialog.Description className="mt-2 text-sm leading-6 text-muted-token">
              คนนี้เคยรับค่าแรงไปแล้ว {info?.payroll_lines} ครั้ง —
              ยอดที่จ่ายไปแล้วอ้างถึงชื่อนี้อยู่ <span className="font-medium text-ink-2">จึงลบไม่ได้</span>
              <br />
              ถ้าคนนี้ไม่ทำงานกับเราแล้ว ให้กด “ปิดใช้งาน” แทน — ชื่อจะหายจากรายการลงชื่อเข้าโครงการ
              แต่ประวัติค่าแรงยังอยู่ครบ
            </Dialog.Description>
          ) : (
            <>
              <Dialog.Description className="mt-2 text-sm leading-6 text-muted-token">
                ลบแล้วย้อนกลับไม่ได้ · ประวัติการลงชื่อเข้าโครงการและใบเบิกของคนนี้จะถูกลบไปด้วย
              </Dialog.Description>

              {/* 🔴 เตือนเฉพาะตอนที่มีอะไรจะเสียจริง — กล่องเตือนที่ขึ้นทุกครั้ง
                  แม้ตอนไม่มีอะไรเลย คือกล่องที่คนเลิกอ่านตั้งแต่ครั้งที่สาม */}
              {unpaid > 0 || advance > 0 ? (
                <div className="mt-3 flex gap-3 rounded-lg border border-urgent-ring bg-urgent-bg px-4 py-3">
                  <AlertTriangle className="size-5 shrink-0 text-urgent" strokeWidth={1.8} />
                  <div className="text-sm leading-6 text-ink-2">
                    <p className="font-bold text-ink">ยังจ่ายค่าแรงคนนี้ไม่ครบ</p>
                    <ul className="mt-1 space-y-0.5">
                      <li>
                        ค่าแรงค้างจ่าย{' '}
                        <span className="font-bold tnum text-urgent">{fmtBaht(unpaid)}</span>{' '}
                        <span className="text-muted-token">(ลงชื่อไว้ {days} วัน)</span>
                      </li>
                      {advance > 0 && (
                        <li>
                          เบิกล่วงหน้าไปแล้ว{' '}
                          <span className="font-bold tnum text-ink">{fmtBaht(advance)}</span>{' '}
                          <span className="text-muted-token">({info?.advance_count} ครั้ง)</span>
                        </li>
                      )}
                      <li className="text-muted-token">
                        คงเหลือต้องจ่ายอีก{' '}
                        <span className="font-bold tnum text-ink-2">{fmtBaht(unpaid - advance)}</span>
                      </li>
                    </ul>
                    <p className="mt-1 text-muted-token">
                      ลบแล้วยอดนี้จะหายจากหน้าค่าแรงค้างจ่าย และต้นทุนค่าแรงของโครงการจะลดลงตามวันที่ลบไป
                    </p>
                  </div>
                </div>
              ) : hasHistory ? (
                <p className="mt-3 text-sm leading-6 text-muted-token">
                  ลงชื่อเข้าโครงการไว้ {days} วัน · จ่ายค่าแรงครบแล้ว ไม่มียอดค้าง
                </p>
              ) : (
                <p className="mt-3 text-sm leading-6 text-muted-token">
                  คนนี้ยังไม่เคยลงชื่อเข้าโครงการและไม่มีใบเบิก — ลบได้เลย
                </p>
              )}
            </>
          )}

          {error && <p className="mt-3 text-sm text-urgent">{error}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close disabled={busy} className="btn-secondary">
              {paid ? 'ปิด' : 'ยกเลิก'}
            </Dialog.Close>
            {!paid && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="btn-danger disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                ลบถาวร
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
