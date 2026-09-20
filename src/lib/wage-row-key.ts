/**
 * คีย์ของแถว "คน × โครงการ" ในแท็บทำงานที่ไหนบ้าง
 *
 * 🔴 ต้องอยู่ในไฟล์ที่**ไม่มี `'use client'`** เพราะทั้งหน้า (Server Component)
 * และกล่องแก้ค่าแรง (Client Component) ต้องสร้างคีย์เดียวกัน
 *
 * เดิมมันอยู่ใน `site-wage-edit.tsx` ซึ่งขึ้นต้นด้วย `'use client'` · Next 16
 * ปฏิเสธการเรียกฟังก์ชันของโมดูลฝั่ง client จากฝั่งเซิร์ฟเวอร์ด้วยข้อความ
 * *"Attempted to call wageRowKey() from the server but wageRowKey is on the client"*
 * แล้วหน้าทั้งหน้าตกไปที่ error boundary ("เปิดหน้านี้ไม่สำเร็จ")
 *
 * 🔴 และมันมองไม่เห็นจาก `curl`/`fetch` ฝั่งเซิร์ฟเวอร์เลย — สตรีม RSC ตอบ 200
 * พร้อม HTML ที่ดูปกติ ส่วน error ไปโผล่ตอน **เบราว์เซอร์** ประมวลผลสตรีมนั้น
 * · ตัวตรวจที่ยิงด้วย fetch อย่างเดียวจึงเขียวทั้งที่ผู้ใช้เปิดหน้าไม่ได้
 *   (เจอจริง 21 ก.ย. 2569 — เจ้าของแจ้งพร้อมภาพ แต่ยิง fetch เข้า production แล้วได้ 200)
 */
export type WageRowKey = string

export const wageRowKey = (employeeId: string, siteId: string): WageRowKey =>
  `${employeeId}|${siteId}`
