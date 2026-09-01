/**
 * ชื่อเครื่องมือฝั่ง **เขียน** — รายการเดียวที่ทั้งเซิร์ฟเวอร์และหน้าจอใช้ร่วมกัน
 *
 * ไฟล์นี้ไม่มี `server-only` และไม่ import อะไรเลย เพราะหน้า `/mcp` (client
 * component) ต้องรู้ว่าแถวไหนในบันทึกการใช้งานคือการเขียน แล้วขึ้นไอคอนคนละตัว
 * · ถ้าเอาไปไว้ใน `tools.ts` คำอธิบายเครื่องมือทั้งชุด (หลายกิโลไบต์) จะติดไป
 * อยู่ในบันเดิลของเบราว์เซอร์ทุกคนโดยไม่มีใครสังเกต
 *
 * 🔴 เพิ่มเครื่องมือที่เขียนข้อมูลแล้วลืมเติมชื่อตรงนี้ = แถวนั้นบนหน้า /mcp
 * จะดูเหมือนการอ่านธรรมดา · `tools.ts` มีตัวตรวจตอนโหลดโมดูลกันไว้แล้ว
 */
export const WRITE_TOOL_NAMES = [
  'record_transaction',
  'update_transaction',
  'delete_transaction',
  'record_attendance',
  'record_advance',
] as const

export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number]

export const isWriteTool = (name: string): name is WriteToolName =>
  (WRITE_TOOL_NAMES as readonly string[]).includes(name)
