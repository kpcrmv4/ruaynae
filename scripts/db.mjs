#!/usr/bin/env node
/**
 * db.mjs — คุยกับฐานข้อมูลผ่าน Supabase Management API
 *
 * ทำไมไม่ใช้ MCP: MCP server ของ plugin ตอบ `Invalid project ref:
 * ${SUPABASE_PROJECT_REF}` — ตัวแปรในไฟล์ config ไม่ถูกแทนค่า จึงไม่ได้ผูก
 * กับโปรเจ็คนี้ · ตัวนี้เป็นทางสำรองที่สกิล supabase-rls-schema กำหนดไว้
 *
 * 🔴 ค่าใน .env.local ต้อง **ชนะ** ตัวแปรของเชลล์เสมอ
 * เชลล์อาจถือ SUPABASE_ACCESS_TOKEN ของโปรเจ็คอื่นอยู่ ซึ่งจะได้ 403
 * ที่หาสาเหตุยากมากเพราะทุกอย่างดูถูกไปหมด
 *
 * ใช้:
 *   node scripts/db.mjs query "select 1"
 *   node scripts/db.mjs file supabase/migrations/xxx.sql
 *   node scripts/db.mjs advisors security|performance
 *   node scripts/db.mjs types > src/lib/database.types.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)

const REF = env.SUPABASE_PROJECT_REF
const TOKEN = env.SUPABASE_ACCESS_TOKEN
if (!REF || !TOKEN) throw new Error('.env.local ต้องมี SUPABASE_PROJECT_REF และ SUPABASE_ACCESS_TOKEN')

// ตรึงเป้าหมาย: ref ต้องตรงกับ subdomain ใน URL ที่แอปใช้จริง
// ไม่ตรง = กำลังจะเขียนผิดฐานข้อมูล ต้องหยุดทันที
const hostRef = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
if (hostRef !== REF) {
  throw new Error(`เป้าหมายไม่ตรงกัน: PROJECT_REF=${REF} แต่ URL ชี้ไป ${hostRef} — หยุดก่อนเขียนผิดที่`)
}

const api = async (path, init = {}) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...init.headers },
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}\n${text.slice(0, 900)}`)
  return text
}

const runSql = (sql) => api('/database/query', { method: 'POST', body: JSON.stringify({ query: sql }) })

const [cmd, arg] = process.argv.slice(2)

if (cmd === 'query') {
  console.log(await runSql(arg))
} else if (cmd === 'file') {
  const sql = readFileSync(arg, 'utf8')
  const out = await runSql(sql)
  console.error(`✅ applied ${arg} (project ${REF})`)
  console.log(out)

  // regenerate types ทันที ไม่ต้องพึ่งความจำ
  // ขั้นนี้คือขั้นที่คนข้ามบ่อยที่สุด และอาการคือ .from('ตารางใหม่') กลายเป็น
  // never ซึ่ง tsc จับได้ก็ต่อเมื่อไฟล์ type เป็นของจริง — ถ้าเป็น stub จะเงียบสนิท
  const t = JSON.parse(await api('/types/typescript'))
  const target = 'src/lib/database.types.ts'
  const rows = (t.types.match(/Row:\s*\{/g) ?? []).length
  if (rows < 1) throw new Error(`types ที่ได้กลับมาไม่มีตารางเลย (${rows} Row blocks) — ไม่เขียนทับ`)
  writeFileSync(target, t.types, 'utf8')
  console.error(`✅ regenerated ${target} (${rows} tables)`)
} else if (cmd === 'advisors') {
  const out = JSON.parse(await api(`/advisors/${arg}`))
  const lints = out.lints ?? []
  const errs = lints.filter((l) => l.level === 'ERROR')
  const warns = lints.filter((l) => l.level === 'WARN')
  console.log(`  ${arg}: ERROR ${errs.length} · WARN ${warns.length} · รวม ${lints.length}`)
  for (const l of [...errs, ...warns]) console.log(`   [${l.level}] ${l.name} — ${l.title}`)
  process.exit(errs.length ? 1 : 0)
} else if (cmd === 'types') {
  const out = JSON.parse(await api('/types/typescript'))
  process.stdout.write(out.types)
} else {
  console.error('usage: db.mjs query|file|advisors|types <arg>')
  process.exit(2)
}
