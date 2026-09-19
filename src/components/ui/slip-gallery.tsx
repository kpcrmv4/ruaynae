'use client'

import { ExternalLink, ImageOff } from 'lucide-react'
import { useState } from 'react'

/**
 * สลิป/บิลของหนึ่งรายการ — รูปใหญ่พออ่านยอดในรูปออก + แถวรูปย่อไว้สลับ
 *
 * ใช้ร่วมกันระหว่างกล่องรายละเอียดของคิวอนุมัติและของหน้ารายการ
 * 🔴 เขียนแยกสองที่เมื่อไหร่ อีกที่จะลืมแก้ทันทีที่เจอปัญหาเรื่องรูป (เช่น
 * สลิปที่เปิดไม่ได้ หรือรูปแนวนอนที่ล้นกล่อง) ซึ่งเป็นเรื่องที่เจอทีหลังเสมอ
 *
 * ลิงก์ "เปิดรูปเต็ม" ไม่ใช่ของประดับ — บนมือถือ modal ซูมด้วยสองนิ้วไม่ได้
 * คนที่ต้องอ่านเลขในสลิปเบลอ ๆ ต้องมีทางเปิดรูปจริงเสมอ
 */
export function SlipGallery({
  attachments,
  emptyMessage,
}: {
  attachments: { id: string }[]
  /** ข้อความเมื่อไม่มีสลิปแนบ — ไม่ส่งมา = ไม่วาดอะไรเลย */
  emptyMessage?: string
}) {
  const [active, setActive] = useState(attachments[0]?.id ?? null)
  const [broken, setBroken] = useState(false)

  if (!active) {
    return emptyMessage ? (
      <p className="rounded-md border border-dashed border-line-strong px-3 py-3 text-sm text-muted-token">
        {emptyMessage}
      </p>
    ) : null
  }

  return (
    <div>
      <a
        href={`/api/uploads/${active}`}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden rounded-md border border-line bg-surface-2"
      >
        {broken ? (
          <span className="flex h-40 flex-col items-center justify-center gap-1.5 text-sm text-muted-token">
            <ImageOff className="size-6" strokeWidth={1.6} />
            เปิดรูปนี้ไม่ได้ ลองกดเปิดในแท็บใหม่
          </span>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={active}
            src={`/api/uploads/${active}`}
            alt="สลิป / บิลที่แนบมา"
            onError={() => setBroken(true)}
            className="mx-auto max-h-[45svh] w-full object-contain"
          />
        )}
      </a>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <a
          href={`/api/uploads/${active}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
        >
          <ExternalLink className="size-3.5" />
          เปิดรูปเต็มในแท็บใหม่
        </a>
        {attachments.length > 1 && (
          <span className="text-sm text-muted-token">
            แนบมา <span className="tnum">{attachments.length}</span> รูป
          </span>
        )}
      </div>

      {/* แถวรูปย่อ — โผล่เมื่อมีมากกว่าหนึ่งรูปเท่านั้น */}
      {attachments.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setActive(a.id)
                setBroken(false)
              }}
              aria-label={`ดูรูปที่ ${i + 1}`}
              aria-pressed={a.id === active}
              className={`overflow-hidden rounded-sm border transition-colors ${
                a.id === active ? 'border-brand ring-2 ring-brand/40' : 'border-line hover:border-ink-2'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/uploads/${a.id}?thumb=1`}
                alt=""
                loading="lazy"
                className="size-14 object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
