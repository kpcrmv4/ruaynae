#!/usr/bin/env node
/**
 * make-icons.mjs — สร้างไอคอนแอปและโลโก้เป็น PNG/ICO จริง
 *
 * 🔴 ทำไมไม่ใช้ SVG ในไฟล์ manifest: Safari/iOS ไม่รองรับ SVG ใน manifest
 * และ `apple-touch-icon` ต้องเป็น PNG เท่านั้น · ใช้ SVG อย่างเดียวแปลว่า
 * ไอโฟนติดตั้งแอปแล้วได้ไอคอนเปล่า ซึ่งไม่มีใครสังเกตจนกว่าจะมีคนใช้ไอโฟน
 *
 * 🔴 ไม่พึ่งไลบรารีนอก — เขียน PNG เองด้วย zlib ที่มากับ Node
 * ไอคอนของแอปไม่ควรเป็นเหตุผลที่ต้องเพิ่ม dependency
 *
 * เครื่องหมายของ RUAYNAE: ตัวอาคาร/บ้านสีขาวบนพื้นเขียว `--brand-solid`
 * (#047857) ซึ่งเป็นสีเดียวกับปุ่มหลักในแอป และผ่าน AA กับตัวขาวที่ 5.48:1
 *
 * 🔴 วาดด้วย supersampling 4×4 ไม่ใช่ mask 1 บิต · ขอบทแยงของหลังคาที่ไม่มี
 * anti-alias จะเป็นฟันปลาชัดเจนที่ 32px และ 16px ซึ่งเป็นขนาดที่ favicon
 * ถูกใช้จริงบนแท็บเบราว์เซอร์ — ขนาดที่คนเห็นบ่อยที่สุดคือขนาดที่แย่ที่สุด
 *
 * ใช้: node scripts/make-icons.mjs [โฟลเดอร์ปลายทาง]
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

/** พื้น = --brand-solid · ตัวเครื่องหมาย = ขาว (คู่นี้ผ่าน AA 5.48:1) */
const GREEN = [0x04, 0x78, 0x57]
const WHITE = [0xff, 0xff, 0xff]

/** กี่ตัวอย่างต่อด้านของหนึ่งพิกเซล — 4 ให้ 16 ระดับ พอสำหรับขอบหลังคา */
const SS = 4

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

/**
 * เครื่องหมาย: หลังคาทรงจั่ว + ตัวอาคาร + ช่องประตูเจาะทะลุถึงพื้น
 *
 * พิกัดเป็นสัดส่วน 0..1 ของด้านกว้าง ไม่ใช่พิกเซล — ทุกขนาดจึงได้รูปเดียวกัน
 * กว้างสุด 0.14..0.86 = 72% ของกรอบ ซึ่งอยู่ในเขตปลอดภัยของไอคอน maskable
 * (ระบบปฏิบัติการครอบมุมได้ถึง 10% ต่อด้าน) — ล้นเขตนี้แล้วแอนดรอยด์จะตัด
 * ปีกหลังคาหายไปเฉพาะบนเครื่องที่ครอบเป็นวงกลม
 *
 * คืน `true` = จุดนี้เป็นสีขาว
 */
function isMark(u, v) {
  // ── ประตู — เจาะก่อน เพราะต้องชนะทั้งตัวอาคาร
  if (u >= 0.435 && u <= 0.565 && v >= 0.60 && v <= 0.82) return false

  // ── หลังคาทรงจั่ว: สามเหลี่ยม (0.5, 0.17) → (0.14, 0.47) → (0.86, 0.47)
  if (v >= 0.17 && v <= 0.47) {
    // ครึ่งความกว้างโตเป็นเส้นตรงจากยอดลงมาถึงชายคา
    const half = ((v - 0.17) / (0.47 - 0.17)) * 0.36
    if (Math.abs(u - 0.5) <= half) return true
  }

  // ── ตัวอาคาร — สอบเข้าเล็กน้อยให้ชายคายื่นออกมาเห็นชัด
  if (v > 0.47 && v <= 0.82 && u >= 0.255 && u <= 0.745) return true

  return false
}

/** ค่าความเป็นสีขาวของหนึ่งพิกเซล 0..1 จากการสุ่มตัวอย่าง SS×SS จุด */
function coverage(x, y, size) {
  let hit = 0
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const u = (x + (sx + 0.5) / SS) / size
      const v = (y + (sy + 0.5) / SS) / size
      if (isMark(u, v)) hit++
    }
  }
  return hit / (SS * SS)
}

/**
 * @param size  ด้านกว้างเป็นพิกเซล
 * @param rgba  เขียนช่องอัลฟาด้วยหรือไม่
 *
 * 🔴 `rgba` ไม่ใช่ตัวเลือกเพื่อความสวย — **PNG ที่ฝังใน .ico ต้องเป็น RGBA**
 * ตัวถอดรหัสของ Next (crate `image` ของ Rust) ปฏิเสธ ICO ที่ข้างในเป็น PNG
 * แบบ truecolor ด้วยข้อความ `The PNG is not in RGBA format!` แล้ว **ทั้งหน้า
 * ตอบ 500** เพราะ `src/app/favicon.ico` ถูกประมวลผลตอน build ไม่ใช่แค่เสิร์ฟ
 * ทิ้งไว้เฉย ๆ · อาการคือเว็บทั้งเว็บล่มเพราะไฟล์ไอคอน ซึ่งเดาไม่ถูกเลย
 * ถ้าไม่ได้อ่าน log · ไอคอนของเรานั้นทึบทั้งใบ อัลฟาจึงเป็น 255 ทุกพิกเซล
 */
function png(size, rgba = false) {
  const ch = rgba ? 4 : 3
  const raw = Buffer.alloc(size * (size * ch + 1))
  let p = 0
  for (let y = 0; y < size; y++) {
    raw[p++] = 0 // filter type 0 ต่อแถว
    for (let x = 0; x < size; x++) {
      const a = coverage(x, y, size)
      // ผสมในปริภูมิ sRGB ตรง ๆ — ขอบยาว ๆ ของรูปทึบแบบนี้ตาไม่จับความต่าง
      // จากการผสมแบบ linear และการทำ linear ต้องแปลงกลับไปกลับมาทุกพิกเซล
      for (let i = 0; i < 3; i++) raw[p++] = Math.round(WHITE[i] * a + GREEN[i] * (1 - a))
      if (rgba) raw[p++] = 0xff
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8          // bit depth
  ihdr[9] = rgba ? 6 : 2   // color type: 6 = truecolor+alpha · 2 = truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * ICO ที่ห่อ PNG ไว้ข้างใน — เบราว์เซอร์ทุกตัวที่ยังมีคนใช้อ่านได้
 * ใส่สามขนาดเพราะแท็บ, บุ๊กมาร์ก และทางลัดบนเดสก์ท็อปเลือกไม่เท่ากัน
 */
function ico(sizes) {
  const imgs = sizes.map((s) => png(s, true))   // RGBA บังคับ — ดูคอมเมนต์ของ png()
  const head = Buffer.alloc(6)
  head.writeUInt16LE(0, 0)          // reserved
  head.writeUInt16LE(1, 2)          // type 1 = icon
  head.writeUInt16LE(sizes.length, 4)
  let offset = 6 + 16 * sizes.length
  const dir = sizes.map((s, i) => {
    const e = Buffer.alloc(16)
    e[0] = s >= 256 ? 0 : s         // 0 หมายถึง 256 ตามสเปก
    e[1] = s >= 256 ? 0 : s
    e[2] = 0                        // จำนวนสีในพาเลต — 0 = ไม่ใช้พาเลต
    e[3] = 0                        // reserved
    e.writeUInt16LE(1, 4)           // planes
    e.writeUInt16LE(32, 6)          // bit count (ตัวอ่านข้าม เพราะข้างในเป็น PNG)
    e.writeUInt32LE(imgs[i].length, 8)
    e.writeUInt32LE(offset, 12)
    offset += imgs[i].length
    return e
  })
  return Buffer.concat([head, ...dir, ...imgs])
}

const OUT = process.argv[2] ?? 'public/icons'
mkdirSync(OUT, { recursive: true })

/** ชื่อไฟล์ → ขนาด · ชื่อพวกนี้ถูกอ้างใน layout.tsx และ manifest route ตรงตัว */
const PNGS = {
  'icon-192.png': 192,
  'icon-512.png': 512,
  'apple-touch-icon.png': 180,
  'favicon-96x96.png': 96,
  'logo.png': 512,
}
for (const [name, size] of Object.entries(PNGS)) {
  writeFileSync(`${OUT}/${name}`, png(size))
  console.log(`  ✅ ${OUT}/${name} (${size}×${size})`)
}
writeFileSync(`${OUT}/favicon.ico`, ico([16, 32, 48]))
console.log(`  ✅ ${OUT}/favicon.ico (16 · 32 · 48)`)
