'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { txnError } from '@/lib/transactions'
import { advanceError } from '@/lib/advances'

export type ApprovalAction = 'approve' | 'reject'
/** คิวเดียวกัน แต่คนละตาราง — รายจ่ายที่หัวหน้าโครงการคีย์ / คำขอเบิกค่าแรง */
export type ApprovalKind = 'transaction' | 'advance'

/**
 * ยิงอนุมัติ/ตีกลับหนึ่งรายการ — ตรรกะชุดเดียวที่ปุ่มท้ายแถวและกล่องรายละเอียดใช้ร่วมกัน
 *
 * 🔴 เขียนสองที่เมื่อไหร่ อีกที่จะลืมอัปเดตทันทีที่กติกาเปลี่ยน (เช่นวันหน้า
 * ต้องแนบเหตุผลตอนอนุมัติด้วย) · ที่นี่จึงเป็นที่เดียวที่รู้จัก endpoint,
 * การกันกดซ้ำ, ข้อความ toast และการสั่ง refresh
 *
 * คืน `ok` ให้ผู้เรียกตัดสินใจเองว่าจะปิดกล่องหรือแสดง error ตรงช่องไหน
 */
export function useApproval(id: string, kind: ApprovalKind = 'transaction') {
  const router = useRouter()
  const [busy, setBusy] = useState<ApprovalAction | null>(null)
  const path = kind === 'advance' ? 'advances' : 'transactions'
  // ข้อความผิดพลาดของสองตารางไม่เหมือนกัน (ALREADY_APPROVED · PAYROLL_CLOSED
  // มีเฉพาะฝั่งใบเบิก) — แปลด้วยพจนานุกรมของตัวเองเสมอ
  const toMessage = kind === 'advance' ? advanceError : txnError

  async function send(
    action: ApprovalAction,
    reason?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    // 🔴 กันกดซ้ำสองชั้น: ปุ่ม disabled *และ* ธงตรงนี้ — การกดรัว ๆ ยิง onClick
    // ได้ก่อนที่ React จะ re-render ปุ่มเป็น disabled
    if (busy) return { ok: false }
    setBusy(action)
    try {
      const r = await fetch(`/api/${path}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'approve' ? { action } : { action, reason: (reason ?? '').trim() },
        ),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        const msg = toMessage(b.error)
        toast.error(msg)
        return { ok: false, error: msg }
      }
      toast.success(
        action === 'approve'
          ? 'อนุมัติแล้ว'
          : kind === 'advance' ? 'ไม่อนุมัติคำขอนี้แล้ว' : 'ตีกลับแล้ว',
      )
      // แถวหายจากคิวเพราะ query กรอง `pending` — refresh ให้เซิร์ฟเวอร์คำนวณใหม่
      // ไม่ใช่ลบออกจาก state เอง ซึ่งจะเพี้ยนทันทีที่มีคนอื่นกดพร้อมกัน
      router.refresh()
      return { ok: true }
    } catch {
      const msg = 'เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่'
      toast.error(msg)
      return { ok: false, error: msg }
    } finally {
      setBusy(null)
    }
  }

  return { busy, send }
}
