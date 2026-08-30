/**
 * ไฟล์นี้ถูก "สร้างทับ" ด้วย generate_typescript_types ของ Supabase MCP
 * หลังรัน migration ทุกครั้ง — อย่าแก้ด้วยมือ
 *
 * ตอนนี้เป็นโครงเปล่าเพราะยังไม่มีตาราง (migration แรกอยู่ที่ P0-9)
 * มีไว้เพื่อให้ generic <Database> ของ client ทั้งสี่ตัวคอมไพล์ผ่านไปก่อน
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: Record<string, never>
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
