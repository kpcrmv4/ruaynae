import { fmtBaht } from '@/lib/format'
import { bucketLabel } from '@/lib/reports'

export type FlowPoint = { bucket: string; income: number; expense: number; wage: number }

/**
 * กราฟเงินเข้า–เงินออกตามช่วงเวลา
 *
 * 🔴 **แยกด้วยตำแหน่ง ไม่ใช่แค่สี** — รายรับพุ่งขึ้นจากเส้นศูนย์ ต้นทุนพุ่งลง
 * เขียว-แดงเป็นคู่สีที่คนตาบอดสีแยกไม่ออกที่สุด ถ้าให้สีทำหน้าที่แยกลำพัง
 * กราฟจะอ่านไม่ได้สำหรับคนกลุ่มนั้นทั้งใบ · บน/ล่างอ่านออกเสมอไม่ว่าตาแบบไหน
 * · ป้ายกำกับใต้แกนและคำอธิบายสีข้างบนเป็นชั้นที่สาม
 *
 * ต้นทุนแบ่งเป็นสองท่อน (รายจ่ายที่อนุมัติ + ค่าแรงจากการลงชื่อ) เพราะสองอย่างนี้
 * มาจากคนละที่และแก้คนละทาง — รวมเป็นแท่งเดียวแล้วเจ้าของจะไม่รู้ว่าต้องไปดูตรงไหน
 *
 * เขียนเป็น SVG ตรง ๆ ไม่พึ่งไลบรารีกราฟ: หน้านี้ต้องเบาพอสำหรับมือถือกลางไซต์
 * และเป็น Server Component เต็มใบ (ไม่มี JS ฝั่ง client เลย) · `<title>` ในแต่ละ
 * แท่งทำให้เอาเมาส์ชี้/แตะค้างแล้วเห็นตัวเลขจริงโดยไม่ต้องมีสคริปต์
 */
export function FlowChart({
  points,
  grain,
}: {
  points: FlowPoint[]
  grain: 'day' | 'month'
}) {
  const cost = (p: FlowPoint) => p.expense + p.wage
  const peak = Math.max(1, ...points.map((p) => Math.max(p.income, cost(p))))

  // ระบบพิกัด: กว้าง 100 หน่วยต่อแท่ง สูงบน 100 / ล่าง 100 — `preserveAspectRatio`
  // ปิดไว้ กราฟจึงยืดเต็มความกว้างจอเสมอโดยความสูงคงที่ อ่านได้ทั้ง 390 และ 1440
  const W = points.length * 100
  const H = 210 // 100 บน + 10 เส้นศูนย์ + 100 ล่าง
  const up = (v: number) => (v / peak) * 100
  const barW = 56
  const gap = (100 - barW) / 2

  return (
    <figure className="m-0">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <Key className="bg-income" label="รายรับ (ขึ้น)" />
        <Key className="bg-expense" label="รายจ่าย (ลง)" />
        <Key className="bg-bar-cost" label="ค่าแรงจากการลงชื่อ (ลง)" />
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="กราฟเงินเข้าและเงินออกตามช่วงเวลา"
        className="h-44 w-full sm:h-56"
      >
        {/* เส้นศูนย์ — จุดอ้างอิงเดียวของทั้งกราฟ */}
        <line x1="0" y1="105" x2={W} y2="105" className="stroke-line-strong" strokeWidth="1.5" />

        {points.map((p, i) => {
          const x = i * 100
          const inH = up(p.income)
          const exH = up(p.expense)
          const wgH = up(p.wage)
          return (
            <g key={p.bucket}>
              {/* แถบโปร่งคลุมทั้งช่อง — พื้นที่แตะ/ชี้ใหญ่กว่าตัวแท่ง */}
              <rect x={x} y="0" width="100" height={H} fill="transparent">
                <title>
                  {`${bucketLabel(p.bucket, grain)} · เข้า ${fmtBaht(p.income)} · ออก ${fmtBaht(
                    cost(p),
                  )}${p.wage > 0 ? ` (ค่าแรง ${fmtBaht(p.wage)})` : ''}`}
                </title>
              </rect>

              {p.income > 0 && (
                <rect
                  x={x + gap}
                  y={100 - inH}
                  width={barW}
                  height={inH}
                  rx="4"
                  className="fill-income"
                />
              )}
              {p.expense > 0 && (
                <rect
                  x={x + gap}
                  y="110"
                  width={barW}
                  height={exH}
                  rx="4"
                  className="fill-expense"
                />
              )}
              {p.wage > 0 && (
                // เว้น 2 หน่วยระหว่างท่อน ไม่งั้นสองสีติดกันอ่านเป็นแท่งเดียว
                <rect
                  x={x + gap}
                  y={110 + exH + (p.expense > 0 ? 2 : 0)}
                  width={barW}
                  height={Math.max(0, wgH - (p.expense > 0 ? 2 : 0))}
                  rx="4"
                  className="fill-bar-cost"
                />
              )}
            </g>
          )
        })}
      </svg>

      {/* ป้ายแกน — เดือนโชว์ทุกช่อง · วันโชว์ทุก 5 วันไม่ให้ตัวเลขทับกันบนจอ 390 */}
      <div
        className="mt-1 grid text-center text-[10px] tabular-nums text-muted-token"
        style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
      >
        {points.map((p, i) => {
          const label = bucketLabel(p.bucket, grain)
          const show = grain === 'month' || i === 0 || (i + 1) % 5 === 0
          return (
            <span key={p.bucket} className="truncate">
              {show ? label : ' '}
            </span>
          )
        })}
      </div>

      <figcaption className="mt-2 text-xs text-muted-token">
        ต้นทุน = รายจ่ายที่อนุมัติแล้ว + ค่าแรงจากการลงชื่อ ·
        เบิกล่วงหน้าและปิดรอบจ่ายเป็นเงินสดออก ไม่ถูกนับซ้ำในกราฟนี้
      </figcaption>
    </figure>
  )
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-token">
      <span aria-hidden className={`size-2.5 rounded-xs ${className}`} />
      {label}
    </span>
  )
}
