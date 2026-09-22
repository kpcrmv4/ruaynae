#!/usr/bin/env node
/**
 * verify-four-states.mjs — ปิดสี่สถานะของ `/payroll` (แถว `P5-UI-08a/b/c`)
 *
 * สองสถานะแรกปิดไปแล้วที่อื่น (ว่าง = `P5-UI-03` · สำเร็จ = `P5-UI-01`)
 * ไฟล์นี้ปิดสองสถานะที่เหลือ ซึ่ง **ต้องฉีดความล้มเหลว** ถึงจะเห็น
 *
 * 🔴 ทำไมต้องพร็อกซี ไม่ใช่บล็อก request ใน Playwright: หน้านี้เป็น Server Component
 * — คำขอไปฐานข้อมูลออกจาก **เซิร์ฟเวอร์** ไม่ได้ออกจากเบราว์เซอร์ ตัวดัก request
 * ฝั่ง client จึงไม่มีทางแตะมันได้เลย · และจะชี้ทั้ง URL ไปพอร์ตตายก็ไม่ได้ เพราะ
 * auth จะพังก่อนแล้วโดน redirect ไป `/login` แทนที่จะได้เห็นหน้า error
 * → พร็อกซีส่งทุกอย่างต่อให้ของจริง **ยกเว้น** `rpc/payroll_balances` ตอนเปิดสวิตช์
 *
 * 🔴 Next 16 ไม่ยอมให้รัน dev server ตัวที่สองจากโฟลเดอร์เดียวกัน
 * ("Another next dev server is already running") — ยกเซิร์ฟเวอร์ปกติกับเซิร์ฟเวอร์
 * ที่พังพร้อมกันไม่ได้ · จึงใช้ **เซิร์ฟเวอร์ตัวเดียวที่ชี้ผ่านพร็อกซี** แล้วสลับสวิตช์
 * ตอนรันไทม์ — ได้ของแถมคือพิสูจน์ได้ว่า "กดลองใหม่แล้วข้อมูลกลับมาจริง"
 *
 * ⚠️ ต้องไม่มี dev server ตัวอื่นครองพอร์ต 3200 อยู่ — สคริปต์ยกของตัวเอง
 * ⚠️ อ่านข้อมูลอย่างเดียว ไม่เขียนอะไรลงฐานเลยสักแถว
 *
 * red-tested: 21 ก.ย. 2569 — ปิดสวิตช์ `failing` ทิ้งไว้แล้ว P5-UI-08b แดงทันที
 * (ไม่มีการ์ดผิดพลาดให้หา) · และตอนหน้ายังใช้กล่องแดงเดิมที่ไม่มีปุ่ม แถวนี้ก็แดง
 */
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { chromium } from 'playwright'

const PORT = 3200
const BASE = `http://127.0.0.1:${PORT}`
const PROXY_PORT = 3999

/** สวิตช์ความล้มเหลว — พร็อกซีอ่านค่านี้ทุกคำขอ */
let failing = false

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)
const REAL = env.NEXT_PUBLIC_SUPABASE_URL

const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const alive = async (url) => {
  try {
    const r = await fetch(url, { redirect: 'manual' })
    return r.status > 0
  } catch { return false }
}
const waitFor = async (url, tries = 90) => {
  for (let i = 0; i < tries; i++) {
    if (await alive(url)) return true
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

console.log('\n🔎 verify-four-states · /payroll')

if (await alive(`${BASE}/login`)) {
  console.error(
    `\n❌ มี dev server ครองพอร์ต ${PORT} อยู่แล้ว\n` +
    '   สคริปต์นี้ต้องยกเซิร์ฟเวอร์เองเพื่อชี้ Supabase ไปที่พร็อกซีที่ฉีดความล้มเหลวได้\n' +
    '   ปิดตัวเดิมก่อนแล้วรันใหม่\n')
  process.exit(1)
}

// ── พร็อกซี: ส่งต่อทุกอย่าง ยกเว้น RPC ตัวเดียวตอนเปิดสวิตช์ ────────
const proxy = createServer(async (req, res) => {
  if (failing && req.url.startsWith('/rest/v1/rpc/payroll_balances')) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ message: 'ฉีดความล้มเหลวเพื่อทดสอบสถานะผิดพลาด' }))
    return
  }
  const chunks = []
  for await (const c of req) chunks.push(c)
  const headers = { ...req.headers }
  delete headers.host
  delete headers['content-length']
  try {
    const upstream = await fetch(`${REAL}${req.url}`, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      redirect: 'manual',
    })
    const body = Buffer.from(await upstream.arrayBuffer())
    const out = {}
    upstream.headers.forEach((v, k) => {
      if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) out[k] = v
    })
    res.writeHead(upstream.status, out)
    res.end(body)
  } catch (e) {
    res.writeHead(502)
    res.end(String(e))
  }
})
await new Promise((r) => proxy.listen(PROXY_PORT, '127.0.0.1', r))

// 🔴 เรียกไบนารีของ next ด้วย node ตรง ๆ — `npm run dev -- -p x` จะได้
// `next dev -p 3200 -p x` (สคริปต์ dev ใส่พอร์ตไว้แล้ว) ส่วน `npx.cmd` โดน Node 24
// ปฏิเสธด้วย EINVAL เมื่อไม่เปิด shell
const dev = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(PORT)], {
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${PROXY_PORT}` },
  stdio: 'ignore',
})

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch())

try {
  if (!(await waitFor(`${BASE}/login`))) throw new Error('dev server ไม่ขึ้นภายในเวลา')

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const login = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD },
  })
  if (!login.ok()) throw new Error(`ล็อกอินผ่านพร็อกซีไม่สำเร็จ (${login.status()})`)

  // ══ P5-UI-08a · โครงร่าง ═══════════════════════════════════════════
  {
    const page = await ctx.newPage()
    // 🔴 Next โหลด RSC ของลิงก์ที่เห็นบนจอไว้ล่วงหน้า (prefetch) — คลิกแล้วหน้ามาทันที
    // และ `loading.tsx` ไม่มีวันถูกวาด · ตัด prefetch ทิ้ง (มีหัว `Next-Router-Prefetch`)
    // แล้วหน่วงเฉพาะคำขอจริงตอนคลิก
    await page.route(/_rsc=/, async (route) => {
      if (route.request().headers()['next-router-prefetch']) return route.abort()
      await new Promise((r) => setTimeout(r, 3000))
      await route.continue()
    })
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('link', { name: /ค่าแรง/ }).first().click()
    // โครงร่าง = `PageSkeleton` ซึ่งวาด `<div class="animate-pulse …">`
    const seen = await page.locator('.animate-pulse').first()
      .waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false)
    check('P5-UI-08a ระหว่างรอข้อมูล หน้าวาด **โครงร่าง** จาก loading.tsx (ไม่ใช่จอค้างเปล่า ๆ)',
      seen, seen ? 'เห็น skeleton ระหว่างนำทาง' : 'ไม่เห็น skeleton เลย')
    await page.unrouteAll()
    await page.close()
  }

  // ══ P5-UI-08b · ผิดพลาด + ปุ่มลองใหม่ ══════════════════════════════
  {
    const page = await ctx.newPage()
    failing = true
    await page.goto(`${BASE}/payroll`, { waitUntil: 'networkidle' })

    const box = page.locator('[data-state="error"]')
    const retry = page.getByRole('button', { name: /ลองใหม่/ })
    const hasBox = await box.isVisible().catch(() => false)
    const hasRetry = await retry.isVisible().catch(() => false)
    // ห้ามเหลือข้อความสั่งให้ผู้ใช้ไปรีเฟรชเอง — นั่นคือสิ่งที่แถวนี้มีไว้จับ
    const oldText = await page.getByText('ลองรีเฟรชหน้านี้อีกครั้ง').isVisible().catch(() => false)
    check('P5-UI-08b โหลดข้อมูลไม่ได้ → การ์ดผิดพลาดพร้อม **ปุ่มลองใหม่** (ไม่ใช่ข้อความบอกให้ไปรีเฟรชเอง)',
      hasBox && hasRetry && !oldText,
      `การ์ด=${hasBox} · ปุ่ม=${hasRetry} · ยังมีข้อความให้รีเฟรชเอง=${oldText}`)

    // ══ P5-UI-08c · กดลองใหม่แล้วต้องหายจริง ════════════════════════
    // 🔴 นี่คือครึ่งที่ทำให้แถวบนมีความหมาย — ปุ่มที่กดแล้วไม่เกิดอะไรขึ้นก็ยัง
    // "มองเห็นได้" ครบทุกเงื่อนไขข้างบน · ปิดสวิตช์แล้วกด ข้อมูลต้องกลับมา
    failing = false
    await retry.click()
    // 🔴 อ่านจาก **หัวข้อของหน้า** ไม่ใช่ `getByText` ทั้งหน้า — "ค่าแรงและการจ่าย"
    // เป็นชื่อเมนูในแถบข้างด้วย เช็คเดิมจึงเขียวจากลิงก์ที่อยู่คนละที่กับเนื้อหา
    // (กับดักเดียวกับ "อ่านค่าจากอิลิเมนต์ที่เป็นเจ้าของค่า")
    const recovered = await page.getByRole('heading', { name: 'ค่าแรงและการจ่าย' })
      .waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)
    const errorGone = !(await box.isVisible().catch(() => false))
    check('P5-UI-08c กดปุ่มลองใหม่หลังต้นทางกลับมาปกติ → ข้อมูลกลับมาและการ์ดผิดพลาดหายไป',
      recovered && errorGone, `เนื้อหากลับมา=${recovered} · การ์ดหาย=${errorGone}`)
    await page.close()
  }

  await ctx.close()
} finally {
  await browser.close()
  dev.kill('SIGTERM')
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(dev.pid), '/f', '/t'], { stdio: 'ignore' })
  }
  proxy.close()
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok).length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}`)
process.exit(pass === results.length ? 0 : 1)
