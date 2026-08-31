import 'server-only'

import { cache } from 'react'
import { createClient } from '@supabase/supabase-js'
import { SYSTEM_NAME } from '@/lib/constants'
import type { Database } from '@/lib/database.types'
import { presignGet } from '@/lib/r2'

export type Branding = {
  companyName: string
  logoObjectKey: string | null
  /** ลิงก์ดูโลโก้ที่เซ็นแล้ว · null = ยังไม่ได้ตั้ง หรือเซ็นไม่สำเร็จ */
  logoUrl: string | null
}

/** ยาวสุดที่ป้ายใต้ไอคอนบนหน้าจอโฮมจะแสดงได้ก่อนโดนตัดด้วย … */
const SHORT_NAME_MAX = 12

/**
 * ชื่อสั้นสำหรับป้ายใต้ไอคอนแอป
 *
 * 🔴 `companyName.slice(0, 12)` ตรง ๆ ใช้ไม่ได้กับชื่อบริษัทไทย —
 * `บริษัท คอสซี่ คอนสตรัคชั่น จำกัด` จะกลายเป็น **`บริษัท คอสซี`**
 * คือเสีย 7 ตัวแรกไปกับคำว่า "บริษัท " ที่ไม่ได้บอกว่าเป็นบริษัทไหนเลย
 * แล้วตัดคาคำพอดี · ป้ายนี้คือสิ่งที่คนเห็นบนหน้าจอโฮมทุกวัน
 *
 * ตัดคำนำหน้า/ต่อท้ายที่เป็นรูปแบบทางกฎหมายออกก่อน แล้วค่อยหยิบทีละคำ
 * เท่าที่ยังไม่เกินความยาว — ตัดคาคำอ่านยากกว่าชื่อที่สั้นกว่าหนึ่งคำ
 */
export function shortName(companyName: string): string {
  const core = companyName
    .replace(/^\s*(บริษัท|บมจ\.?|หจก\.?|ห้างหุ้นส่วน(จำกัด|สามัญ)?|ห้าง|ร้าน)\s*/u, '')
    .replace(/\s*(จำกัด)?\s*\((มหาชน)\)\s*$/u, '')
    .replace(/\s*จำกัด\s*$/u, '')
    .trim()

  const source = core || companyName.trim()
  if (source.length <= SHORT_NAME_MAX) return source

  const words = source.split(/\s+/)
  let out = ''
  for (const w of words) {
    const next = out ? `${out} ${w}` : w
    if (next.length > SHORT_NAME_MAX) break
    out = next
  }
  // คำเดียวที่ยาวเกินเพดาน — ไม่มีทางเลือกอื่นนอกจากตัด
  return out || source.slice(0, SHORT_NAME_MAX)
}

/**
 * ค่าสำรองตอนยังไม่ได้ตั้งค่า หรือตอนอ่านฐานข้อมูลไม่ได้
 *
 * ใช้ **ชื่อระบบ** เป็นตัวสำรอง ไม่ใช่ชื่อบริษัทจริง — หน้าล็อกอินที่โหลด
 * ฐานข้อมูลไม่ได้ต้องยังใช้งานได้ แต่ต้องไม่โกหกว่าเป็นบริษัทไหน
 * · ชื่อบริษัทจริงอยู่ใน `branding.company_name` ที่เดียว (CLAUDE.md §5)
 */
const FALLBACK: Branding = { companyName: SYSTEM_NAME, logoObjectKey: null, logoUrl: null }

/**
 * ชื่อบริษัทและโลโก้
 *
 * ใช้ client แบบ publishable key ธรรมดา ไม่ต้องมี session
 * เพราะ policy ของตาราง `branding` เปิดให้ `anon` อ่านได้ —
 * หน้าล็อกอินทำงานตอนยังไม่ล็อกอิน จึงต้องอ่านได้โดยไม่มีสิทธิ์อะไรเลย
 *
 * 🔴 ตารางนี้ห้ามมีคอลัมน์ที่เป็นความลับเด็ดขาด ทุกอย่างในนี้เป็นข้อมูลสาธารณะ
 * ของที่เป็นความลับอยู่ใน `app_settings` ซึ่งเป็นคนละตารางและเจ้าของเท่านั้นที่อ่านได้
 *
 * 🔴 อ่านไม่ได้ต้องคืนค่าสำรอง ห้าม throw — หน้าล็อกอินพังเพราะโหลดชื่อบริษัท
 * ไม่ได้ แปลว่าไม่มีใครเข้าระบบได้เลยจนกว่าฐานข้อมูลจะกลับมา
 */
export const getBranding = cache(async (): Promise<Branding> => {
  try {
    const sb = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } },
    )
    const { data, error } = await sb
      .from('branding')
      .select('company_name, logo_object_key')
      .maybeSingle()

    if (error) {
      console.error('[branding] อ่านไม่ได้ ใช้ค่าสำรองแทน', error.message)
      return FALLBACK
    }
    const key = data?.logo_object_key ?? null

    // เซ็นลิงก์รูปแยกจากการอ่านชื่อ — เซ็นพลาดต้องไม่ทำให้ชื่อบริษัทหายไปด้วย
    let logoUrl: string | null = null
    if (key) {
      try {
        logoUrl = await presignGet(key)
      } catch (e) {
        console.error('[branding] เซ็นลิงก์โลโก้ไม่ได้', e instanceof Error ? e.message : e)
      }
    }

    return {
      companyName: data?.company_name?.trim() || FALLBACK.companyName,
      logoObjectKey: key,
      logoUrl,
    }
  } catch (e) {
    console.error('[branding] อ่านไม่ได้ ใช้ค่าสำรองแทน', e instanceof Error ? e.message : e)
    return FALLBACK
  }
})
