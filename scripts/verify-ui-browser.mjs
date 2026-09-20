#!/usr/bin/env node
/**
 * verify-ui-browser.mjs — แถวที่ตัดสินได้เฉพาะในเบราว์เซอร์จริง
 *
 * ปิด: `P5-UI-04` · `P5-UI-10` (อยู่ในกล่องโต้ตอบ ต้องกดเปิดถึงจะเรนเดอร์)
 *      `BACK-04` · `BACK-05` · `BACK-06` (ต้องมีประวัติจริงและขนาดจอจริง)
 *
 * 🔴 **ยิงที่ localhost เท่านั้น ห้ามชี้ไป production** — สองเหตุผล:
 *   1. โค้ดที่กำลังตรวจยังไม่ถูก deploy · production จะตอบด้วยของเก่าแล้วแถวนี้
 *      จะเขียว/แดงโดยไม่เกี่ยวกับสิ่งที่เพิ่งแก้เลย
 *   2. production คือฐานข้อมูลจริงของลูกค้า — ตัวตรวจที่คลิกปุ่มบันทึกบนนั้น
 *      คือการเขียนข้อมูลจริงทิ้งไว้
 * · สคริปต์นี้ **ไม่กดปุ่มที่เขียนข้อมูลเลยสักปุ่ม** เปิดกล่อง พิมพ์ อ่านผล แล้วปิด
 *
 * red-tested: 21 ก.ย. 2569 — P0-BROWSER-01 คืนโค้ดที่เรียก `wageRowKey()` ข้ามฝั่ง
 *   กลับเข้าไปแล้วมันแดงทันทีพร้อมชี้หน้าที่พัง (`/payroll?tab=sites (error boundary)`)
 *   ใส่กลับ → เขียว · และ BACK-05 แดงจริงในรอบแรก (คาด history.idx=0 แต่ได้ null)
 * · P5-UI-04 มีคู่ตรงข้าม P5-UI-04b ที่ต้องผ่านเมื่อยอดอยู่ในคงเหลือ — ถ้าตัวตรวจ
 *   มองไม่เห็นความต่างของสองสถานะนี้ แถวใดแถวหนึ่งจะแดงทันที
 *
 * 🔴 การล้นขอบวัดจาก **ขอบขวาของแต่ละอิลิเมนต์** ไม่ใช่ `documentElement.scrollWidth`
 * ซึ่งเป็น 0 เสมอเพราะเชลล์ตั้ง `overflow-x: clip` ไว้ (CLAUDE.md §17 ข้อ 7)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3200'
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
  console.error(`\n❌ ปฏิเสธที่จะรันกับ ${BASE}\n` +
    '   ตัวตรวจนี้คลิกของจริงในหน้าเว็บ — ต้องเป็น dev server ในเครื่องเท่านั้น\n')
  process.exit(1)
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)

/** ทุก `page.tsx` ใต้ `(app)` → เส้นทางจริง (ตัด route group ในวงเล็บทิ้ง) */
function routesUnder(dir, prefix = '') {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const seg = e.name.startsWith('(') ? '' : `/${e.name}`
      out.push(...routesUnder(join(dir, e.name), prefix + seg))
    } else if (e.name === 'page.tsx') {
      out.push(prefix === '' ? '/' : prefix)
    }
  }
  return out
}

const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/** อิลิเมนต์ที่ขอบขวาเลยความกว้างจอ — ตัวเลขที่ `scrollWidth` มองไม่เห็น */
const overflowing = (page) =>
  page.evaluate(() => {
    const w = document.documentElement.clientWidth
    return [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.right > w + 1
      })
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`)
  })

/**
 * ใช้ **Chrome ของเครื่อง** ก่อน แล้วค่อยถอยไปใช้ chromium ที่ Playwright โหลดมา
 *
 * 🔴 เบราว์เซอร์ที่ Playwright โหลดไว้ในเครื่องนี้เป็น build 1243 แต่ไลบรารี 1.62.1
 * มองหา 1234 — ต่างกันหนึ่งขั้นก็ล้มด้วย "Executable doesn't exist" ทันที
 * · `channel: 'chrome'` ใช้ Chrome ที่ติดตั้งจริง ไม่ต้องดาวน์โหลดอะไรเพิ่ม
 *   และเป็นเบราว์เซอร์ตัวเดียวกับที่ผู้ใช้จริงเปิด
 */
const browser = await chromium
  .launch({ channel: 'chrome' })
  .catch(() => chromium.launch())
console.log(`\n🔎 verify-ui-browser · ${BASE}`)

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  // ล็อกอินผ่าน API แล้วคุกกี้ลงใน context เอง — ไม่ต้องพิมพ์ฟอร์มให้เปราะ
  const login = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD },
  })
  if (!login.ok()) throw new Error(`ล็อกอินไม่สำเร็จ (${login.status()})`)

  // ── BACK-04 · ถอยตามประวัติจริง ───────────────────────────────────
  {
    const page = await ctx.newPage()
    await page.goto(`${BASE}/sites`, { waitUntil: 'networkidle' })
    const firstSite = page.locator('a[href^="/sites/"]').first()
    const href = await firstSite.getAttribute('href')
    await firstSite.click()
    await page.waitForURL(`**${href}`)
    await page.getByRole('button', { name: 'ย้อนกลับ' }).click()
    await page.waitForURL('**/sites')
    check('BACK-04 เข้าโครงการจาก /sites แล้วกดย้อนกลับ → กลับมาที่ /sites',
      new URL(page.url()).pathname === '/sites', page.url().replace(BASE, ''))
    await page.close()
  }

  // ── BACK-05 · เปิดลิงก์ตรง ไม่มีประวัติให้ถอย ─────────────────────
  {
    // context ใหม่ = แท็บใหม่ ไม่มีประวัติในแอปเลย (idx = 0)
    const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await fresh.request.post(`${BASE}/api/auth/login`, {
      data: { email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD },
    })
    const page = await fresh.newPage()
    await page.goto(`${BASE}/settings/categories`, { waitUntil: 'networkidle' })
    const idx = await page.evaluate(() => window.history.state?.idx ?? null)
    await page.getByRole('button', { name: 'ย้อนกลับ' }).click()
    await page.waitForURL('**/settings')
    // 🔴 เปิดลิงก์ตรง ๆ `history.state.idx` เป็น **`null`** ไม่ใช่ `0` — Next ยังไม่ได้
    // เขียนสถานะของตัวเองลงไปจนกว่าจะมีการนำทางในแอปครั้งแรก · คอมโพเนนต์อ่านด้วย
    // `?? 0` จึงถูกต้องอยู่แล้ว · ตัวตรวจฉบับแรกคาด `=== 0` แล้วแดงทั้งที่ปุ่มทำงานถูก
    // — แถวนี้ต้องถามว่า "ไม่มีประวัติให้ถอยใช่ไหม" ไม่ใช่ถามค่าภายในของ Next
    check('BACK-05 เปิดลิงก์ตรงเข้าหน้าลูกแล้วกดย้อนกลับ → ไป /settings ไม่หลุดออกจากเว็บ',
      new URL(page.url()).pathname === '/settings' && (idx === null || idx === 0),
      `history.idx=${idx} (ไม่มีประวัติในแอป) → ${page.url().replace(BASE, '')}`)
    await fresh.close()
  }

  // ── BACK-06 · สามความกว้าง ────────────────────────────────────────
  {
    const sizes = [
      { w: 390, h: 844, label: 'มือถือ', wantText: false },
      { w: 768, h: 1024, label: 'แท็บเล็ต', wantText: true },
      { w: 1440, h: 900, label: 'เดสก์ท็อป', wantText: true },
    ]
    const seen = []
    let ok = true
    for (const s of sizes) {
      const c = await browser.newContext({ viewport: { width: s.w, height: s.h } })
      await c.request.post(`${BASE}/api/auth/login`, {
        data: { email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD },
      })
      const page = await c.newPage()
      await page.goto(`${BASE}/payroll`, { waitUntil: 'networkidle' })
      const btn = page.getByRole('button', { name: 'ย้อนกลับ' })
      const label = btn.locator('span')
      const textVisible = await label.isVisible()
      const iconVisible = await btn.locator('svg').isVisible()
      const over = await overflowing(page)
      const good = iconVisible && textVisible === s.wantText && over.length === 0
      if (!good) ok = false
      seen.push(`${s.w}px ${s.label}: ไอคอน=${iconVisible} คำ=${textVisible}${over.length ? ` ล้น:${over.join(',')}` : ''}`)
      await c.close()
    }
    check('BACK-06 390 เหลือแต่ไอคอน · 768/1440 เห็นคำว่า "ย้อนกลับ" · ไม่มีอะไรล้นขอบ',
      ok, seen.join(' · '))
  }

  // ── P5-UI-04 + P5-UI-10 · ในกล่องเบิก ─────────────────────────────
  // ⚠️ เปิดกล่องกับพิมพ์อย่างเดียว **ไม่กดบันทึก** — คนในลิสต์เป็นคนจริงของลูกค้า
  {
    const page = await ctx.newPage()
    await page.goto(`${BASE}/payroll`, { waitUntil: 'networkidle' })
    const row = page.locator('[data-balance-for]').first()
    const balText = (await row.innerText()).replace(/[^\d]/g, '')
    const balance = Number(balText || 0)
    await page.getByRole('button', { name: 'เบิก', exact: true }).first().click()

    const dateInput = page.locator('#adv-date')
    const dateValue = await dateInput.inputValue()
    const dateMax = await dateInput.getAttribute('max')
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
    check('P5-UI-10 กล่องเบิกมีช่องวันที่ · เริ่มที่วันนี้ · max = วันนี้ (เลือกอนาคตไม่ได้)',
      dateValue === today && dateMax === today,
      `value=${dateValue} max=${dateMax} (วันนี้ ${today})`)

    // พิมพ์ยอดเกินคงเหลือ → ต้องเตือน และปุ่มต้องเปลี่ยนความหมาย
    const submit = page.locator('button', { hasText: /บันทึกเบิก|ยืนยันเบิกเกิน/ }).last()
    const labelBefore = (await submit.innerText()).trim()
    await page.locator('#adv-amount').fill(String(balance + 1000))
    const warn = page.locator('text=เกินค่าแรงค้างจ่าย')
    const labelAfter = (await submit.innerText()).trim()
    const danger = await submit.getAttribute('class')
    check('P5-UI-04 พิมพ์ยอดเกินคงเหลือ → แถบเตือนโผล่ · ปุ่มเปลี่ยนเป็น "ยืนยันเบิกเกิน" สีแดง',
      (await warn.isVisible()) && labelBefore.includes('บันทึกเบิก')
      && labelAfter.includes('ยืนยันเบิกเกิน') && /btn-danger/.test(danger ?? ''),
      `ปุ่ม "${labelBefore}" → "${labelAfter}" · เตือน=${await warn.isVisible()}`)

    // ฝั่งตรงข้ามที่ต้องไม่เตือน: ยอดที่อยู่ในคงเหลือ
    if (balance > 1) {
      await page.locator('#adv-amount').fill(String(Math.floor(balance / 2)))
      const stillWarn = await warn.isVisible()
      const labelBack = (await submit.innerText()).trim()
      check('P5-UI-04b ลดยอดลงมาในคงเหลือ → คำเตือนหายและปุ่มกลับเป็น "บันทึกเบิก"',
        !stillWarn && labelBack.includes('บันทึกเบิก'), `ปุ่ม "${labelBack}" · เตือน=${stillWarn}`)
    }

    await page.keyboard.press('Escape')
    await page.close()
  }

  // ══ P0-BROWSER-01 · ทุกหน้าเปิดได้ในเบราว์เซอร์จริง ═══════════════
  // 🔴 แถวนี้เกิดเพราะ `/payroll?tab=sites` พังบน production แต่ตัวตรวจที่ยิงด้วย
  // `fetch` ได้ **200 พร้อม HTML ที่ดูปกติ** ทุกครั้ง · error เป็นของฝั่ง client
  // (เรียกฟังก์ชันของโมดูล 'use client' จากเซิร์ฟเวอร์) ซึ่งโผล่ตอนเบราว์เซอร์
  // ประมวลผลสตรีม RSC เท่านั้น — เจ้าของเจอก่อนตัวตรวจ (21 ก.ย. 2569)
  {
    const routes = routesUnder('src/app/(app)')
      .map((r) => (r.includes('[id]') ? null : r))
      .filter(Boolean)
      .concat(['/payroll?tab=sites', '/payroll?tab=grid', '/settings/users?tab=workers'])
    const page = await ctx.newPage()
    const broken = []
    for (const path of routes) {
      const errs = []
      const onErr = (e) => errs.push(e.message.split(/\r?\n/)[0].slice(0, 100))
      page.on('pageerror', onErr)
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }).catch(() => {})
      const boundary = await page.getByText('เปิดหน้านี้ไม่สำเร็จ').isVisible().catch(() => false)
      page.off('pageerror', onErr)
      if (boundary || errs.length) broken.push(`${path}${boundary ? ' (error boundary)' : ''}${errs.length ? ' · ' + errs[0] : ''}`)
    }
    check(
      `P0-BROWSER-01 ทุกหน้าเปิดได้ในเบราว์เซอร์จริง ไม่ตกลง error boundary — ตรวจ ${routes.length} หน้า`,
      broken.length === 0,
      broken.length ? broken.join(' · ') : `${routes.length}/${routes.length} หน้า สะอาด`,
    )
    await page.close()
  }

  await ctx.close()
} finally {
  await browser.close()
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
