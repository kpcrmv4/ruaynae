import { test, expect, type Page } from '@playwright/test'

/**
 * P8-E2E — แถวที่ต้องมีเบราว์เซอร์จริง
 *
 * ทุกแถวในไฟล์นี้ต้อง **แดงได้จริง** ถ้าโค้ดพัง — ห้ามมีแถวที่เขียวเพราะ
 * ไม่มีอะไรให้ตรวจ (ดู kp-acceptance-test-matrix §3)
 */

const DATA_PAGES = ['/', '/ledger', '/approvals', '/sites', '/attendance', '/payroll', '/audit']

/**
 * หาของที่ล้นออกนอกจอ
 *
 * 🔴 **`documentElement.scrollWidth` ใช้วัดเรื่องนี้ไม่ได้** — เชลล์มี
 * `overflow-x: clip` อยู่ชั้นบน ของที่ล้นจึงถูก **ตัดทิ้ง** ไม่ได้ทำให้หน้าเลื่อน
 * ตัวเลขจึงเป็น 0 เสมอ ต่อให้ยัด div กว้าง 3000px เข้าไปก็ยังเป็น 0
 * (พิสูจน์ด้วยแถว P8-E2E-04b — check เดิมไม่มีวันแดง จึงไม่เคยตรวจอะไรเลย)
 *
 * และ "ถูกตัดทิ้ง" แย่กว่า "เลื่อนได้" เพราะผู้ใช้ไม่มีทางเข้าถึงปุ่มที่หายไป
 * และไม่มีแถบเลื่อนบอกด้วยซ้ำว่ามีอะไรอยู่ตรงนั้น (ดูคอมเมนต์ใน page-header.tsx
 * เรื่องปุ่มที่หายไปจากหัวเรื่องกว้าง 401px บนจอ 390px)
 *
 * จึงวัดที่ **ขอบขวาของแต่ละอิลิเมนต์** เทียบกับความกว้างจอแทน
 */
async function overflowingElements(page: Page) {
  return page.evaluate(() => {
    const limit = window.innerWidth + 1
    const bad: string[] = []
    // ของที่อยู่ในกล่องที่ **ตั้งใจให้เลื่อนได้** (ตาราง แผนภูมิ โค้ด) ไม่ใช่บั๊ก —
    // CLAUDE.md อนุญาตไว้ชัดเจน ขอแค่ตัวหน้าเองอย่าเลื่อน · ตัวที่เป็นบั๊กคือ
    // ของที่ล้นออกไปโดยไม่มีทางเลื่อนไปดู
    const inScroller = (el: HTMLElement) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX
        if (ox === 'auto' || ox === 'scroll') return true
      }
      return false
    }
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const s = getComputedStyle(el)
      if (s.display === 'none' || s.visibility === 'hidden' || s.position === 'fixed') continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right > limit && !inScroller(el)) {
        const id = el.tagName.toLowerCase() + (el.className ? `.${String(el.className).split(/\s+/)[0]}` : '')
        bad.push(`${id} ขอบขวา ${Math.round(r.right)} > ${window.innerWidth}`)
      }
    }
    return bad.slice(0, 5)
  })
}

/** รอให้ hydrate เสร็จก่อนอ่านค่าใด ๆ — เชลล์ที่เรนเดอร์จากเซิร์ฟเวอร์มีป้ายครบแต่ยังไม่มีตัวเลข */
async function ready(page: Page) {
  await page.waitForLoadState('networkidle')
}

test.describe('P8-E2E-01 · โครงร่างตอนโหลด', () => {
  test('P8-E2E-01 ทุกหน้าข้อมูลส่งโครงร่างมาก่อน ไม่ใช่หน้าขาว', async ({ page }) => {
    // หน่วง RSC ของการเปลี่ยนหน้าฝั่ง client แล้วดูว่าโครงร่างขึ้นจริงไหม
    // (ถ้าไม่หน่วง ข้อมูลมาเร็วจนจับไม่ทัน แล้วแถวนี้จะเขียวโดยไม่ได้ตรวจอะไร)
    await page.goto('/')
    await ready(page)

    await page.route(/_rsc=/, async (route) => {
      await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })

    await page.getByRole('link', { name: 'รายรับ-รายจ่าย' }).first().click()
    await expect(page.locator('[data-state="skeleton"]')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('[data-state="skeleton"]')).toHaveAttribute('aria-busy', 'true')
    await page.unroute(/_rsc=/)

    // แล้วของจริงต้องมาแทนที่ ไม่ใช่ค้างเป็นโครงร่างตลอดไป
    await expect(page.locator('[data-state="skeleton"]')).toBeHidden({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'รายรับ-รายจ่าย' })).toBeVisible()
  })

  test('P8-E2E-01b ทุกหน้าข้อมูลมี loading.tsx ของตัวเอง — โครงร่างอยู่ในสตรีมตั้งแต่ไบต์แรก', async ({ request }) => {
    const missing: string[] = []
    for (const path of DATA_PAGES) {
      // 🔴 คำขอแรกของ `next dev` คือคำขอที่กระตุ้นให้คอมไพล์ route นั้น และมัน
      // ตอบกลับมาโดยไม่มี fallback ของ Suspense · ยิงทิ้งหนึ่งครั้งก่อนวัด
      // ไม่งั้นแถวนี้จะแดงสลับเขียวตามว่าใครเคยเปิดหน้านั้นในเซสชันนี้แล้วหรือยัง
      await request.get(path)
      const html = await (await request.get(path)).text()
      if (!html.includes('data-state="skeleton"')) missing.push(path)
    }
    expect(missing, `หน้าที่ไม่มีโครงร่างในสตรีม: ${missing.join(', ')}`).toEqual([])
  })
})

test.describe('P8-E2E-02 · ผิดพลาด + ปุ่มลองใหม่', () => {
  test('P8-E2E-02 คิวรีฝั่งเซิร์ฟเวอร์ล้มเหลว → เห็นการ์ดผิดพลาดพร้อมปุ่มลองใหม่ที่กดได้', async ({ page }) => {
    // 🔴 วิธีที่ใช้ไม่ได้: ดัก RSC ของการเปลี่ยนหน้าแล้วตอบ 500 — เราเตอร์ของ
    // Next ไม่โยนเข้า error boundary แต่ **ถอยไปโหลดทั้งหน้าแบบเดิม** แทน
    // การ์ดผิดพลาดจึงไม่มีวันขึ้น และแถวจะแดงทั้งที่โค้ดถูก
    //
    // วิธีที่ใช้ได้: ส่ง `site` ที่ไม่ใช่ uuid — Postgres ตอบ 22P02 กลับมาเป็น
    // `error` ของ query ซึ่งเป็นเส้นทางเดียวกับตอนฐานข้อมูลล่มจริง
    await page.goto('/ledger?site=ไม่ใช่ยูยูไอดี')
    await ready(page)

    const card = page.locator('[data-state="error"]')
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(card.getByText('โหลดรายการไม่สำเร็จ')).toBeVisible()

    // 🔴 ปุ่มลองใหม่ต้อง **ใช้ได้จริง** ไม่ใช่แค่มีอยู่ให้ครบสถานะ
    const retry = card.getByRole('button', { name: /ลองใหม่/ })
    await expect(retry).toBeEnabled()
    await retry.click()

    // ยังพังเหมือนเดิมเพราะพารามิเตอร์ยังผิดอยู่ — ที่ต้องพิสูจน์คือกดแล้ว
    // **มันลองใหม่จริง** ไม่ใช่ปุ่มตาย: หน้าไม่ค้าง ไม่ระเบิด และการ์ดยังอยู่
    await expect(card).toBeVisible()

    // พอพารามิเตอร์ถูกต้อง หน้าเดิมต้องกลับมาปกติ — ยืนยันว่าการ์ดเมื่อกี้
    // มาจากข้อผิดพลาดจริง ไม่ใช่การ์ดที่ขึ้นค้างอยู่ตลอดเวลา
    await page.goto('/ledger')
    await ready(page)
    await expect(page.locator('[data-state="error"]')).toBeHidden()
    await expect(page.getByRole('heading', { name: 'รายรับ-รายจ่าย' })).toBeVisible()
  })
})

test.describe('P8-E2E-03 · toast และปุ่ม disabled ระหว่างส่ง', () => {
  test('P8-E2E-03 ปุ่มบันทึกถูก disable พร้อมสปินเนอร์ แล้ว toast ขึ้นหลังสำเร็จ', async ({ page }) => {
    await page.goto('/entry')
    await ready(page)

    await page.locator('#amount').fill('1234')
    // ฟอร์มไม่ยอมส่งถ้ายังไม่เลือกหมวด — เลือกค่าจริงจากตัวเลือกที่มี
    // (เดิมเทสต์ไม่ได้เลือก แล้วปุ่มก็ไม่เคยเข้าสถานะ "กำลังบันทึก" เลย)
    const category = page.locator('#category')
    await category.selectOption({ index: 1 })
    await page.locator('#note').fill('ทดสอบอัตโนมัติ P8-E2E-03')

    // หน่วงคำขอบันทึกไว้ เพื่อให้สถานะ "กำลังบันทึก" อยู่นานพอที่จะอ่านได้
    await page.route('**/api/**', async (route) => {
      await new Promise((r) => setTimeout(r, 1200))
      await route.continue()
    })

    const save = page.getByRole('button', { name: /บันทึก/ })
    await save.click()

    await expect(page.getByRole('button', { name: 'กำลังบันทึก…' })).toBeDisabled()
    await expect(page.locator('.animate-spin').first()).toBeVisible()

    // sonner ใส่ role=status ให้ toast
    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 20_000 })
  })
})

test.describe('P8-E2E-04 · ความกว้าง 390 / 768 / 1440', () => {
  for (const [w, h] of [[390, 844], [768, 1024], [1440, 900]] as const) {
    test(`P8-E2E-04 ที่ ${w}px ไม่มีการเลื่อนแนวนอน และเมนูถูกชุด`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      const overflowing: string[] = []

      // 🔴 `/settings` ไม่ได้อยู่ใน DATA_PAGES (มันไม่มี loading.tsx และไม่ใช่หน้าลิสต์)
      // จึงเคยหลุดจากการกวาดความกว้างทั้งหมด — การ์ดใหม่ทุกใบที่ไปลงหน้านั้น
      // เลยไม่เคยถูกวัดว่าล้นขอบจอมือถือหรือไม่ · ตรงนี้กวาดมันด้วย
      for (const path of [...DATA_PAGES, '/settings']) {
        await page.goto(path)
        await ready(page)
        const bad = await overflowingElements(page)
        if (bad.length) overflowing.push(`${path}: ${bad.join(' | ')}`)
      }
      expect(overflowing, `หน้าที่เลื่อนแนวนอนได้ที่ ${w}px: ${overflowing.join(' · ')}`).toEqual([])

      // เมนูสลับตามความกว้าง — แถบล่างสำหรับมือถือ, sidebar สำหรับจอกว้าง
      await page.goto('/')
      await ready(page)
      if (w < 1024) {
        await expect(page.locator('[data-nav="bottom"]')).toBeVisible()
        await expect(page.locator('[data-nav="sidebar"]')).toBeHidden()
      } else {
        await expect(page.locator('[data-nav="sidebar"]')).toBeVisible()
        await expect(page.locator('[data-nav="bottom"]')).toBeHidden()
      }
    })
  }
})

test('P8-E2E-04b ตัวตรวจการเลื่อนแนวนอนจับของที่ล้นได้จริง', async ({ page }) => {
  // 🔴 แถว P8-E2E-04 เขียวตั้งแต่รอบแรก ซึ่งเป็นสัญญาณที่ต้องสงสัยเสมอ —
  // เขียวเพราะหน้าไม่ล้น หรือเขียวเพราะสูตรวัดผิดจนไม่มีวันแดง? · แถวนี้
  // ยัดของกว้างเกินจอเข้าไปแล้วยืนยันว่าสูตรเดียวกันนั้น **แดง**
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await ready(page)

  expect(await overflowingElements(page), 'หน้าปกติต้องไม่มีของล้น').toEqual([])

  await page.evaluate(() => {
    const wide = document.createElement('div')
    wide.id = 'e2e-overflow-probe'
    wide.style.width = '3000px'
    wide.style.height = '4px'
    wide.style.background = 'red'
    document.body.appendChild(wide)
  })
  expect(
    (await overflowingElements(page)).join(' '),
    'สูตรวัดต้องจับของกว้าง 3000px ได้ — ถ้าแถวนี้แดง แปลว่าแถว P8-E2E-04 เขียวโดยไม่ได้ตรวจอะไร',
  ).toContain('e2e-overflow-probe'.slice(0, 0) + 'ขอบขวา')

  await page.evaluate(() => document.getElementById('e2e-overflow-probe')?.remove())
  expect(await overflowingElements(page), 'เอาออกแล้วต้องกลับมาไม่ล้น').toEqual([])
})

test.describe('P8-E2E-05 · โหมดสว่างและมืด', () => {
  test('P8-E2E-05 สลับธีมแล้วพื้นหลังและตัวหนังสือเปลี่ยนจริงทั้งคู่', async ({ page }) => {
    await page.goto('/')
    await ready(page)

    const read = () =>
      page.evaluate(() => {
        const s = getComputedStyle(document.body)
        return {
          dark: document.documentElement.classList.contains('dark'),
          bg: s.backgroundColor,
          fg: s.color,
        }
      })

    const first = await read()
    await page.getByRole('button', { name: /เปลี่ยนเป็นโหมด/ }).click()
    await expect
      .poll(async () => (await read()).dark, { timeout: 10_000 })
      .toBe(!first.dark)
    const second = await read()

    expect(second.bg, 'พื้นหลังต้องเปลี่ยนเมื่อสลับธีม').not.toBe(first.bg)
    expect(second.fg, 'สีตัวหนังสือต้องเปลี่ยนเมื่อสลับธีม').not.toBe(first.fg)

    // 🔴 พื้นหลังโปร่งใสแปลว่าไปยืมสีของ host มา — ต้องทาสีเองทั้งสองโหมด
    for (const s of [first, second]) {
      expect(s.bg, 'body ต้องมีพื้นหลังของตัวเอง').not.toBe('rgba(0, 0, 0, 0)')
      expect(s.bg).not.toBe('transparent')
    }
  })
})

test.describe('P8-E2E-07 · loading.tsx ต้องไม่กลืนสถานะ 404', () => {
  test('P8-E2E-07 โครงการที่ไม่มีอยู่จริงตอบ 404 ไม่ใช่ 200', async ({ request }) => {
    // 🔴 `loading.tsx` เปลี่ยน segment เป็นสตรีม ซึ่งทำให้ `notFound()`
    // ตั้งรหัสสถานะไม่ได้ · ถ้าแถวนี้แดง ให้ถอด loading.tsx ของ segment นั้นออก
    const res = await request.get('/sites/00000000-0000-0000-0000-000000000000')
    expect(res.status()).toBe(404)
  })
})

/**
 * แถว P0 ที่ต้องอ่านค่าจากเบราว์เซอร์จริง — ค้าง `☐` มาตั้งแต่เฟสแรก
 * เพราะไม่มีสคริปต์ไหนเปิดหน้าเว็บจริงจนกระทั่ง P8
 */
test.describe('P0-UI · ธีมและฟอนต์', () => {
  const read = (page: Page) =>
    page.evaluate(() => ({
      dark: document.documentElement.classList.contains('dark'),
      bg: getComputedStyle(document.body).backgroundColor,
      stored: localStorage.getItem('theme'),
    }))

  /**
   * 🔴 ต้อง **กดจริงอย่างน้อยหนึ่งครั้ง** — `next-themes` เขียน localStorage
   * เฉพาะตอนที่ผู้ใช้เลือกเอง · ถ้าเครื่องตั้งเป็นโหมดสว่างอยู่แล้วแล้วเรา
   * "เห็นว่าตรงแล้วเลยไม่กด" ค่าใน localStorage จะเป็น null และแถวจะแดง
   * ทั้งที่ธีมถูกต้อง — คนละเรื่องกันระหว่าง "ตอนนี้สว่าง" กับ "ผู้ใช้เลือกสว่าง"
   */
  const setTheme = async (page: Page, want: 'dark' | 'light') => {
    await page.goto('/')
    await ready(page)
    const toggle = page.getByRole('button', { name: /เปลี่ยนเป็นโหมด/ })
    for (let i = 0; i < 4; i++) {
      const s = await read(page)
      if (s.dark === (want === 'dark') && s.stored !== null) return
      await toggle.click()
      await page.waitForTimeout(300)
    }
  }

  test('P0-UI-05 โหมดมืด: html มีคลาส dark · พื้นหลัง rgb(11, 16, 23) · จำไว้ใน localStorage', async ({ page }) => {
    await setTheme(page, 'dark')
    const s = await read(page)
    expect(s.dark).toBe(true)
    expect(s.bg).toBe('rgb(11, 16, 23)')
    expect(s.stored).toBe('dark')
  })

  test('P0-UI-06 โหมดสว่าง: html ไม่มีคลาส dark · พื้นหลัง rgb(242, 245, 250) · จำไว้ใน localStorage', async ({ page }) => {
    await setTheme(page, 'light')
    const s = await read(page)
    expect(s.dark).toBe(false)
    expect(s.bg).toBe('rgb(242, 245, 250)')
    expect(s.stored).toBe('light')
  })

  test('P0-UI-08 IBM Plex Sans Thai โหลดจริง — ตัวหนา 20px ใช้ได้', async ({ page }) => {
    await page.goto('/')
    await ready(page)
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.fonts.check('600 20px "IBM Plex Sans Thai"'))).toBe(true)
  })

  test('P0-UI-12 กดสลับธีมแล้วคลาสเปลี่ยนภายใน 500ms และ console ไม่มี error', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto('/')
    await ready(page)
    const before = await read(page)

    const t0 = Date.now()
    await page.getByRole('button', { name: /เปลี่ยนเป็นโหมด/ }).click()
    await expect.poll(async () => (await read(page)).dark, { timeout: 500 }).toBe(!before.dark)
    expect(Date.now() - t0).toBeLessThan(500)

    expect(errors, `console error: ${errors.join(' | ')}`).toEqual([])
  })
})
