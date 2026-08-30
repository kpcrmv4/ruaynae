#!/usr/bin/env node
/**
 * verify-p0.mjs — หลักฐานของแถวใน docs/test-plan/P0.md ที่เครื่องตัดสินได้
 *
 * กติกา (kp-acceptance-test-matrix):
 *  - ID ของแถวต้องอยู่ใน label ของ check เพื่อให้กระทบยอดกับตารางได้
 *  - แถวปฏิเสธต้องยืนยัน "เหตุผล" ไม่ใช่แค่ว่ามี error
 *  - ตัวตรวจที่แดงไม่เป็น ยังไม่นับเป็นตัวตรวจ → P0-INF-03 จงใจพังเพื่อพิสูจน์
 *  - grep ซอร์สต้องตัดคอมเมนต์ก่อน ไม่งั้นกฎจะถูก "คอมเมนต์ที่อธิบายกฎ" ทำให้ผ่าน
 *
 * ห้ามพิมพ์ค่าความลับลง stdout เด็ดขาด
 */
import { readFileSync, writeFileSync, copyFileSync, unlinkSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail })
  console.log(`  ${ok === 'skip' ? '⏭' : ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}
const sh = (cmd) => {
  try {
    return { out: execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 }
  } catch (e) {
    return { out: (e.stdout ?? '') + (e.stderr ?? ''), code: e.status ?? 1 }
  }
}
/** ตัดคอมเมนต์ออกก่อน grep — กฎที่ถูก "ประโยคอธิบายกฎ" ทำให้ผ่าน คือกฎที่ไม่มีวันแดง */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*.*$/gm, '')

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)

console.log('\n── P0-INF · โครงสร้างและ gate ─────────────────────────────')

// P0-INF-01 · typecheck ต้องผ่านแม้ไม่มี .next (typegen ต้องอยู่ใน script)
{
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const hasTypegen = /next typegen/.test(pkg.scripts?.typecheck ?? '')
  const r = sh('npm run typecheck')
  check('P0-INF-01 npm run typecheck ผ่าน และมี next typegen นำหน้า',
    r.code === 0 && hasTypegen, `exit=${r.code} typegen=${hasTypegen}`)
}

// P0-INF-02 · คอนทราสต์ต้องไม่มีคู่ที่ตก
let contrastOut = ''
{
  const r = sh('node scripts/verify-contrast.mjs src/app/globals.css')
  contrastOut = r.out
  const m = r.out.match(/(\d+) pairs checked · (\d+) below/)
  check('P0-INF-02 คอนทราสต์ 0 คู่ที่ต่ำกว่า 4.5:1',
    r.code === 0 && m?.[2] === '0', m ? `${m[1]} คู่ · ตก ${m[2]}` : 'อ่านผลไม่ได้')
}

// P0-INF-03 · red-test — ตัวตรวจต้องแดงเป็นเมื่อ token พัง
{
  const f = 'src/app/globals.css'
  const bak = f + '.redtest.bak'
  copyFileSync(f, bak)
  try {
    const src = readFileSync(f, 'utf8')
    const i = src.search(/^:root\s*\{/m)
    const j = src.search(/^\.dark\s*\{/m)
    const broken = src.slice(0, i) + src.slice(i, j).replace(/(--muted:\s*)#[0-9a-f]{6}/, '$1#999999') + src.slice(j)
    writeFileSync(f, broken, 'utf8')
    const r = sh('node scripts/verify-contrast.mjs src/app/globals.css')
    check('P0-INF-03 ตัวตรวจคอนทราสต์แดงเป็นจริงเมื่อ --muted พัง',
      r.code !== 0 && /FAIL/.test(r.out), `exit=${r.code} มีคำว่า FAIL=${/FAIL/.test(r.out)}`)
  } finally {
    // ต้องคืนไฟล์เสมอ — ถ้า throw กลางทาง รอบถัดไปจะอ่านไฟล์ที่ถูกทำพังไว้
    copyFileSync(bak, f)
    unlinkSync(bak)
  }
}

// P0-INF-04 · โหมดสว่างกับมืดต้องให้ตัวเลขต่างกัน (กันบั๊ก .dark ถูกอ่านเป็น :root)
{
  const [, lightBlk = '', darkBlk = ''] = contrastOut.split(/LIGHT|DARK/)
  const nums = (s) => [...s.matchAll(/\s(\d+\.\d\d)\s+([a-z-]+ on [a-z-]+)/g)].map((m) => m[1] + ' ' + m[2])
  const L = nums(lightBlk), D = nums(darkBlk)
  const differing = L.filter((v, k) => D[k] && v !== D[k]).length
  check('P0-INF-04 รายงาน LIGHT ≠ DARK อย่างน้อย 5 บรรทัด',
    differing >= 5, `ต่างกัน ${differing} บรรทัด จาก ${Math.min(L.length, D.length)}`)
}

// P0-INF-05 · region ต้องอยู่ที่สิงคโปร์ ให้ติดกับฐานข้อมูล
{
  const v = JSON.parse(readFileSync('vercel.json', 'utf8'))
  check('P0-INF-05 vercel.json regions = ["sin1"]',
    JSON.stringify(v.regions) === '["sin1"]', JSON.stringify(v.regions))
}

// P0-INF-06 · allowedDevOrigins ครบ + header กัน sw.js ถูกแคช
{
  const src = stripComments(readFileSync('next.config.ts', 'utf8'))
  const origins = ['localhost', '127.0.0.1', '*.localhost'].filter((o) => src.includes(`'${o}'`))
  const swHeader = /no-cache, no-store, must-revalidate/.test(src) && src.includes("'/sw.js'")
  check('P0-INF-06 allowedDevOrigins ครบ 3 และ header /sw.js กันแคช',
    origins.length === 3 && swHeader, `origins=${origins.length}/3 swHeader=${swHeader}`)
}

// P0-INF-07 · ความลับต้องไม่อยู่ใน git
{
  const tracked = sh('git ls-files').out.split('\n')
  const leaked = tracked.filter((f) => /^\.env($|\.)/.test(f) && f !== '.env.example')
  check('P0-INF-07 ไม่มีไฟล์ .env จริงถูก track ใน git',
    leaked.length === 0, leaked.length ? leaked.join(', ') : 'มีแต่ .env.example')
}

console.log('\n── P0-SEC · ความปลอดภัยระดับตั้งค่า ───────────────────────')

// P0-SEC-01 / P0-SEC-02 · การสมัครสมาชิกต้องปิด
{
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  try {
    const r = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
    const j = await r.json()
    check('P0-SEC-01 disable_signup = true', j.disable_signup === true, String(j.disable_signup))
    check('P0-SEC-02 anonymous sign-in ปิด',
      j.external?.anonymous_users === false, String(j.external?.anonymous_users))
  } catch (e) {
    check('P0-SEC-01 disable_signup = true', false, 'เรียก API ไม่ได้: ' + e.message)
    check('P0-SEC-02 anonymous sign-in ปิด', false, 'เรียก API ไม่ได้')
  }
}

// P0-SEC-04 · ห้ามมีความลับที่ขึ้นต้นด้วย NEXT_PUBLIC_
{
  const bad = Object.keys(env).filter(
    (k) => k.startsWith('NEXT_PUBLIC_') && /SECRET|SERVICE_ROLE|PRIVATE|PEPPER/.test(k),
  )
  check('P0-SEC-04 ไม่มีความลับขึ้นต้นด้วย NEXT_PUBLIC_', bad.length === 0, bad.join(', ') || 'ไม่มี')
}

console.log('\n══════════════════════════════════════════════')
const pass = results.filter((r) => r.ok === true).length
const fail = results.filter((r) => r.ok === false).length
const skip = results.filter((r) => r.ok === 'skip').length
console.log(`  ${results.length} แถว: ผ่าน ${pass} · ตก ${fail} · undecided ${skip}`)
process.exit(fail ? 1 : 0)
