#!/usr/bin/env node
/**
 * ตรวจว่าคลาสสีที่โค้ดใช้ ถูก Tailwind สร้าง CSS ให้จริง
 *
 * 🔴 กับดักที่ตรวจ (CLAUDE.md §17 ข้อ 15): โทเคนที่ประกาศไว้ใน `:root` ครบ
 * แต่**ลืมส่งเข้า `@theme inline`** จะทำให้ Tailwind ไม่รู้จักคลาสนั้น แล้ว
 * **ไม่สร้าง CSS ให้เลยโดยไม่มี error ที่ไหน** — `tsc` เขียว `next build` เขียว
 * ตัวตรวจอื่นเขียวหมด แต่บนจอจริงตัวหนังสือตกไปใช้สีที่สืบทอดมา
 * · ของจริงที่เจอ: `text-sidebar-title` ไม่ถูกสร้าง ชื่อบริษัทจึงเป็นสีเกือบดำ
 *   (`--ink`) บนแผงกรมท่า = อ่านไม่ออกทั้งแผง และไม่มีใครสังเกตจนผู้ใช้แจ้ง
 *
 * วิธีตรวจ: อ่านคลาสที่ขึ้นต้นด้วยคำนำหน้าเชิงสีจากซอร์ส แล้วยืนยันว่ามีอยู่ใน
 * CSS ที่ build ออกมาจริง — ไม่ใช่เทียบรายชื่อโทเคนกับตัวเอง ซึ่งจะเขียวตลอด
 *
 * ต้องรัน **หลัง** `next build` (อ่านผลจาก .next) — `npm run gate` ต่อให้แล้ว
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** ไล่หาไฟล์ตามนามสกุล แบบไม่พึ่ง glob ของเชลล์ (Windows ก็ต้องรันได้) */
function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, exts, out)
    else if (exts.some((e) => name.endsWith(e))) out.push(p)
  }
  return out
}

const cssFiles = walk('.next', ['.css'])
if (cssFiles.length === 0) {
  console.error('❌ ไม่พบ CSS ที่ build ไว้ — รัน `next build` ก่อน แล้วค่อยรันตัวตรวจนี้')
  process.exit(1)
}

// ชื่อคลาสใน CSS ถูก escape (`bg-black/45` → `.bg-black\/45`)
// ถอด backslash ออกก่อนเทียบ จะได้ไม่ต้องเดารูปแบบการ escape ของ Tailwind
const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n').replace(/\\/g, '')

// คำนำหน้าที่กินค่าสี — ตัวที่พลาดแล้วเงียบที่สุดคือกลุ่มนี้
// `(?<![a-z0-9-])` กัน false positive จากคำที่มีขีดกลาง เช่น `auto-fit` → `to-fit`
const CLASS = new RegExp(
  '(?<![a-z0-9-])(?:text|bg|border|ring|fill|stroke|placeholder|accent|caret|decoration|outline|divide|shadow|from|via|to)' +
    '-[a-z0-9][a-z0-9-]*(?:/[0-9.]+)?',
  'g',
)

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const found = new Map()
for (const file of walk('src', ['.ts', '.tsx'])) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(CLASS)) if (!found.has(m[0])) found.set(m[0], file)
}

const missing = [...found].filter(
  ([cls]) => !new RegExp(`(?<![a-z0-9-])${escapeRe(cls)}(?![a-z0-9-])`).test(css),
)

if (missing.length > 0) {
  console.error(`❌ พบ ${missing.length} คลาสที่ใช้ในโค้ดแต่ Tailwind ไม่ได้สร้าง CSS ให้:`)
  for (const [cls, file] of missing) console.error(`   ${cls}  ← ${file}`)
  console.error('\nสาเหตุที่พบบ่อยที่สุด: โทเคนอยู่ใน :root แต่ยังไม่ได้ส่งเข้า @theme inline')
  console.error('ของ src/app/globals.css (เพิ่มบรรทัด `--color-<ชื่อ>: var(--<ชื่อ>);`)')
  process.exit(1)
}

console.log(`✅ คลาสสีทั้ง ${found.size} ตัวถูกสร้างเป็น CSS ครบ (จาก ${cssFiles.length} ไฟล์)`)
