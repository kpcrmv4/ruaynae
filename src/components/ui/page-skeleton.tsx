import { ListSkeleton, MetricSkeleton, Skeleton } from '@/components/ui/states'

/**
 * โครงร่างระดับหน้า — ใช้ใน `loading.tsx` ของแต่ละ segment
 *
 * 🔴 โครงร่างต้องมี **รูปร่างเดียวกับของจริง** ไม่ใช่แถบเทาทั่วไป · โครงร่างผิด
 * รูปทำให้ของจริงมาถึงแล้วหน้ากระตุก ซึ่งรู้สึกช้ากว่าไม่มีโครงร่างเลย
 * ตัวนี้จึงรับ `metrics` กับ `rows` มาให้ตรงกับจำนวนที่หน้านั้นวาดจริง
 *
 * 🔴 **ไม่มี `loading.tsx` ที่ระดับกลุ่ม `(app)` โดยเจตนา** — `loading.tsx`
 * เปลี่ยน response ของ segment นั้นเป็นแบบสตรีม ซึ่งทำให้ `notFound()`
 * ตั้งรหัส 404 ไม่ได้อีก (`/sites/[id]` เรียก `notFound()` อยู่) · ถ้าวางไฟล์
 * ไว้ที่ระดับกลุ่ม มันจะครอบ `[id]` ไปด้วยแล้วโครงการที่ไม่มีอยู่จริงจะตอบ 200
 * เงียบ ๆ · จึงวางเป็นรายหน้าเท่านั้น และตั้งใจไม่วางใน `sites/[id]`
 */
export function PageSkeleton({
  metrics = 0,
  rows = 5,
  toolbar = false,
  titleWidth = 'w-40',
}: {
  metrics?: number
  rows?: number
  toolbar?: boolean
  titleWidth?: string
}) {
  return (
    <div data-state="skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">กำลังโหลดข้อมูล</span>

      {/* ตรงกับ <PageHeader>: หัวเรื่องบรรทัดเดียว + คำอธิบายใต้หัว */}
      <div className="mb-5 space-y-2">
        <Skeleton className={`h-7 ${titleWidth}`} />
        <Skeleton className="h-4 w-56" />
      </div>

      {metrics > 0 && <MetricSkeleton count={metrics} />}

      {/* ตรงกับ <ListToolbar>: ช่องค้นหาเต็มแถว + ชิปกรองสามอัน */}
      {toolbar && (
        <div className="mb-4 space-y-3">
          <Skeleton className="h-10 w-full rounded-md" />
          <div className="flex gap-2">
            <Skeleton className="h-7 w-20 rounded-full" />
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-7 w-16 rounded-full" />
          </div>
        </div>
      )}

      <ListSkeleton rows={rows} />
    </div>
  )
}
