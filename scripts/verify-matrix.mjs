#!/usr/bin/env node
/**
 * verify-matrix.mjs — ตรวจว่า "ติ๊ก" ในตารางตรวจรับมีของจริงรองรับ
 *
 * ตารางตรวจรับซื่อสัตย์ได้เท่าที่ติ๊กในนั้นซื่อสัตย์ · ปล่อยไว้มันจะเลื่อนไหล
 * ทีละนิด — ติ๊กจากความจำ จากภาพหน้าจอ จาก "อาทิตย์ที่แล้วก็ทำไปแล้ว"
 * แล้วเอกสารจะกลายเป็นบันทึกความตั้งใจ ไม่ใช่บันทึกสิ่งที่ทดสอบแล้ว
 *
 * ตรวจสองทาง ทั้งคู่สำคัญ:
 *   1. แถวที่ติ๊ก ✅ แต่ไม่มี ID อยู่ใน check ไหนเลย → ติ๊กนั้นคือความจำ
 *   2. check ที่อ้าง ID ซึ่งไม่มีในตารางแล้ว → มีคนแก้ตารางแล้วข้อกำหนดหายไปด้วย
 *
 * 🔴 จับ ID ที่ตำแหน่งไหนก็ได้ใน label — หนึ่ง check มักปิดหลายแถว
 *    ถ้า anchor ไว้ที่ต้นข้อความ ID ที่สองเป็นต้นไปจะหายทั้งหมด
 * 🔴 `P\d+-[A-Z]+-\d+` ไม่แมตช์ `P9-E2E-01` — ชื่อหมวดที่มีตัวเลขจะหลุดทั้งกลุ่ม
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ID = /P\d+(?:\.\d+)?-[A-Z][A-Z0-9]*-\d+[a-z]?/g

const readAll = (dir, ext) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? readAll(join(dir, e.name), ext)
      : e.name.endsWith(ext)
        ? [join(dir, e.name)]
        : [],
  )

// ── แถวจากทุกตารางตรวจรับ ──────────────────────────────────────────────
const rows = new Map()
for (const file of readAll('docs/test-plan', '.md')) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\|\s*(P\d+(?:\.\d+)?-[A-Z][A-Z0-9]*-\d+[a-z]?)\s*\|/.exec(line)
    if (!m) continue
    // อ่าน **ช่องสถานะ** ช่องสุดท้าย ไม่ใช่ทั้งบรรทัด — `⚠️` ที่อยู่ในช่อง
    // "ผลที่คาด" ไม่ได้แปลว่าแถวนั้น blocked
    const cells = line.trim().replace(/\|$/, '').split('|')
    rows.set(m[1], { file, status: cells[cells.length - 1].trim() })
  }
}

// ── ID ที่ปรากฏใน check ที่รันได้จริง ──────────────────────────────────
const evidence = new Map()
const sources = [
  ...readAll('scripts', '.mjs').filter((f) => !f.endsWith('verify-matrix.mjs')),
  ...(() => {
    try {
      return readAll('tests', '.ts')
    } catch {
      return []
    }
  })(),
]
for (const file of sources) {
  for (const id of readFileSync(file, 'utf8').match(ID) ?? []) {
    if (!evidence.has(id)) evidence.set(id, file)
  }
}

const ticked = [...rows].filter(([, r]) => r.status.startsWith('✅'))
const unproven = ticked.filter(([id]) => !evidence.has(id))
const orphans = [...evidence.keys()].filter((id) => !rows.has(id)).sort()

console.log('\n── ตรวจความซื่อสัตย์ของตารางตรวจรับ ──────────────────────────')
console.log(`  แถวทั้งหมด ${rows.size} · ติ๊กแล้ว ${ticked.length} · check ที่อ้าง ID ${evidence.size}`)

const line = (ok, label, detail) => console.log(`  ${ok ? '✅' : '❌'} ${label} — ${detail}`)

line(unproven.length === 0, 'ทุกแถวที่ติ๊กมี check ที่รันได้รองรับ',
  unproven.length ? unproven.map(([id]) => id).join(', ') : `${ticked.length} แถว`)
line(orphans.length === 0, 'ไม่มี check ที่อ้างแถวซึ่งหายไปจากตารางแล้ว',
  orphans.length ? orphans.join(', ') : 'ไม่มี')

console.log('\n══════════════════════════════════════════════')
const fail = (unproven.length ? 1 : 0) + (orphans.length ? 1 : 0)
console.log(`  2 แถว: ผ่าน ${2 - fail} · ตก ${fail}`)
process.exit(fail ? 1 : 0)
