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

const SCRIPTS = ['verify-p0', 'verify-rls', 'verify-auth', 'verify-r2', 'verify-users', 'verify-sites', 'verify-sites-api']

let pass = 0
let fail = 0
let skip = 0
const failed = []

for (const name of SCRIPTS) {
  await clearAttempts()
  const r = spawnSync('node', [`scripts/${name}.mjs`], { encoding: 'utf8' })
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  const m = out.match(/(\d+) แถว: ผ่าน (\d+) · ตก (\d+)(?: · undecided (\d+))?/)
  if (!m) {
    console.log(`  ❌ ${name.padEnd(13)} รันไม่สำเร็จ`)
    console.log(out.split('\n').slice(-6).join('\n'))
    fail += 1
    failed.push(name)
    continue
  }
  const [, total, p, f, s] = m
  pass += Number(p)
  fail += Number(f)
  skip += Number(s ?? 0)
  const bad = out.split('\n').filter((l) => l.includes('❌'))
  console.log(`  ${Number(f) === 0 ? '✅' : '❌'} ${name.padEnd(13)} ${total} แถว · ผ่าน ${p} · ตก ${f}${s ? ` · undecided ${s}` : ''}`)
  for (const b of bad) console.log(`      ${b.trim()}`)
  if (Number(f) > 0) failed.push(name)
}

await clearAttempts()

console.log('\n══════════════════════════════════════════════')
console.log(`  รวม: ผ่าน ${pass} · ตก ${fail} · undecided ${skip}`)
if (failed.length) console.log(`  สคริปต์ที่มีแถวตก: ${failed.join(', ')}`)
process.exit(fail ? 1 : 0)
