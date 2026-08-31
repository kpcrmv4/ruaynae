import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKey, isValidKey, hashKey, keyPrefix } from '../../src/lib/mcp/keys-core.ts'
import { clampLimit, clampOffset, parseIsoDate, pickEnum } from '../../src/lib/mcp/args-core.ts'
import { searchTerms } from '../../src/lib/search-core.ts'
import { hashPin, derivePassword } from '../../src/lib/pin-core.ts'

test('คีย์ที่สร้างขึ้นผ่านตัวตรวจเสมอ', () => {
  for (let i = 0; i < 200; i += 1) assert.ok(isValidKey(generateKey()))
})

test('ตัวตรวจปฏิเสธของที่ไม่ใช่คีย์', () => {
  for (const bad of ['', 'k_', 'abc', 123, null, undefined, 'k_' + 'a'.repeat(42),
                     'k_' + 'a'.repeat(44), 'k_aaaa+aaa/aaa=', ' k_' + 'a'.repeat(43)]) {
    assert.equal(isValidKey(bad), false, `ควรปฏิเสธ: ${String(bad)}`)
  }
})

test('hash เดิมได้ค่าเดิม — จำเป็นเพราะต้องหาแถวจาก hash', () => {
  const k = generateKey()
  assert.equal(hashKey('pepper', k), hashKey('pepper', k))
})

test('pepper ต่างกัน hash ต่างกัน', () => {
  const k = generateKey()
  assert.notEqual(hashKey('pepper-a', k), hashKey('pepper-b', k))
})

// 🔴 แถวที่สำคัญที่สุดของไฟล์นี้ — ฐานข้อมูลที่รั่วต้องไม่กลายเป็นรายการคีย์พร้อมใช้
test('โดเมนของ MCP ต้องไม่ชนกับ PIN หรือรหัสผ่าน', () => {
  const same = '123456'
  assert.notEqual(hashKey('p', same), hashPin('p', same))
  assert.notEqual(hashKey('p', same), derivePassword('p', same))
})

test('key_prefix เป็นคำนำหน้าของคีย์จริงและยาวคงที่', () => {
  const k = generateKey()
  assert.equal(keyPrefix(k).length, 10)
  assert.ok(k.startsWith(keyPrefix(k)))
})

test('clampLimit กันค่าที่โมเดลส่งมามั่ว', () => {
  assert.equal(clampLimit(undefined, 30, 100), 30)
  assert.equal(clampLimit(0, 30, 100), 1)
  assert.equal(clampLimit(-5, 30, 100), 1)
  assert.equal(clampLimit(9999, 30, 100), 100)
  assert.equal(clampLimit('50', 30, 100), 50)
  assert.equal(clampLimit('ห้าสิบ', 30, 100), 30)
  assert.equal(clampLimit(12.7, 30, 100), 12)
})

test('clampOffset ไม่ยอมให้ติดลบ', () => {
  assert.equal(clampOffset(undefined), 0)
  assert.equal(clampOffset(-1), 0)
  assert.equal(clampOffset('20'), 20)
})

// 🔴 ปี พ.ศ. ที่หลุดลงฐานข้อมูลทำให้วันที่เพี้ยน 543 ปีโดยไม่มี error
test('ปฏิเสธปี พ.ศ. และวันที่ที่ไม่มีจริง', () => {
  assert.equal(parseIsoDate('2026-03-15'), '2026-03-15')
  assert.equal(parseIsoDate('2569-03-15'), null)
  assert.equal(parseIsoDate('2026-02-31'), null)
  assert.equal(parseIsoDate('15/03/2026'), null)
  assert.equal(parseIsoDate(''), null)
  assert.equal(parseIsoDate(undefined), null)
})

test('pickEnum รับเฉพาะค่าที่อยู่ในรายการ', () => {
  assert.equal(pickEnum('active', ['active', 'done']), 'active')
  assert.equal(pickEnum('ACTIVE', ['active', 'done']), null)
  assert.equal(pickEnum('ลบทิ้ง', ['active', 'done']), null)
})

// 🔴 คอมมาในคำค้นเคยกลายเป็นเงื่อนไขที่สองของ PostgREST
test('คำค้นถูกตัดเป็นคำและถอดไวลด์การ์ดทิ้ง', () => {
  assert.deepEqual(searchTerms('ร้านเจริญ, สาขาสอง'), ['ร้านเจริญ', 'สาขาสอง'])
  assert.deepEqual(searchTerms('%'), [])
  assert.deepEqual(searchTerms('a_b'), ['ab'])
  assert.equal(searchTerms('a b c d e f g h').length, 5)
})
