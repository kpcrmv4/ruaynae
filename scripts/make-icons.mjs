#!/usr/bin/env node
/**
 * make-icons.mjs — สร้างไอคอน PWA เป็น PNG จริง
 *
 * 🔴 ทำไมไม่ใช้ SVG ในไฟล์ manifest: Safari/iOS ไม่รองรับ SVG ใน manifest
 * และ `apple-touch-icon` ต้องเป็น PNG เท่านั้น · ใช้ SVG อย่างเดียวแปลว่า
 * ไอโฟนติดตั้งแอปแล้วได้ไอคอนเปล่า ซึ่งไม่มีใครสังเกตจนกว่าจะมีคนใช้ไอโฟน
 *
 * 🔴 ไม่พึ่งไลบรารีนอก — เขียน PNG เองด้วย zlib ที่มากับ Node
 * ไอคอนของแอปไม่ควรเป็นเหตุผลที่ต้องเพิ่ม dependency
 *
 * รูป: พื้นกรมท่า (--sidebar #12213f) + หมวกนิรภัยสีขาว
 * เปลี่ยนเป็นโลโก้จริงได้เมื่อเจ้าของส่งไฟล์มา — ดูเช็คลิสต์ก่อนส่งมอบ
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const NAVY = [0x12, 0x21, 0x3f]
const WHITE = [0xff, 0xff, 0xff]

const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** วาดหมวกนิรภัยแบบเรียบ ๆ: โดมครึ่งวงรี + ปีกหมวก */
function isHat(x, y, size) {
  const cx = size / 2
  // ปีกหมวก — แถบแนวนอนมุมโค้ง
  const brimY = size * 0.62
  const brimH = size * 0.085
  if (y >= brimY && y <= brimY + brimH) {
    const halfW = size * 0.34
    if (Math.abs(x - cx) <= halfW) return true
  }
  // โดม — ครึ่งวงรีบนปีกหมวก
  const ry = size * 0.3
  const rx = size * 0.25
  if (y < brimY) {
    const dx = (x - cx) / rx
    const dy = (y - brimY) / ry
    if (dx * dx + dy * dy <= 1) return true
  }
  return false
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1))
  let p = 0
  for (let y = 0; y < size; y++) {
    raw[p++] = 0 // filter type 0 ต่อแถว
    for (let x = 0; x < size; x++) {
      const c = isHat(x, y, size) ? WHITE : NAVY
      raw[p++] = c[0]
      raw[p++] = c[1]
      raw[p++] = c[2]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 2   // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync('public/icons', { recursive: true })
for (const size of [192, 512, 180]) {
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`
  writeFileSync(`public/icons/${name}`, png(size))
  console.log(`  ✅ public/icons/${name} (${size}×${size})`)
}
