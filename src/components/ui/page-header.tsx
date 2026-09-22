import type { ReactNode } from 'react'
import { BackButton } from '@/components/ui/back-button'

/**
 * หัวข้อหน้า + ปุ่มย้อนกลับ + ปุ่มของหน้านั้น
 *
 * 🔴 **ปุ่มย้อนกลับอยู่แถวเดียวกับชื่อหน้า และชิดขวาของจอเสมอ**
 * (คำสั่งเจ้าของ 21 ก.ย. 2569) — แถวหัวข้อจึงมีแค่สองอย่าง: ชื่อหน้า กับปุ่มย้อนกลับ
 * และ **ห้าม `flex-wrap`** ในแถวนั้น
 *
 * เดิมปุ่มย้อนกลับถูกจับกลุ่มกับปุ่มของหน้า (`[ปุ่มของหน้า] [ย้อนกลับ]`) ในแถวที่
 * `flex-wrap` · ผลคือสองอาการที่เจ้าของเห็นจริง:
 *   1. จอแคบ ทั้งกลุ่มพับลงไปใต้ชื่อหน้า → ปุ่มย้อนกลับไม่ได้อยู่แถวเดียวกับหัวข้ออีก
 *   2. หน้าไหนมีปุ่มของตัวเองสั้น-ยาวไม่เท่ากัน ปุ่มย้อนกลับก็ขยับไปคนละตำแหน่ง
 *      ทุกหน้า → ตาต้องไล่หาใหม่ทุกครั้งที่เปลี่ยนหน้า
 * ปุ่มของหน้าจึงย้ายลงมาเป็นแถวของตัวเองใต้หัวข้อ ซึ่งกว้างเต็มและพับได้ตามสบาย
 *
 * 🔴 **ปุ่มย้อนกลับอยู่ในนี้ ไม่ใช่ให้แต่ละหน้าใส่เอง** — หน้าที่ใช้ `PageHeader`
 * จึงได้ปุ่มครบโดยอัตโนมัติและไม่มีทางหล่นหาย · `scripts/verify-back-button.mjs`
 * บังคับว่าทุกหน้าใต้ `(app)` ต้องผ่าน `PageHeader` ไม่ใช่ประกอบแถวหัวข้อเอง
 *
 * ระยะเหนือหัวข้อมากกว่าใต้หัวข้อเสมอ หัวข้อจึงผูกกับเนื้อหาของตัวเอง
 * ไม่ใช่ลอยอยู่กลางสองส่วน
 */
export function PageHeader({
  title,
  titleExtra,
  subtitle,
  action,
  backHref = '/',
  className = '',
}: {
  title: string
  /** ของที่ต้องอยู่ติดชื่อหน้า เช่นป้ายสถานะของเอกสาร — ไม่ใช่ปุ่ม */
  titleExtra?: ReactNode
  subtitle?: ReactNode
  /** ปุ่มของหน้านี้ — วาดเป็นแถวของตัวเองใต้หัวข้อ */
  action?: ReactNode
  /** ปลายทางตอนไม่มีประวัติให้ถอย (เปิดลิงก์ตรงเข้าหน้านี้) — ดู `BackButton` */
  backHref?: string
  /** เผื่อหน้าที่ต้องซ่อนหัวตอนพิมพ์ (`print-hide`) */
  className?: string
}) {
  return (
    <div className={`mb-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="min-w-0 truncate text-2xl font-bold text-ink">{title}</h1>
            {titleExtra}
          </div>
          {subtitle && <div className="mt-0.5 text-sm text-muted-token">{subtitle}</div>}
        </div>
        {/* `shrink-0` กันไม่ให้ตัวหนังสือไทยบนปุ่มถูกบีบจนแตกกลางพยางค์ ·
            อยู่นอก `min-w-0 flex-1` ข้างบน มันจึงชิดขวาของแถวเสมอ */}
        <BackButton fallbackHref={backHref} />
      </div>

      {action && <div className="mt-3 flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}
