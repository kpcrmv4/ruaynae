import { fmtBaht } from '@/lib/format'

export type BarItem = {
  key: string
  label: string
  /** ค่าที่ใช้วัดความยาวแท่ง (บาท หรือหน่วยอื่น) */
  value: number
  /** บรรทัดเล็กใต้ชื่อ เช่น "12 รายการ" */
  hint?: string
  /** ข้อความฝั่งขวาแทนจำนวนเงิน (เช่น "6 วัน") */
  valueText?: string
}

const TONE = {
  expense: 'bg-expense',
  income: 'bg-income',
  brand: 'bg-brand',
} as const

/**
 * รายการพร้อมแท่งแนวนอน — ใช้กับ "ต้นทุนแยกหมวด" และ "คนที่ทำงานมากที่สุด"
 *
 * แนวนอนเพราะชื่อไทยยาว: แท่งตั้งบนจอ 390px จะเหลือที่ให้ป้ายไม่ถึง 40px แล้วชื่อ
 * ถูกตัดจนอ่านไม่ออก (บทเรียนเดียวกับแถวคนเข้าโครงการ) · ที่นี่ชื่ออยู่บนแท่ง
 * ได้ความกว้างเต็ม และตัวเลขอยู่ขวาแบบ tabular ให้เทียบกันในแนวตั้งได้
 *
 * **สีไม่ได้ทำหน้าที่แยกรายการ** — ชื่อเป็นตัวแยก สีบอกแค่ว่าเป็นเงินเข้าหรือออก
 * ทุกแท่งในลิสต์เดียวกันจึงสีเดียวกันทั้งหมด ไม่ใช่ไล่สีรุ้งตามลำดับ
 */
export function BarList({
  items,
  tone = 'expense',
  total,
}: {
  items: BarItem[]
  tone?: keyof typeof TONE
  /** ฐานสำหรับคิด % — ไม่ส่งมาจะใช้ค่าที่มากที่สุดในลิสต์ */
  total?: number
}) {
  const base = Math.max(1, total ?? Math.max(...items.map((i) => i.value), 0))
  const peak = Math.max(1, ...items.map((i) => i.value))

  return (
    <ul className="divide-y divide-line-soft">
      {items.map((item) => {
        const pct = Math.round((item.value / base) * 100)
        return (
          <li key={item.key} className="px-3.5 py-2.5 md:px-4">
            <div className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                {item.label}
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-ink">
                {item.valueText ?? fmtBaht(item.value)}
              </span>
              {total !== undefined && (
                <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-token">
                  {pct}%
                </span>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-bar-track">
                {/* วัดเทียบกับตัวที่มากที่สุดเสมอ — แท่งยาวสุดเต็มความกว้างพอดี
                    ทำให้เห็นสัดส่วนระหว่างรายการได้แม้ยอดรวมจะไม่ถูกส่งมา */}
                <span
                  className={`block h-full rounded-full ${TONE[tone]}`}
                  style={{ width: `${Math.max(2, (item.value / peak) * 100)}%` }}
                />
              </span>
              {item.hint && (
                <span className="shrink-0 text-xs tabular-nums text-muted-token">{item.hint}</span>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
