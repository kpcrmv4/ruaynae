#!/usr/bin/env node
/**
 * verify-e2e.mjs — รัน Playwright แล้วรายงานผลด้วยรูปแบบเดียวกับตัวตรวจอื่น
 *
 * ทำไมต้องมีตัวห่อ ไม่เรียก `npx playwright test` ตรง ๆ:
 *
 * 1. **ต้องมีข้อมูล** — หน้าที่ว่างเปล่าทำให้แถวอย่าง "ปุ่มบันทึกถูก disable"
 *    ไม่มีอะไรให้กด และ "ไม่มีการเลื่อนแนวนอน" ก็เขียวเพราะไม่มีอะไรให้ล้น
 *    (kp-acceptance-test-matrix §3 — `0 === 0` คือ check ที่เห็นด้วยกับทุกอย่าง)
 * 2. **ต้องคืนฐานข้อมูลให้เหมือนเดิม** — เทสต์บันทึกรายการจริงลงฐาน
 *    ถ้าปล่อยค้าง ตัวนับของสคริปต์อื่นเพี้ยนทั้งชุด (เคยทำมาแล้ว 31 แถว)
 * 3. **ต้องมี dev server** — ถ้าไม่มี Playwright จะแดงทุกแถวโดยที่แอปไม่ผิด
 *    ซึ่งเป็นการรายงานที่ทำให้คนเลิกเชื่อชุดตรวจ
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const BASE = process.argv[2] ?? 'http://localhost:3200'
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)

const sql = async (query) => {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    },
  )
  const body = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`SQL ล้มเหลว: ${JSON.stringify(body)?.slice(0, 300)}`)
  return body
}

console.log('── E2E บนเบราว์เซอร์จริง ────────────────────────────────────')

const up = await fetch(BASE, { redirect: 'manual' }).then(() => true).catch(() => false)
if (!up) {
  console.log(`  ❌ ไม่มี dev server ที่ ${BASE} — สั่ง \`npm run dev\` ก่อน`)
  console.log('\n  1 แถว: ผ่าน 0 · ตก 1')
  process.exit(1)
}

const counts = async () => (await sql(`
  select
    (select count(*) from public.sites) sites,
    (select count(*) from public.transactions) txns,
    (select count(*) from public.employees) emps`))[0]

const startedEmpty = Object.values(await counts()).every((n) => Number(n) === 0)
if (startedEmpty) {
  console.log('  · ฐานข้อมูลว่าง — ใส่ข้อมูลตัวอย่างก่อน (หน้าว่างทำให้แถวเขียวโดยไม่ได้ตรวจอะไร)')
  const seed = spawnSync('node', ['scripts/seed-demo.mjs'], { encoding: 'utf8' })
  if (seed.status !== 0) {
    console.log('  ❌ seed ไม่สำเร็จ:', (seed.stdout + seed.stderr).split('\n').slice(-3).join(' '))
    console.log('\n  1 แถว: ผ่าน 0 · ตก 1')
    process.exit(1)
  }
}

let out = ''
try {
  const r = spawnSync('npx', ['playwright', 'test', '--reporter=line'], {
    encoding: 'utf8', shell: process.platform === 'win32',
  })
  out = (r.stdout ?? '') + (r.stderr ?? '')
} finally {
  if (startedEmpty) {
    await sql(readFileSync('supabase/reset.sql', 'utf8'))
    console.log('  · ล้างข้อมูลตัวอย่างแล้ว — ฐานข้อมูลว่างเหมือนตอนเริ่ม')
  } else {
    // เทสต์บันทึกรายการจริงลงไป — เก็บกวาดเฉพาะของที่ตัวเองสร้าง
    await sql("delete from public.transactions where note like 'ทดสอบอัตโนมัติ P8-E2E%'")
    console.log('  · ฐานข้อมูลมีข้อมูลอยู่ก่อน — ลบเฉพาะรายการที่เทสต์สร้างเอง')
  }
}

// Playwright รายงานว่า "N passed" / "N failed"
const passed = Number(out.match(/(\d+) passed/)?.[1] ?? 0)
const failed = Number(out.match(/(\d+) failed/)?.[1] ?? 0)

for (const line of out.split('\n')) {
  if (/^\s+\d+\) /.test(line) || /✘/.test(line)) console.log(`  ❌ ${line.trim()}`)
}
if (!passed && !failed) {
  console.log('  ❌ อ่านผลจาก Playwright ไม่ได้')
  console.log(out.split('\n').slice(-8).join('\n'))
}

console.log('\n══════════════════════════════════════════════')
console.log(`  ${passed + failed} แถว: ผ่าน ${passed} · ตก ${failed || (passed ? 0 : 1)}`)
process.exit(failed || !passed ? 1 : 0)
