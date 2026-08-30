import { Hammer } from 'lucide-react'

/**
 * หน้ายังไม่ได้สร้าง — มีไว้เพื่อไม่ให้เมนูใน shell กดแล้วเจอ 404
 * ปุ่มที่ไม่มีหน้าอยู่ปลายทางคือปุ่มที่ไม่มีใครทดสอบ
 */
export function ComingSoon({ title, detail, phase }: { title: string; detail: string; phase: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line-soft px-4 py-3.5">
        <h1 className="text-lg font-bold text-ink">{title}</h1>
        <p className="mt-0.5 text-sm text-muted-token">{detail}</p>
      </div>
      <div className="px-4 py-12 text-center">
        <Hammer className="mx-auto mb-3 size-8 text-muted-token" strokeWidth={1.4} />
        <p className="text-sm text-muted-token">
          หน้านี้อยู่ในเฟส <span className="font-semibold text-ink">{phase}</span> ยังไม่ได้สร้าง
        </p>
      </div>
    </div>
  )
}
