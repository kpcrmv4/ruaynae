import { test, expect, type Locator } from '@playwright/test'

/**
 * P9-BUG-modal-off-screen · modal และแผงลอยหลุดขอบจอบนจอแคบ
 *
 * สาเหตุ (วัดจากเบราว์เซอร์จริงแล้ว — ดู
 * `.superpowers/sdd/2026-08-31-mcp-analytics-connector/bugfix-modal-brief.md`):
 * Tailwind v4 คอมไพล์ `-translate-x-1/2 -translate-y-1/2` เป็น CSS property
 * `translate` ส่วน keyframes `kp-pop-in` (ก่อนแก้) ตั้ง property `transform`
 * — คนละ property กัน จึง **ทบกัน ไม่ใช่ทับกัน** กล่องเลยเลื่อนซ้ายไป -100%
 * แทนที่จะเป็น -50% ขอบขวาของกล่องไปตกที่กึ่งกลางจอพอดี จอกว้างยังพอเห็น
 * (แค่เยื้องซ้ายจนไม่มีใครสังเกต) แต่จอแคบ (390px) กล่องหลุดออกนอกจอซ้าย
 *
 * 🔴 ห้ามวัดด้วย `document.documentElement.scrollWidth` — เชลล์แอปนี้ตั้ง
 * `overflow-x: clip` ซึ่ง **ตัดส่วนที่ล้นทิ้งไปเงียบ ๆ** ค่าจะเป็น 0 เสมอ
 * ไม่ว่ากล่องจะหลุดจอไปไกลแค่ไหน (CLAUDE.md §17 ข้อ 7) จึงวัดกรอบของ
 * อิลิเมนต์เอง (`boundingBox()`) เทียบความกว้างจอแทน
 */

const VIEWPORT = { width: 390, height: 844 }

/** ยืนยันว่ากล่องอยู่ในจอทั้งหมด ไม่มีขอบไหนหลุดซ้าย/ขวา */
async function expectDialogWithinViewport(dialog: Locator) {
  const box = await dialog.boundingBox()
  expect(box, 'ต้องอ่านกรอบของกล่องได้ (กล่องต้องมองเห็นอยู่)').not.toBeNull()
  expect(box!.x, `ขอบซ้ายหลุดจอ: x=${box!.x}`).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width, `ขอบขวาหลุดจอ: right=${box!.x + box!.width} > ${VIEWPORT.width}`).toBeLessThanOrEqual(
    VIEWPORT.width,
  )
}

test.describe('P9-BUG-modal-off-screen · กล่องกลางจอต้องไม่หลุดขอบที่ 390px', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT)
  })

  test('เปิดฟอร์ม "เพิ่มไซต์งาน" แล้วกล่องอยู่ในจอทั้งหมด', async ({ page }) => {
    // หน้า /sites เปิดได้แม้ยังไม่มีไซต์งานเลยสักแถว (ฐานทดสอบว่าง 0 ไซต์)
    // ปุ่มนี้จึงเป็นเป้าหมายที่ทดสอบได้โดยไม่ต้อง seed ข้อมูลก่อน
    await page.goto('/sites')
    await page.waitForLoadState('networkidle')

    // หน้านี้มีปุ่ม "เพิ่มไซต์งาน" สองจุดพร้อมกันตอนไม่มีไซต์เลย (หัวหน้า +
    // การ์ดสถานะว่าง) ทั้งคู่เปิด dialog เดียวกัน — เอาอันแรกก็พอ
    await page.getByRole('button', { name: 'เพิ่มไซต์งาน' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // รอให้อนิเมชั่นเปิด (220ms) จบก่อนวัด — `animation-fill-mode: both` ทำให้
    // ค่าตอนจบค้างอยู่ แต่วัดกลางอนิเมชั่นจะได้ค่าที่ยังไม่นิ่ง
    await page.waitForTimeout(350)

    await expectDialogWithinViewport(dialog)
  })

  test('เปิดแผงแจ้งเตือน (กระดิ่ง) แล้วกล่องอยู่ในจอทั้งหมด', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /แจ้งเตือน/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(350)

    await expectDialogWithinViewport(dialog)
  })
})
