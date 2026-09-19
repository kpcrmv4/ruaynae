import { BellRing, Sparkles } from 'lucide-react'
import { fmtBaht, fmtDate } from '@/lib/format'
import {
  INCOME_KIND_LABEL, PAY_METHOD_LABEL, TXN_STATUS_LABEL, TXN_STATUS_TONE,
  type IncomeKind, type PayMethod, type TxnKind, type TxnStatus,
} from '@/lib/transactions'
import { Badge } from '@/components/ui/badge'
import { TxnEditButton } from '@/components/ledger/txn-edit'

/**
 * หนึ่งแถวของรายรับ-รายจ่าย — รูปเดียวกันทั้ง `/ledger` และหน้าโครงการ
 *
 * เป็น Server Component · ปุ่มแก้ไข (`TxnEditButton`) เป็น client island
 * ใบเล็กที่แขวนอยู่ท้ายแถว และมันเป็นคนตัดสินเองว่าจะวาดปุ่มไหม จาก role
 * ที่อยู่ใน `TxnEditProvider` — หน้าที่ใช้แถวนี้จึงไม่ต้องรู้กฎสิทธิ์เลย
 */
export type TxnRowData = {
  id: string
  kind: TxnKind
  amount: number
  txn_date: string
  pay_method: PayMethod
  status: TxnStatus
  note: string | null
  income_kind: IncomeKind | null
  installment_no: number | null
  rejected_reason: string | null
  site_id: string | null
  created_by: string | null
  /** มีค่า = คีย์ MCP ใบนั้นเป็นคนบันทึกผ่าน AI · null = คนคีย์เองในแอป */
  mcp_key_id: string | null
  category_id: string
  sites: { name: string } | null
  categories: { name: string } | null
  attachments: { id: string }[]
}

export function TxnRow({
  txn: t,
  showSite = true,
  showDate = false,
  focused = false,
}: {
  txn: TxnRowData
  /** ปิดเมื่ออยู่ในหน้าโครงการ — ชิปชื่อโครงการเดิมซ้ำทุกแถวคือหมึกที่ไม่บอกอะไร */
  showSite?: boolean
  /** เปิดเมื่อลิสต์ไม่ได้จัดกลุ่มตามวัน (หน้าโครงการ) */
  showDate?: boolean
  /** แถวที่แจ้งเตือน/ตัวเลขบนเมนูพามา — ไฮไลท์และมีป้ายบอกว่าทำไมถึงเด่น */
  focused?: boolean
}) {
  /* 🔴 "ตีกลับ" คือของค้างที่ต้องแก้ ไม่ใช่สถานะเฉย ๆ — ป้ายมุมขวาตัวเดียว
     หายไปในลิสต์ยาว ๆ · แถบสีซ้าย + พื้นอ่อนทำให้กวาดตาเจอก่อนอ่านอะไรเลย
     และเป็นคำตอบของคำถาม "ตัวเลขบนเมนูรายการมาจากใบไหน" */
  /* 🔴 แถวที่ถูกตีกลับ **คงโทนแดงไว้แม้ตอนถูกโฟกัส** — ถ้าให้สีแบรนด์ทับ
     แถวที่มีปัญหาจะกลายเป็นสีเขียวซึ่งอ่านว่า "เรียบร้อย" · วงขอบเป็นคน
     บอกว่า "ใบนี้แหละ" ส่วนสีพื้นยังบอกสถานะจริงเหมือนเดิม */
  const tone = [
    t.status === 'rejected'
      ? 'bg-urgent-bg/60 border-l-4 border-l-urgent-solid'
      : focused
        ? 'bg-brand-tint border-l-4 border-l-brand'
        : '',
    focused ? 'ring-2 ring-inset ring-brand' : '',
  ].join(' ')

  return (
    /* 🔴 ปุ่มแก้ไขเป็น **คอลัมน์ที่สาม** ไม่ใช่ของต่อท้ายกลุ่มป้ายสถานะ —
       ยัดปุ่ม 44px ต่อท้ายป้ายทำให้คอลัมน์ขวากว้างขึ้นอีกราว 50px แล้วบนจอ 390
       ช่องข้อความจะถูกบีบจนภาษาไทยขึ้นบรรทัดใหม่กลางคำ (CLAUDE.md §17 ข้อ 7)
       · คอลัมน์ที่สามที่ไม่มีปุ่ม (คนที่แก้ไม่ได้) ยุบเหลือ 0 เองตามธรรมชาติของ auto */
    <div
      id={`txn-${t.id}`}
      /* scroll-mt กันหัวเรื่องเหนียวบังแถวตอนถูกเลื่อนมาหา */
      className={`grid scroll-mt-24 grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-3 gap-y-1.5 border-b border-line-soft px-3.5 py-3 last:border-b-0 md:px-4 ${tone}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-semibold text-ink">
            {t.categories?.name ?? 'ไม่มีหมวด'}
          </span>
          {/* ผูกโครงการ = ชิปขอบทึบ · ส่วนกลาง = ชิปขอบประ (DESIGN §5.2)
              ต้องแยกออกในแวบเดียวเพราะสองอย่างนี้เข้าคนละยอดรวม */}
          {showSite &&
            (t.site_id ? (
              <span className="chip border border-brand-tint-strong bg-brand-tint text-brand-on-tint ring-0">
                {t.sites?.name ?? 'โครงการ'}
              </span>
            ) : (
              <span className="chip border border-dashed border-line-strong text-muted-token ring-0">
                ส่วนกลาง
              </span>
            ))}
          {/* 🔴 เจ้าของต้องแยกออกในแวบเดียวว่าแถวไหนตัวเองคีย์ แถวไหน AI คีย์ให้
              — ทั้งสองแถวมี `created_by` เป็นเจ้าของเหมือนกัน เพราะคีย์ที่ AI
              ใช้เป็นของเจ้าของ ป้ายนี้จึงเป็นทางเดียวที่ดูออกจากหน้ารายการ */}
          {t.mcp_key_id && (
            <span className="chip border border-dashed border-line-strong text-muted-token ring-0">
              <Sparkles className="size-3" strokeWidth={2} aria-hidden />
              บันทึกผ่าน AI
            </span>
          )}
          {/* ไฮไลท์เฉย ๆ ตอบไม่ได้ว่า "ทำไมแถวนี้ถึงเด่น" — ป้ายเป็นคนตอบ */}
          {focused && (
            <span className="chip bg-brand-solid text-white ring-0">
              <BellRing className="size-3" strokeWidth={2} aria-hidden />
              รายการที่แจ้งเตือนถึง
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-sm text-muted-token">
          {showDate && `${fmtDate(t.txn_date)} · `}
          {PAY_METHOD_LABEL[t.pay_method]}
          {t.income_kind && ` · ${INCOME_KIND_LABEL[t.income_kind]}`}
          {t.installment_no && ` ${t.installment_no}`}
          {t.note && ` · ${t.note}`}
        </div>
        {/* 🔴 เหตุผลที่ตีกลับต้องอยู่ตรงนี้ ไม่ใช่อยู่แค่ในกระดิ่ง
            กระดิ่งถูกกดอ่านแล้วก็หายไป แต่คนที่ต้องแก้จะกลับมาดูที่รายการ —
            ป้าย "ตีกลับ" ที่ไม่บอกว่าเพราะอะไร คือการส่งงานคืนโดยไม่บอก
            ว่าต้องแก้อะไร */}
        {t.status === 'rejected' && t.rejected_reason && (
          <div className="mt-1 text-sm text-urgent">เหตุผลที่ตีกลับ: {t.rejected_reason}</div>
        )}
      </div>

      <div className="flex flex-col items-end gap-1">
        <span
          className={`text-base font-bold tnum ${
            t.kind === 'income' ? 'text-income' : 'text-expense'
          }`}
        >
          {t.kind === 'income' ? '+' : '−'}
          {fmtBaht(t.amount)}
        </span>
        <div className="flex items-center gap-1.5">
          {t.attachments.length > 0 && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={`/api/uploads/${t.attachments[0].id}?thumb=1`}
              alt="สลิป"
              loading="lazy"
              className="size-8 rounded-xs border border-line object-cover"
            />
          )}
          <Badge tone={TXN_STATUS_TONE[t.status]} dot>
            {TXN_STATUS_LABEL[t.status]}
          </Badge>
        </div>
      </div>

      <div className="self-center">
        <TxnEditButton
          txn={{
            id: t.id,
            kind: t.kind,
            status: t.status,
            createdBy: t.created_by,
            siteId: t.site_id,
            siteName: t.sites?.name ?? null,
            categoryId: t.category_id,
            categoryName: t.categories?.name ?? null,
            amount: Number(t.amount),
            txnDate: t.txn_date,
            payMethod: t.pay_method,
            incomeKind: t.income_kind,
            installmentNo: t.installment_no,
            note: t.note,
            attachments: t.attachments,
          }}
        />
      </div>
    </div>
  )
}
