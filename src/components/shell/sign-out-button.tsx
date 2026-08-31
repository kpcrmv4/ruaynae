'use client'

import { Loader2, LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * ปุ่มออกจากระบบ — ที่เดียวสำหรับทั้งสองเชลล์
 *
 * เดิมตรรกะนี้อยู่ในแถบล่างมือถือที่เดียว บนจอใหญ่จึง**ไม่มีทางออกจากระบบเลย**
 * เพราะแถบล่างถูกซ่อนด้วย `lg:hidden` · เอาไปไว้สองที่แบบก๊อปวางก็จะเพี้ยนจากกัน
 * วันที่มีคนแก้ปลายทางของ logout แค่ที่เดียว
 *
 * หน้าตาต่างกันสองที่ (แผงกรมท่า vs แผ่นเลื่อนพื้นสว่าง) จึงรับ `className`
 * มาเป็นสไตล์ ส่วนพฤติกรรมอยู่ในนี้ทั้งหมด
 */
export function SignOutButton({ className }: { className: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function signOut() {
    if (busy) return
    setBusy(true)
    const r = await fetch('/api/auth/logout', { method: 'POST' })
    if (r.ok) {
      router.refresh()
      router.push('/login')
    } else {
      // ออกไม่สำเร็จต้องกดใหม่ได้ ไม่ใช่ปุ่มค้าง disabled ตลอดกาล
      setBusy(false)
    }
  }

  return (
    <button type="button" onClick={signOut} disabled={busy} className={className}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
      {busy ? 'กำลังออกจากระบบ' : 'ออกจากระบบ'}
    </button>
  )
}
