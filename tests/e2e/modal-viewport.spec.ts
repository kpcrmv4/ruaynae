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

/**
 * รอให้อนิเมชั่นเปิด dialog "จบจริง" ก่อนวัดกรอบ — ไม่ใช่รอตามเวลา
 *
 * 🔴 เดิมใช้ `page.waitForTimeout(350)` (ยาวกว่า 220ms ของ `animate-pop-in`
 * พอประมาณ) แต่เวลาคงที่แบบนี้คือความเสี่ยงเรื่อง flaky ภายใต้โหลดของ CI —
 * เครื่องช้าลงเมื่อไหร่ก็ไม่พอ เร็วขึ้นก็เสียเวลาฟรี ๆ ทุกครั้ง
 * ใช้ Web Animations API อ่านอนิเมชั่นที่ผูกกับอิลิเมนต์นั้นจริง ๆ แล้วรอ
 * `.finished` ของทุกตัว — ถ้าปิด reduced-motion ไว้ (animation-duration
 * เกือบ 0) หรือไม่มีอนิเมชั่นเลย `getAnimations()` จะว่างและ resolve ทันที
 */
async function waitForDialogAnimation(dialog: Locator) {
  await dialog.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})))
  })
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
    await waitForDialogAnimation(dialog)

    await expectDialogWithinViewport(dialog)
  })

  test('เปิดแผงแจ้งเตือน (กระดิ่ง) แล้วกล่องอยู่ในจอทั้งหมด', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /แจ้งเตือน/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await waitForDialogAnimation(dialog)

    await expectDialogWithinViewport(dialog)
  })

  /**
   * อีกห้ากล่องที่ได้ผลจากการแก้เดียวกัน (ดู bugfix-modal-brief.md ตาราง
   * "กล่องที่ได้ผลจากการแก้นี้ (7 จุด)") — สองกล่องด้านบนเปิดได้แม้ฐานว่าง
   * แต่ห้ากล่องนี้ต้องมีข้อมูลจริงก่อนปุ่มที่เปิดมันถึงจะโผล่/กดได้:
   *   - "ตีกลับ" ต้องมีรายการรออนุมัติอย่างน้อยหนึ่งแถว
   *   - "เบิก" ต้องมีคนที่มียอดค้างจ่าย > 0
   *   - "แก้ไข" / "ถอนหัวหน้าไซต์ / ลบงวด" ต้องมีไซต์งาน (แถวหลังต้องมี
   *     หัวหน้าไซต์หรือแผนงวดผูกอยู่ด้วย ไม่งั้นส่วนนี้ไม่เรนเดอร์เลย)
   * รันเฉพาะตอนที่ `node scripts/seed-demo.mjs` ใส่ข้อมูลไว้ก่อนแล้วเท่านั้น
   * (ดูขั้นตอนรันแบบเต็มใน bugfix-modal-report.md ภาคผนวก)
   */
  test('เปิดกล่อง "ตีกลับ" ที่ /approvals แล้วกล่องอยู่ในจอทั้งหมด', async ({ page }) => {
    await page.goto('/approvals')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'ตีกลับ' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await waitForDialogAnimation(dialog)

    await expectDialogWithinViewport(dialog)
  })

  test('เปิดกล่องเบิกล่วงหน้าที่ /payroll แล้วกล่องอยู่ในจอทั้งหมด', async ({ page }) => {
    await page.goto('/payroll')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'เบิก' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await waitForDialogAnimation(dialog)

    await expectDialogWithinViewport(dialog)
  })

  test('เปิดกล่อง "เปิดรอบใหม่" ที่ /payroll แล้วกล่องอยู่ในจอทั้งหมด', async ({ page }) => {
    // ปุ่มนี้เรนเดอร์เสมอไม่ว่ามีรอบจ่ายอยู่แล้วหรือไม่ — ไม่ต้องพึ่งข้อมูล seed
    // แต่รวมไว้ในชุดนี้เพื่อให้ทั้งเจ็ดกล่องถูกตรวจในสภาพฐานข้อมูลเดียวกัน
    await page.goto('/payroll')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'เปิดรอบใหม่' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await waitForDialogAnimation(dialog)

    await expectDialogWithinViewport(dialog)
  })

  test('เปิดกล่อง "แก้ไข" ไซต์งานที่ /sites/[id] แล้วกล่องอยู่ในจอทั้งหมด', async ({ page }) => {
    await page.goto('/sites')
    await page.waitForLoadState('networkidle')

    // เข้าไซต์ A ("บ้านคุณสมศักดิ์…") ที่ seed-demo.mjs สร้างไว้ — มีทั้ง
    // หัวหน้าไซต์และแผนงวดผูกอยู่ ใช้ทดสอบกล่องถัดไปได้ด้วย
    await page.getByRole('link', { name: /บ้านคุณสมศักดิ์/ }).click()
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'แก้ไข' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await waitForDialogAnimation(dialog)

    await expectDialogWithinViewport(dialog)
  })

  test('เปิดกล่อง "ยืนยันการลบ" ที่ /sites/[id] แล้วกล่องอยู่ในจอทั้งหมด', async ({ page }) => {
    await page.goto('/sites')
    await page.waitForLoadState('networkidle')

    await page.getByRole('link', { name: /บ้านคุณสมศักดิ์/ }).click()
    await page.waitForLoadState('networkidle')

    // ปุ่มลบอยู่หลัง <details>/<summary> ที่ยุบไว้ก่อน ต้องกดขยายก่อน
    await page.getByText('ถอนหัวหน้าไซต์ / ลบงวด').click()
    await page.getByRole('button', { name: /งวด 1/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await waitForDialogAnimation(dialog)

    await expectDialogWithinViewport(dialog)
  })
})
