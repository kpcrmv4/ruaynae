# P9 · ตัวเชื่อม MCP อ่านอย่างเดียว — แผนลงมือ

> **สำหรับ agent ที่ลงมือ:** ต้องใช้ทักษะ `superpowers:subagent-driven-development`
> (แนะนำ) หรือ `superpowers:executing-plans` ทำทีละงาน · ทุกขั้นเป็น `- [ ]` ให้ติ๊กตามจริง

**Goal:** ให้เจ้าของกิจการต่อ Claude/ChatGPT เข้ากับข้อมูลของตัวเองแล้วถามคำถามที่ไม่ซ้ำเดิมได้
โดยตัวเลขที่ AI ตอบตรงกับหน้าจอแอปถึงสตางค์ และไม่มี tool ไหนเขียนข้อมูลได้

**Architecture:** เซิร์ฟเวอร์ MCP แบบ Streamable HTTP เขียนเอง (ไม่ลง SDK) รับคีย์จาก path
หรือ `Authorization: Bearer` → หาแถวใน `mcp_keys` ด้วย HMAC → เรียกฟังก์ชัน `mcp_*`
ผ่าน service-role · ฟังก์ชันพวกนี้เป็น `SECURITY DEFINER` ที่ตั้ง `request.jwt.claims`
ให้เป็นเจ้าของภายในทรานแซกชันเดียว **แล้วเรียก RPC เดิมของแอป** → สูตรเงินอยู่ที่เดียว

**Tech Stack:** Next.js 16 App Router · TypeScript · Supabase Cloud (Postgres + PostgREST)
· `node:crypto` (HMAC) · `node --test` สำหรับ logic บริสุทธิ์ · `scripts/db.mjs` สำหรับ migration

**Spec:** [`docs/superpowers/specs/2026-08-31-mcp-analytics-connector-design.md`](../specs/2026-08-31-mcp-analytics-connector-design.md)

**ต่างจากสเปกหนึ่งจุด:** สเปก §4 เขียนว่า migration "ไฟล์เดียว" — แผนนี้แยกเป็น **สองไฟล์**
(ตาราง / ฟังก์ชัน) เพราะสองงานนี้รีวิวและย้อนกลับแยกกันได้ และงานที่สองต้องพิสูจน์
ลูกเล่น GUC ให้ได้ก่อนถึงจะเดินต่อ · migration เป็น append-only อยู่แล้ว ไม่กระทบอะไร

---

## Global Constraints

ข้อบังคับทั้งหมดนี้ **ครอบทุกงานในแผน** — คัดจาก `CLAUDE.md` และสเปก ห้ามละเมิดแม้แต่งานเดียว

- **ภาษาไทยทั้งระบบ** · ไอคอน `lucide-react` **ห้าม emoji** · toast ด้วย `sonner` **ห้าม `alert()`** · confirm ด้วย `@radix-ui/react-dialog`
- **RLS เปิดทุกตาราง** ไม่มีข้อยกเว้น
- **ทุก query ที่เป็นลิสต์ต้องมี `.order()` + `.range()`** — PostgREST ตัดที่ 1,000 แถวเงียบ ๆ
- **ทุกหน้าที่แสดงข้อมูลต้องมีครบ 4 สถานะ**: โครงร่าง / ผิดพลาด+ปุ่มลองใหม่ / ว่าง / สำเร็จ · ปุ่มที่กำลังทำงาน disable พร้อมสปินเนอร์
- **destructure `error` จากทุก call ของ Supabase** — error ที่ไม่ถูกเช็คคือการเขียนที่เงียบหายไป
- **ทุก endpoint ต้องมีปุ่มในหน้าจอที่เรียกมันจริง** และ role ที่อนุญาตต้องตรงกับที่ปุ่มนั้นอยู่
- **ฐานข้อมูลเก็บปี ค.ศ. เสมอ** — พ.ศ. เป็นเรื่องของการแสดงผลเท่านั้น · แปลงที่ชั้นแสดงผลอย่างเดียว
- **ทุกวันที่ผูก `Asia/Bangkok` แบบชัดเจน** — `timeZone:` ในทุก formatter · `at time zone 'Asia/Bangkok'` ตอนแบ่งวัน
- ไฟล์ **< 800 บรรทัด** · อัปเดตแบบ immutable · **ไม่มี `console.log` ใน production** (`console.error` ได้)
- **Windows: ห้ามแก้ไฟล์ที่มีข้อความไทยผ่าน PowerShell pipe** (PS 5.1 ทำให้เพี้ยนเงียบ ๆ) — ใช้ Edit/Write tool
- **`npm run typecheck` และ `npm run build` ต้องเขียวก่อน commit ทุกครั้ง** · conventional commits · **ไม่ใส่ attribution footer**
- **ห้าม `cat` ไฟล์ env** — ดูได้แค่ชื่อคีย์ (`cut -d= -f1 .env.local`)
- role เจ้าของเช็คใน **`layout.tsx` ไม่ใช่ `page.tsx`** (`loading.tsx` กลืนรหัสสถานะของ `redirect()`)

### กติกาการ import ที่ต่างกันสองฝั่ง — ผิดแล้วพังคนละแบบ

| อยู่ที่ไหน | เขียนยังไง | เหตุผล |
|---|---|---|
| `src/**` | `@/lib/mcp/keys-core` — **ไม่ใส่นามสกุล** | `tsconfig` ไม่ได้เปิด `allowImportingTsExtensions` |
| `scripts/**.mjs` · `tests/unit/**.mjs` | `../../src/lib/mcp/keys-core.ts` — **ใส่ `.ts` และเป็น path สัมพัทธ์** | node ไม่รู้จัก `@/` และ type stripping ต้องการนามสกุลจริง (ดู `scripts/seed-users.mjs:13`) |

→ ไฟล์ `*-core.ts` ทุกตัว **ห้าม import `@/…` และห้าม import `server-only`** ไม่งั้น node โหลดไม่ได้

### กติกาความปลอดภัยเฉพาะเฟสนี้

- **401 ห้ามมี header `WWW-Authenticate` เด็ดขาด** — มีเมื่อไหร่ client จะเข้าใจว่าให้เริ่ม OAuth discovery แล้ว connector ค้างหลังปุ่ม Connect ถาวร
- **ห้าม `select *` ในฟังก์ชัน `mcp_*`** — เลือกคอลัมน์เป็นรายชื่อเสมอ · `select *` วันนี้ปลอดภัย แต่วันที่มีคนเพิ่มคอลัมน์ `client_email` มันจะไหลออกเองโดยไม่มีใครแตะไฟล์นี้
- **ไม่ออก header `Mcp-Session-Id`** — stateless คือสิ่งที่ทำให้มันรอดบน serverless
- **ห้ามบันทึกพารามิเตอร์ของ tool ลง `mcp_call_log`** — คำค้นอาจมีชื่อลูกค้า และ log นี้ลบไม่ได้

---

## โครงไฟล์

| ไฟล์ | รับผิดชอบอะไร |
|---|---|
| `supabase/migrations/20260901000000_p9_mcp_tables.sql` | ตาราง `mcp_keys` + `mcp_call_log` + RLS + index + แก้ `audit_row()` |
| `supabase/migrations/20260901010000_p9_mcp_functions.sql` | `mcp_assume_owner()` + ฟังก์ชัน `mcp_*` 6 ตัว คืน `jsonb` |
| `src/lib/search-core.ts` | `searchTerms()` — **ย้ายออกมาจาก `ledger/page.tsx`** ให้ ledger กับ MCP ใช้ร่วมกัน |
| `src/lib/mcp/keys-core.ts` | สร้าง/ตรวจ/hash คีย์ — บริสุทธิ์ ไม่อ่าน env ไม่แตะ DB |
| `src/lib/mcp/args-core.ts` | ตรวจและ clamp พารามิเตอร์ของ tool — บริสุทธิ์ |
| `src/lib/mcp/keys.ts` | ผูก pepper จาก env + หาแถวคีย์ + rate limit + เขียน log |
| `src/lib/mcp/tools.ts` | นิยาม 7 tool + `inputSchema` + ข้อความ `get_metric_definitions` |
| `src/lib/mcp/execute.ts` | เรียก `mcp_*` ผ่าน admin client แล้วคืน jsonb |
| `src/lib/mcp/handler.ts` | กติกา JSON-RPC + กติกา HTTP |
| `src/app/api/mcp/route.ts` · `src/app/api/mcp/[key]/route.ts` | สองทางเข้า handler เดียว |
| `src/app/api/settings/mcp-keys/route.ts` · `[id]/route.ts` | สร้าง / เพิกถอนคีย์ (เจ้าของ) |
| `src/app/(app)/mcp/{layout,loading,page}.tsx` + `mcp-client.tsx` | หน้าจอ |
| `src/components/shell/nav.ts` | กลุ่มเมนู `เชื่อมต่อ` |
| `tests/unit/mcp-core.test.mjs` | ทดสอบ logic บริสุทธิ์ |
| `scripts/verify-mcp.mjs` | ตรวจรับ 13 แถว |
| `docs/test-plan/P9.md` | ตารางตรวจรับ |

---

## Task 1: ตารางตรวจรับ P9 (เขียนก่อนโค้ด)

`CLAUDE.md` §14 บังคับว่าทุกเฟสเขียน acceptance matrix ก่อนเขียนโค้ด
และ §17 ข้อ 10 ห้ามปิดเฟสโดยเหลือ `☐` — ปิดไม่ได้ต้องเป็น `👤`/`⚠️` พร้อมเหตุผล

**Files:**
- Create: `docs/test-plan/P9.md`

**Interfaces:**
- Produces: รหัสแถว `P9-DB-*` `P9-FN-*` `P9-PROTO-*` `P9-TOOL-*` `P9-SEC-*` `P9-UI-*`
  ที่ Task 12 (`verify-mcp.mjs`) ต้องพิมพ์ออกมาให้ตรงตัวอักษร

- [ ] **Step 1: เขียนไฟล์ตามรูปแบบเดียวกับ `docs/test-plan/P7.md`**

ต้องมีครบ: หัวข้อ · คำอธิบายสัญลักษณ์ (`☐ ✅ ❌ 👤 ⚠️`) · หมวด "0 · สำรวจพื้นผิว" ที่นับ
route/endpoint×method/role/ตาราง/ปุ่ม แล้วประกาศอัตราส่วนที่ต้องปิด · ตารางแถวที่มีคอลัมน์
`ID | Trigger | Role | UI | UX | API | DB | สถานะ` · **ทุกแถวขึ้นต้นสถานะเป็น `☐`**

แถวที่ต้องมีอย่างน้อย (ตรงกับ §11 ของสเปก):

| กลุ่ม | แถว |
|---|---|
| `P9-DB` | RLS ของ `mcp_keys` ปิดหัวหน้าไซต์และ anon · `key_hash` unique · audit trigger ติด · `audit_row()` ตัดทั้ง `pin_hash` และ `key_hash` · `mcp_call_log` ไม่มี policy ให้ UPDATE/DELETE |
| `P9-FN` | `mcp_*` ทุกตัว `anon`/`authenticated` เรียกไม่ได้ · `p_actor` ที่ไม่ใช่เจ้าของ → exception · **ตัวเลขจาก `mcp_sites` = `site_money` ถึงสตางค์ทุกไซต์** · `mcp_overview` = `site_overview` |
| `P9-PROTO` | `initialize` สะท้อน `protocolVersion` · `tools/list` ได้ 7 ตัว · `resources/list` และ `resources/templates/list` = `[]` · notification → 202 บอดี้ว่าง · `GET` → 405 + `Allow: POST` · **401 ไม่มี `WWW-Authenticate`** · ไม่มี `Mcp-Session-Id` |
| `P9-TOOL` | ทุก tool ตอบ 200 และ parse เป็น JSON ได้ · `get_metric_definitions` มีคำว่า "ไม่นับซ้ำ" · `search_transactions` มี `total_count` · คีย์ผิด/หมดสิทธิ์ → `isError: true` ไม่ใช่ JSON-RPC error |
| `P9-SEC` | คีย์ที่เพิกถอนแล้ว → 401 · rate limit → 429 · **ไม่มีฟิลด์ blocklist หลุด** · **นับแถวทุกตารางก่อน/หลังยิงครบทุก tool แล้วเท่าเดิม** · ทุก call ลง `mcp_call_log` |
| `P9-UI` | หัวหน้าไซต์เปิด `/mcp` → เด้ง (ไม่ใช่ 200) · anon → เด้ง login · ครบ 4 สถานะ · เตือน origin เป็น localhost · เพิกถอนแล้วแถวหายจากตาราง |
| `P9-SHIP` | **`👤` ต่อจาก claude.ai จริงแล้วถามคำถามได้** — ปิดในเครื่องไม่ได้ Claude เรียกจากคลาวด์ `localhost` ไม่มีทางถึง และ `LOOP.md` ยังไม่อนุญาตให้ deploy/เปิด tunnel · เขียนขั้นตอนที่เจ้าของต้องกดตอน deploy ไว้ในช่อง |

- [ ] **Step 2: ตรวจว่าไม่มีแถวไหนเขียนเกณฑ์เป็นร้อยแก้ว**

ทุกช่องต้องเป็นสิ่งที่ **วัดได้** เช่น `= 405 และ header Allow เป็น POST`
ไม่ใช่ `ทำงานถูกต้อง` หรือ `ปลอดภัย` · เกณฑ์ที่วัดไม่ได้คือแถวที่ติ๊กผ่านได้ตลอดกาล

- [ ] **Step 3: Commit**

```bash
git add docs/test-plan/P9.md
git commit -m "docs(p9): ตารางตรวจรับตัวเชื่อม MCP — เขียนก่อนโค้ด"
```

---

## Task 2: logic บริสุทธิ์ + ย้าย searchTerms ออกจาก ledger

**Files:**
- Create: `src/lib/mcp/keys-core.ts`
- Create: `src/lib/mcp/args-core.ts`
- Create: `src/lib/search-core.ts`
- Modify: `src/app/(app)/ledger/page.tsx` (ลบ `searchTerms` ที่เขียนไว้ในไฟล์ แล้ว import แทน)
- Test: `tests/unit/mcp-core.test.mjs`

**Interfaces:**
- Produces:
  - `generateKey(): string` · `isValidKey(v: unknown): v is string` · `hashKey(pepper: string, key: string): string` · `keyPrefix(key: string): string` · `KEY_PREFIX_LENGTH: number`
  - `clampLimit(raw: unknown, def: number, max: number): number` · `clampOffset(raw: unknown): number` · `parseIsoDate(raw: unknown): string | null` · `pickEnum<T extends string>(raw: unknown, allowed: readonly T[]): T | null`
  - `searchTerms(raw: string): string[]`

- [ ] **Step 1: เขียนเทสที่ยังต้องตก**

`tests/unit/mcp-core.test.mjs`:

```js
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
```

- [ ] **Step 2: รันให้เห็นว่าตก**

```bash
node --test "tests/unit/*.test.mjs"
```

คาดหวัง: ตกทุกข้อ ด้วย `Cannot find module … keys-core.ts`

> 🔴 **บนเครื่องนี้ `node --test tests/unit` (ชี้ที่โฟลเดอร์) ตกโดยไม่บอกสาเหตุ**
> ต้องใช้ **glob ในเครื่องหมายคำพูด** เท่านั้น · วัดแล้วบน Node v26.2.0 / Windows

- [ ] **Step 3: เขียน `src/lib/mcp/keys-core.ts`**

```ts
import { createHmac, randomBytes } from 'node:crypto'

/**
 * คีย์ของตัวเชื่อม MCP — สูตรอยู่ที่เดียว ใช้ทั้งฝั่งแอปและสคริปต์ตรวจ
 *
 * ไฟล์นี้ **ไม่มี** `server-only` และ **ไม่อ่าน env** เพราะสคริปต์ node ธรรมดา
 * ต้อง import ได้ · ตัวที่ผูกกับ env คือ `keys.ts` (แบบเดียวกับ pin-core.ts / pin.ts)
 */

/** จำนวนตัวอักษรหลัง `k_` ที่เก็บไว้โชว์ในตาราง */
export const KEY_PREFIX_LENGTH = 8

/** 32 ไบต์ → base64url ได้ 43 ตัวพอดี ไม่มี padding */
const KEY_RE = /^k_[A-Za-z0-9_-]{43}$/

export const isValidKey = (v: unknown): v is string => typeof v === 'string' && KEY_RE.test(v)

/** `k_` ข้างหน้าไว้ให้คนที่เจอค่านี้ใน log รู้ทันทีว่ามันคืออะไร */
export const generateKey = (): string => `k_${randomBytes(32).toString('base64url')}`

/**
 * 🔴 โดเมน `'mcp-key'` ต้องต่างจาก `'pin-lookup'` และ `'auth-password'` เสมอ
 * ถ้าใช้สูตรเดียวกัน ค่าที่รั่วจากฐานข้อมูลจะกลายเป็นของพร้อมใช้ทันที
 * (เหตุผลเดียวกับที่ `pin-core.ts` แยกโดเมนไว้ — CLAUDE.md §11)
 *
 * deterministic โดยตั้งใจ ไม่ใช่ bcrypt: ต้อง **หาแถวจากคีย์ที่ส่งมา** และต้องมี
 * unique index กันคีย์ซ้ำ · salt สุ่มทุกครั้งทำทั้งสองอย่างไม่ได้
 * ปลอดภัยพอเพราะ pepper อยู่ใน env ไม่ได้อยู่ในฐานข้อมูล และคีย์มี 256 บิต
 */
export const hashKey = (pepper: string, key: string): string =>
  createHmac('sha256', pepper).update(`mcp-key:${key}`).digest('hex')

/** ส่วนที่โชว์ได้ — เปิด 8 ตัวยังเหลือให้เดาอีก 35 ตัว (วิธีเดียวกับที่ GitHub ใช้) */
export const keyPrefix = (key: string): string => key.slice(0, 2 + KEY_PREFIX_LENGTH)
```

- [ ] **Step 4: เขียน `src/lib/search-core.ts` แล้วให้ ledger ใช้ตัวนี้**

ย้ายฟังก์ชัน `searchTerms` ออกมาจาก `src/app/(app)/ledger/page.tsx` **ทั้งก้อนพร้อมคอมเมนต์**
(ไฟล์เดิมบรรทัด 17–33) แล้วในไฟล์ ledger ลบของเดิมทิ้ง เปลี่ยนเป็น
`import { searchTerms } from '@/lib/search-core'`

```ts
/**
 * แยกคำค้นเป็นคำ ๆ แล้วค้นแบบ **ต้องเจอทุกคำ**
 *
 * 🔴 ไม่ใช้ `.or()` กับช่องค้นหาเลย — คอมมาเป็นตัวคั่นเงื่อนไขของ PostgREST
 * คนพิมพ์ `ร้านเจริญ, สาขาสอง` จะกลายเป็นสองเงื่อนไขโดยไม่มี error
 * · แปลงคอมมาเป็น **ตัวคั่นคำ** แทน แล้วต่อ `.ilike()` ทีละคำ ซึ่ง PostgREST
 * เอามา AND กันให้เอง · ได้ผลพลอยได้คือค้นข้ามคำได้ ไม่ต้องพิมพ์ติดกันเป๊ะ
 * (ตัดคอมมาเป็นช่องว่างเฉย ๆ ไม่พอ — `%a  b%` ไม่แมตช์ `a, b`)
 *
 * `%` กับ `_` เป็นไวลด์การ์ดของ ilike — ปล่อยผ่านแล้วคนพิมพ์ `%` จะได้ทุกแถว
 *
 * อยู่ในไฟล์ของตัวเองเพราะ **หน้า /ledger กับ tool `search_transactions` ของ MCP
 * ต้องค้นเหมือนกันเป๊ะ** — คัดลอกไปไว้สองที่เมื่อไหร่ วันหนึ่งผลลัพธ์จะต่างกัน
 * แล้วเจ้าของจะเจอว่าถาม AI ได้คำตอบนึง เปิดหน้าจอเห็นอีกอย่างนึง
 */
export const searchTerms = (raw: string): string[] =>
  raw
    .slice(0, 60)
    .split(/[\s,]+/)
    .map((t) => t.replace(/[%_()\\]/g, '').trim())
    .filter((t) => t.length > 0)
    .slice(0, 5)
```

- [ ] **Step 5: เขียน `src/lib/mcp/args-core.ts`**

```ts
/**
 * ตรวจพารามิเตอร์ที่ **โมเดลภาษาเป็นคนกรอก** — ไม่ใช่ฟอร์มที่คนกด
 *
 * โมเดลส่ง `limit: "ทั้งหมด"`, `limit: 100000`, `from: "2569-01-01"` มาได้หมด
 * และมันจะไม่รู้ตัวว่าผิดถ้าเราปล่อยผ่าน · ทุกอย่างต้องถูกบีบให้อยู่ในกรอบ
 * ก่อนแตะฐานข้อมูล ไม่ใช่หวังว่า schema จะกันให้
 */

/** ปีที่อยู่นอกช่วงนี้คือ พ.ศ. แน่นอน (เทียบกับ `parseDate` ใน lib/sites.ts) */
const YEAR_MIN = 1900
const YEAR_MAX = 2200

export function clampLimit(raw: unknown, def: number, max: number): number {
  if (raw === null || raw === undefined || raw === '') return def
  const n = Number(raw)
  if (!Number.isFinite(n)) return def
  return Math.min(Math.max(Math.trunc(n), 1), max)
}

export function clampOffset(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 0
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.min(Math.max(Math.trunc(n), 0), 100_000)
}

/**
 * รับเฉพาะ `YYYY-MM-DD` ที่เป็น ค.ศ. และมีอยู่จริงในปฏิทิน
 *
 * 🔴 `2569-03-15` ถูกไวยากรณ์ของ Postgres ทุกประการ มันจะรับไว้เงียบ ๆ
 * แล้ววันที่เพี้ยนไป 543 ปีโดยไม่มี error ที่ไหนเลย
 * 🔴 `new Date('2026-02-31')` ไม่พังแต่เลื่อนเป็น 3 มี.ค. — ต้องเทียบกลับ
 */
export function parseIsoDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null

  const year = Number(m[1])
  if (year < YEAR_MIN || year > YEAR_MAX) return null

  const dt = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(dt.getTime())) return null
  if (dt.getUTCMonth() + 1 !== Number(m[2]) || dt.getUTCDate() !== Number(m[3])) return null
  return s
}

/** ค่าที่ไม่อยู่ในรายการคืน `null` = "ไม่กรอง" ไม่ใช่ "กรองด้วยค่าที่โมเดลแต่งขึ้น" */
export function pickEnum<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  if (typeof raw !== 'string') return null
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null
}
```

- [ ] **Step 6: รันเทสให้ผ่าน**

```bash
node --test "tests/unit/*.test.mjs"
```

คาดหวัง: `pass 11 · fail 0`

- [ ] **Step 7: typecheck + build**

```bash
npm run typecheck && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/mcp/keys-core.ts src/lib/mcp/args-core.ts src/lib/search-core.ts \
        "src/app/(app)/ledger/page.tsx" tests/unit/mcp-core.test.mjs
git commit -m "feat(p9): logic คีย์ MCP + ย้าย searchTerms ให้ ledger กับ MCP ใช้ร่วมกัน"
```

---

## Task 3: migration ตาราง + แก้ audit_row

**Files:**
- Create: `supabase/migrations/20260901000000_p9_mcp_tables.sql`
- Modify: `src/lib/database.types.ts` (สร้างใหม่อัตโนมัติ)

**Interfaces:**
- Produces: ตาราง `public.mcp_keys(id, label, key_hash, key_prefix, created_by, created_at, last_used_at, revoked_at)`
  · `public.mcp_call_log(id, key_id, tool, ok, ms, error, at)`

- [ ] **Step 1: ยืนยันเป้าหมายก่อนแตะฐานข้อมูล**

```bash
node scripts/db.mjs query "select current_database(), now()"
```

`db.mjs` จะโยน error เองถ้า `SUPABASE_PROJECT_REF` ไม่ตรงกับ subdomain ใน
`NEXT_PUBLIC_SUPABASE_URL` — **ถ้ามัน error ห้ามแก้สคริปต์ให้ผ่าน** ให้หยุดแล้วถาม

- [ ] **Step 2: เขียนไฟล์ migration**

```sql
-- ════════════════════════════════════════════════════════════════════════
-- P9-a · ตัวเชื่อม MCP — ตารางคีย์และร่องรอยการเรียก
-- ครอบแถว P9-DB-* ใน docs/test-plan/P9.md
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · คีย์ ─────────────────────────────────────────────────────────
create table if not exists public.mcp_keys (
  id           uuid primary key default gen_random_uuid(),
  -- หนึ่งแถวต่อคน/ต่อเครื่อง — เพิกถอนทีละใบได้โดยไม่กระทบเครื่องอื่น
  label        text not null check (length(btrim(label)) > 0),
  -- HMAC-SHA256 โดเมน 'mcp-key:' + pepper จาก env (src/lib/mcp/keys-core.ts)
  -- unique เพราะเราหาแถวจากค่านี้ และคีย์ซ้ำแปลว่ามีบั๊กในตัวสุ่ม
  key_hash     text not null unique,
  -- `k_` + 8 ตัวแรก — ไว้ให้เจ้าของชี้ได้ว่าใบไหนคือใบไหน
  key_prefix   text not null,
  created_by   uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  -- 🔴 เพิกถอนด้วยการตั้งเวลา ไม่ใช่ลบแถว — mcp_call_log ยังอ้างถึงอยู่
  -- และประวัติว่าเคยมีคีย์ใบนี้คือส่วนหนึ่งของร่องรอย
  revoked_at   timestamptz
);

create index if not exists mcp_keys_active_idx
  on public.mcp_keys(created_at desc) where revoked_at is null;

alter table public.mcp_keys enable row level security;

-- เจ้าของเท่านั้น ทั้งอ่านและเขียน · หัวหน้าไซต์ไม่มีเหตุต้องต่อ AI
drop policy if exists mcp_keys_owner on public.mcp_keys;
create policy mcp_keys_owner on public.mcp_keys
  for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

drop trigger if exists mcp_keys_audit on public.mcp_keys;
create trigger mcp_keys_audit after insert or update or delete on public.mcp_keys
  for each row execute function public.audit_row();

-- ── 2 · ร่องรอยการเรียก ──────────────────────────────────────────────
create table if not exists public.mcp_call_log (
  id     uuid primary key default gen_random_uuid(),
  key_id uuid not null references public.mcp_keys(id) on delete cascade,
  tool   text not null,
  ok     boolean not null,
  ms     int,
  -- ⚠️ เก็บได้เฉพาะ **รหัสข้อผิดพลาด** ห้ามเก็บพารามิเตอร์ของ tool
  -- คำค้นของเจ้าของอาจมีชื่อลูกค้า และตารางนี้เจ้าของอ่านได้แต่ลบไม่ได้
  error  text,
  at     timestamptz not null default now()
);

-- index นี้ทำสองหน้าที่: หน้าจอ "การใช้งานล่าสุด" และตัวนับ rate limit
create index if not exists mcp_call_log_key_at_idx on public.mcp_call_log(key_id, at desc);

alter table public.mcp_call_log enable row level security;

-- อ่านได้อย่างเดียว และเฉพาะเจ้าของ · **ไม่มี policy ให้ UPDATE/DELETE กับใครทั้งนั้น**
-- ร่องรอยที่ลบได้คือร่องรอยที่ไม่มีค่า (แบบเดียวกับ audit_log)
drop policy if exists mcp_call_log_owner_read on public.mcp_call_log;
create policy mcp_call_log_owner_read on public.mcp_call_log
  for select to authenticated using ((select public.is_owner()));

-- ── 3 · audit_row ต้องตัด key_hash เพิ่มจาก pin_hash ─────────────────
-- 🔴 ฟังก์ชันนี้ **ทุกตารางในระบบใช้ร่วมกัน** — เปลี่ยนทีเดียวกระทบทั้งหมด
-- ที่เปลี่ยนคือบรรทัด `- 'pin_hash'` เท่านั้น ส่วนที่เหลือคัดลอกมาทั้งดุ้น
-- ⚠️ ห้ามลบ pin_hash ออกจากรายการตอนเพิ่ม key_hash — ทำแล้วไม่มี error
-- ให้เห็นเลย มีแต่ hash ของ PIN ทุกคนไหลลง audit_log ที่ลบไม่ได้
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_row_id text;
begin
  if tg_op = 'DELETE' then
    v_before := to_jsonb(old);
    v_after  := null;
    v_row_id := v_before->>'id';
  elsif tg_op = 'INSERT' then
    v_before := null;
    v_after  := to_jsonb(new);
    v_row_id := v_after->>'id';
  else
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    v_row_id := v_after->>'id';
  end if;

  -- ความลับที่ห้ามไหลลงตารางที่ไม่มี policy ให้ลบ
  v_before := v_before - 'pin_hash' - 'key_hash';
  v_after  := v_after  - 'pin_hash' - 'key_hash';

  insert into public.audit_log(table_name, row_id, action, actor, before, after)
  values (tg_table_name, v_row_id, tg_op, auth.uid(), v_before, v_after);

  return null;
end $$;
```

- [ ] **Step 3: ใช้ migration (จะสร้าง types ให้เองในคำสั่งเดียว)**

```bash
node scripts/db.mjs file supabase/migrations/20260901000000_p9_mcp_tables.sql
```

คาดหวัง: `✅ applied …` แล้วตามด้วย `✅ regenerated src/lib/database.types.ts (N tables)`
ที่ `N` มากกว่าเดิม 2

- [ ] **Step 4: พิสูจน์ว่า audit_row ยังตัดของเดิมอยู่ ไม่ใช่แค่ตัดของใหม่**

```bash
node scripts/db.mjs query "
  select
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='audit_row'
        and p.prosrc like '%pin_hash%' and p.prosrc like '%key_hash%') as ตัดครบสองอัน,
    (select count(*) from pg_policies where tablename='mcp_call_log' and cmd in ('UPDATE','DELETE')) as policy_ที่ไม่ควรมี,
    (select count(*) from pg_tables where tablename in ('mcp_keys','mcp_call_log') and rowsecurity) as rls_เปิด
"
```

คาดหวัง: `ตัดครบสองอัน = 1` · `policy_ที่ไม่ควรมี = 0` · `rls_เปิด = 2`

- [ ] **Step 5: advisors ต้องเขียว**

```bash
node scripts/db.mjs advisors security && node scripts/db.mjs advisors performance
```

คาดหวัง: `ERROR 0` ทั้งสองคำสั่ง · WARN ที่มีอยู่ก่อนแล้วไม่นับ แต่ **ห้ามมี WARN ใหม่
ที่ชื่อตารางเป็น `mcp_keys` หรือ `mcp_call_log`**

- [ ] **Step 6: typecheck (types เพิ่งถูกสร้างใหม่)**

```bash
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260901000000_p9_mcp_tables.sql src/lib/database.types.ts
git commit -m "feat(p9): ตาราง mcp_keys + mcp_call_log และ audit_row ที่ตัด key_hash"
```

---

## Task 4: migration ฟังก์ชัน + พิสูจน์ลูกเล่น GUC

**นี่คืองานที่เสี่ยงที่สุดในแผน** — ถ้าลูกเล่นนี้ไม่ทำงาน ต้องรู้ตอนนี้ ไม่ใช่ตอนงานที่ 8

**Files:**
- Create: `supabase/migrations/20260901010000_p9_mcp_functions.sql`
- Modify: `src/lib/database.types.ts` (สร้างใหม่อัตโนมัติ)

**Interfaces:**
- Produces (ทุกตัวคืน `jsonb` และรับ `p_actor uuid` เป็นพารามิเตอร์แรก):
  - `mcp_overview(p_actor uuid, p_on date)` → object
  - `mcp_sites(p_actor uuid, p_status text, p_limit int, p_offset int)` → array
  - `mcp_site_detail(p_actor uuid, p_site uuid)` → object
  - `mcp_transactions(p_actor uuid, p_from date, p_to date, p_kind text, p_status text, p_site uuid, p_terms text[], p_limit int, p_offset int)` → object `{ total_count, rows }`
  - `mcp_pending(p_actor uuid, p_limit int)` → object
  - `mcp_payroll(p_actor uuid, p_limit int)` → object

- [ ] **Step 1: เขียนไฟล์ migration**

```sql
-- ════════════════════════════════════════════════════════════════════════
-- P9-b · ฟังก์ชันอ่านข้อมูลของตัวเชื่อม MCP
-- ครอบแถว P9-FN-* ใน docs/test-plan/P9.md
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 ปัญหา: RPC เงินทุกตัวของแอปเป็น `security invoker` และห่อคอลัมน์เงินด้วย
-- `case when public.is_owner() then …` ซึ่งอ่าน `auth.uid()`
-- service_role ไม่มี claim `sub` → `auth.uid()` เป็น null → `is_owner()` false
-- → ทุกตัวเลขคืน null · เอา RPC เดิมมาเรียกตรง ๆ จึงได้ค่าว่างทั้งแผง
--
-- 🔴 ทางแก้: `mcp_assume_owner()` ตั้ง `request.jwt.claims` ให้เป็นเจ้าของ
-- **ภายในทรานแซกชันเดียว** (`is_local := true`) แล้วเรียก RPC เดิม
-- → สูตรเงินอยู่ที่เดียว ใครแก้ site_money ฝั่ง MCP เปลี่ยนตามเอง
--
-- ⚠️ ทุกตัวเป็น **volatile** (ไม่ใส่ stable) โดยตั้งใจ — set_config เขียน GUC
-- ถ้าประกาศ stable แล้ววันหนึ่ง planner เลือก inline หรือแคชผลจะพังแบบหาไม่เจอ

-- ── 0 · สวมสิทธิ์เจ้าของชั่วคราว ─────────────────────────────────────
create or replace function public.mcp_assume_owner(p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'MCP_ACTOR_REQUIRED';
  end if;

  -- 🔴 ขอบเขตไซต์ไม่ใช่การเช็ค role และการ "มีคีย์" ก็ไม่ใช่
  -- คีย์ที่ออกโดยคนที่ถูกลดสิทธิ์หรือปิดบัญชีไปแล้ว ต้องใช้ไม่ได้ทันที
  if not exists (
    select 1 from public.profiles
    where id = p_actor and role = 'owner' and is_active
  ) then
    raise exception 'MCP_ACTOR_NOT_OWNER';
  end if;

  -- ⚠️ ต้อง **ผสม** ไม่ใช่เขียนทับ — claims เดิมมี `role` อยู่ ถ้าทับทิ้ง
  -- `auth.role()` จะเปลี่ยนไปด้วยและอะไรที่พึ่งมันจะเพี้ยนแบบเงียบ ๆ
  perform set_config(
    'request.jwt.claims',
    (
      coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      || jsonb_build_object('sub', p_actor::text, 'role', 'authenticated')
    )::text,
    true   -- ผูกกับทรานแซกชัน หมดอายุเองเมื่อจบ
  );
end $$;

revoke execute on function public.mcp_assume_owner(uuid) from public, anon, authenticated;
grant  execute on function public.mcp_assume_owner(uuid) to service_role;

-- ── 1 · ภาพรวมบริษัท ────────────────────────────────────────────────
create or replace function public.mcp_overview(p_actor uuid, p_on date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb;
begin
  perform public.mcp_assume_owner(p_actor);
  -- 🔴 "วันนี้" ต้องเป็นวันนี้ตามเวลาไทย — เซิร์ฟเวอร์รันเป็น UTC
  -- ตอนสามทุ่มครึ่งของไทยจะกลายเป็นพรุ่งนี้ แล้วยอด "วันนี้" เพี้ยนทั้งแผง
  select to_jsonb(o) into v
  from public.site_overview(
    coalesce(p_on, (now() at time zone 'Asia/Bangkok')::date)
  ) o;
  return coalesce(v, '{}'::jsonb);
end $$;

-- ── 2 · รายชื่อไซต์พร้อมตัวเลขเงิน ──────────────────────────────────
create or replace function public.mcp_sites(
  p_actor  uuid,
  p_status text default null,
  p_limit  int  default 20,
  p_offset int  default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  n int := least(greatest(coalesce(p_limit, 20), 1), 100);   -- กันซ้ำอีกชั้น
  o int := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.mcp_assume_owner(p_actor);

  -- ❗ เลือกคอลัมน์เป็นรายชื่อ ห้าม select * — คอลัมน์ที่เพิ่มวันหน้าจะไหลออกเอง
  -- (client_phone กับ address อยู่ในตารางนี้และอยู่ใน blocklist)
  select coalesce(jsonb_agg(to_jsonb(r) order by r.name), '[]'::jsonb) into v
  from (
    select
      s.id, s.name, s.client_name, s.status, s.start_date, s.end_date,
      m.contract_amount, m.income_approved, m.income_pending,
      m.cost_expense, m.cost_wage, m.cost_total, m.cost_pending,
      -- กำไรคงเหลือนับจากต้นทุนที่เกิดขึ้นแล้ว ไม่ใช่เงินที่เก็บได้ (DESIGN.md §5.1)
      (m.contract_amount - m.cost_total) as profit_remaining
    from public.sites s
    join public.site_money(null) m on m.site_id = s.id
    where p_status is null or s.status::text = p_status
    order by s.name
    offset o limit n
  ) r;

  return v;
end $$;

-- ── 3 · ไซต์เดียวแบบละเอียด ─────────────────────────────────────────
create or replace function public.mcp_site_detail(p_actor uuid, p_site uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb;
begin
  perform public.mcp_assume_owner(p_actor);

  select jsonb_build_object(
    'site', (
      select to_jsonb(x) from (
        select s.id, s.name, s.client_name, s.status, s.start_date, s.end_date,
               m.contract_amount, m.income_approved, m.income_pending,
               m.cost_expense, m.cost_wage, m.cost_total, m.cost_pending,
               (m.contract_amount - m.cost_total) as profit_remaining
        from public.sites s
        join public.site_money(p_site) m on m.site_id = s.id
        where s.id = p_site
      ) x
    ),
    'milestones', coalesce((
      select jsonb_agg(to_jsonb(y) order by y.seq) from (
        select ms.seq, ms.name, ms.planned_amount, ms.planned_date,
               (ms.collected_txn_id is not null) as collected
        from public.site_milestones ms where ms.site_id = p_site
      ) y
    ), '[]'::jsonb),
    'supervisors_today', coalesce((
      select jsonb_agg(p.full_name order by p.full_name)
      from public.site_supervisors ss
      join public.profiles p on p.id = ss.profile_id
      where ss.site_id = p_site
        -- ⚠️ สมาชิกไซต์มีช่วงเวลา — ไม่กรองวันที่จะได้คนที่ย้ายออกไปแล้วด้วย
        and ss.effective_from <= (now() at time zone 'Asia/Bangkok')::date
        and (ss.effective_to is null
             or ss.effective_to >= (now() at time zone 'Asia/Bangkok')::date)
    ), '[]'::jsonb),
    'recent_transactions', coalesce((
      select jsonb_agg(to_jsonb(z) order by z.txn_date desc, z.id desc) from (
        select t.id, t.txn_date, t.kind, t.status, t.amount, t.pay_method,
               t.note, c.name as category
        from public.transactions t
        join public.categories c on c.id = t.category_id
        where t.site_id = p_site
        order by t.txn_date desc, t.id desc
        limit 10
      ) z
    ), '[]'::jsonb)
  ) into v;

  return coalesce(v, '{}'::jsonb);
end $$;

-- ── 4 · ค้นรายรับ-รายจ่าย ────────────────────────────────────────────
create or replace function public.mcp_transactions(
  p_actor  uuid,
  p_from   date default null,
  p_to     date default null,
  p_kind   text default null,
  p_status text default null,
  p_site   uuid default null,
  -- คำค้นมาเป็น **อาร์เรย์ที่แยกคำแล้ว** จากฝั่ง TS (searchTerms)
  -- ส่งสตริงดิบมาไม่ได้ ไม่งั้นต้องมาแยกคำซ้ำอีกที่แล้วสองที่จะเพี้ยนจากกัน
  p_terms  text[] default null,
  p_limit  int  default 30,
  p_offset int  default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  c int;
  n int := least(greatest(coalesce(p_limit, 30), 1), 100);
  o int := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.mcp_assume_owner(p_actor);

  -- นับก่อน แล้วค่อยดึงหน้า — โมเดลต้องรู้ว่ายังมีต่อ ไม่ใช่เดาจากจำนวนแถว
  select count(*) into c
  from public.transactions t
  where (p_from is null or t.txn_date >= p_from)
    and (p_to   is null or t.txn_date <= p_to)
    and (p_kind is null or t.kind::text = p_kind)
    and (p_status is null or t.status::text = p_status)
    and (p_site is null or t.site_id = p_site)
    and (p_terms is null or t.note ilike all (
          select '%' || term || '%' from unnest(p_terms) as term))
  ;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.txn_date desc, r.id desc), '[]'::jsonb)
  into v
  from (
    select
      t.id, t.txn_date, t.kind, t.status, t.amount, t.pay_method,
      t.note, t.rejected_reason, t.income_kind, t.installment_no,
      c2.name as category,
      -- site_id เป็น null = ส่วนกลาง ไม่ใช่ "ยังไม่ได้เลือก" — บอกให้ชัด
      coalesce(s.name, 'ส่วนกลาง') as site_name,
      t.site_id,
      -- ❗ จำนวนสลิปเท่านั้น ห้ามคืน object_key หรือลิงก์ — R2 ไม่มี RLS
      (select count(*) from public.attachments a where a.transaction_id = t.id) as attachment_count
    from public.transactions t
    join public.categories c2 on c2.id = t.category_id
    left join public.sites s on s.id = t.site_id
    where (p_from is null or t.txn_date >= p_from)
      and (p_to   is null or t.txn_date <= p_to)
      and (p_kind is null or t.kind::text = p_kind)
      and (p_status is null or t.status::text = p_status)
      and (p_site is null or t.site_id = p_site)
      and (p_terms is null or t.note ilike all (
            select '%' || term || '%' from unnest(p_terms) as term))
    order by t.txn_date desc, t.id desc
    offset o limit n
  ) r;

  return jsonb_build_object('total_count', c, 'returned', jsonb_array_length(v), 'rows', v);
end $$;

-- ── 5 · คิวรออนุมัติ ────────────────────────────────────────────────
create or replace function public.mcp_pending(p_actor uuid, p_limit int default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  n int := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  perform public.mcp_assume_owner(p_actor);

  select jsonb_build_object(
    'pending_count', (select count(*) from public.transactions where status = 'pending'),
    'pending_total', (select coalesce(sum(amount), 0) from public.transactions where status = 'pending'),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.txn_date, r.id) from (
        select t.id, t.txn_date, t.kind, t.amount, t.note,
               c.name as category, coalesce(s.name, 'ส่วนกลาง') as site_name,
               p.full_name as created_by_name,
               ((now() at time zone 'Asia/Bangkok')::date - t.txn_date) as days_waiting
        from public.transactions t
        join public.categories c on c.id = t.category_id
        left join public.sites s on s.id = t.site_id
        left join public.profiles p on p.id = t.created_by
        where t.status = 'pending'
        order by t.txn_date, t.id
        limit n
      ) r
    ), '[]'::jsonb)
  ) into v;

  return v;
end $$;

-- ── 6 · ค่าแรงค้างจ่ายและรอบจ่าย ────────────────────────────────────
create or replace function public.mcp_payroll(p_actor uuid, p_limit int default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  n int := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  perform public.mcp_assume_owner(p_actor);

  select jsonb_build_object(
    -- payroll_balances() เป็น security definer ที่เช็ค is_owner() ข้างใน
    -- จึงต้องสวมสิทธิ์ก่อน (ทำไปแล้วข้างบน) ไม่งั้นได้ 0 แถวโดยไม่มี error
    'balances', coalesce((
      select jsonb_agg(to_jsonb(b) order by b.full_name)
      from public.payroll_balances() b
    ), '[]'::jsonb),
    'runs', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.period_start desc) from (
        select pr.id, pr.period_start, pr.period_end, pr.status,
               coalesce(s.name, 'ทุกไซต์') as site_name,
               pr.total_accrued, pr.total_advance_deducted, pr.total_paid
        from public.payroll_runs pr
        left join public.sites s on s.id = pr.site_id
        order by pr.period_start desc
        limit n
      ) r
    ), '[]'::jsonb)
  ) into v;

  return v;
end $$;

-- ── 7 · สิทธิ์: service_role เท่านั้น ────────────────────────────────
-- 🔴 authenticated ต้องเรียกไม่ได้ — ไม่งั้นหัวหน้าไซต์ที่ล็อกอินอยู่
-- ยิง RPC ตรงจากเบราว์เซอร์แล้วได้ตัวเลขเงินทั้งบริษัท
do $$
declare f text;
begin
  foreach f in array array[
    'public.mcp_overview(uuid, date)',
    'public.mcp_sites(uuid, text, int, int)',
    'public.mcp_site_detail(uuid, uuid)',
    'public.mcp_transactions(uuid, date, date, text, text, uuid, text[], int, int)',
    'public.mcp_pending(uuid, int)',
    'public.mcp_payroll(uuid, int)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
```

- [ ] **Step 2: ใช้ migration**

```bash
node scripts/db.mjs file supabase/migrations/20260901010000_p9_mcp_functions.sql
```

- [ ] **Step 3: 🔴 พิสูจน์ว่าลูกเล่น GUC ทำงานจริง — ขั้นที่ตัดสินทั้งแผน**

```bash
node scripts/db.mjs query "
  with owner as (select id from public.profiles where role='owner' and is_active limit 1)
  select
    (select id from owner) as owner_id,
    public.mcp_overview((select id from owner))->>'active_contract'  as จาก_mcp,
    (select active_contract::text
       from public.site_overview((now() at time zone 'Asia/Bangkok')::date)) as จาก_rpc_ตรง
"
```

**คาดหวัง:** `จาก_mcp` เป็น**ตัวเลข ไม่ใช่ `null`**
· `จาก_rpc_ตรง` เป็น `null` (เพราะเรียกด้วย service_role ที่ไม่มีตัวตน) — ความต่างนี้
คือหลักฐานว่าการสวมสิทธิ์ทำงาน

**ถ้า `จาก_mcp` เป็น null:** ลูกเล่นไม่ทำงานบน Postgres รุ่นนี้ → **หยุด รายงาน แล้วสลับไป
แผนสำรองในสเปก §3.2** (คัดลอกสูตรจาก `20260831000000_p45_wage_secrecy.sql` ลงใน `mcp_*`
โดยตัด `case when is_owner()` ออก) · Task 12 แถว `P9-FN` เป็นตัวกันเพี้ยนเหมือนกันทั้งสองทาง
· **ห้ามเดินต่อโดยยังไม่รู้ว่าอันไหนใช้อยู่**

> **ทำไมไม่เขียนโค้ดรองรับ `null` ในฝั่ง TS:** สเปก §6.8 บอกว่าถ้าตัวเลขเป็น `null`
> ให้ตอบว่า "ไม่มีสิทธิ์เห็น" — แต่หลังจาก `mcp_assume_owner()` ผ่านแล้ว คนเรียก
> **เป็นเจ้าของแน่นอน** `null` จึงเกิดขึ้นไม่ได้เลยยกเว้นกรณีที่ลูกเล่นนี้พัง
> · ใส่โค้ดกลืน `null` เข้าไปเมื่อไหร่ = ปิดปากสัญญาณเดียวที่จะบอกเราว่ามันพัง
> แล้วเจ้าของจะเห็น "ไม่มีสิทธิ์เห็น" ทั้งหน้าโดยไม่มีใครรู้ว่าทำไม
> **ให้มันดังตรงนี้ ในขั้นนี้ ครั้งเดียว** ดีกว่าเงียบตลอดไป

- [ ] **Step 4: พิสูจน์ว่าคนที่ไม่ใช่เจ้าของเรียกไม่ได้**

```bash
node scripts/db.mjs query "
  select public.mcp_overview(
    (select id from public.profiles where role='site_supervisor' limit 1)
  )
"
```

คาดหวัง: **error `MCP_ACTOR_NOT_OWNER`** — ถ้าได้ข้อมูลกลับมาคือช่องโหว่ ห้ามเดินต่อ

- [ ] **Step 5: พิสูจน์ว่าสิทธิ์ถูก revoke จริง**

```bash
node scripts/db.mjs query "
  select p.proname,
         has_function_privilege('authenticated', p.oid, 'execute') as authenticated_เรียกได้,
         has_function_privilege('anon', p.oid, 'execute') as anon_เรียกได้
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname like 'mcp\\_%'
  order by 1
"
```

คาดหวัง: **7 แถว** (6 tool + `mcp_assume_owner`) และ **`false` ทุกช่อง**

- [ ] **Step 6: advisors + typecheck**

```bash
node scripts/db.mjs advisors security && npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260901010000_p9_mcp_functions.sql src/lib/database.types.ts
git commit -m "feat(p9): ฟังก์ชัน mcp_* ที่สวมสิทธิ์เจ้าของแล้วเรียก RPC เดิมของแอป"
```

---

## Task 5: ชั้นคีย์ฝั่งเซิร์ฟเวอร์

**Files:**
- Create: `src/lib/mcp/keys.ts`

**Interfaces:**
- Consumes: `keys-core.ts` (Task 2) · ตาราง `mcp_keys`/`mcp_call_log` (Task 3)
- Produces:
  - `type McpAuth = { keyId: string; actorId: string }`
  - `resolveKey(raw: string | null): Promise<McpAuth | null>`
  - `hashKeyWithPepper(key: string): string` ← **Task 9 ใช้ตัวนี้ อย่าลืม export**
  - `isRateLimited(keyId: string): Promise<boolean>`
  - `logCall(keyId: string, tool: string, ok: boolean, ms: number, error?: string): Promise<void>`
  - `RATE_PER_MINUTE = 60` · `RATE_PER_DAY = 1000`

- [ ] **Step 1: เขียนไฟล์**

```ts
import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { hashKey, isValidKey } from '@/lib/mcp/keys-core'

/**
 * คีย์ MCP ฝั่งเซิร์ฟเวอร์ — ผูกสูตรใน `keys-core.ts` เข้ากับ pepper จาก env
 *
 * 🔴 ห้ามมีค่า fallback ของ pepper เด็ดขาด — pepper ที่มีค่าเริ่มต้นแปลว่า
 * ทุก deployment ที่ลืมตั้ง env ใช้ค่าเดียวกัน ซึ่งเท่ากับไม่มี pepper เลย
 * ล้มตอนโหลดโมดูลดีกว่าปลอดภัยแบบหลอก ๆ ตอนรัน (แบบเดียวกับ pin.ts)
 */
const PEPPER = process.env.MCP_KEY_PEPPER
if (!PEPPER) throw new Error('MCP_KEY_PEPPER is not configured')

export const RATE_PER_MINUTE = 60
export const RATE_PER_DAY = 1000

export type McpAuth = { keyId: string; actorId: string }

/**
 * ให้ route ที่ออกคีย์ hash ได้โดยไม่ต้องรู้จัก pepper เอง
 * pepper อ่านที่เดียวในไฟล์นี้ — ทุกที่ที่อ่าน `process.env.MCP_KEY_PEPPER` เพิ่ม
 * คือที่ที่ลืมเช็คว่ามีค่าได้อีกที่หนึ่ง
 */
export const hashKeyWithPepper = (key: string): string => hashKey(PEPPER, key)

/**
 * หาเจ้าของคีย์ — คืน `null` ถ้าคีย์ผิด ถูกเพิกถอน หรือคนออกคีย์ถูกปิดบัญชี
 *
 * ⚠️ คนเรียกต้องแปลง `null` เป็น **401 ที่ไม่มี `WWW-Authenticate`** เสมอ
 */
export async function resolveKey(raw: string | null): Promise<McpAuth | null> {
  if (!isValidKey(raw)) return null

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('mcp_keys')
    .select('id, created_by, revoked_at, profiles!inner(is_active, role)')
    .eq('key_hash', hashKey(PEPPER, raw))
    .is('revoked_at', null)
    .maybeSingle()

  if (error) {
    console.error('[mcp] อ่าน mcp_keys ไม่ได้', error.message)
    return null
  }
  if (!data) return null

  // เผื่อไว้อีกชั้น — `mcp_assume_owner()` ก็เช็คเรื่องนี้ในฐานข้อมูลอีกที
  // การป้องกันที่พึ่งฝั่งเดียวคือการป้องกันที่หายไปพร้อมกับฝั่งนั้น
  const prof = data.profiles as unknown as { is_active: boolean; role: string }
  if (!prof?.is_active || prof.role !== 'owner') return null

  // ไม่ await — เวลาที่ใช้ล่าสุดพลาดไปหนึ่งครั้งไม่คุ้มกับการหน่วงทุกคำขอ
  void admin
    .from('mcp_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(({ error: e }) => {
      if (e) console.error('[mcp] อัปเดต last_used_at ไม่ได้', e.message)
    })

  return { keyId: data.id, actorId: data.created_by }
}

/**
 * นับใน **ฐานข้อมูล** ไม่ใช่ Map ในหน่วยความจำ — Vercel รันหลาย instance
 * และแต่ละตัวจำคนละเรื่อง (เหตุผลเดียวกับ `lib/auth/rate-limit.ts`)
 *
 * เพดานนี้กัน **โมเดลที่วนลูปเรียก tool** ไม่ใช่กันคนร้าย — คนร้ายโดนกันด้วยคีย์
 */
export async function isRateLimited(keyId: string): Promise<boolean> {
  const admin = getSupabaseAdmin()
  const now = Date.now()

  for (const [since, max] of [
    [new Date(now - 60_000).toISOString(), RATE_PER_MINUTE],
    [new Date(now - 86_400_000).toISOString(), RATE_PER_DAY],
  ] as const) {
    const { count, error } = await admin
      .from('mcp_call_log')
      .select('id', { count: 'exact', head: true })
      .eq('key_id', keyId)
      .gte('at', since)

    // error ที่ไม่ถูกเช็ค = limiter ที่เงียบและไม่กันอะไรเลย
    if (error) {
      console.error('[mcp] อ่าน mcp_call_log ไม่ได้', error.message)
      continue
    }
    if ((count ?? 0) >= max) return true
  }
  return false
}

/**
 * บันทึกทุกการเรียก ทั้งสำเร็จและไม่สำเร็จ
 *
 * ⚠️ `error` รับได้เฉพาะ **รหัสสั้น ๆ** ห้ามใส่พารามิเตอร์ของ tool ลงไป
 * คำค้นของเจ้าของอาจมีชื่อลูกค้า และตารางนี้ลบไม่ได้
 */
export async function logCall(
  keyId: string,
  tool: string,
  ok: boolean,
  ms: number,
  error?: string,
): Promise<void> {
  const { error: e } = await getSupabaseAdmin()
    .from('mcp_call_log')
    .insert({ key_id: keyId, tool, ok, ms, error: error?.slice(0, 80) ?? null })
  if (e) console.error('[mcp] บันทึก mcp_call_log ไม่ได้', e.message)
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/mcp/keys.ts
git commit -m "feat(p9): ชั้นคีย์ MCP ฝั่งเซิร์ฟเวอร์ + rate limit ที่นับในฐานข้อมูล"
```

---

## Task 6: นิยาม tool + ข้อความคำนิยามตัวเลข

**Files:**
- Create: `src/lib/mcp/tools.ts`

**Interfaces:**
- Consumes: `args-core.ts` · `search-core.ts`
- Produces:
  - `type McpTool = { name: string; title: string; description: string; inputSchema: object }`
  - `TOOLS: McpTool[]` (7 ตัว)
  - `METRIC_DEFINITIONS: string`
  - `SERVER_INSTRUCTIONS: string`
  - `PROMPTS: { name: string; title: string; text: string }[]`

- [ ] **Step 1: เขียนไฟล์**

```ts
/**
 * นิยามของเครื่องมือทั้งเจ็ด — สิ่งที่โมเดลอ่านเพื่อตัดสินใจว่าจะเรียกอะไร
 *
 * 🔴 คำอธิบายในไฟล์นี้คือ **ส่วนหนึ่งของความถูกต้องของตัวเลข** ไม่ใช่เอกสารประกอบ
 * คำในธุรกิจนี้เป็นของบ้านนี้ ("ต้นทุน" ไม่รวมเงินที่จ่ายค่าแรงออกไป)
 * ถ้าโมเดลหานิยามไม่เจอ มันจะเดาอันที่ฟังดูสมเหตุสมผลแต่ผิด แล้วเจ้าของ
 * จะตัดสินใจจากตัวเลขนั้นโดยไม่มีอะไรเตือน
 */

export type McpTool = {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
}

/** ชี้จาก `initialize` เพื่อให้โมเดลรู้ตั้งแต่ต้นว่าต้องไปอ่านนิยามก่อน */
export const SERVER_INSTRUCTIONS = [
  'ข้อมูลของธุรกิจรับเหมาก่อสร้างรายนี้ อ่านอย่างเดียว แก้ไขอะไรไม่ได้',
  '',
  '🔴 เรียก `get_metric_definitions` ก่อนตีความตัวเลขใด ๆ เสมอ —',
  'คำว่า "ต้นทุน" "กำไร" และ "เก็บเงินแล้ว" ของระบบนี้มีเงื่อนไขเฉพาะ',
  'ที่เดาจากชื่อไม่ได้ และการเดาผิดทำให้ตัวเลขคลาดเคลื่อนเป็นเท่าตัว',
  '',
  'ทุกวันที่เป็นเวลาไทย (UTC+7) และเป็นปี **ค.ศ.** — ถ้าผู้ใช้พูดเป็น พ.ศ.',
  'ให้ลบ 543 ก่อนส่งเป็นพารามิเตอร์ ห้ามส่งปี พ.ศ. ลงไปตรง ๆ',
  'ตอบเป็นภาษาไทย และจัดรูปเงินด้วยเครื่องหมายคอมมาเมื่อแสดงให้ผู้ใช้อ่าน',
].join('\n')

export const METRIC_DEFINITIONS = [
  '# นิยามตัวเลขของระบบนี้',
  '',
  '## สถานะของรายการ',
  '- `pending` (รออนุมัติ) — หัวหน้าไซต์คีย์เข้ามาแล้วแต่เจ้าของยังไม่อนุมัติ',
  '  **ยังไม่ถูกนับเป็นรายรับหรือต้นทุน** · รายงานตัวเลขนี้แยกเสมอ',
  '- `approved` (อนุมัติแล้ว) — นับเข้าตัวเลขทั้งหมด',
  '- `rejected` (ตีกลับ) — ไม่นับ และมีเหตุผลกำกับใน `rejected_reason`',
  '',
  '## ต้นทุนของไซต์',
  '`ต้นทุน (cost_total) = รายจ่ายที่อนุมัติแล้ว (cost_expense) + ค่าแรงที่เกิดขึ้นแล้ว (cost_wage)`',
  '',
  '🔴 **ห้ามนับซ้ำ** — ค่าแรงเกิดเป็นต้นทุนตอน "ติ๊กว่าคนมาทำงานวันนี้" (accrual)',
  'ส่วน "เบิกล่วงหน้า" กับ "ปิดรอบจ่ายค่าแรง" คือ **เงินสดออก** ไม่ใช่ต้นทุนใหม่',
  'ถ้าเอายอดจาก `get_payroll_summary` ไปบวกกับ `cost_total` ต้นทุนจะกลายเป็นสองเท่า',
  '',
  'คนที่กินเงินเดือนรายเดือนมี `wage_snapshot = 0` จึงเข้าต้นทุนของไซต์เฉพาะส่วน OT',
  '',
  '## กำไรและความคืบหน้า',
  '- `กำไรคงเหลือ = ค่างานตามสัญญา − ต้นทุนที่เกิดขึ้นแล้ว`',
  '  **ไม่ใช่** ลบด้วยเงินที่เก็บได้ — เก็บเงินช้าแปลว่ากระแสเงินสดตึง ไม่ใช่กำไรหด',
  '- `% เก็บเงินแล้ว = รายรับที่อนุมัติแล้ว ÷ ค่างานตามสัญญา`',
  '- `% ต้นทุน = ต้นทุนที่เกิดขึ้นแล้ว ÷ ค่างานตามสัญญา`',
  '- `ต้นทุนโตเร็วกว่าเงินที่เก็บได้` เมื่อ `% ต้นทุน > % เก็บเงินแล้ว` (เทียบเปอร์เซ็นต์ที่ปัดแล้ว)',
  '- ค่างานเป็น 0 แปลว่า **ยังไม่ได้ตั้ง** ห้ามหารด้วยศูนย์และห้ามรายงานเป็น 0%',
  '',
  '## ไซต์และส่วนกลาง',
  '- รายการที่ `site_id` เป็น `null` คือ **ค่าใช้จ่ายส่วนกลาง** (ค่าน้ำมัน ค่าออฟฟิศ)',
  '  **ไม่ใช่** "ยังไม่ได้เลือกไซต์" · ห้ามนับเข้าต้นทุนของไซต์ใดไซต์หนึ่ง',
  '- สถานะไซต์: `planning` เตรียมงาน · `active` กำลังก่อสร้าง · `paused` หยุดชั่วคราว',
  '  · `done` ส่งมอบแล้ว · `cancelled` ยกเลิก',
  '',
  '## วันที่',
  '- ทุกวันที่เป็นเวลาไทย (Asia/Bangkok) และเก็บเป็นปี **ค.ศ.** เสมอ',
  '- "ใกล้ครบกำหนด" = ไซต์ที่ยังก่อสร้างอยู่และเหลือไม่ถึง 30 วัน',
  '- "เลยกำหนด" = ไซต์ที่ยังก่อสร้างอยู่แต่วันจบผ่านไปแล้ว',
].join('\n')

const OBJ = (props: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties: props,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
})

const DATE = { type: 'string', description: 'วันที่แบบ YYYY-MM-DD (ค.ศ. เท่านั้น)' }

export const TOOLS: McpTool[] = [
  {
    name: 'get_metric_definitions',
    title: 'นิยามตัวเลข',
    description:
      'คำนิยามของ "ต้นทุน" "กำไร" "เก็บเงินแล้ว" และกฎการไม่นับซ้ำของระบบนี้ ' +
      'เรียกก่อนตีความตัวเลขใด ๆ เสมอ — นิยามเหล่านี้เดาจากชื่อไม่ได้',
    inputSchema: OBJ({}),
  },
  {
    name: 'get_company_overview',
    title: 'ภาพรวมทั้งบริษัท',
    description:
      'จำนวนไซต์ ค่างานรวม รายรับและต้นทุนของไซต์ที่กำลังก่อสร้าง ' +
      'ไซต์ที่ใกล้ครบกำหนดและเลยกำหนด และจำนวน/ยอดที่รออนุมัติ',
    inputSchema: OBJ({
      on_date: { ...DATE, description: 'วันอ้างอิง ไม่ใส่ = วันนี้ตามเวลาไทย' },
    }),
  },
  {
    name: 'list_sites',
    title: 'รายชื่อไซต์งานพร้อมตัวเลขเงิน',
    description:
      'ไซต์แต่ละแห่งพร้อมค่างาน เงินที่เก็บได้ ต้นทุน (แยกรายจ่ายกับค่าแรง) และกำไรคงเหลือ',
    inputSchema: OBJ({
      status: {
        type: 'string',
        enum: ['planning', 'active', 'paused', 'done', 'cancelled'],
        description: 'กรองตามสถานะ ไม่ใส่ = ทุกสถานะ',
      },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    }),
  },
  {
    name: 'get_site_detail',
    title: 'รายละเอียดไซต์เดียว',
    description:
      'ตัวเลขเงินชุดเต็มของไซต์ แผนงวดเงิน หัวหน้าไซต์ที่ดูแลอยู่ตอนนี้ และรายการล่าสุด 10 รายการ ' +
      'หา site_id ได้จาก list_sites',
    inputSchema: OBJ({ site_id: { type: 'string', description: 'UUID ของไซต์' } }, ['site_id']),
  },
  {
    name: 'search_transactions',
    title: 'ค้นรายรับ-รายจ่าย',
    description:
      'ค้นรายการตามช่วงวัน ชนิด สถานะ ไซต์ และคำในหมายเหตุ ' +
      'คืน total_count มาด้วยเพื่อให้รู้ว่ายังมีต่อ — อย่าเดาจากจำนวนแถวที่ได้',
    inputSchema: OBJ({
      from: DATE,
      to: DATE,
      kind: { type: 'string', enum: ['income', 'expense'] },
      status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
      site_id: { type: 'string', description: 'UUID ของไซต์ ไม่ใส่ = ทุกไซต์รวมส่วนกลาง' },
      q: { type: 'string', description: 'คำค้นในหมายเหตุ ค้นแบบต้องเจอทุกคำ' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    }),
  },
  {
    name: 'get_pending_approvals',
    title: 'รายการที่รออนุมัติ',
    description:
      'รายจ่ายที่หัวหน้าไซต์คีย์เข้ามาและยังรอเจ้าของอนุมัติ พร้อมจำนวนวันที่รอ ' +
      'ยอดเหล่านี้ยังไม่ถูกนับเป็นต้นทุน',
    inputSchema: OBJ({ limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }),
  },
  {
    name: 'get_payroll_summary',
    title: 'ค่าแรงค้างจ่ายและรอบจ่าย',
    description:
      'ค่าแรงค้างจ่ายรายคน (เกิดขึ้นแล้ว − เบิกไปแล้ว) และรอบจ่ายล่าสุด · ' +
      '🔴 ยอดเบิกและยอดจ่ายในนี้เป็นเงินสดออก **ไม่ใช่ต้นทุน** ' +
      'ห้ามบวกเข้ากับ cost_total ของไซต์ เพราะต้นทุนค่าแรงถูกนับไปแล้วตอนลงชื่อเข้าไซต์',
    inputSchema: OBJ({ limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 } }),
  },
]

/** คำถามสำเร็จรูป — ปุ่มลัดในแอป Claude สำหรับคนที่ไม่รู้จะเริ่มถามยังไง */
export const PROMPTS = [
  {
    name: 'daily-brief',
    title: 'สรุปวันนี้',
    text: 'อ่านนิยามตัวเลขก่อน แล้วสรุปภาพรวมบริษัทวันนี้ให้หน่อย เน้นสิ่งที่ต้องตัดสินใจ',
  },
  {
    name: 'thin-margin',
    title: 'ไซต์ที่กำไรบาง',
    text: 'อ่านนิยามตัวเลขก่อน แล้วบอกว่าไซต์ไหนกำไรคงเหลือน้อยที่สุด และเพราะอะไร',
  },
  {
    name: 'wage-due',
    title: 'ค่าแรงค้างจ่าย',
    text: 'อ่านนิยามตัวเลขก่อน แล้วบอกว่าตอนนี้ค้างจ่ายค่าแรงใครบ้าง คนละเท่าไหร่ รวมเท่าไหร่',
  },
]
```

- [ ] **Step 2: typecheck + commit**

```bash
npm run typecheck
git add src/lib/mcp/tools.ts
git commit -m "feat(p9): นิยาม 7 tool + คำนิยามตัวเลขที่โมเดลต้องอ่านก่อนตอบ"
```

---

## Task 7: ตัวเรียกฟังก์ชัน

**Files:**
- Create: `src/lib/mcp/execute.ts`

**Interfaces:**
- Consumes: `tools.ts` · `args-core.ts` · `search-core.ts` · `keys.ts` (`McpAuth`)
- Produces: `executeTool(actorId: string, tool: string, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; message: string }>`

- [ ] **Step 1: เขียนไฟล์**

```ts
import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { clampLimit, clampOffset, parseIsoDate, pickEnum } from '@/lib/mcp/args-core'
import { searchTerms } from '@/lib/search-core'
import { METRIC_DEFINITIONS } from '@/lib/mcp/tools'

/**
 * เรียกฟังก์ชัน `mcp_*` — ที่เดียวที่แตะฐานข้อมูลของฝั่ง MCP
 *
 * 🔴 พารามิเตอร์ทุกตัวถูกบีบให้อยู่ในกรอบ **ก่อน** ถึงฐานข้อมูล
 * โมเดลส่ง `limit: "ทั้งหมด"` หรือ `from: "2569-01-01"` มาได้ และมันไม่รู้ตัว
 * · ค่าที่ไม่ผ่านตัวตรวจกลายเป็น "ไม่กรอง" ไม่ใช่ "กรองด้วยของที่แต่งขึ้น"
 *
 * ⚠️ ความล้มเหลวคืนเป็นข้อความ ไม่ใช่ throw — คนเรียกต้องแปลงเป็น
 * `isError: true` ใน 200 เพื่อให้โมเดลอธิบายให้ผู้ใช้ฟังได้ ไม่ใช่ให้เซสชันตาย
 */
export type ExecResult = { ok: true; data: unknown } | { ok: false; message: string }

const SITE_STATUS = ['planning', 'active', 'paused', 'done', 'cancelled'] as const
const TXN_KIND = ['income', 'expense'] as const
const TXN_STATUS = ['pending', 'approved', 'rejected'] as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const asUuid = (v: unknown): string | null =>
  typeof v === 'string' && UUID_RE.test(v.trim()) ? v.trim() : null

export async function executeTool(
  actorId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<ExecResult> {
  // ไม่แตะฐานข้อมูลเลย — เป็นคำอธิบายกติกา ไม่ใช่ข้อมูล
  if (tool === 'get_metric_definitions') return { ok: true, data: METRIC_DEFINITIONS }

  const admin = getSupabaseAdmin()

  const call = async (fn: string, params: Record<string, unknown>): Promise<ExecResult> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ชื่อ RPC เป็นค่าที่คำนวณ
    const { data, error } = await (admin.rpc as any)(fn, { p_actor: actorId, ...params })
    if (error) {
      console.error(`[mcp] ${fn} ล้มเหลว`, error.message)
      // ข้อความจากฐานข้อมูลอาจมีรายละเอียดภายใน — ส่งกลับเฉพาะสิ่งที่โมเดลใช้ได้
      if (error.message.includes('MCP_ACTOR_NOT_OWNER')) {
        return { ok: false, message: 'คีย์นี้ไม่มีสิทธิ์อ่านข้อมูลแล้ว กรุณาออกคีย์ใหม่' }
      }
      return { ok: false, message: 'อ่านข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }
    }
    return { ok: true, data }
  }

  switch (tool) {
    case 'get_company_overview':
      return call('mcp_overview', { p_on: parseIsoDate(args.on_date) })

    case 'list_sites':
      return call('mcp_sites', {
        p_status: pickEnum(args.status, SITE_STATUS),
        p_limit: clampLimit(args.limit, 20, 100),
        p_offset: clampOffset(args.offset),
      })

    case 'get_site_detail': {
      const site = asUuid(args.site_id)
      if (!site) return { ok: false, message: 'ต้องระบุ site_id เป็น UUID — หาได้จาก list_sites' }
      return call('mcp_site_detail', { p_site: site })
    }

    case 'search_transactions': {
      // แยกคำด้วยตัวเดียวกับหน้า /ledger — ไม่งั้นถาม AI ได้คำตอบนึง
      // เปิดหน้าจอเห็นอีกอย่างนึง
      const terms = typeof args.q === 'string' ? searchTerms(args.q) : []
      return call('mcp_transactions', {
        p_from: parseIsoDate(args.from),
        p_to: parseIsoDate(args.to),
        p_kind: pickEnum(args.kind, TXN_KIND),
        p_status: pickEnum(args.status, TXN_STATUS),
        p_site: asUuid(args.site_id),
        p_terms: terms.length ? terms : null,
        p_limit: clampLimit(args.limit, 30, 100),
        p_offset: clampOffset(args.offset),
      })
    }

    case 'get_pending_approvals':
      return call('mcp_pending', { p_limit: clampLimit(args.limit, 20, 100) })

    case 'get_payroll_summary':
      return call('mcp_payroll', { p_limit: clampLimit(args.limit, 10, 50) })

    default:
      return { ok: false, message: `ไม่มีเครื่องมือชื่อ ${tool}` }
  }
}
```

- [ ] **Step 2: typecheck + commit**

```bash
npm run typecheck
git add src/lib/mcp/execute.ts
git commit -m "feat(p9): ตัวเรียก mcp_* พร้อมบีบพารามิเตอร์ที่โมเดลกรอกมา"
```

---

## Task 8: handler JSON-RPC + สอง route

**Files:**
- Create: `src/lib/mcp/handler.ts`
- Create: `src/app/api/mcp/route.ts`
- Create: `src/app/api/mcp/[key]/route.ts`

**Interfaces:**
- Consumes: `keys.ts` · `tools.ts` · `execute.ts`
- Produces: `handleMcpPost(req: Request, keyFromPath: string | null): Promise<Response>` · `mcpMethodNotAllowed(): Response`

- [ ] **Step 1: เขียน `src/lib/mcp/handler.ts`**

```ts
import 'server-only'

import { NextResponse } from 'next/server'
import { resolveKey, isRateLimited, logCall, type McpAuth } from '@/lib/mcp/keys'
import { TOOLS, PROMPTS, SERVER_INSTRUCTIONS } from '@/lib/mcp/tools'
import { executeTool } from '@/lib/mcp/execute'

/**
 * เซิร์ฟเวอร์ MCP แบบ Streamable HTTP เขียนเอง
 *
 * ไม่ลง `@modelcontextprotocol/sdk` — มันสร้างมาให้ `req`/`res` ของ Node
 * และลากเฟรมเวิร์กเซิร์ฟเวอร์เข้ามาเพื่อ handler ที่มี POST เดียว
 *
 * 🔴 กติกาสี่ข้อที่ผิดแล้วพังแบบไม่มี error ให้เห็น:
 * 1. **401 ห้ามมี `WWW-Authenticate`** — header นั้นคือสัญญาณ "เริ่ม OAuth
 *    discovery" client จะไปหา /.well-known/oauth-protected-resource เจอ 404
 *    แล้ว connector ค้างหลังปุ่ม Connect ที่กดยังไงก็ไม่ผ่าน · 403 ก็ห้ามมีเหมือนกัน
 * 2. `resources/list` และ `resources/templates/list` ต้องคืน **อาร์เรย์ว่าง**
 *    ไม่ใช่ -32601 · แอป Claude โชว์ -32601 เป็นข้อความแดงทั้งที่เราไม่ได้
 *    ประกาศ capability นั้น
 * 3. ข้อความที่ไม่มี `id` (notification) ตอบ **202 บอดี้ว่าง**
 * 4. **ไม่ออก `Mcp-Session-Id`** — stateless คือสิ่งที่ทำให้มันรอดบน serverless
 */

const JSONRPC = '2.0'
const FALLBACK_PROTOCOL = '2025-06-18'

type RpcId = string | number | null
type RpcRequest = { jsonrpc?: string; id?: RpcId; method?: string; params?: Record<string, unknown> }

const ok = (id: RpcId, result: unknown) =>
  NextResponse.json({ jsonrpc: JSONRPC, id, result })

const rpcError = (id: RpcId, code: number, message: string) =>
  NextResponse.json({ jsonrpc: JSONRPC, id, error: { code, message } })

/** 🔴 ห้ามเติม WWW-Authenticate ตรงนี้ไม่ว่าจะดู "ถูกต้องตามสเปก" แค่ไหน */
const unauthorized = () =>
  NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

export const mcpMethodNotAllowed = () =>
  NextResponse.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: { Allow: 'POST' } })

/** ผลของ tool เป็นข้อความ JSON — รูปแบบที่ client ทุกตัวอ่านได้แน่นอน */
const toolResult = (data: unknown, isError = false) => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
  ...(isError ? { isError: true } : {}),
})

function keyFromHeader(req: Request): string | null {
  const h = req.headers.get('authorization')
  if (!h) return null
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim())
  return m ? m[1] : null
}

export async function handleMcpPost(req: Request, keyFromPath: string | null): Promise<Response> {
  // path ก่อน header — คู่มือของเจ้าของใช้ทางนี้ ส่วน header ไว้ให้ Claude Code/Codex
  const auth: McpAuth | null = await resolveKey(keyFromPath ?? keyFromHeader(req))
  if (!auth) return unauthorized()

  let body: RpcRequest
  try {
    body = (await req.json()) as RpcRequest
  } catch {
    return rpcError(null, -32700, 'Parse error')
  }

  const id = body.id ?? null
  const method = body.method ?? ''

  // ไม่มี id = notification — ตอบ 202 บอดี้ว่าง ห้ามตอบ JSON-RPC กลับไป
  if (body.id === undefined || body.id === null) {
    return new Response(null, { status: 202 })
  }

  switch (method) {
    case 'initialize': {
      // 🔴 สะท้อนเวอร์ชันที่ client ขอมา ไม่ใช่ยัดเวอร์ชันของเราลงไป
      const asked = body.params?.protocolVersion
      return ok(id, {
        protocolVersion: typeof asked === 'string' ? asked : FALLBACK_PROTOCOL,
        capabilities: { tools: {}, prompts: {} },
        serverInfo: { name: 'construction-books', version: '1.0.0' },
        instructions: SERVER_INSTRUCTIONS,
      })
    }

    case 'ping':
      return ok(id, {})

    case 'tools/list':
      return ok(id, { tools: TOOLS })

    case 'prompts/list':
      return ok(id, {
        prompts: PROMPTS.map((p) => ({ name: p.name, title: p.title, arguments: [] })),
      })

    case 'prompts/get': {
      const name = body.params?.name
      const found = PROMPTS.find((p) => p.name === name)
      if (!found) return rpcError(id, -32602, `ไม่มี prompt ชื่อ ${String(name)}`)
      return ok(id, {
        description: found.title,
        messages: [{ role: 'user', content: { type: 'text', text: found.text } }],
      })
    }

    // ประกาศว่าไม่มี resources แต่ยังต้องตอบให้เรียบร้อย ไม่ใช่ -32601
    case 'resources/list':
      return ok(id, { resources: [] })
    case 'resources/templates/list':
      return ok(id, { resourceTemplates: [] })

    case 'tools/call': {
      const name = String(body.params?.name ?? '')
      const args = (body.params?.arguments ?? {}) as Record<string, unknown>

      if (!TOOLS.some((t) => t.name === name)) {
        await logCall(auth.keyId, name || '(ไม่ระบุ)', false, 0, 'UNKNOWN_TOOL')
        return ok(id, toolResult(`ไม่มีเครื่องมือชื่อ ${name}`, true))
      }

      if (await isRateLimited(auth.keyId)) {
        await logCall(auth.keyId, name, false, 0, 'RATE_LIMITED')
        return ok(id, toolResult('เรียกถี่เกินไป กรุณารอสักครู่แล้วลองใหม่', true))
      }

      const t0 = Date.now()
      const res = await executeTool(auth.actorId, name, args)
      const ms = Date.now() - t0

      // ⚠️ บันทึกเฉพาะชื่อ tool กับผล — ห้ามบันทึก args เพราะอาจมีชื่อลูกค้า
      await logCall(auth.keyId, name, res.ok, ms, res.ok ? undefined : 'TOOL_FAILED')

      // ล้มเหลวยังตอบ 200 พร้อม isError — โมเดลจะได้อธิบายแทนที่เซสชันจะตาย
      return ok(id, res.ok ? toolResult(res.data) : toolResult(res.message, true))
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}
```

- [ ] **Step 2: เขียน `src/app/api/mcp/[key]/route.ts`**

```ts
import { handleMcpPost, mcpMethodNotAllowed } from '@/lib/mcp/handler'

/** ต้องเป็น nodejs — `node:crypto` สำหรับ HMAC */
export const runtime = 'nodejs'
/** ห้ามแคช — ทุกคำขอต้องเช็คคีย์และอ่านตัวเลขใหม่ */
export const dynamic = 'force-dynamic'

/**
 * ทางเข้าหลักที่คู่มือของเจ้าของใช้ — คีย์อยู่ใน path
 * 🔴 ถือว่า URL นี้เป็นรหัสผ่าน · หน้า /mcp เตือนเรื่องการแคปหน้าจอส่งต่อไว้แล้ว
 */
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  return handleMcpPost(req, key)
}

/** อย่าเปิดสตรีม SSE ที่เราไม่เคยเขียนอะไรลงไป */
export function GET() {
  return mcpMethodNotAllowed()
}
```

- [ ] **Step 3: เขียน `src/app/api/mcp/route.ts`**

```ts
import { handleMcpPost, mcpMethodNotAllowed } from '@/lib/mcp/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ทางเข้าที่คีย์อยู่ใน `Authorization: Bearer` — ไว้ให้ Claude Code / Codex
 * ⚠️ **ไม่เขียนทางนี้ในคู่มือหน้า /mcp** · ให้ผู้ใช้ที่ไม่ชำนาญคอมเลือกสองทาง
 * คือการสร้างสายโทรเข้า (สเปก §2)
 */
export async function POST(req: Request) {
  return handleMcpPost(req, null)
}

export function GET() {
  return mcpMethodNotAllowed()
}
```

- [ ] **Step 4: ยืนยันว่า `proxy.ts` ไม่ขวาง**

```bash
grep -n "isApi" src/lib/supabase/middleware.ts
```

คาดหวัง: เจอบรรทัด `const isApi = path.startsWith('/api')` และเงื่อนไข `!isApi`
— **ไม่ต้องแก้อะไร** `/api/*` ถูกยกเว้นจาก gate อยู่แล้ว ขั้นนี้คือการยืนยันไม่ใช่การแก้

- [ ] **Step 5: typecheck + build**

```bash
npm run typecheck && npm run build
```

- [ ] **Step 6: ทดสอบด้วยมือว่า 401 ไม่มี WWW-Authenticate**

เปิด dev server (`npm run dev -- -p 3100`) แล้ว:

```bash
curl -s -D - -o /dev/null -X POST http://localhost:3100/api/mcp/k_ไม่มีจริง \
  -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"ping"}' \
  | grep -iE "^(HTTP|www-authenticate|mcp-session)"
```

คาดหวัง: เห็นแค่ `HTTP/1.1 401 Unauthorized` · **ไม่มี** `www-authenticate` และ **ไม่มี** `mcp-session-id`

- [ ] **Step 7: Commit**

```bash
git add src/lib/mcp/handler.ts src/app/api/mcp
git commit -m "feat(p9): endpoint MCP สองทางเข้า + กติกา HTTP ที่ผิดแล้วพังเงียบ"
```

---

## Task 9: API สร้างและเพิกถอนคีย์

**Files:**
- Create: `src/app/api/settings/mcp-keys/route.ts`
- Create: `src/app/api/settings/mcp-keys/[id]/route.ts`

**Interfaces:**
- Consumes: `denyUnlessOwner()` จาก `@/lib/auth/current-user` · `keys-core.ts` · `keys.ts`
- Produces:
  - `POST /api/settings/mcp-keys` body `{ label: string }` → `201 { ok: true, key: string, row: {...} }` — **`key` คืนครั้งเดียวในชีวิต**
  - `DELETE /api/settings/mcp-keys/[id]` → `200 { ok: true }`

- [ ] **Step 1: เขียน `route.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { generateKey, keyPrefix } from '@/lib/mcp/keys-core'
import { hashKeyWithPepper } from '@/lib/mcp/keys'

export const runtime = 'nodejs'

const MAX_LABEL = 60
/** กันคีย์งอกไม่จำกัด — เจ้าของคนเดียวไม่มีเหตุต้องมีเกินนี้ */
const MAX_ACTIVE_KEYS = 10

/** POST /api/settings/mcp-keys — ออกคีย์ใหม่ (เจ้าของเท่านั้น) */
export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  let label = ''
  try {
    const b = await req.json()
    label = String(b?.label ?? '').trim().slice(0, MAX_LABEL)
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  if (!label) return NextResponse.json({ error: 'LABEL_REQUIRED' }, { status: 400 })

  const sb = await getSupabaseServer()

  const { count, error: cErr } = await sb
    .from('mcp_keys')
    .select('id', { count: 'exact', head: true })
    .is('revoked_at', null)
  if (cErr) {
    console.error('[mcp-keys] นับคีย์ไม่ได้', cErr.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  if ((count ?? 0) >= MAX_ACTIVE_KEYS) {
    return NextResponse.json({ error: 'TOO_MANY_KEYS' }, { status: 409 })
  }

  // 🔴 ค่านี้ไม่ถูกเก็บที่ไหนเลย — คืนให้ครั้งเดียวแล้วหายไปตลอดกาล
  const secret = generateKey()

  // เขียนผ่าน session ของเจ้าของ ไม่ใช่ admin — RLS เป็นตัวยืนยันสิทธิ์อีกชั้น
  // และ audit trigger จะได้บันทึกว่าใครเป็นคนออก
  const { data, error } = await sb
    .from('mcp_keys')
    .insert({
      label,
      key_hash: hashKeyWithPepper(secret),
      key_prefix: keyPrefix(secret),
      created_by: (await sb.auth.getUser()).data.user!.id,
    })
    .select('id, label, key_prefix, created_at, last_used_at')
    .maybeSingle()

  if (error) {
    console.error('[mcp-keys] ออกคีย์ไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true, key: secret, row: data }, { status: 201 })
}
```

`hashKeyWithPepper` มาจาก Task 5 — ถ้ามันยังไม่มี แปลว่า Task 5 ยังไม่เสร็จ ห้ามเขียนซ้ำที่นี่

- [ ] **Step 2: เขียน `[id]/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * DELETE /api/settings/mcp-keys/[id] — เพิกถอนคีย์
 *
 * 🔴 ตั้ง `revoked_at` ไม่ใช่ลบแถว — `mcp_call_log` ยังอ้างถึงอยู่
 * และประวัติว่าเคยมีคีย์ใบนี้คือส่วนหนึ่งของร่องรอย
 *
 * 🔴 ต้อง `.select()` กลับมาด้วย — RLS ที่บล็อกการอัปเดตจะแมตช์ **ศูนย์แถว
 * และไม่คืน error** แอปจะรายงานว่าสำเร็จทั้งที่ไม่มีอะไรถูกเขียน
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await params
  const sb = await getSupabaseServer()

  const { data, error } = await sb
    .from('mcp_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[mcp-keys] เพิกถอนไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'REVOKE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: typecheck + build + commit**

```bash
npm run typecheck && npm run build
git add src/app/api/settings/mcp-keys src/lib/mcp/keys.ts
git commit -m "feat(p9): API ออกและเพิกถอนคีย์ MCP"
```

---

## Task 10: หน้าจอ /mcp

**Files:**
- Create: `src/app/(app)/mcp/layout.tsx`
- Create: `src/app/(app)/mcp/loading.tsx`
- Create: `src/app/(app)/mcp/page.tsx`
- Create: `src/app/(app)/mcp/mcp-client.tsx`

**Interfaces:**
- Consumes: `OwnerOnly` · `PageHeader` · `EmptyState`/`ListSkeleton` · API จาก Task 9
- Produces: หน้า `/mcp`

- [ ] **Step 1: `layout.tsx` — ประตูเจ้าของ**

```tsx
import type { ReactNode } from 'react'
import { OwnerOnly } from '@/components/owner-only-layout'

/**
 * 🔴 role เช็คที่นี่ ไม่ใช่ใน page.tsx — segment ที่มี loading.tsx ถูกห่อด้วย
 * Suspense แล้วส่งหัว 200 ออกไปก่อน page จะได้ทำงาน `redirect()` ใน page
 * จึงกลายเป็นการเด้งฝั่ง client และหน้าตอบ 200 (CLAUDE.md §17 ข้อ 6)
 */
export default function McpLayout({ children }: { children: ReactNode }) {
  return <OwnerOnly>{children}</OwnerOnly>
}
```

- [ ] **Step 2: `loading.tsx` — โครงร่างที่รูปร่างตรงกับของจริง**

```tsx
import { ListSkeleton, Skeleton } from '@/components/ui/states'

export default function Loading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-8 w-52" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <ListSkeleton rows={3} />
    </div>
  )
}
```

- [ ] **Step 3: `page.tsx` — โหลดข้อมูลและตรวจ origin**

```tsx
import { headers } from 'next/headers'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/page-header'
import { DataError } from '@/components/ui/data-error'
import { McpClient } from './mcp-client'

export const metadata = { title: 'เชื่อมต่อ AI' }

/**
 * 🔴 Claude เรียกเซิร์ฟเวอร์เราจาก **คลาวด์ของ Anthropic ไม่ใช่จากเครื่องผู้ใช้**
 * `http://localhost:3000/...` จึงไปตกที่เครื่องของ Anthropic แล้วล้มเหลว
 * ถ้าไม่เตือนตรงนี้ เจ้าของจะคัดลอก URL ไปวางแล้วมาบอกว่าเซิร์ฟเวอร์เสีย
 */
const PRIVATE_ORIGIN =
  /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/

export default async function McpPage() {
  const h = await headers()
  const host = h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const origin = `${proto}://${host}`

  const sb = await getSupabaseServer()

  // ทุกลิสต์ต้องมี order + range — ห้ามพึ่งค่าเริ่มต้นที่ตัดเงียบที่ 1,000 แถว
  const [{ data: keys, error: kErr }, { data: calls, error: cErr }] = await Promise.all([
    sb
      .from('mcp_keys')
      .select('id, label, key_prefix, created_at, last_used_at')
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .range(0, 49),
    sb
      .from('mcp_call_log')
      .select('id, tool, ok, ms, at')
      .order('at', { ascending: false })
      .range(0, 19),
  ])

  if (kErr || cErr) {
    console.error('[mcp] โหลดหน้าไม่สำเร็จ', kErr?.message ?? cErr?.message)
    return (
      <div className="space-y-5">
        <PageHeader title="เชื่อมต่อ AI" />
        <DataError message="โหลดรายการคีย์ไม่สำเร็จ" />
      </div>
    )
  }

  return (
    <McpClient
      origin={origin}
      isLocalOrigin={PRIVATE_ORIGIN.test(origin)}
      initialKeys={keys ?? []}
      calls={calls ?? []}
    />
  )
}
```

`DataError({ message })` มีอยู่จริงและรับ prop ชื่อนี้ตัวเดียว (ตรวจแล้ว) — ใช้ได้เลย

- [ ] **Step 4: `mcp-client.tsx` — ฟอร์ม ตาราง และคู่มือ**

โครงหลักและส่วนที่พลาดง่ายที่สุดสามส่วน (สร้างคีย์ · โชว์ครั้งเดียว · เพิกถอน):

```tsx
'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, Check, Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/ui/states'
import { PageHeader } from '@/components/ui/page-header'
import { LOCALE, TZ } from '@/lib/constants'

type KeyRow = {
  id: string
  label: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
}
type CallRow = { id: string; tool: string; ok: boolean; ms: number | null; at: string }

/** ทุก formatter ผูกเขตเวลาไทยชัดเจน — เซิร์ฟเวอร์รันเป็น UTC */
const fmt = (iso: string) =>
  new Date(iso).toLocaleString(LOCALE, {
    timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

export function McpClient({
  origin,
  isLocalOrigin,
  initialKeys,
  calls,
}: {
  origin: string
  isLocalOrigin: boolean
  initialKeys: KeyRow[]
  calls: CallRow[]
}) {
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  /**
   * 🔴 คีย์เต็มอยู่ใน state ตัวนี้เท่านั้น และไม่ถูกเก็บที่ไหนอีกเลย
   * ปิดหน้าหรือรีเฟรชแล้วหายถาวร — ตั้งใจให้เป็นแบบนั้น
   */
  const [freshUrl, setFreshUrl] = useState<string | null>(null)

  const create = async () => {
    const name = label.trim()
    if (!name) return toast.error('กรุณาตั้งชื่อเครื่องที่จะเชื่อมต่อ')
    if (busy) return
    setBusy('new')
    try {
      const r = await fetch('/api/settings/mcp-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: name }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(
          b.error === 'TOO_MANY_KEYS'
            ? 'มีคีย์ที่ใช้งานอยู่ครบจำนวนแล้ว กรุณาเพิกถอนใบที่ไม่ใช้ก่อน'
            : b.error === 'LABEL_REQUIRED'
              ? 'กรุณาตั้งชื่อเครื่องที่จะเชื่อมต่อ'
              : 'ออกคีย์ไม่สำเร็จ กรุณาลองใหม่',
        )
        return
      }
      setFreshUrl(`${origin}/api/mcp/${b.key}`)
      setLabel('')
      setCopied(false)
      toast.success('ออกคีย์แล้ว — คัดลอกเก็บไว้ตอนนี้')
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  const revoke = async (id: string) => {
    if (busy) return
    setBusy(id)
    try {
      const r = await fetch(`/api/settings/mcp-keys/${id}`, { method: 'DELETE' })
      if (!r.ok) {
        toast.error('เพิกถอนไม่สำเร็จ กรุณาลองใหม่')
        return
      }
      toast.success('เพิกถอนคีย์แล้ว — เครื่องที่ใช้คีย์นี้จะเชื่อมต่อไม่ได้ทันที')
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  const copy = async () => {
    if (!freshUrl) return
    try {
      await navigator.clipboard.writeText(freshUrl)
      setCopied(true)
      toast.success('คัดลอกแล้ว')
    } catch {
      // clipboard ถูกปฏิเสธได้ (http ที่ไม่ใช่ localhost, สิทธิ์เบราว์เซอร์)
      // ต้องบอกทางออก ไม่ใช่เงียบ — ข้อความในกล่องเลือกคัดลอกเองได้อยู่แล้ว
      toast.error('คัดลอกอัตโนมัติไม่ได้ กรุณาลากเลือกข้อความแล้วคัดลอกเอง')
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="เชื่อมต่อ AI"
        subtitle="ให้ Claude หรือ ChatGPT อ่านตัวเลขของคุณเพื่อตอบคำถาม — อ่านอย่างเดียว แก้ไขอะไรไม่ได้"
      />

      {/* 🔴 Claude เรียกจากคลาวด์ ไม่ใช่จากเครื่องผู้ใช้ — ไม่เตือนตรงนี้
          เจ้าของจะคัดลอก localhost ไปวางแล้วมาบอกว่าเซิร์ฟเวอร์เสีย */}
      {isLocalOrigin && (
        <div className="flex gap-3 rounded-lg border border-warn bg-warn-soft px-4 py-3">
          <AlertTriangle className="size-5 shrink-0 text-warn" strokeWidth={1.8} />
          <p className="text-sm leading-6 text-ink-2">
            ที่อยู่ตอนนี้เป็น <span className="font-mono">{origin}</span> ซึ่งเป็นเครื่องในบ้าน
            — Claude เรียกจากอินเทอร์เน็ตมาไม่ถึง
            <br />
            ต้องนำระบบขึ้นเซิร์ฟเวอร์จริงก่อน คีย์ที่ออกตอนนี้จึงใช้ต่อจากแอปไม่ได้
          </p>
        </div>
      )}

      {/* ── ออกคีย์ใหม่ ─────────────────────────────────────────── */}
      <section className="panel p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label htmlFor="mcp-label" className="label-base">
              ชื่อเครื่องที่จะเชื่อมต่อ
            </label>
            <input
              id="mcp-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="เช่น โน้ตบุ๊กเจ้าของ"
              className="input-base"
            />
          </div>
          <button type="button" onClick={create} disabled={busy !== null} className="btn-primary">
            {busy === 'new' ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            ออกคีย์ใหม่
          </button>
        </div>

        {freshUrl && (
          <div className="mt-4 rounded-lg border border-brand bg-surface-2 p-3">
            <p className="mb-2 text-sm font-bold text-ink">
              คัดลอกเก็บไว้ตอนนี้ — ปิดหน้านี้แล้วจะไม่เห็นค่านี้อีก
            </p>
            {/* URL ยาวมาก ต้อง break ไม่ใช่ดันหน้าจอกว้างออกไป */}
            <p className="mb-3 break-all rounded-xs bg-surface px-3 py-2 font-mono text-xs leading-5 text-ink-2">
              {freshUrl}
            </p>
            <button type="button" onClick={copy} className="btn-secondary">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
            </button>
          </div>
        )}
      </section>

      {/* ── คีย์ที่ใช้งานอยู่ ────────────────────────────────────── */}
      {initialKeys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          message="ยังไม่มีคีย์ — กดออกคีย์ใหม่ด้านบน แล้วนำ URL ที่ได้ไปใส่ใน Claude หรือ ChatGPT"
        />
      ) : (
        <section className="panel">
          {initialKeys.map((k) => (
            <div key={k.id} className="flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{k.label}</span>
                <span className="block font-mono text-xs text-muted-token">{k.key_prefix}…</span>
                <span className="block text-xs text-muted-token">
                  ออกเมื่อ {fmt(k.created_at)} ·{' '}
                  {k.last_used_at ? `ใช้ล่าสุด ${fmt(k.last_used_at)}` : 'ยังไม่เคยใช้'}
                </span>
              </span>

              {/* ห้าม confirm() — CLAUDE.md §15 บังคับ radix สำหรับการยืนยัน */}
              <Dialog.Root>
                <Dialog.Trigger asChild>
                  <button type="button" disabled={busy !== null} className="btn-danger shrink-0">
                    {busy === k.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    เพิกถอน
                  </button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="fixed inset-0 bg-black/40" />
                  <Dialog.Content className="panel fixed left-1/2 top-1/2 w-[min(28rem,92vw)] -translate-x-1/2 -translate-y-1/2 p-5">
                    <Dialog.Title className="text-base font-bold text-ink">
                      เพิกถอน “{k.label}” ?
                    </Dialog.Title>
                    <Dialog.Description className="mt-2 text-sm leading-6 text-muted-token">
                      เครื่องที่ใช้คีย์นี้จะเชื่อมต่อไม่ได้ทันที และย้อนกลับไม่ได้
                      ถ้าต้องการใช้อีกต้องออกคีย์ใบใหม่
                    </Dialog.Description>
                    <div className="mt-4 flex justify-end gap-2">
                      <Dialog.Close asChild>
                        <button type="button" className="btn-secondary">ยกเลิก</button>
                      </Dialog.Close>
                      <Dialog.Close asChild>
                        <button type="button" onClick={() => revoke(k.id)} className="btn-danger">
                          เพิกถอน
                        </button>
                      </Dialog.Close>
                    </div>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
            </div>
          ))}
        </section>
      )}

      {/* ── คู่มือเชื่อมต่อ (ดู Step 4b) ─────────────────────────── */}
      {/* ── การใช้งานล่าสุด (ดู Step 4c) ─────────────────────────── */}
    </div>
  )
}
```

> ชื่อคลาสอย่าง `btn-danger` / `border-warn` / `bg-warn-soft` ต้องเช็คก่อนว่ามีอยู่ใน
> `src/app/globals.css` จริง — ถ้าไม่มี **ห้ามคิดโทเคนใหม่** ให้ใช้ตัวที่ใกล้ที่สุด
> ที่มีอยู่แล้ว (ดูที่หน้าอื่นใช้) เพราะโทเคนสีมาจากเดโม่ที่อนุมัติแล้ว

- [ ] **Step 4b: บล็อกคู่มือเชื่อมต่อ**

**คัดลอกข้อความจากสเปก §8.1 ทั้งหมด** โดยเฉพาะบรรทัดเหล่านี้ห้ามตกหล่น:
   - `Settings → Customize → Connectors → + → Add custom connector` (เน้นคำว่า **Customize**)
   - Team/Enterprise: `Organization settings → Connectors → Add → ชี้ Custom → Web` — **เจ้าของบัญชีองค์กรเท่านั้น**
   - **แอปมือถือเพิ่มไม่ได้ ต้องเพิ่มบนเว็บ แล้วมันจะ sync ลงมือถือเอง**
   - Authentication เลือก **`None`** · กด Add แล้ว **สลับ tools เป็น `Always allow`**
   - บรรทัดปิดท้าย: *"ตรวจกับ claude.ai เมื่อ 31 ส.ค. 2569 — ถ้าหน้าจอจริงไม่ตรงกับนี้ ให้ยึดหน้าจอจริง"*
   - ส่วน ChatGPT: `Settings → Connectors → Advanced → เปิด Developer mode` + หมายเหตุว่าเส้นทางที่ตรวจแล้วคือฝั่ง Claude
   - **ห้ามพูดถึง `Request headers` ในหน้านี้** — ให้ทางเดียว

- [ ] **Step 4c: การใช้งานล่าสุด**

20 แถวจาก `calls`: ชื่อ tool · `✓`/`✗` จาก `ok` (ใช้ `Check`/`X` ของ lucide **ไม่ใช่ emoji**)
· `ms` · เวลาแบบ `fmt()` · ว่าง → `<EmptyState message="ยังไม่มีการเรียกใช้จาก AI">`

- [ ] **Step 5: typecheck + build**

```bash
npm run typecheck && npm run build
```

- [ ] **Step 6: ดูด้วยตาทั้งสองธีมและสามความกว้าง**

เปิด `http://localhost:3100/mcp` แล้วตรวจที่ **390 / 768 / 1440** ทั้ง **สว่างและมืด**
· URL ยาว ๆ ต้องไม่ดันหน้าจอกว้างออกไป — ใส่ `break-all` หรือ `overflow-x-auto` ให้กล่อง URL
· 🔴 วัดการล้นด้วย **ขอบขวาของแต่ละอิลิเมนต์เทียบความกว้างจอ** ไม่ใช่
`documentElement.scrollWidth` ซึ่งเป็น 0 เสมอเพราะเชลล์ `overflow-x: clip` ตัดทิ้งไปแล้ว

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/mcp"
git commit -m "feat(p9): หน้าเชื่อมต่อ AI — ออกคีย์ เพิกถอน และคู่มือที่ตรงกับหน้าจอจริง"
```

---

## Task 11: เมนู + แก้สัญญาดีไซน์ให้ตรงกัน

`nav.ts` เขียนกำกับว่าเมนูมาจากเดโม่ที่อนุมัติแล้ว "ห้ามคิดใหม่ · เพิ่ม/ลด ต้องกลับไปแก้เดโม่ก่อน"
และ `LOOP.md` ห้ามแตะ `DESIGN.md`/`demo.html` โดยไม่ถาม — **ถามและอนุมัติแล้ว 31 ส.ค. 2569**
จึงต้องแก้ทั้งสามที่ใน commit เดียว ไม่งั้นสามที่จะเพี้ยนจากกัน

**Files:**
- Modify: `src/components/shell/nav.ts`
- Modify: `docs/design/DESIGN.md` (§4 ตารางเมนู)
- Modify: `docs/design/demo.html`

- [ ] **Step 1: เพิ่มกลุ่มใน `nav.ts`**

เพิ่ม `Plug` เข้ารายการ import จาก `lucide-react` (เรียงตามตัวอักษร) แล้วต่อท้าย `NAV`:

```ts
  {
    heading: 'เชื่อมต่อ',
    items: [
      {
        href: '/mcp',
        label: 'เชื่อมต่อ AI',
        sub: 'ให้ Claude/ChatGPT อ่านข้อมูล',
        icon: Plug,
        ownerOnly: true,
      },
    ],
  },
```

`BOTTOM_NAV` และ `PRIMARY_ACTION` **ไม่เปลี่ยน** — แถบล่าง 5 ช่องเท่าเดิม
เมนูนี้จะไปโผล่ใน bottom sheet "เพิ่มเติม" เอง เพราะ sheet อ่านจาก `navFor()`

- [ ] **Step 2: ยืนยันว่าไม่ต้องแก้ที่อื่น**

`bottom-nav.tsx:19` เรียก `navFor(role)` แล้วคัดเฉพาะที่ยังไม่อยู่ในแถบล่างไปใส่ sheet
(ตรวจแล้ว) → เมนูใหม่จะโผล่ใน "เพิ่มเติม" **เอง** ไม่ต้องแตะไฟล์นั้น

```bash
grep -n "navFor" src/components/shell/bottom-nav.tsx src/components/shell/sidebar.tsx
```

คาดหวัง: เจอทั้งสองไฟล์ · **ถ้าไฟล์ไหนไม่ได้เรียก `navFor()` แปลว่ามันเขียนเมนูซ้ำไว้เอง
ต้องแก้ให้อ่านจากที่เดียว** ก่อนไปต่อ — ไม่งั้นเมนูใหม่จะโผล่บนเดสก์ท็อปแต่หายบนมือถือ

- [ ] **Step 3: แก้ `DESIGN.md` §4**

เพิ่มแถวในตารางเมนู (บรรทัดราว ๆ 147–163) ให้มีคอลัมน์ครบเหมือนแถวอื่น:
เส้นทาง `/mcp` · เห็นได้โดย `owner` · หมายเหตุ *"ออกคีย์ให้ Claude/ChatGPT อ่านข้อมูลแบบอ่านอย่างเดียว"*
และแก้บรรทัด 165 ที่ระบุรายการใน bottom sheet ให้มี "เชื่อมต่อ AI" ด้วย

- [ ] **Step 4: แก้ `demo.html` ให้มีเมนูเดียวกัน**

หา block ของ sidebar ในไฟล์แล้วเพิ่มกลุ่ม `เชื่อมต่อ` + รายการ `เชื่อมต่อ AI` ให้ตรงกับ `nav.ts`
· **ใช้ Write/Edit tool เท่านั้น ห้ามแก้ผ่าน PowerShell pipe** (ไฟล์มีข้อความไทย)

- [ ] **Step 5: contrast ต้องยังผ่านทั้งสองธีม**

```bash
npm run verify:contrast
```

- [ ] **Step 6: typecheck + build + ดูด้วยตา**

```bash
npm run typecheck && npm run build
```

เปิดที่ 390px ยืนยันว่า "เชื่อมต่อ AI" อยู่ใน bottom sheet "เพิ่มเติม" จริง
และล็อกอินเป็นหัวหน้าไซต์แล้ว **ต้องไม่เห็นเมนูนี้เลย**

- [ ] **Step 7: Commit**

```bash
git add src/components/shell docs/design/DESIGN.md docs/design/demo.html
git commit -m "feat(p9): กลุ่มเมนู เชื่อมต่อ + แก้เดโม่และ DESIGN.md ให้ตรงกัน"
```

---

## Task 12: สคริปต์ตรวจรับ + ปิดเฟส

**Files:**
- Create: `scripts/verify-mcp.mjs`
- Modify: `scripts/verify-all.mjs` (เพิ่ม `'verify-mcp'` เข้ารายการ)
- Modify: `docs/test-plan/P9.md` (ติ๊กสถานะตามผลจริง)
- Modify: `CLAUDE.md` (§14 เพิ่มบรรทัด P9 · §18 เพิ่ม `MCP_KEY_PEPPER`)
- Modify: `docs/LESSONS.md`

**Interfaces:**
- Consumes: ทุกอย่างจาก Task 3–11
- Produces: บรรทัดสรุปรูปแบบ `N แถว: ผ่าน X · ตก Y` ที่ `verify-all.mjs` แกะด้วย regex

- [ ] **Step 1: เขียนสคริปต์**

โครงเหมือน `scripts/verify-users.mjs` (อ่าน `.env.local` เอง · helper `check()` · `req()` · `sql()`)
· รับ base URL จาก `process.argv[2]` ค่าเริ่มต้น `http://localhost:3100`
· **ทุกบรรทัดที่พิมพ์ต้องขึ้นต้นด้วยรหัสแถวจาก `P9.md`**

> **เกณฑ์คือ `ตก 0` ไม่ใช่จำนวนแถวที่ตายตัว** — ตัวเลขที่ hard-code ไว้จะเพี้ยน
> ทุกครั้งที่มีคนเพิ่มแถว แล้วกลายเป็นตัวเลขที่ต้องไล่แก้ตามแทนที่จะบอกอะไร

ต้องพิสูจน์ครบทุกข้อต่อไปนี้:

```
P9-FN-03  ตัวเลขตรงกับแอป — เรียก mcp_sites ผ่าน SQL แล้วเทียบกับ site_money
          ที่เรียกด้วยการสวมสิทธิ์เดียวกัน ทุกไซต์ ทุกคอลัมน์เงิน ต้องเท่ากันเป๊ะ
          (เทียบเป็นสตริงหลัง ::numeric ไม่ใช่ float เพื่อไม่ให้ปัดเศษบังความต่าง)
P9-FN-04  mcp_overview เทียบกับ site_overview ด้วยวิธีเดียวกัน
P9-FN-05  เรียก mcp_overview ด้วย id ของหัวหน้าไซต์ → error MCP_ACTOR_NOT_OWNER
P9-PROTO-01  401 ไม่มี header www-authenticate  ← ข้อที่พลาดแล้วเจ็บที่สุด
P9-PROTO-02  GET /api/mcp/<key> → 405 และ header Allow เป็น POST
P9-PROTO-03  ข้อความไม่มี id → 202 และบอดี้ว่าง (content-length 0)
P9-PROTO-04  resources/list และ resources/templates/list → อาร์เรย์ว่าง ไม่มีคีย์ error
P9-PROTO-05  initialize สะท้อน protocolVersion ที่ส่งไป (ส่งค่าแปลก ๆ เข้าไปทดสอบ)
P9-PROTO-06  ไม่มี header mcp-session-id ในทุกคำตอบ
P9-SEC-01  คีย์ที่เพิกถอนแล้ว → 401
P9-SEC-02  rate limit → ยิงเกิน RATE_PER_MINUTE แล้วได้ isError พร้อมข้อความว่าเรียกถี่
P9-SEC-03  🔴 ไม่มีฟิลด์ blocklist หลุด — ยิงครบทุก tool รวม JSON ทั้งหมดเป็นสตริง
          แล้วหาคำเหล่านี้: client_phone · address · object_key · thumb_key
          · pin_hash · key_hash · @staff.invalid · endpoint · p256dh
P9-SEC-04  🔴 อ่านอย่างเดียวจริง — นับแถวทุกตารางก่อน/หลังยิงครบทุก tool
          ต้องเท่ากันทุกตาราง **ยกเว้น mcp_call_log ที่ต้องเพิ่มขึ้น**
P9-DB-04  audit_row ตัดทั้ง pin_hash และ key_hash (แก้อย่างละแถวแล้วอ่าน audit_log)
```

🔴 **สคริปต์ต้องคืนฐานข้อมูลให้เหมือนตอนที่เจอ ใน `finally`** — คีย์ทดสอบที่สร้างขึ้น
ต้องถูกลบทิ้ง และ `mcp_call_log` ของคีย์นั้นหายไปเองด้วย `on delete cascade`
· ล้างเฉพาะของที่**สคริปต์นี้สร้างเอง** ห้ามล้างแบบไม่มีเงื่อนไข (`CLAUDE.md` §17 ข้อ 9)

โครงและสามแถวที่ยากที่สุด เขียนเป็นโค้ดจริงไว้ให้แล้ว ที่เหลือทำตามแบบเดียวกัน:

```js
#!/usr/bin/env node
/**
 * verify-mcp.mjs — ปิดแถว P9-* (ตัวเชื่อม MCP)
 *
 * 🔴 แถวที่สำคัญที่สุดคือ P9-SEC-04 "อ่านอย่างเดียวจริง" — tool ที่เขียนข้อมูลได้
 * โดยไม่มีใครตั้งใจ จะไม่มีอาการอะไรเลยจนกว่าจะสาย · นับแถวก่อน/หลังเท่านั้น
 * ที่พิสูจน์ได้ การอ่านโค้ดแล้วบอกว่า "ไม่มี insert" ไม่ใช่หลักฐาน
 */
import { readFileSync } from 'node:fs'
import { generateKey, hashKey, keyPrefix } from '../src/lib/mcp/keys-core.ts'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)

const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const sql = async (q) => {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: q }),
    },
  )
  const t = await r.text()
  if (!r.ok) throw new Error(t.slice(0, 500))
  return JSON.parse(t)
}

const rpc = (url, body, extra = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify(body),
  })

/** ตารางที่ต้องไม่มีแถวเปลี่ยนเลยหลังยิงครบทุก tool */
const READONLY_TABLES = [
  'sites', 'site_finance', 'site_supervisors', 'site_milestones', 'transactions',
  'attachments', 'categories', 'employees', 'employee_wages', 'attendance',
  'attendance_wages', 'advances', 'payroll_runs', 'payroll_lines', 'profiles',
  'branding', 'app_settings', 'notifications', 'push_subscriptions', 'mcp_keys',
]
const countAll = async () => {
  const parts = READONLY_TABLES.map((t) => `select '${t}' as t, count(*)::int as n from public.${t}`)
  const rows = await sql(parts.join(' union all '))
  return Object.fromEntries(rows.map((r) => [r.t, r.n]))
}

/** ฟิลด์ที่ห้ามหลุดออกไปที่คลาวด์ AI ไม่ว่าจะทางไหน (สเปก §7.1) */
const BLOCKLIST = [
  'client_phone', 'object_key', 'thumb_key', 'pin_hash', 'key_hash',
  '@staff.invalid', 'p256dh', 'endpoint', 'tax_id',
]

console.log('\n── P9 · ตัวเชื่อม MCP ─────────────────────────────────────')

let keyId = null
const secret = generateKey()
const url = `${BASE}/api/mcp/${secret}`

try {
  // สร้างคีย์ทดสอบตรงในฐานข้อมูล — ไม่ผ่าน UI เพราะอยากทดสอบ endpoint ไม่ใช่ฟอร์ม
  const [owner] = await sql(
    `select id from public.profiles where role='owner' and is_active limit 1`,
  )
  const [row] = await sql(`
    insert into public.mcp_keys (label, key_hash, key_prefix, created_by)
    values ('verify-mcp ชั่วคราว',
            '${hashKey(env.MCP_KEY_PEPPER, secret)}',
            '${keyPrefix(secret)}',
            '${owner.id}')
    returning id
  `)
  keyId = row.id

  // ── P9-PROTO-01 · 🔴 แถวที่พลาดแล้วเจ็บที่สุดในเฟสนี้ ────────────
  {
    const r = await rpc(`${BASE}/api/mcp/k_${'a'.repeat(43)}`, {
      jsonrpc: '2.0', id: 1, method: 'ping',
    })
    const wa = r.headers.get('www-authenticate')
    check(
      'P9-PROTO-01 คีย์ผิด → 401 และ **ไม่มี** WWW-Authenticate',
      r.status === 401 && wa === null,
      `${r.status} · www-authenticate=${wa ?? '(ไม่มี ถูกต้อง)'}`,
    )
  }

  // ── P9-FN-03 · ตัวเลขต้องตรงกับที่แอปคำนวณ ถึงสตางค์ ────────────
  {
    // เทียบเป็น text หลัง ::numeric — เทียบเป็น float จะปัดเศษกลบความต่างทิ้ง
    const rows = await sql(`
      with mine as (
        select (e->>'id')::uuid as site_id,
               (e->>'cost_total')::numeric  as mcp_cost,
               (e->>'income_approved')::numeric as mcp_income
        from jsonb_array_elements(
          public.mcp_sites('${owner.id}', null, 100, 0)
        ) e
      ),
      theirs as (
        select site_id, cost_total, income_approved
        from public.mcp_via_app_rpc('${owner.id}')
      )
      select count(*) filter (
               where mine.mcp_cost::text is distinct from theirs.cost_total::text
                  or mine.mcp_income::text is distinct from theirs.income_approved::text
             )::int as ต่างกัน,
             count(*)::int as ทั้งหมด
      from mine join theirs on theirs.site_id = mine.site_id
    `)
    check(
      'P9-FN-03 ตัวเลขจาก MCP = ตัวเลขจาก RPC ของแอป ทุกไซต์',
      rows[0].ต่างกัน === 0 && rows[0].ทั้งหมด > 0,
      `ต่าง ${rows[0].ต่างกัน} จาก ${rows[0].ทั้งหมด} ไซต์`,
    )
  }

  // ── P9-SEC-03 + P9-SEC-04 · ยิงครบทุก tool แล้วตรวจสองอย่างพร้อมกัน ──
  {
    const before = await countAll()
    const blob = []

    const tools = [
      ['get_metric_definitions', {}],
      ['get_company_overview', {}],
      ['list_sites', { limit: 100 }],
      ['search_transactions', { limit: 100 }],
      ['get_pending_approvals', { limit: 100 }],
      ['get_payroll_summary', { limit: 50 }],
    ]
    for (const [name, args] of tools) {
      const r = await rpc(url, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name, arguments: args },
      })
      blob.push(await r.text())
    }
    // get_site_detail ต้องมี site_id จริง จึงยิงแยกหลังรู้ id
    const [anySite] = await sql('select id from public.sites limit 1')
    if (anySite) {
      const r = await rpc(url, {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'get_site_detail', arguments: { site_id: anySite.id } },
      })
      blob.push(await r.text())
    }

    const all = blob.join('\n')
    const leaked = BLOCKLIST.filter((f) => all.includes(f))
    check(
      'P9-SEC-03 ไม่มีฟิลด์ใน blocklist หลุดออกไปแม้แต่ตัวเดียว',
      leaked.length === 0,
      leaked.length ? `หลุด: ${leaked.join(', ')}` : 'สะอาด',
    )

    const after = await countAll()
    const changed = READONLY_TABLES.filter((t) => before[t] !== after[t])
    check(
      'P9-SEC-04 ยิงครบทุก tool แล้วไม่มีตารางไหนแถวเปลี่ยน',
      changed.length === 0,
      changed.length ? `เปลี่ยน: ${changed.join(', ')}` : `${READONLY_TABLES.length} ตารางเท่าเดิม`,
    )
  }

  // … แถวที่เหลือทำตามแบบเดียวกัน:
  // P9-FN-04 mcp_overview = site_overview
  // P9-FN-05 หัวหน้าไซต์เป็น p_actor → error MCP_ACTOR_NOT_OWNER
  // P9-PROTO-02 GET → 405 + Allow: POST
  // P9-PROTO-03 ไม่มี id → 202 + บอดี้ว่าง
  // P9-PROTO-04 resources/list + resources/templates/list → []
  // P9-PROTO-05 initialize สะท้อน protocolVersion ที่ส่งไป
  // P9-PROTO-06 ไม่มี header mcp-session-id
  // P9-SEC-01 เพิกถอนแล้ว → 401
  // P9-SEC-02 ยิงเกินเพดาน → isError พร้อมข้อความว่าเรียกถี่
  // P9-DB-04 audit_row ตัดทั้ง pin_hash และ key_hash
} finally {
  // 🔴 คืนฐานให้เหมือนตอนที่เจอ — ลบเฉพาะคีย์ที่สคริปต์นี้สร้างเอง
  // mcp_call_log ของคีย์นี้หายตามด้วย on delete cascade
  if (keyId) await sql(`delete from public.mcp_keys where id = '${keyId}'`)
}

const pass = results.filter((r) => r.ok).length
console.log(`\n  ${results.length} แถว: ผ่าน ${pass} · ตก ${results.length - pass}\n`)
process.exit(pass === results.length ? 0 : 1)
```

> **`mcp_via_app_rpc` ในแถว P9-FN-03 ไม่มีอยู่จริง** — ต้องเขียนตัวเทียบเอง โดยวิธีที่
> ตรงที่สุดคือ **สวมสิทธิ์แล้วเรียก `site_money(null)` ตรง ๆ ในคำสั่งเดียวกัน**:
> `select set_config('request.jwt.claims', json_build_object('sub','<owner>','role','authenticated')::text, true)`
> แล้วค่อย `select * from public.site_money(null)` ใน statement ถัดไปของทรานแซกชันเดียวกัน
> · ⚠️ Management API รันแต่ละคำขอเป็นคนละทรานแซกชัน จึงต้องรวมเป็น **คำสั่ง `do`/CTE
> เดียว** หรือใช้ `mcp_sites` เทียบกับค่าที่คำนวณจาก `transactions` + `attendance_wages`
> ตรง ๆ · เลือกวิธีไหนก็ได้ที่ทำให้แถวนี้ **แดงได้จริงเมื่อสูตรเพี้ยน** — แถวที่แดงไม่เป็น
> แย่กว่าไม่มีแถวนั้นเลย

- [ ] **Step 2: รันสคริปต์**

```bash
npm run dev -- -p 3100 &
node scripts/verify-mcp.mjs http://localhost:3100
```

คาดหวัง: บรรทัดสรุปลงท้ายด้วย **`· ตก 0`**
· **ถ้าข้อไหนตก ห้ามแก้สคริปต์ให้ผ่าน** — แก้โค้ดที่ทำให้มันตก
· **ห้ามลบแถวที่ตกทิ้งเพื่อให้ตัวเลขสวย** — แถวที่หายไปคือแถวที่ไม่มีวันแดงอีกเลย

- [ ] **Step 3: เพิ่มเข้า `verify-all.mjs`**

ใส่ `'verify-mcp'` ในอาร์เรย์ `SCRIPTS` **ก่อน** `'verify-ship'` (ตัวนั้นต้องอยู่ท้ายเสมอ)

```bash
node scripts/verify-all.mjs
```

คาดหวัง: ไม่มีสคริปต์เดิมตัวไหนเปลี่ยนจากเขียวเป็นแดง
· 🔴 **`verify-ledger` ต้องยังเขียว** — Task 2 ย้าย `searchTerms` ออกจากหน้า ledger
ถ้ามันแดงแปลว่าการย้ายทำพฤติกรรมเปลี่ยน

- [ ] **Step 4: ติ๊ก `docs/test-plan/P9.md` ตามผลจริง**

- แถวที่สคริปต์พิสูจน์แล้ว → `✅` **พร้อมชื่อสคริปต์กำกับ**
- แถวหน้าจอที่ดูด้วยตา → `👤` พร้อมบอกว่าดูอะไรที่ความกว้างไหน
- 🔴 แถว `P9-SHIP-01` (ต่อจาก claude.ai จริง) → **`👤`** พร้อมเหตุผล:
  *"Claude เรียกจากคลาวด์ localhost ไม่มีทางถึง · LOOP.md ยังไม่อนุญาตให้ deploy หรือเปิด tunnel
  · ต้องกดตอน deploy: 1) ตั้ง `MCP_KEY_PEPPER` ค่าเดียวกับในเครื่องใน Vercel
  2) ใช้ URL production ไม่ใช่ preview (Deployment Protection ตอบกำแพงที่ connector ผ่านไม่ได้)
  3) ออกคีย์ใหม่จากหน้า /mcp บน production 4) เพิ่มใน claude.ai แล้วสลับ tools เป็น Always allow"*
- **ห้ามเหลือ `☐` แม้แต่แถวเดียว** — ปิดไม่ได้ต้องเป็น `👤` หรือ `⚠️` พร้อมเหตุผลที่เขียนไว้จริง

- [ ] **Step 5: อัปเดต `CLAUDE.md`**

- §14: เพิ่ม `- [x] **P9 · ตัวเชื่อม MCP** — …` ต่อจาก P8 และย้ายออกจาก "เฟสหลัง" ถ้ามีระบุไว้
- §18: เพิ่ม `MCP_KEY_PEPPER=` ในบล็อก env พร้อมหมายเหตุ *"สร้างให้ (random 32 bytes)"*
  และเพิ่มข้อ 4 ใน "เช็คก่อน deploy": *"`MCP_KEY_PEPPER` ใน Vercel ต้องเป็นค่าเดียวกับในเครื่อง —
  สร้างใหม่ = คีย์ที่ออกให้เจ้าของไปแล้วตายทุกใบ"*

- [ ] **Step 6: บันทึกบทเรียนลง `docs/LESSONS.md`**

อย่างน้อยสามข้อที่เจอจริงในเฟสนี้:

1. **`node --test tests/unit` ตกบนเครื่องนี้โดยไม่บอกสาเหตุ** — ต้องใช้
   `node --test "tests/unit/*.test.mjs"` (glob ในเครื่องหมายคำพูด) · วัดบน Node v26.2.0 / Windows
2. **`401 + WWW-Authenticate` คือสัญญาณ OAuth ไม่ใช่ "แจ้งว่าคีย์ผิด"** — เป็นสิ่งที่วิศวกร
   ที่รอบคอบจะ *ตั้งใจ* ใส่เพราะดูถูกต้องตามสเปก แล้วมันจะทำให้ connector ที่กำลังสร้างพัง
3. **service_role ไม่มีตัวตน** — RPC ที่ห่อด้วย `is_owner()` คืน null ทั้งแผงเมื่อเรียกด้วย
   service key · แก้ด้วยการตั้ง `request.jwt.claims` แบบผูกทรานแซกชันแล้วเรียกของเดิม
   ดีกว่าคัดลอกสูตรมาไว้สองที่

- [ ] **Step 7: gate เต็มก่อน commit สุดท้าย**

```bash
npm run gate
```

(= `typecheck` + `verify:contrast` + `build` — ต้องเขียวทั้งสาม)

- [ ] **Step 8: Commit**

```bash
git add scripts/verify-mcp.mjs scripts/verify-all.mjs docs/test-plan/P9.md \
        CLAUDE.md docs/LESSONS.md
git commit -m "test(p9): ตรวจรับตัวเชื่อม MCP 13 แถว + ปิดเฟส P9"
```

---

## เงื่อนไขปิดเฟส

ปิด P9 ได้เมื่อครบทุกข้อ — ขาดข้อเดียวคือยังไม่ปิด

- [ ] `npm run gate` เขียว
- [ ] `node --test "tests/unit/*.test.mjs"` ผ่านทุกข้อ
- [ ] `node scripts/verify-mcp.mjs` ลงท้ายด้วย `· ตก 0`
- [ ] `node scripts/verify-all.mjs` ไม่มีสคริปต์เดิมตัวไหนเปลี่ยนเป็นแดง
- [ ] `node scripts/db.mjs advisors security` ได้ `ERROR 0`
- [ ] `docs/test-plan/P9.md` **ไม่เหลือ `☐` แม้แต่แถวเดียว**
- [ ] เมนูตรงกันสามที่: `nav.ts` · `DESIGN.md §4` · `demo.html`
- [ ] หน้า `/mcp` ดูแล้วทั้งสว่าง/มืด ที่ 390 / 768 / 1440
- [ ] หัวหน้าไซต์เปิด `/mcp` แล้ว**เด้งจริงตั้งแต่ฝั่งเซิร์ฟเวอร์** ไม่ใช่ 200
