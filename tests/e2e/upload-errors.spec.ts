import { test, expect, type Page } from '@playwright/test'

/**
 * P05-R2-13/14/15 — ข้อความตอนอัปโหลดโลโก้ล้มเหลว
 *
 * 🔴 ทำไมต้องมีแถวพวกนี้: เดิมความล้มเหลว **ทุกแบบ** ในฟอร์มนี้ยุบเหลือ
 * ประโยคเดียวว่า "อัปโหลดไม่สำเร็จ กรุณาลองใหม่" · วันที่ CORS ของ bucket
 * ไม่ครอบโดเมน production เจ้าของจึงอัปโลโก้ไม่ได้เลย และไม่มีใครไล่ถูก
 * เพราะข้อความเดียวกันนั้นแปลว่าอะไรก็ได้ — ตั้งแต่ไฟล์ผิดชนิดไปจนถึง
 * ที่เก็บรูปทั้งก้อนต่อไม่ติด · ทุกแถวที่นี่ตรวจว่า **ข้อความบอกสาเหตุที่ถูก**
 *
 * ทุกแถวจงใจไม่แตะ R2 จริงและไม่แก้ `branding` — เทสต์ที่เปลี่ยนโลโก้ของ
 * ลูกค้าคือเทสต์ที่ห้ามรันตอนมีคนใช้งานอยู่
 */

const R2_HOST = '**/*.r2.cloudflarestorage.com/**'

/** ยัดไฟล์เข้าช่องเลือกไฟล์ที่ซ่อนอยู่ แล้วปล่อยให้ React จัดการต่อ */
async function pickLogo(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.locator('input[type="file"][accept*="image/png"]').setInputFiles({
    name, mimeType, buffer,
  })
}

/** PNG 8×8 ที่ถอดรหัสได้จริง — ใช้กับแถวที่ต้องผ่านการบีบรูปไปให้ถึงขั้น PUT */
const REAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAG0lEQVQoz2NgGAWjYBSMglEwCkbBKBgFo4CBAAAIsAAB0Q5rEwAAAABJRU5ErkJggg==',
  'base64',
)

test.beforeEach(async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'ชื่อบริษัทและโลโก้' })).toBeVisible()
})

test('P05-R2-13 ไฟล์ชนิดที่ไม่รองรับถูกปฏิเสธที่เบราว์เซอร์ พร้อมบอกว่ารับชนิดไหน', async ({ page }) => {
  // ถ้าโค้ดถอยกลับไปบีบรูปก่อนตรวจชนิด แถวนี้จะแดงทันที เพราะตัวบีบรูป
  // throw แล้วข้อความจะกลายเป็น "เปิดไฟล์รูปนี้ไม่ได้" แทน
  let calledSign = false
  await page.route('**/api/uploads/sign', (route) => {
    calledSign = true
    return route.continue()
  })

  await pickLogo(page, 'IMG_0042.HEIC', 'image/heic', Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]))

  await expect(page.getByText('รองรับเฉพาะไฟล์ PNG, JPG และ WebP')).toBeVisible()
  expect(calledSign, 'ไฟล์ผิดชนิดต้องไม่ถูกส่งไปขอลิงก์อัปโหลดเลย').toBe(false)
})

test('P05-R2-14 ไฟล์รูปที่เนื้อในเสีย บอกว่าเปิดไฟล์ไม่ได้ ไม่ใช่ "ไม่สำเร็จ" ลอย ๆ', async ({ page }) => {
  await pickLogo(page, 'broken.png', 'image/png', Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))

  await expect(page.getByText('เปิดไฟล์รูปนี้ไม่ได้', { exact: false })).toBeVisible()

  // ปุ่มต้องกลับมากดได้ ไม่ค้างสปินเนอร์ (§15)
  await expect(page.getByRole('button', { name: /เปลี่ยนโลโก้|เลือกไฟล์/ })).toBeEnabled()
})

test('P05-R2-15 ต่อกับ R2 ไม่ได้ → ข้อความไทยที่ชี้ไปถูกจุด ไม่ใช่ error ของเบราว์เซอร์', async ({ page }) => {
  // จำลองสิ่งที่เกิดขึ้นจริงตอน CORS ไม่ครอบ origin: เบราว์เซอร์บล็อกคำขอ
  // แล้ว `fetch` โยน TypeError — เหมือนกันทุกประการกับตอนเน็ตหลุด
  await page.route(R2_HOST, (route) => route.abort('failed'))

  await pickLogo(page, 'logo.png', 'image/png', REAL_PNG)

  await expect(page.getByText('ต่อกับที่เก็บรูปไม่ได้', { exact: false })).toBeVisible()

  // 🔴 ห้ามมีข้อความอังกฤษดิบจากเบราว์เซอร์หลุดออกมา
  await expect(page.getByText(/Failed to fetch|NetworkError|TypeError/i)).toHaveCount(0)
})

test('P2-R2-13 แนบสลิปตอนต่อ R2 ไม่ได้ → ข้อความไทย ไม่ใช่ "Failed to fetch"', async ({ page }) => {
  // หน้านี้สำคัญกว่าโลโก้มาก — หัวหน้าไซต์ใช้ทุกวันกลางไซต์งาน และเดิม
  // `catch (e) => toast.error(e.message)` เอาข้อความของเบราว์เซอร์ขึ้นจอตรง ๆ
  await page.route(R2_HOST, (route) => route.abort('failed'))
  await page.goto('/entry')

  await page.locator('input[type="file"]').last().setInputFiles({
    name: 'slip.png', mimeType: 'image/png', buffer: REAL_PNG,
  })

  await expect(page.getByText('ต่อกับที่เก็บรูปไม่ได้', { exact: false })).toBeVisible()
  await expect(page.getByText(/Failed to fetch|NetworkError|TypeError/i)).toHaveCount(0)
})
