#!/usr/bin/env node
/**
 * verify-client-boundary.mjs — ปิดแถว `P0-BOUNDARY-01`
 *
 * 🔴 **กับดักที่กัดสองครั้งแล้วในโปรเจ็คนี้** (21 ก.ย. 2569 ทั้งคู่):
 *   · `wageRowKey()` ถูก export จาก `'use client'` แล้วเรียกจากหน้า `/payroll`
 *   · `emptyDraft()` ถูก export จาก `doc-form.tsx` แล้วเรียกจากหน้า `/documents/new`
 *
 * อาการเหมือนกันเป๊ะและมองไม่เห็นจากที่ไหนเลย:
 *   `tsc --noEmit` เขียว · `next build` เขียว · ตัวตรวจที่ยิงด้วย `fetch`
 *   ได้ **200 พร้อม HTML ที่ดูปกติ** เพราะโครงร่างของ `loading.tsx` ถูกส่งออกไปแล้ว
 *   — error โผล่ตอน **เบราว์เซอร์ประมวลผลสตรีม RSC** เท่านั้น
 *   → ผู้ใช้จริงเปิดหน้านั้นไม่ได้เลยสักคน แต่ทุกไฟเขียวหมด
 *
 * `P0-BROWSER-01` ใน `verify-ui-browser.mjs` จับได้ แต่ต้องเปิด Chrome และ
 * ไล่ทุกหน้า · แถวนี้จับได้จากซอร์สล้วน ๆ จึงต่อเข้า `npm run gate` ได้
 *
 * กติกาที่บังคับ: ไฟล์ที่ **ไม่มี** `'use client'` ห้าม import **ค่า** (ไม่ใช่ `type`)
 * ที่ขึ้นต้นด้วยตัวพิมพ์เล็ก จากไฟล์ที่ **มี** `'use client'`
 * — ชื่อขึ้นต้นด้วยตัวพิมพ์ใหญ่ = คอมโพเนนต์ ซึ่งเรนเดอร์ข้ามฝั่งได้ตามการออกแบบ
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = 'src'

function files(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...files(p))
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

const all = files(ROOT)
const text = new Map(all.map((f) => [f.replace(/\\/g, '/'), readFileSync(f, 'utf8')]))
const isClient = (f) => /^\s*['"]use client['"]/.test(text.get(f) ?? '')

/** `@/lib/x` หรือ `./x` → เส้นทางจริงในโปรเจ็ค (ลองทุกนามสกุล/`index`) */
function resolveImport(from, spec) {
  if (!spec.startsWith('@/') && !spec.startsWith('.')) return null
  const base = spec.startsWith('@/')
    ? join('src', spec.slice(2))
    : resolve(dirname(from), spec).replace(/\\/g, '/').replace(`${process.cwd().replace(/\\/g, '/')}/`, '')
  for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    const key = cand.replace(/\\/g, '/')
    if (text.has(key)) return key
  }
  return null
}

const IMPORT_RE = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g

const bad = []
for (const [file, body] of text) {
  if (isClient(file)) continue
  for (const m of body.matchAll(IMPORT_RE)) {
    // `import type { … }` ทั้งก้อน = ชนิดล้วน ลบทิ้งตอน build ไม่ข้ามฝั่งจริง
    if (/^import\s+type/.test(m[0])) continue
    const target = resolveImport(file, m[2])
    if (!target || !isClient(target)) continue
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
      if (!name || /^type\s/.test(raw.trim())) continue
      if (raw.trim().startsWith('type ')) continue
      if (/^[A-Z]/.test(name)) continue // คอมโพเนนต์ — เรนเดอร์ข้ามฝั่งได้
      bad.push(`${file} → ${name}() จาก ${target}`)
    }
  }
}

console.log('\n── P0-BOUNDARY-01 · ไม่มีใครเรียกฟังก์ชันของโมดูล client จากเซิร์ฟเวอร์ ──')
const ok = bad.length === 0
console.log(`  ${ok ? '✅' : '❌'} ตรวจ ${text.size} ไฟล์ — ${
  ok ? 'ไม่พบการเรียกข้ามฝั่ง' : `พบ ${bad.length} จุด`}`)
for (const b of bad) console.log(`     · ${b}`)
if (!ok) {
  console.log('\n  วิธีแก้: ย้ายฟังก์ชันไปไฟล์ล้วน ๆ ใน `src/lib/` แล้วให้ทั้งสองฝั่ง import จากที่นั่น')
  console.log('  (ตัวอย่างที่ทำไปแล้ว: `src/lib/wage-row-key.ts` · `emptyDraft` ใน `src/lib/documents.ts`)')
}
process.exit(ok ? 0 : 1)
