import { HardDrive, ImageOff } from 'lucide-react'
import { Suspense } from 'react'
import { Skeleton } from '@/components/ui/states'
import { fmtBytes, fmtMoney } from '@/lib/format'
import { bucketUsage, type BucketUsage } from '@/lib/r2'
import { StorageRetry } from './storage-retry'

/**
 * พื้นที่เก็บรูปที่ใช้ไปแล้ว (CLAUDE.md §9)
 *
 * เดิมตรงนี้เป็นกล่องเปล่าที่เขียนว่า "ส่วนพื้นที่เก็บรูปจะเพิ่มในเฟสถัดไป" —
 * คำว่า "เฟส" เป็นศัพท์ของทีมที่สร้าง ไม่ใช่ของเจ้าของกิจการที่อ่านมัน
 * และกล่องที่บอกว่าตัวเองยังไม่มีอะไรก็ไม่ควรกินที่บนหน้าจอ
 *
 * ตัวเลขมาจาก R2 โดยตรง ไม่ใช่จากฐานข้อมูล — เหตุผลอยู่ใน `bucketUsage()`
 */

const ROWS = [
  { key: 'slips', label: 'สลิปและบิล' },
  { key: 'thumbs', label: 'รูปย่อในหน้ารายการ' },
  { key: 'branding', label: 'โลโก้บริษัท' },
  { key: 'other', label: 'อื่น ๆ' },
] as const

function StorageSkeleton() {
  return (
    <div className="space-y-3 p-4">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-3 w-40" />
      <div className="space-y-2 pt-1">
        {ROWS.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}

function UsageBody({ usage }: { usage: BucketUsage }) {
  if (usage.totalFiles === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-surface-2 text-muted-token ring-1 ring-inset ring-line">
          <ImageOff className="size-5" strokeWidth={1.8} />
        </span>
        <p className="mx-auto max-w-[46ch] text-sm leading-6 text-muted-token">
          ยังไม่มีรูปในระบบ · สลิปที่แนบตอนบันทึกรายจ่ายจะมานับรวมตรงนี้
        </p>
      </div>
    )
  }

  // แถวที่ยังไม่มีไฟล์เลยไม่ต้องโชว์ — "0 ไบต์" สี่บรรทัดไม่ได้บอกอะไร
  const rows = ROWS.filter((r) => usage.groups[r.key].files > 0)

  return (
    <div className="p-4">
      <p className="text-2xl font-bold tabular-nums text-ink">
        {usage.truncated && <span className="text-muted-token">มากกว่า </span>}
        {fmtBytes(usage.totalBytes)}
      </p>
      <p className="mt-0.5 text-xs text-muted-token">
        {fmtMoney(usage.totalFiles)} ไฟล์บน Cloudflare R2 · เก็บถาวร ไม่ลบอัตโนมัติ
      </p>

      <dl className="mt-3 space-y-1.5 border-t border-line-soft pt-3">
        {rows.map((r) => (
          <div key={r.key} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="min-w-0 truncate text-muted-token">{r.label}</dt>
            <dd className="shrink-0 tabular-nums text-ink-2">
              {fmtBytes(usage.groups[r.key].bytes)}
              <span className="ml-1.5 text-xs text-muted-token">
                ({fmtMoney(usage.groups[r.key].files)} ไฟล์)
              </span>
            </dd>
          </div>
        ))}
      </dl>

      {usage.groups.other.files > 0 && (
        <p className="mt-3 text-xs text-muted-token">
          &ldquo;อื่น ๆ&rdquo; คือไฟล์ที่คีย์ไม่เข้าหมวดไหน — ปกติไม่ควรมี
        </p>
      )}
    </div>
  )
}

function StorageError() {
  return (
    <div className="px-4 py-8 text-center">
      <p className="mx-auto mb-4 max-w-[46ch] text-sm leading-6 text-ink-2">
        อ่านพื้นที่เก็บรูปไม่สำเร็จ · รูปที่อัปไว้แล้วยังอยู่ครบ
      </p>
      <StorageRetry />
    </div>
  )
}

async function StorageBody() {
  // 🔴 R2 ล่มต้องไม่ทำให้หน้าตั้งค่าทั้งหน้าพัง — ส่วนอื่นของหน้านี้
  // (ชื่อบริษัท รหัสผ่าน ผู้ใช้) ไม่ได้พึ่ง R2 เลยและยังต้องใช้งานได้
  //
  // ดัก error ที่ `bucketUsage()` โดยตรง ไม่ใช่ห่อ JSX ไว้ใน try/catch —
  // React เรนเดอร์ทีหลัง error ตอนเรนเดอร์จึงไม่มีทางตกลง catch นั้นอยู่ดี
  // (กติกา react-hooks/error-boundaries) · ตัวที่พังได้จริงคือการยิงไป R2
  const usage = await bucketUsage().catch(() => null)
  return usage ? <UsageBody usage={usage} /> : <StorageError />
}

export function StorageCard() {
  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
        <HardDrive className="size-4 shrink-0 text-brand" strokeWidth={1.8} />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">พื้นที่เก็บรูป</h2>
          <p className="mt-0.5 text-xs text-muted-token">สลิปและโลโก้ที่เก็บไว้บนคลาวด์</p>
        </div>
      </div>
      {/* Suspense เฉพาะการ์ดนี้ — หน้าตั้งค่าที่เหลือไม่ต้องรอ R2 ตอบ */}
      <Suspense fallback={<StorageSkeleton />}>
        <StorageBody />
      </Suspense>
    </section>
  )
}
