import { fmtBaht } from '@/lib/format'

export type CategoryTotal = {
  category_id: string | null
  name: string
  kind: 'income' | 'expense'
  total: number
  item_count: number
}

/**
 * ยอดรวมแยกหมวดของ **ทั้งโครงการ** — ไม่ใช่ผลบวกของแถวล่าสุดที่วาดอยู่ข้างล่าง
 *
 * 🔴 หัวเรื่องต้องเขียนว่า "ทั้งโครงการ" ให้ชัด เพราะกล่องนี้อยู่ในแผงเดียวกับ
 * ลิสต์ 10 แถวล่าสุด · คนอ่านที่คิดว่ามันคือผลบวกของสิบแถวนั้นจะลองบวกเองแล้ว
 * ได้ไม่ตรง แล้วเลิกเชื่อทั้งหน้า (§17 ข้อ 2)
 *
 * 🔴 แถว "ค่าแรงจากการลงชื่อ" มาจาก RPC เอง (`category_id = null`) ไม่ใช่หมวด
 * ในตาราง `categories` — ถ้าไม่มีแถวนี้ ผลรวมฝั่งรายจ่ายจะน้อยกว่า "ต้นทุนสะสม"
 * ที่เขียนอยู่ข้างบนของหน้าเดียวกันโดยไม่มีคำอธิบาย
 *
 * Server Component — ไม่มีอะไรต้องกด
 */
export function CategoryTotals({ rows }: { rows: CategoryTotal[] }) {
  if (rows.length === 0) return null

  const expense = rows.filter((r) => r.kind === 'expense')
  const income = rows.filter((r) => r.kind === 'income')
  // มีฝั่งเดียวก็ใช้คอลัมน์เดียว — ไม่ปล่อยครึ่งขวาว่างไว้เฉย ๆ ให้ดูเหมือนของหาย
  const bothSides = expense.length > 0 && income.length > 0

  return (
    <div className="border-b border-line-soft px-4 py-3">
      <p className="mb-2 text-xs font-medium text-muted-token">
        ยอดรวมทั้งโครงการ แยกตามหมวด{' '}
        <span className="text-muted-token/80">(นับเฉพาะรายการที่อนุมัติแล้ว)</span>
      </p>

      <div className={`grid gap-x-6 gap-y-3 ${bothSides ? 'sm:grid-cols-2' : ''}`}>
        <Group title="รายจ่าย" tone="expense" rows={expense} />
        <Group title="รายรับ" tone="income" rows={income} />
      </div>
    </div>
  )
}

function Group({
  title,
  tone,
  rows,
}: {
  title: string
  tone: 'income' | 'expense'
  rows: CategoryTotal[]
}) {
  if (rows.length === 0) return null
  const sum = rows.reduce((s, r) => s + Number(r.total), 0)
  const money = tone === 'income' ? 'text-income' : 'text-expense'

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 border-b border-line-soft pb-1">
        <span className="text-xs font-semibold text-ink-2">{title}</span>
        <span className={`tnum text-sm font-bold ${money}`}>{fmtBaht(sum)}</span>
      </div>
      <dl>
        {rows.map((r) => (
          <div
            key={r.category_id ?? `wage-${r.name}`}
            className="flex items-baseline justify-between gap-2 py-1 text-sm"
          >
            {/* จำนวนรายการอยู่ในวงเล็บ — เลขลอย ๆ ข้างชื่อหมวดอ่านเหมือนเป็น
                ส่วนหนึ่งของชื่อ โดยเฉพาะหมวดที่เจ้าของตั้งชื่อมีตัวเลขอยู่แล้ว */}
            <dt className="min-w-0 truncate text-muted-token">
              {r.name}
              <span className="ml-1.5 text-xs tnum text-muted-token/80">({r.item_count})</span>
            </dt>
            <dd className={`shrink-0 tnum font-medium ${money}`}>{fmtBaht(Number(r.total))}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
