import { defineConfig, devices } from '@playwright/test'

/**
 * E2E ที่ยิงใส่ dev server จริงและฐานข้อมูลจริง — ไม่ mock Supabase
 *
 * 🔴 ต้องมี dev server รันอยู่ที่ `E2E_BASE` ก่อน (ค่าเริ่มต้น 3200) ·
 * ไม่ใช้ `webServer` ของ Playwright เพราะสคริปต์ตรวจตัวอื่นใช้เซิร์ฟเวอร์
 * ตัวเดียวกันอยู่ · ให้ `verify-e2e.mjs` เป็นคนเช็คว่ามันขึ้นแล้วจริง
 *
 * 🔴 `workers: 1` — ทุกอย่างวิ่งบนฐานข้อมูลเดียวกัน การรันขนานทำให้แถวที่
 * เทสต์หนึ่งสร้างไปโผล่ในตัวนับของอีกเทสต์
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE ?? 'http://localhost:3200',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: '.playwright/owner.json' },
      dependencies: ['setup'],
    },
  ],
})
