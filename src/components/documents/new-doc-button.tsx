import Link from 'next/link'
import { Plus } from 'lucide-react'
import { DOC_KIND_SHORT, type DocKind } from '@/lib/documents'

/**
 * ปุ่มสร้างเอกสารใหม่ — ความหมายเปลี่ยนตามแท็บที่เปิดอยู่
 *
 * ไม่ใช่ client component: มันคือลิงก์ ไม่มี state · หน้าที่เรียกใช้เป็น
 * Server Component อยู่แล้ว การทำให้เป็น client จะลากทั้งกิ่งไปฝั่งเบราว์เซอร์ฟรี ๆ
 */
export function NewDocButton({ kind, siteId }: { kind: DocKind; siteId?: string }) {
  const params = new URLSearchParams({ kind })
  if (siteId) params.set('site', siteId)
  return (
    <Link href={`/documents/new?${params.toString()}`} className="btn-primary shrink-0">
      <Plus className="size-4" />
      สร้าง{DOC_KIND_SHORT[kind]}
    </Link>
  )
}
