/**
 * app-origins.mjs — รายชื่อ origin ที่เบราว์เซอร์จะ PUT เข้า R2 ได้ **แหล่งเดียว**
 *
 * 🔴 ทำไมต้องเป็นไฟล์กลาง ไม่ใช่ค่าที่พิมพ์ตอนรันสคริปต์
 * ตัวตั้งค่า (`setup-r2-cors.mjs`) เคยรับโดเมน production ทาง argv พร้อม
 * คอมเมนต์ว่า "เพิ่มโดเมน production ตอน deploy" — แล้วไม่มีใครเพิ่ม
 * ผลคือ **ทุกการอัปโหลดรูปบน production ตายเงียบมาตลอด**: เบราว์เซอร์
 * บล็อก PUT ตั้งแต่ preflight (R2 ตอบ 403 ไม่มี access-control-allow-origin)
 * `fetch` โยน TypeError แล้วหน้าจอบอกแค่ "อัปโหลดไม่สำเร็จ กรุณาลองใหม่"
 * ไม่มี error ฝั่งเซิร์ฟเวอร์ ไม่มีอะไรใน log ของ Vercel เลยสักบรรทัด
 *
 * คอมเมนต์ไม่ใช่การบังคับใช้ · ตอนนี้ค่าอยู่ในนี้ `setup-r2-cors.mjs` เอาไปตั้ง
 * และ `verify-r2.mjs` ยิง preflight จริงทีละ origin เพื่อพิสูจน์ว่าตั้งแล้ว
 *
 * ⚠️ อย่าใส่ `'*'` — presigned URL ที่หลุดออกไปจะกลายเป็นช่องให้เว็บไหนก็ได้
 * เขียนไฟล์เข้า bucket เรา
 *
 * ⚠️ URL ของ preview deployment สุ่มใหม่ทุกครั้ง (`cpie-<hash>-*.vercel.app`)
 * จึงใส่ล่วงหน้าไม่ได้ · preview มี Deployment Protection กั้นอยู่แล้ว
 * ถ้าต้องทดสอบอัปโหลดบน preview ให้ส่ง origin นั้นทาง argv เป็นครั้ง ๆ ไป
 */

/** โดเมนจริงที่ผู้ใช้เปิดใช้งาน */
export const PRODUCTION_ORIGIN = 'https://cpie.vercel.app'

/** เครื่องนักพัฒนา — พอร์ต 3000 และ 3100 ตามที่ `npm run dev` ใช้จริง */
export const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3100',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3100',
]

export const APP_ORIGINS = [PRODUCTION_ORIGIN, ...DEV_ORIGINS]
