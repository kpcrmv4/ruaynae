# CLAUDE.md — ระบบจัดการโปรเจ็คงานรับเหมาก่อสร้าง

> เอกสารนี้คือ **แผนหลักและแหล่งความจริง** ของโปรเจ็ค
> ดีไซน์ที่อนุมัติแล้วอยู่ที่ [`docs/design/DESIGN.md`](docs/design/DESIGN.md) + [`docs/design/demo.html`](docs/design/demo.html)
> โทเคนสีและเมนู **มาจากเดโม่ที่อนุมัติแล้ว ห้ามคิดใหม่**

---

## 1. ผลิตภัณฑ์

เว็บแอปสำหรับผู้รับเหมาก่อสร้างรายเล็ก-กลาง (**บริษัทเดียว ไม่ใช่ SaaS หลายผู้เช่า**)
บันทึกรายรับ-รายจ่ายรายวันต่อไซต์งาน แนบสลิป/บิล จัดการพนักงานและค่าแรง
และให้เจ้าของเห็นว่าแต่ละโปรเจ็คคืบหน้าแค่ไหน เก็บเงินได้เท่าไหร่ เหลือกำไรเท่าไหร่

ผู้ใช้จริงไม่ชำนาญคอมพิวเตอร์ และใช้งานหลักบนมือถือกลางไซต์ → การ์ดโปร่ง ตัวหนังสือใหญ่ ขั้นตอนน้อย

## 2. Role

| Role | ล็อกอิน | เห็น | ทำได้ |
|---|---|---|---|
| `owner` | อีเมล + รหัสผ่าน | ทุกไซต์ ทุกตัวเลข กำไร audit log | ทุกอย่าง · อนุมัติ/ตีกลับ · ปิดรอบจ่ายค่าแรง · CRUD ทั้งหมด |
| `site_supervisor` | PIN 6 หลัก | เฉพาะไซต์ที่ดูแล **ณ ช่วงเวลานั้น** | คีย์รายจ่ายไซต์ตัวเอง (เข้าคิวรออนุมัติ) · ลงชื่อคนเข้าไซต์ · บันทึกเบิกล่วงหน้า |

**คนงานไม่ล็อกอิน** — เป็นแถวใน `employees` ไม่ใช่ผู้ใช้ระบบ `role` ถูกกำหนดฝั่งเซิร์ฟเวอร์เท่านั้น ห้ามเชื่อ metadata จาก client

## 3. Tech stack

| ชั้น | ของที่ใช้ |
|---|---|
| Framework | Next.js 16 App Router + React + TypeScript · **`src/proxy.ts` ไม่ใช่ `middleware.ts`** |
| CSS | Tailwind v4 (CSS-first `@theme inline`) + โทเคนจาก `thai-admin-page-kit/tokens.css` |
| ฐานข้อมูล/Auth | Supabase **Cloud** (สิงคโปร์ `ap-southeast-1`) · `@supabase/ssr` ล่าสุด |
| Data fetching | `@tanstack/react-query` |
| ธีม | `next-themes` (class strategy) |
| ไอคอน | `lucide-react` — **ห้าม emoji** |
| Toast | `sonner` — **ห้าม `alert()`** |
| Modal | `@radix-ui/react-dialog` |
| รูปภาพ | `browser-image-compression` → **Cloudflare R2** ผ่าน `@aws-sdk/client-s3` + `s3-request-presigner` |
| Push | `web-push` (VAPID) |
| PDF (เฟสหลัง) | `@react-pdf/renderer` |
| Deploy | Vercel Hobby · `vercel.json` → `{ "regions": ["sin1"] }` |

## 4. ดีไซน์

โทเคนสว่าง+มืดฉบับเต็มอยู่ใน [`DESIGN.md` §3](docs/design/DESIGN.md) — **คัดลอกลง `src/app/globals.css` แบบตรงตัว**

ขั้นตอนตอน scaffold:
1. คัดลอก `thai-admin-page-kit/tokens.css` และ `components/ui/*` เข้ามาทั้งไฟล์ (อย่าเขียนเทียบเคียงเอง)
2. แทนที่เฉพาะบล็อก `BRAND` + `SIDEBAR` + เพิ่ม `MONEY` / `bar-*` ด้วยค่าจาก DESIGN.md
3. รัน `verify-contrast.mjs` ของ kit — ต้องผ่านทั้งสองธีมก่อนไปต่อ

จุดสำคัญที่ต้องไม่หลุด:
- `--brand` (#1d4ed8) ใช้ได้ทั้งสีตัวหนังสือและพื้นปุ่ม — ผ่าน AA 6.70:1 ทั้งคู่
- sidebar เป็น **กรมท่าเข้ม ไม่ใช่สีแบรนด์**
- **เงายกระดับต้องเป็นสีกลางเสมอ** เงาสีแบรนด์บนพื้นเข้ม = แสงเรือง ไม่ใช่ความสูง
- IBM Plex Sans Thai · `line-height: 1.5` ขั้นต่ำ · เงินทุกที่ `tabular-nums`
- เมนูและปุ่มกลางแถบล่าง: ดู [`DESIGN.md` §4](docs/design/DESIGN.md)

## 5. โครงข้อมูล Postgres

### Enums
```sql
create type user_role      as enum ('owner','site_supervisor');
create type site_status    as enum ('planning','active','paused','done','cancelled');
create type txn_kind       as enum ('income','expense');
create type txn_status     as enum ('pending','approved','rejected');
create type pay_method     as enum ('cash','transfer');
create type income_kind    as enum ('deposit','installment','variation_order','other');
create type wage_type      as enum ('daily','monthly');
create type payroll_status as enum ('open','closed');
```

### ตาราง

| ตาราง | สาระสำคัญ | RLS |
|---|---|---|
| `branding` | แถวเดียว: `company_name`, `logo_object_key`, `updated_at` | **`anon` SELECT ได้** (หน้า login ต้องอ่านตอนยังไม่ล็อกอิน) · UPDATE เฉพาะ owner |
| `app_settings` | แถวเดียว: ที่อยู่, เลขผู้เสียภาษี, ผู้ลงนาม, นโยบายเก็บรูป ฯลฯ | **owner เท่านั้น ทั้งอ่านและเขียน** |
| `profiles` | `id → auth.users`, `full_name`, `role`, `pin_hash` (HMAC + pepper, unique), `is_active` | อ่านตัวเอง · owner อ่าน/เขียนทั้งหมด · **`role` แก้ได้เฉพาะ owner (guard trigger)** |
| `sites` | `name`, `client_name`, `contract_amount`, `start_date`, `end_date`, `status` | owner ทั้งหมด · supervisor อ่านเฉพาะไซต์ที่ดูแล |
| `site_supervisors` | `site_id`, `profile_id`, **`effective_from`, `effective_to`** | owner เขียน · supervisor อ่านแถวตัวเอง |
| `site_milestones` | แผนงวดล่วงหน้า (ไม่บังคับ): `seq`, `name`, `planned_amount`, `planned_date`, `collected_txn_id` | ตามไซต์ |
| `categories` | `name`, `kind`, `is_active`, `sort_order` | อ่านได้ทุก role · เขียนเฉพาะ owner |
| `employees` | `full_name`, `job_title`, `wage_type`, `daily_rate`, `monthly_salary`, `default_site_id`, `is_active`, **`profile_id`** (NULL = ไม่มีบัญชีล็อกอิน) | owner ทั้งหมด · supervisor อ่านคนที่เคยเข้าไซต์ตัวเอง |
| `attendance` | `work_date`, `site_id`, `employee_id`, `work_units`, `ot_amount`, **`wage_snapshot`**, `amount` (generated) | supervisor เขียนได้เฉพาะไซต์ตัวเองและวันที่ยังไม่ปิดรอบ |
| `transactions` | `kind`, `site_id` (NULL = ส่วนกลาง), `category_id`, `amount`, `txn_date`, `pay_method`, `status`, `income_kind`, `installment_no` | supervisor เขียน `pending` ของไซต์ตัวเอง · **แก้เป็น `approved` ได้เฉพาะ owner** |
| `attachments` | `transaction_id`, `object_key`, `thumb_key`, `byte_size`, `content_type` | ตาม transaction |
| `upload_intents` | `object_key`, `thumb_key`, `created_by`, `site_id`, `expires_at`, `consumed_at` | ของตัวเองเท่านั้น |
| `advances` | เบิกล่วงหน้า: `employee_id`, `amount`, `advance_date`, `pay_method`, `site_id`, `payroll_run_id` | supervisor เขียนของไซต์ตัวเอง |
| `payroll_runs` | `period_start`, `period_end`, `site_id`, `status`, `total_accrued`, `total_advance_deducted`, `total_paid` | **owner เท่านั้น** |
| `payroll_lines` | `run_id`, `employee_id`, `days`, `accrued`, `advance_deducted`, `net_paid` | ตาม run |
| `audit_log` | `table_name`, `row_id`, `action`, `actor`, `before` jsonb, `after` jsonb, `at` | **อ่านได้เฉพาะ owner · ไม่มี policy ให้ UPDATE/DELETE กับใครทั้งนั้น** |
| `notifications` | `user_id`, `kind`, `title`, `body`, `link`, `read_at` | ของตัวเอง |
| `push_subscriptions` | `user_id`, `endpoint` (unique), `p256dh`, `auth`, `last_ok_at` | ของตัวเอง |

### "คน" กับ "ผู้ใช้ระบบ" เป็นคนละเรื่อง — อย่ายุบเป็นตารางเดียว

| | `employees` (คน) | `profiles` (ผู้ใช้ระบบ) |
|---|---|---|
| คือใคร | ทุกคนที่มีค่าแรงต้องจ่าย | ทุกคนที่ล็อกอินเข้าระบบได้ |
| ล็อกอินได้ | ไม่ (ค่าเริ่มต้น) | ใช่ |
| มี role | **ไม่มี** | `owner` / `site_supervisor` |
| ตัวอย่าง | ช่างปูน กรรมกร ที่มีแค่ชื่อกับค่าแรง | เจ้าของ · หัวหน้าไซต์ |

คนส่วนใหญ่มีแต่แถวใน `employees` · บางคน (เช่นหัวหน้าไซต์ที่กินเงินเดือนด้วย) มีทั้งสองแถว
เชื่อมด้วย `employees.profile_id` · ห้ามยุบเป็นตารางเดียวแล้วใส่ `role = NULL` เพราะ
สร้าง `auth.users` ให้คนที่ไม่มีวันล็อกอินคือการเปิดบัญชีทิ้งไว้เปล่า ๆ ให้กิน MAU และกลายเป็นช่องโหว่

**ค่าแรงตั้งรายคนเสมอ** (`wage_type` + `daily_rate` / `monthly_salary` บน `employees`)
ไม่มีค่าแรงกลางของระบบ ไม่มีใน `constants.ts` ไม่มีใน `app_settings`

### ชื่อบริษัทและโลโก้อยู่ในฐานข้อมูล ไม่ใช่ใน `constants.ts`

ต้องแก้ได้จากหน้าตั้งค่า และต้องแสดงทั้งบน **หน้า login** และ **หัวระบบ (sidebar / topbar มือถือ)**

- หน้า login ทำงานตอน **ยังไม่ล็อกอิน** → `branding` ต้องเปิดให้ `anon` SELECT ได้
- ⚠️ **RLS ของ Postgres คุมระดับแถว ไม่ใช่ระดับคอลัมน์** — จึงต้อง**แยกตาราง** ไม่ใช่แยกคอลัมน์
  ถ้าเอาชื่อบริษัทไปอยู่ตารางเดียวกับเลขผู้เสียภาษี/เลขบัญชีธนาคาร วันที่มีคนเติมข้อมูลพวกนั้น
  มันจะหลุดออกหน้า login ทันทีโดยไม่มีใครสังเกต — `branding` (สาธารณะ) ต้องแยกจาก `app_settings` (ลับ) เด็ดขาด
- หน้า login กับ shell เป็น Server Component ทั้งคู่ จึงอ่าน `branding` จากฐานข้อมูล**ตรง**
  ผ่าน `lib/branding.ts` ไม่ต้องผ่าน HTTP · **ยังไม่สร้าง `/api/branding`** เพราะจะได้ endpoint
  ที่ไม่มีใครเรียก ซึ่งผิดกฎ "ทุก endpoint ต้องมีปุ่มที่เรียกมันจริง" (§15)
  → สร้างตอน P7 เมื่อ PWA manifest/service worker ต้องใช้ พร้อม presigned GET ของโลโก้
- ต้องมีค่า fallback ตอนยังไม่ได้ตั้งค่า และตอน R2 ล่ม — หน้า login ห้ามพังเพราะโหลดโลโก้ไม่ได้

### กฎที่ต้องบังคับที่ฐานข้อมูล ไม่ใช่แค่หน้าจอ

1. **เพดานเบิกล่วงหน้า** — trigger `before insert/update on advances`:
   `เพดาน = Σ attendance.amount (ยังไม่ปิดรอบ) − Σ advances.amount (ยังไม่หัก)` เกินแล้ว `raise exception`
2. **`wage_snapshot` ห้ามแก้หลังปิดรอบ** — guard trigger บน `attendance`
3. **`transactions.status`** — supervisor เปลี่ยนเป็น `approved` ไม่ได้ · แก้ `amount` หลัง `approved` ไม่ได้
4. **`profiles.role`** — เปลี่ยนได้เฉพาะ owner
5. **Audit trigger** ติดกับ **ทุกตาราง** ในรายการข้างบน

### Helper `SECURITY DEFINER`
```sql
is_owner() -> boolean
supervises_site(p_site uuid, p_on date default current_date) -> boolean
```
⚠️ **ห้ามใส่ทางลัด `auth.uid() is null` เพื่อให้ service-role ผ่าน** ในฟังก์ชันที่ `anon` เรียกได้ —
นั่นคือช่องที่เปิดข้อมูลทั้งระบบให้คนที่ยังไม่ล็อกอิน
⚠️ **ขอบเขตไซต์ไม่ใช่การเช็ค role** — `supervises_site()` บอกแค่ว่าอยู่ไซต์นั้นไหม ไม่ได้บอกว่าอนุมัติได้

### Index
FK ทุกตัว + คอลัมน์ที่ใช้กรองจริง:
`transactions(txn_date desc)` · `transactions(site_id, txn_date desc)` · `transactions(status) where status='pending'`
`attendance(work_date, site_id)` · `attendance(employee_id, work_date)` · `advances(employee_id, advance_date)`
`audit_log(table_name, row_id)` · `audit_log(at desc)`

### สมาชิกไซต์ต้องมีช่วงเวลา
`site_supervisors` **ต้อง**มี `effective_from` / `effective_to` — ถ้าเก็บแค่ "ใครดูแลไซต์ไหน" แบบไม่มีวันที่
พอย้ายหัวหน้าไซต์ รายงานย้อนหลังจะเปลี่ยนเจ้าของตามไปด้วย และคนที่ย้ายออกจะเห็นข้อมูลใหม่ที่ไม่ควรเห็น
ใช้ `btree_gist` + exclusion constraint กันช่วงเวลาซ้อนกัน

## 6. เชื่อม Supabase

**PAT เฉพาะโปรเจ็คนี้** — ตั้ง `SUPABASE_PROJECT_REF` + `SUPABASE_ACCESS_TOKEN` แล้วรัน `/setup-supabase-mcp`
เปิด **read-only** จนกว่าจะสั่งเขียนชัดเจน · Supabase = **Cloud** (PAT ใช้ management API ซึ่งมีเฉพาะฝั่ง cloud)

### คีย์ API — ใช้ชุดใหม่เท่านั้น (ตัดสินใจแล้ว 30 ส.ค. 2569)

Dashboard → **Settings → API Keys** → แท็บ **"Publishable and secret API keys"**

| ใช้ที่ | คีย์ | แทน |
|---|---|---|
| เบราว์เซอร์ (เปิดเผยได้) | `sb_publishable_…` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `anon` |
| เซิร์ฟเวอร์เท่านั้น | `sb_secret_…` → `SUPABASE_SECRET_KEY` | `service_role` |

**ห้ามใช้ legacy `anon` / `service_role`** — หมดการรองรับสิ้นปี 2026 และผูกกับ JWT secret ของโปรเจ็ค
ทำให้หมุนคีย์ทีเดียวดับทั้งระบบ · คีย์ใหม่สร้าง/เพิกถอนแยกใบได้

สิ่งที่เปลี่ยนไปและกระทบโค้ดเรา:
- **secret key ไม่ใช่ JWT** — ถ้าเรียก endpoint ของ Supabase จาก `pg_net`/Database Webhook
  ต้องส่งบน header **`apikey`** ไม่ใช่ `Authorization: Bearer` (แบบเดิมจะโดนปฏิเสธ)
  · cron ของเรายิงเข้า API ของตัวเองด้วย `CRON_SECRET` จึงยังไม่กระทบ แต่ถ้าวันหน้าเพิ่ม Edge Function ต้องจำข้อนี้
- secret key ตอบ **HTTP 401 ถ้าถูกเรียกจากเบราว์เซอร์** (ตรวจจาก User-Agent) — ตาข่ายรองเผื่อ import ผิดฝั่ง
- ไม่มี claim `role: service_role` ใน JWT ให้เช็คอีกต่อไป → ยิ่งยืนยันว่าห้ามเขียนทางลัด service-role ใน helper (ดู §5)

### ขั้นตอนแก้ฐานข้อมูล (ทุกครั้ง ไม่มีข้อยกเว้น)
1. **เช็คเป้าหมายก่อน** — `get_project_url` ต้องตรงกับ `NEXT_PUBLIC_SUPABASE_URL` ใน `.env.local`
2. เขียนเป็น **ไฟล์ migration** ใน `supabase/migrations/` **และ** สั่งผ่าน MCP `apply_migration`
3. `generate_typescript_types` → `src/lib/database.types.ts`
4. `get_advisors` (security + performance) → แก้ให้เขียวก่อนไปต่อ

## 7. กฎเรื่องปริมาณข้อมูล

**PostgREST ตัดผลลัพธ์ที่ 1,000 แถวเงียบ ๆ ไม่มี error** — ข้อมูลหายไปเฉย ๆ ออกแบบเผื่อไว้ตั้งแต่วันนี้

- ทุก query ที่เป็นลิสต์ **ต้องมี `.order()` + `.range()`** ห้ามพึ่งค่าเริ่มต้น
- ตัวเลขบนแดชบอร์ดใช้ `head: true, count: 'exact'` หรือ RPC/view ที่ aggregate ในฐานข้อมูล **ห้ามดึงแถวมานับใน JS**
- หน้ารายการยาว (`/ledger`, `/audit`) ใช้ `useInfiniteQuery` + keyset pagination
- ส่งออก/รายงานช่วงวันยาว ทำเป็นก้อน ๆ
- ค้นหาที่ยัดคำเข้า `.or()` ต้อง escape — **คอมมาในช่องค้นหาจะกลายเป็นเงื่อนไขที่สอง**

## 8. เรียลไทม์และงานตามเวลา

- เรียลไทม์ = **broadcast-from-database** (trigger → `realtime.messages` + policy) ไม่ใช่ subscribe ตาราง
- งานตามเวลา = **pg_cron + pg_net** ไม่ใช่ Vercel cron (Hobby ได้แค่ 2 งาน วันละครั้ง)
- pg_cron ทำงานเป็น **UTC** — งานที่ต้องยิงตอน 8 โมงเช้าไทยคือ `0 1 * * *`
- งานที่ต้องมี:
  - `sweep-orphans` ทุกชั่วโมง → เรียก `/api/cron/sweep-orphans` ลบไฟล์ R2 ที่ `upload_intents` หมดอายุแล้วไม่มีคนใช้
  - `daily-digest` 8 โมงเช้าไทย → แจ้งเจ้าของว่ามีกี่รายการค้างอนุมัติ

## 9. รูปสลิป — Cloudflare R2

ข้อตกลงฉบับเต็มอยู่ที่ [`DESIGN.md` §6](docs/design/DESIGN.md) สรุปที่ต้องทำ:

```
client บีบรูป (WebP 1600px + thumb 320px)
  → POST /api/uploads/sign   ← เช็ค session + role + supervises_site()
  → คืน presigned PUT 2 อัน + สร้างแถว upload_intents
  → browser PUT ตรงเข้า R2  (ไบต์ไม่ผ่าน Vercel)
  → บันทึก transaction พร้อม object_key → mark intent consumed
```

อ่านรูป: `GET /api/uploads/[id]` → เช็คสิทธิ์ → **302 ไปยัง presigned GET อายุ 1 ชม.**

- เก็บใน DB แค่ `object_key` **ห้ามเก็บ URL เต็ม**
- เสิร์ฟด้วย `<img>` ธรรมดา **ห้าม `next/image` แบบ optimize** (โควตา Vercel แยกและบานปลายง่าย)
- **R2 ไม่มี RLS** — สิทธิ์ทั้งหมดบังคับที่ route handler เอง คีย์เดายากไม่ใช่การควบคุมสิทธิ์
- CORS ของ bucket: อนุญาต origin ของเรา, `PUT`, header `content-type`
- เก็บถาวรไม่ลบ · หน้า `/settings` ต้องโชว์พื้นที่ที่ใช้ไปแล้ว
- ตอนลงมือ ให้เช็คราคาและ storage class ปัจจุบันจากเอกสาร R2 อีกรอบ อย่าอ้างจากในนี้

### Storage class = **Standard** (ตัดสินใจแล้ว 30 ส.ค. 2569)

ห้ามใช้ Infrequent Access กับ bucket นี้ตอนนี้ เพราะ:
1. โควตาฟรี 10 GB/เดือน เป็นของ **Standard** — ที่ราว 4 GB/ปี จะอยู่ในโควตาฟรีได้ ~2 ปีครึ่ง
   เลือก IA ตอนนี้คือจ่ายเงินแทนที่จะได้ของฟรี
2. IA คิด **ค่าธรรมเนียมเรียกดู** แต่ `/ledger` กับ `/approvals` โหลดรูปเล็กทุกครั้งที่เลื่อน — เข้าถึงบ่อยชัดเจน
3. IA มี **ขั้นต่ำ 30 วัน** แต่ผู้ใช้จะถ่ายสลิปเบลอแล้วลบถ่ายใหม่เป็นประจำ — ลบวันเดียวโดนคิด 30 วัน

**ทบทวนเมื่อไหร่:** ตอนพื้นที่ใช้จริงเกิน ~10 GB แล้วค่อยตั้ง lifecycle rule ย้าย **เฉพาะ `object_key`
(รูปเต็ม) ที่เก่าเกิน 2 ปี** ไป IA · **`thumb_key` ต้องอยู่ Standard เสมอ** เพราะยังถูกโหลดในหน้ารายการ
· ย้ายกลับจาก IA มีค่าใช้จ่าย อย่ารีบ

## 10. แจ้งเตือน · PWA

- กระดิ่งในแอปอ่านจาก `notifications` (realtime broadcast) — ตัวเลขบนกระดิ่งใช้ `--urgent-solid` ซึ่งเข้มพอให้ตัวขาวอ่านออกทั้งสองธีม
- Web push ด้วย VAPID · ตัวส่งต้องลบ subscription ที่ตายแล้วออก (410/404)
- ตัวเลขบนไอคอนแอปด้วย Badging API — เรียกทั้งตอนอยู่ในแอปและใน `push` handler ของ service worker
- SW เขียนเอง (precache + network-first สำหรับ navigation + push + notificationclick)
- `next.config` ต้องมี header ที่ทำให้ `/sw.js` อัปเดตได้จริง
- ⚠️ **matcher ของ `proxy.ts` ต้องยกเว้น `/sw.js` และ `/manifest.webmanifest`** ไม่งั้นคนที่ยังไม่ล็อกอินติดตั้งแอปไม่ได้และ push ตายเงียบ
- ⚠️ **matcher ต้องยกเว้น `/api/*`** ไม่งั้น route ล็อกอินฝั่งเซิร์ฟเวอร์จะโดน redirect ไปหน้า HTML แล้วคุกกี้ไม่ถูกตั้ง

## 11. Auth

ใช้ทั้ง 4 client: `browser` / `server` / `admin` (service-role) / `middleware`

### เช็คลิสต์ตั้งค่า Supabase Auth — ตั้งครั้งเดียวแล้วลืม ต้องมีที่จด

`Authentication → Sign In / Providers` **ปิดทั้งสามอัน**

| สวิตช์ | ค่า | เหตุผล |
|---|---|---|
| Allow new users to sign up | **ปิด** | ไม่มีหน้าสมัคร เจ้าของสร้างผู้ใช้ให้ |
| Allow anonymous sign-ins | **ปิด** | เปิด = ใครก็ขอบัญชีไร้รหัสผ่านได้ แล้วเป็น `authenticated` ทันที |
| Allow manual linking | **ปิด** | ไว้ผูกบัญชี OAuth เพิ่ม — โปรเจ็คนี้ไม่มี OAuth เลย |

**ปิด signup ไม่กระทบการสร้างผู้ใช้ของแอป** — `/settings/users` สร้างบัญชีฝั่งเซิร์ฟเวอร์ผ่าน
Admin API ด้วย `SUPABASE_SECRET_KEY` ซึ่งไม่ได้ถูกสวิตช์นี้ควบคุม · สวิตช์นี้ปิดแค่ทางที่คนนอก
ยิง `POST /auth/v1/signup` เข้ามาเองจากเบราว์เซอร์

ตรวจซ้ำได้ตลอดด้วย `GET {SUPABASE_URL}/auth/v1/settings` → ต้องได้
`disable_signup: true` และไม่มี `anonymous` ในรายการที่เปิด

- ⚠️ **ต้องปิด public signup ใน Supabase Auth** (`Authentication → Sign In / Providers → Allow new users to sign up` = ปิด)
  แอปนี้ไม่มีหน้าสมัครสมาชิก แอดมินเป็นคนสร้างผู้ใช้ให้ · แต่ publishable key ถูกส่งไปกับ JavaScript
  ในเบราว์เซอร์ของทุกคนตามการออกแบบ ใครหยิบไปยิง `POST /auth/v1/signup` ก็สร้างบัญชีใน `auth.users`
  ของเราได้ — กิน MAU ส่งอีเมลยืนยันจากโดเมนเรา และกลายเป็นรูทันทีถ้ามี policy ไหนเขียนว่า `authenticated`
  เฉย ๆ โดยไม่เช็ค `profiles` · **ตรวจแล้วเมื่อ 30 ส.ค. 2569 พบว่ายังเปิดอยู่ (`disable_signup: false`)**
- **route ที่ sign-in ฝั่งเซิร์ฟเวอร์ต้องผูกคุกกี้กับ `response` object** ไม่ใช่เขียนผ่าน `cookies()` ของ `next/headers`
- route PIN ต้อง **rate-limit ตั้งแต่วันแรก** (ต่อ IP *และ* ต่อบัญชีเป้าหมาย · เก็บใน
  ตาราง `login_attempts` ไม่ใช่ map ในหน่วยความจำ เพราะ serverless มีหลาย instance)
- ⚠️ **PIN ต้องไม่ซ้ำกันระหว่างผู้ใช้** — หน้าล็อกอินมีแต่แป้นตัวเลข ไม่ได้ถามว่าคุณคือใคร
  ระบบจึงระบุตัวตนจาก PIN อย่างเดียว · PIN ซ้ำ = กดแล้วเข้าไปเป็นบัญชีของคนอื่น

  **วิธีเก็บ:** `profiles.pin_hash` = **HMAC-SHA256(key=`PIN_PEPPER`, msg=`'pin-lookup:'+pin`)**
  + `unique index` · ไม่เก็บ PIN เป็นข้อความจริงที่ไหนเลย

  *ทำไม deterministic ไม่ใช่ bcrypt:* หน้าล็อกอินมีแต่แป้นตัวเลข ระบบต้อง **หาเจ้าของ PIN
  จากค่าที่กดมา** และต้องมี unique index กันซ้ำ — bcrypt ที่ salt สุ่มทุกครั้งทำทั้งสองอย่างไม่ได้

  *ทำไมไม่ต้องให้เจ้าของดู PIN เดิม:* คนลืม PIN → เจ้าของ**ตั้งใหม่**ให้ จำนวนคลิกเท่ากับการเปิดดู
  แต่ปลอดภัยกว่า · ตอนสร้างผู้ใช้เจ้าของเป็นคนตั้งเองอยู่แล้ว ไม่มีจังหวะไหนที่ต้องอ่านค่าเดิมกลับมา

  🔴 **`pin_hash` กับรหัสผ่านของ `auth.users` ต้องมาจากคนละ domain**
  (`'pin-lookup:'` vs `'auth-password:'`) — ถ้าใช้สูตรเดียวกัน ฐานข้อมูลที่รั่วจะกลายเป็น
  รายการรหัสผ่านพร้อมใช้ทันที ผู้โจมตีไม่ต้องเดา PIN เลย เอาค่าในคอลัมน์ไปล็อกอินตรง ๆ ได้

  · ปลอดภัยพอเพราะ **pepper อยู่ใน env ไม่ได้อยู่ในฐานข้อมูล** — DB รั่วอย่างเดียวยังไล่เดาไม่ได้
  · แต่ **ต้องมี rate limit เสมอ** เพราะ 6 หลักมีแค่ล้านความเป็นไปได้
- ⚠️ **อีเมลสังเคราะห์ของบัญชี PIN ห้ามโผล่บนหน้าจอ** — คนใช้ไม่เคยพิมพ์มันและมันรับเมลไม่ได้
  ให้แสดงชื่อคนแทน และไม่ต้องมีปุ่มเปลี่ยนอีเมลให้บัญชีแบบนี้
- ⚠️ **ปุ่มเข้าใช้แบบเดโม่เป็น opt-in เท่านั้น** — `ENABLE_DEMO_LOGIN=1` (ฝั่งเซิร์ฟเวอร์ ห้ามมีฝาแฝด
  `NEXT_PUBLIC_` ที่ drift จาก route ได้) · ไม่ตั้ง = route ตอบ **`404`** (ไม่ใช่ `403` ซึ่งยืนยันว่า route มีอยู่)
  และหน้า login ไม่เรนเดอร์ปุ่ม · ขั้ว opt-in สำคัญเพราะทุกที่ที่ลืมตั้งค่าจะอยู่ในสถานะ**ปิด**
  ถ้าใช้ขั้ว opt-out ทุก preview branch และทุก fork จะเปิดประตูสาธารณะเข้าแอปโดยปริยาย
- `signOut` ใช้ scope `'local'`
- **destructure `error` จากทุก call ของ Supabase** — error ที่ไม่ถูกเช็คคือการเขียนที่เงียบหายไปโดยแอปรายงานว่าสำเร็จ
- การเปลี่ยนรหัสผ่าน/PIN ด้วยตัวเอง **ต้องถามค่าปัจจุบัน**

## 12. โครงโฟลเดอร์

```
src/
  app/
    (auth)/login/page.tsx · (auth)/pin/page.tsx
    (app)/page.tsx            ภาพรวม
    (app)/sites/[id]/page.tsx · (app)/ledger · (app)/entry
    (app)/attendance · (app)/employees · (app)/approvals · (app)/audit · (app)/settings
    (app)/settings/users     ผู้ใช้ระบบ (มี login) + คนงาน (ไม่มี login) — สองแท็บ หน้าเดียว
    (app)/settings/branding  ชื่อบริษัท + โลโก้
    api/auth/pin/route.ts
    api/branding/route.ts    ← ไม่ต้องล็อกอิน · หน้า login เรียกใช้
    api/uploads/sign/route.ts · api/uploads/[id]/route.ts
    api/cron/sweep-orphans/route.ts · api/cron/daily-digest/route.ts
    api/push/subscribe/route.ts
    globals.css · layout.tsx · loading.tsx · error.tsx
  components/ui/*          ← จาก thai-admin-page-kit
  components/{sites,ledger,attendance,employees}/*
  lib/supabase/{browser,server,admin,middleware}.ts
  lib/{r2,constants,dates,money,database.types}.ts
  proxy.ts
supabase/migrations/*.sql
docs/design/{demo.html,DESIGN.md} · docs/test-plan/*.md · docs/LESSONS.md
```

`src/lib/constants.ts` เก็บได้เฉพาะค่าที่**ตายตัวตอน build** — timezone (`Asia/Bangkok`), ชื่อแอปสำรอง
ตอนยังไม่ได้ตั้งค่า, ขนาดรูปที่บีบ, เพดานจำนวนสลิปต่อรายการ
**ชื่อบริษัท · โลโก้ · ผู้ลงนาม · เรตค่าแรง อยู่ในฐานข้อมูล ห้ามอยู่ในไฟล์นี้** — ทั้งหมดต้องแก้จากหน้าตั้งค่าได้

## 13. ข้อมูลตัวอย่างและการรีเซ็ต

โปรเจ็คนี้เป็น **single-organization** จึงใช้ชุดนี้ (ไม่ต้องมี onboarding/tenant):

1. **migration รีเซ็ต** ที่ commit ไว้ — ล้างทุกตารางรวมถึง `auth.users`
2. **seed เดโม่** ที่ครอบคลุมทุกสถานะที่หน้าจอเรนเดอร์ได้จริง: ไซต์ที่ใกล้ครบกำหนด · ไซต์ที่ต้นทุนแซงรายรับ · รายจ่าย `pending`/`approved`/`rejected` · คนเบิกเต็มเพดาน · รอบจ่ายที่ปิดแล้วและที่ยังเปิด · หน้าที่ยังว่าง
3. **ล็อกอินเดโม่แบบกดครั้งเดียว** ปิดได้ด้วย env kill switch
4. รหัสผ่าน/PIN ของ seed **ต้องมาจาก env ไม่ใช่ฝังใน SQL** — ฝังใน SQL แล้ว commit
   = รหัสติดอยู่ในประวัติ git ตลอดไป ลบไฟล์ทีหลังก็ยังอยู่
   ตัวแปรที่ใช้: `SEED_OWNER_EMAIL` · `SEED_OWNER_PASSWORD` · `SEED_SUPERVISOR{1,2}_NAME` · `SEED_SUPERVISOR{1,2}_PIN`
   **บัญชีทดสอบปัจจุบัน:** `admin@demo.com` (เจ้าของ) · PIN `246810` = อนุชา · PIN `135791` = เสกสรร
   ⚠️ รหัส `123456` ยาว 6 ตัวพอดีกับขั้นต่ำของ Supabase — **ใช้ทดสอบเท่านั้น**
   ก่อนส่งมอบต้องเปลี่ยน และ `/api/*` ที่สร้างผู้ใช้ต้องบังคับความยาวขั้นต่ำที่มากกว่านี้สำหรับบัญชีจริง
5. seed ต้อง idempotent (`on conflict do nothing`) และ deterministic
6. **ยอดที่ seed ไว้ต้องเท่ากับยอดที่แอปคำนวณเอง** — ถ้าเดโม่โชว์สองตัวเลขที่ขัดกัน คนดูจะเลิกเชื่อทั้งหน้า
7. หลังรีเซ็ต ผู้ใช้ที่ยัง log in ค้างอยู่ต้องไม่ติดวนระหว่าง `/` กับ `/login`

## 14. เฟสการสร้าง

แต่ละเฟส **เขียน acceptance matrix ลง `docs/test-plan/<phase>.md` ก่อนเขียนโค้ด**

- [ ] **P0 · ฐาน** — scaffold, โทเคน+`verify-contrast`, shell (sidebar ↔ bottom nav), ธีม, 4 Supabase clients, `proxy.ts`, login อีเมล + PIN (rate-limited), `profiles` + RLS + audit trigger
- [ ] **P0.5 · แบรนด์ + ผู้ใช้** — `branding` + `app_settings` + `/api/branding` (ไม่ต้องล็อกอิน),
      หน้าตั้งค่าแบรนด์ (ชื่อ + อัปโหลดโลโก้เข้า R2), แสดงผลบนหน้า login และหัวระบบ พร้อม fallback,
      หน้า `/settings/users` ให้เจ้าของ CRUD ผู้ใช้ระบบ (แท็บคนงานมาเติมใน P4)
- [ ] **P1 · ไซต์ + ภาพรวม** — CRUD ไซต์, `site_supervisors` มีช่วงเวลา, การ์ด 3 แถบ, ป้ายเตือนต้นทุนแซงรายรับ, หน้าไซต์
- [ ] **P2 · รายรับ-รายจ่าย + R2** — หมวด, ฟอร์มบันทึก, ผูกไซต์/ส่วนกลาง, บีบรูป, presigned PUT/GET, `upload_intents` + sweep, `/ledger` + ค้นหา/กรอง + pagination
- [ ] **P3 · อนุมัติ + แจ้งเตือนในแอป** — คิวอนุมัติ, ตีกลับ+เหตุผล, guard triggers, กระดิ่ง + realtime broadcast
- [ ] **P4 · พนักงาน + คนเข้าไซต์** — CRUD คนงานเป็นแท็บที่สองใน `/settings/users` (ไม่มี login ไม่มี role),
      ตั้งค่าแรง**รายคน** (รายวัน/รายเดือน + เรตของแต่ละคน), ผูก `profile_id` ได้ถ้าคนนั้นล็อกอินด้วย,
      ลงชื่อรายวัน + `wage_snapshot`, ยอดค่าแรงวันนี้, ต้นทุนไซต์ขึ้นทันที
- [ ] **P5 · เบิก + รอบจ่าย** — `advances` + trigger เพดาน, `payroll_runs`/`payroll_lines`, ปิดรอบ, สรุปค่าแรงรายคน
- [ ] **P6 · Audit** — หน้า `/audit` + กรอง + pagination, ตรวจว่าทุกตารางมี trigger จริง
- [ ] **P7 · PWA + push** — manifest, SW, subscribe, ส่ง push ตอนมีรายการรออนุมัติ/ถูกตีกลับ, badge
- [ ] **P8 · seed/reset + ตรวจรับ** — ตาม §13 แล้วไล่ acceptance matrix ทุกเฟสให้ปิด

**เฟสหลัง (ยังไม่ทำ):** PDF ไทย A4 · Excel/CSV · งบประมาณต่อไซต์+เตือน · ปันส่วนเงินเดือนเข้าไซต์ตามวัน

## 15. กติกาที่ห้ามละเมิด

- ภาษาไทยทั้งระบบ · **lucide ห้าม emoji** · **sonner ห้าม `alert()`** · radix สำหรับ confirm/ask
- **RLS เปิดทุกตาราง** ไม่มีข้อยกเว้น
- **ทุก query ลิสต์มี `.order()` + `.range()`**
- **ทุกหน้าที่แสดงข้อมูลต้องมีครบ 4 สถานะ** — โครงร่าง / ผิดพลาด+ปุ่มลองใหม่ / ว่าง / สำเร็จ · ปุ่มที่กำลังทำงานต้องถูก disable พร้อมสปินเนอร์
- **destructure `error` จากทุก call ของ Supabase**
- **ทุก endpoint ต้องมีปุ่มในหน้าจอที่เรียกมันจริง** และ role ที่อนุญาตต้องตรงกับที่ปุ่มนั้นอยู่
- ⚠️ **ฐานข้อมูลเก็บปีเป็น ค.ศ. เสมอ — พ.ศ. เป็นเรื่องของการแสดงผลเท่านั้น**
  คนไทยคิดเป็น พ.ศ. และดีไซน์ก็แสดง พ.ศ. · ถ้าที่ไหนส่งปี พ.ศ. ลงฐานข้อมูลดิบ ๆ
  วันที่จะเพี้ยนไป **543 ปี** โดยไม่มี error — `2569-01-01` เป็นวันที่ที่ถูกต้องตามไวยากรณ์
  แปลงที่ชั้นแสดงผลเท่านั้น (`toLocaleDateString('th-TH')` แปลงให้อยู่แล้ว)
  และ `<input type="date">` ส่งค่าเป็น ค.ศ. เสมอ ห้ามแปลงก่อนส่ง
- **ทุกวันที่ผูก `Asia/Bangkok` แบบชัดเจน** — `timeZone:` ในทุก formatter, `at time zone 'Asia/Bangkok'` ตอนแบ่งวัน
- ไฟล์ < 800 บรรทัด · อัปเดตแบบ immutable · ไม่มี `console.log` ใน production
- **Windows: ห้ามแก้ไฟล์ที่มีข้อความไทยผ่าน PowerShell pipe** (PS 5.1 ทำให้เป็นอักษรเพี้ยนเงียบ ๆ) ใช้ Edit/Write tool
- **`tsc --noEmit` และ `next build` ต้องเขียวก่อน commit ทุกครั้ง** · conventional commits · **ไม่ใส่ attribution footer**
- ห้าม commit ความลับ · `.env.local` อยู่ใน gitignore · **ห้าม `cat` ไฟล์ env** ให้ดูแค่ชื่อคีย์ (`cut -d= -f1 .env.local`)
- **เจอกับดักใหม่ → เขียนลง §17 ทันที** ครั้งที่สองต้องไม่เสียเวลาอีก

## 16. จังหวะการทดสอบ

| เมื่อไหร่ | ทำอะไร |
|---|---|
| ทุกครั้งที่แก้ | `tsc --noEmit` |
| ทุก 2–3 หน่วยงาน | `next build` + unit test เฉพาะ logic บริสุทธิ์ (**ห้าม mock Supabase**) |
| ปลายเฟส / ปลายฟีเจอร์ | E2E ผ่าน Chrome DevTools MCP |
| **ทันที** หลังแตะสิ่งเหล่านี้ | auth/คุกกี้/`proxy.ts`/redirect · อะไรที่ RLS มองเห็น · realtime · PWA/SW · PDF · responsive/เมนู |

ตรวจทุกครั้งทั้ง **โหมดสว่างและมืด** และที่ความกว้าง **390 / 768 / 1440**

## 17. กับดักที่เจอแล้ว

> เจอใหม่เติมทันที พร้อมอาการที่เห็นจริง ไม่ใช่แค่ชื่อปัญหา

1. **ต้นทุนค่าแรงบวกซ้ำ** — ติ๊กคนเข้าไซต์คือ *ต้นทุนเกิด* (accrual) ส่วนเบิกล่วงหน้าและปิดรอบจ่ายคือ *เงินสดออก*
   ถ้านับทั้งสองอย่างเป็นรายจ่าย ต้นทุนจะเป็นสองเท่า · ในหน้าจอแถวจ่ายเงินต้องเป็นสีเทาพร้อมป้าย "ไม่นับซ้ำเป็นต้นทุน"
   (เจอตอนทำเดโม่ — ดู `DESIGN.md` §5.4 มีตัวอย่างตัวเลขที่ต้องถูก)
2. **ยอดรวมใน mockup ไม่ตรงกับผลบวกจริง** — ตอนแรกเขียน ฿3,190 ไว้ 3 ที่ แต่บวกจริงได้ ฿2,460
   ตัวเลขที่ seed หรือใส่ใน mockup ต้องคำนวณจากข้อมูลจริงเสมอ
3. **เหลืองอำพันเป็นพื้นปุ่มไม่ผ่าน AA** — `#D97706` ใต้ตัวหนังสือขาว = 3.18:1
   สีที่ใช้เป็น *ตัวหนังสือ* กับที่ใช้เป็น *พื้น* คนละค่ากัน แยกเป็น `--brand` / `--brand-solid` เสมอ
4. **เงาสีบนพื้นเข้ม** — เงาน้ำเงินบนพื้นกรมท่าไม่ได้ให้ความรู้สึกลอย มันกลายเป็นแสงเรือง ใช้สีกลางเสมอ
5. **`realtime.send()` กลืน error ทุกชนิดเป็นแค่ `RAISE WARNING`** — บนโปรเจ็คที่ยังไม่เคย
   ใช้ Realtime `realtime.messages` ไม่มี partition สักวัน insert ล้มทุกครั้ง
   **แจ้งเตือนจึงไม่ถูกส่งเลยโดยไม่มี error ที่ไหน** (trigger รัน · commit สำเร็จ · หน้าจอปกติ)
   · ต่อ websocket ครั้งแรกได้ `CHANNEL_ERROR MissingPartition` แล้ว Realtime สร้าง
   partition ให้ 5 วันล่วงหน้า → **client ต้อง subscribe แบบมี retry** และต้องมีแถวตรวจรับ
   ที่ยืนยันว่าข้อความลงถึง `realtime.messages` จริง (`P3-DB-12`)
6. *(เว้นไว้เติม)*

## 18. ตัวแปรสภาพแวดล้อม

`.env.local` (gitignored) — ค่าที่สร้างเองได้ต้องสร้างให้ตอน scaffold ค่าที่เหลือเว้นว่างให้ผู้ใช้กรอก

```
NEXT_PUBLIC_SUPABASE_URL=                # ← ผู้ใช้กรอก
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=    # ← ผู้ใช้กรอก · sb_publishable_...
SUPABASE_SECRET_KEY=                     # ← ผู้ใช้กรอก · sb_secret_...
SUPABASE_PROJECT_REF=                    # ← ผู้ใช้กรอก
SUPABASE_ACCESS_TOKEN=                   # ← ผู้ใช้กรอก · PAT สำหรับ MCP เท่านั้น

R2_ACCOUNT_ID=                       # ← ผู้ใช้กรอก
R2_BUCKET=                           # ← ผู้ใช้กรอก
R2_ACCESS_KEY_ID=                    # ← ผู้ใช้กรอก
R2_SECRET_ACCESS_KEY=                # ← ผู้ใช้กรอก

PIN_PEPPER=                          # สร้างให้ (random 32 bytes)
CRON_SECRET=                         # สร้างให้ (random 32 bytes)
VAPID_PUBLIC_KEY=                    # สร้างให้
VAPID_PRIVATE_KEY=                   # สร้างให้
NEXT_PUBLIC_VAPID_PUBLIC_KEY=        # = VAPID_PUBLIC_KEY
VAPID_SUBJECT=mailto:

SEED_OWNER_EMAIL=                        # บัญชีทดสอบ ห้ามใส่ใน production
SEED_OWNER_PASSWORD=
SEED_SUPERVISOR1_NAME=                   # PIN ต้องไม่ซ้ำกันระหว่างผู้ใช้
SEED_SUPERVISOR1_PIN=
SEED_SUPERVISOR2_NAME=
SEED_SUPERVISOR2_PIN=

ENABLE_DEMO_LOGIN=1                      # opt-in เท่านั้น · ไม่ตั้ง = route ตอบ 404 + ปุ่มไม่เรนเดอร์
#                                          ห้ามมีฝาแฝด NEXT_PUBLIC_ (จะ drift จาก route ได้)
```

**เช็คก่อน deploy**
1. `SEED_*` และ `ENABLE_DEMO_LOGIN` ต้อง **ไม่มีอยู่เลย** ใน Vercel
(ขั้วเป็น opt-in: ไม่มีตัวแปร = ปิด · ถ้าใช้ขั้ว opt-out ทุก preview branch และทุก fork
ที่ไม่ได้ตั้งค่าจะกลายเป็นประตูสาธารณะเข้าแอปโดยปริยาย)
2. เปิด **Leaked Password Protection** ใน Supabase Auth (advisor แจ้งเตือนอยู่)
   — ยังไม่เปิดตอนพัฒนาเพราะมันจะปฏิเสธรหัสทดสอบ `123456` ทันที ทำให้ล็อกอินไม่ได้
3. เปลี่ยนรหัสผ่าน/PIN ของบัญชีทดสอบทั้งหมดก่อนส่งมอบ
ให้ P8 เขียนสคริปต์ตรวจข้อนี้ ไม่ใช่จำเอา

⚠️ **ห้ามเขียนทับค่าที่มีอยู่แล้ว** — สร้าง VAPID ใหม่ = subscription ของทุกเครื่องตายหมด
⚠️ ตอน deploy ต้องคัดลอก `PIN_PEPPER` / `CRON_SECRET` / VAPID ชุดเดียวกันไปใส่ใน Vercel env
⚠️ `NEXT_PUBLIC_*` ถูกฝังตอนเริ่ม dev server — แก้แล้วต้องรีสตาร์ท ไม่ใช่แค่ refresh

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
