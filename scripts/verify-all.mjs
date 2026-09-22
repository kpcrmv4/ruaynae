#!/usr/bin/env node
/**
 * verify-all.mjs — รันตัวตรวจทุกตัวแล้วสรุปเป็นตัวเลขเดียว
 *
 * 🔴 ต้องล้าง `login_attempts` **ระหว่าง** สคริปต์
 * ไม่งั้น verify-auth ที่จงใจยิง PIN ผิดรัว ๆ เพื่อทดสอบ rate limit
 * จะทำให้สคริปต์ถัดไปล็อกอินด้วย PIN ไม่ได้ แล้วตกทั้งที่โค้ดถูก
 * — ตัวตรวจที่รอบก่อนทำให้รอบหลังเพี้ยน คือตัวตรวจที่คนจะเลิกเชื่อ
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)

const clearAttempts = async () => {
  await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'delete from public.login_attempts' }),
  }).catch(() => {})
}

const SCRIPTS = [
  // ซอร์สล้วน ไม่แตะฐานข้อมูล — วางไว้ต้นแถวเพราะมันจับ "หน้าพังให้ผู้ใช้ทุกคน
  // แต่ทุกไฟเขียว" ซึ่งทำให้ผลของสคริปต์ที่เหลือน่าเชื่อถือน้อยลงทั้งชุด
  'verify-client-boundary',
  'verify-p0', 'verify-p0-rest', 'verify-rls', 'verify-auth', 'verify-shell',
  'verify-r2', 'verify-users', 'verify-sites', 'verify-sites-api', 'verify-txn', 'verify-txn-edit', 'verify-slips', 'verify-ledger', 'verify-money', 'verify-notify', 'verify-approvals', 'verify-bell', 'verify-employees', 'verify-workers', 'verify-attendance', 'verify-payroll', 'verify-payroll-ui', 'verify-pay-wage', 'verify-advance-db', 'verify-advance-requests', 'verify-recurring', 'verify-digest', 'verify-audit', 'verify-pwa', 'verify-mcp', 'verify-mcp-write', 'verify-back-button', 'verify-ledger-summary',
  'verify-doc-math', 'verify-documents',
  // ท้ายสุดเสมอ — ตรวจว่า "ติ๊ก" ในตารางตรวจรับมีของจริงรองรับ
  // ตัวนี้ไม่ได้ทดสอบแอป มันทดสอบ**เอกสารที่บอกว่าแอปถูกทดสอบแล้ว**
  'verify-ship',
  // E2E ผ่านเบราว์เซอร์จริง — ต้องมี dev server อยู่ที่ 3200
  'verify-ui-browser',
  'verify-e2e',
  'verify-matrix',
]

let pass = 0
let fail = 0
let skip = 0
const failed = []

/**
 * 🔴 เว้นจังหวะระหว่างสคริปต์ — Management API ของ Supabase ตอบ
 * `429 ThrottlerException` เมื่อยิงถี่เกินไป และตอนโดนนั้น `sql()` ของสคริปต์
 * ส่วนใหญ่คืนผลว่างแทนที่จะโยน → แถวแดงมั่วโดยที่แอปไม่ผิดสักอย่าง
 *
 * ที่แย่กว่าคือ **สคริปต์ที่ตายกลางทางไม่ได้ล้างข้อมูลของตัวเอง** ·
 * เจอจริงเมื่อ 31 ส.ค. 2569: `verify-ship` seed ข้อมูลเดโม่แล้วโดน 429
 * ตอนกำลังจะล้าง → เหลือ `site_supervisors` ค้างไว้ → รอบถัดไปแดง 32 แถว
 * เพราะ exclusion constraint ยอมให้หัวหน้าโครงการคนหนึ่งดูแลได้โครงการเดียวต่อวัน
 * ทุกสคริปต์ที่มอบหมายหัวหน้าโครงการให้โครงการทดสอบของตัวเองจึงชนกันหมด
 */
const PACE_MS = 2500

for (const name of SCRIPTS) {
  await clearAttempts()
  await new Promise((r) => setTimeout(r, PACE_MS))
  const r = spawnSync('node', [`scripts/${name}.mjs`], { encoding: 'utf8' })
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  /**
   * 🔴 ยอมรับคอลัมน์ "ข้าม" ที่สคริปต์รุ่นใหม่พิมพ์ด้วย — ไม่งั้นบรรทัดสรุป
   * ของมันจะแมตช์ไม่ติด แล้วตัวนี้รายงานว่า **"รันไม่สำเร็จ"** ทั้งที่ทุกแถวเขียว
   * (เจอตอนเพิ่ม `verify-ledger-summary` 21 ก.ย. 2569 — สคริปต์ที่แถวผ่านหมด
   *  กลับถูกนับเป็นตก 1 เพราะรูปแบบข้อความเปลี่ยนไปคำเดียว)
   */
  const m = out.match(
    /(\d+) แถว: ผ่าน (\d+)(?: · ข้าม (\d+))? · ตก (\d+)(?: · undecided (\d+))?/,
  )
  if (!m) {
    console.log(`  ❌ ${name.padEnd(13)} รันไม่สำเร็จ`)
    console.log(out.split('\n').slice(-6).join('\n'))
    fail += 1
    failed.push(name)
    continue
  }
  const [, total, p, skipped, f, undecided] = m
  const s = skipped ?? undecided
  pass += Number(p)
  fail += Number(f)
  skip += Number(s ?? 0)
  const bad = out.split('\n').filter((l) => l.includes('❌'))
  console.log(`  ${Number(f) === 0 ? '✅' : '❌'} ${name.padEnd(13)} ${total} แถว · ผ่าน ${p} · ตก ${f}${Number(s ?? 0) ? ` · ข้าม ${s}` : ''}`)
  for (const b of bad) console.log(`      ${b.trim()}`)
  if (Number(f) > 0) failed.push(name)
}

await clearAttempts()

console.log('\n══════════════════════════════════════════════')
console.log(`  รวม: ผ่าน ${pass} · ตก ${fail} · undecided ${skip}`)
if (failed.length) console.log(`  สคริปต์ที่มีแถวตก: ${failed.join(', ')}`)
process.exit(fail ? 1 : 0)
