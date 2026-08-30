import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { test as setup, expect } from '@playwright/test'

const STATE = '.playwright/owner.json'

/**
 * ล็อกอินเป็นเจ้าของครั้งเดียว แล้วเก็บคุกกี้ไว้ให้ทุกเทสต์ใช้ต่อ
 *
 * 🔴 อ่านรหัสจาก `.env.local` และ **ห้าม echo ค่าออกมา** ไม่ว่าจะตอน error ·
 * ข้อความ error ของ Playwright ไปโผล่ในล็อก CI ได้
 */
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)

setup('เข้าสู่ระบบเป็นเจ้าของ', async ({ page }) => {
  const email = env.SEED_OWNER_EMAIL
  const password = env.SEED_OWNER_PASSWORD
  expect(Boolean(email && password), 'ต้องมี SEED_OWNER_EMAIL และ SEED_OWNER_PASSWORD ใน .env.local').toBe(true)

  await page.goto('/login')
  await page.getByRole('tab', { name: /เจ้าของ/ }).click()
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()

  // ต้องหลุดจากหน้า login จริง ๆ ไม่ใช่แค่ไม่มี error
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  await expect(page.locator('[data-nav="sidebar"]')).toBeVisible()

  if (!existsSync('.playwright')) mkdirSync('.playwright')
  await page.context().storageState({ path: STATE })
})
