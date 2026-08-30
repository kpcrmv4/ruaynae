import 'server-only'

import { cache } from 'react'
import { createClient } from '@supabase/supabase-js'
import { APP_NAME } from '@/lib/constants'
import type { Database } from '@/lib/database.types'

export type Branding = {
  companyName: string
  logoObjectKey: string | null
}

/** ค่าสำรองตอนยังไม่ได้ตั้งค่า หรือตอนอ่านฐานข้อมูลไม่ได้ */
const FALLBACK: Branding = { companyName: APP_NAME, logoObjectKey: null }

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
    return {
      companyName: data?.company_name?.trim() || FALLBACK.companyName,
      logoObjectKey: data?.logo_object_key ?? null,
    }
  } catch (e) {
    console.error('[branding] อ่านไม่ได้ ใช้ค่าสำรองแทน', e instanceof Error ? e.message : e)
    return FALLBACK
  }
})
