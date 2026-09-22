# CLAUDE.md — Cosxi Construction · ระบบจัดการโปรเจ็คงานรับเหมาก่อสร้าง

> เอกสารนี้คือ **แผนหลักและแหล่งความจริง** ของโปรเจ็ค
> ดีไซน์ที่อนุมัติแล้วอยู่ที่ [`docs/design/DESIGN.md`](docs/design/DESIGN.md) + [`docs/design/demo.html`](docs/design/demo.html)
> โทเคนสีและเมนู **มาจากเดโม่ที่อนุมัติแล้ว ห้ามคิดใหม่**

---

## 1. ผลิตภัณฑ์

**ชื่อระบบ:** `RUAYNAE LIMITED PARTNERSHIP` — อยู่ใน `src/lib/constants.ts` (`SYSTEM_NAME`)
ใช้บนแท็บเบราว์เซอร์และชื่อแอปตอนติดตั้ง · ติดมากับตัวซอฟต์แวร์

**ชื่อบริษัทที่ใช้ระบบ:** `RUAYNAE LIMITED PARTNERSHIP` — อยู่ใน
`branding.company_name` **ที่เดียว** เจ้าของแก้เองได้จาก `/settings`
· ห้ามคัดลอกมาไว้ในโค้ด (§5) · ค่าตั้งต้นของเครื่องที่ติดตั้งใหม่อยู่ใน
migration `20260831040000_branding_company_name.sql` ซึ่งเติม**เฉพาะตอนที่ยังว่าง**

เว็บแอปสำหรับผู้รับเหมาก่อสร้างรายเล็ก-กลาง (**บริษัทเดียว ไม่ใช่ SaaS หลายผู้เช่า**)
บันทึกรายรับ-รายจ่ายรายวันต่อโครงการ แนบสลิป/บิล จัดการพนักงานและค่าแรง
และให้เจ้าของเห็นว่าแต่ละโปรเจ็คคืบหน้าแค่ไหน เก็บเงินได้เท่าไหร่ เหลือกำไรเท่าไหร่

ผู้ใช้จริงไม่ชำนาญคอมพิวเตอร์ และใช้งานหลักบนมือถือกลางโครงการ → การ์ดโปร่ง ตัวหนังสือใหญ่ ขั้นตอนน้อย

## 2. Role

| Role | ล็อกอิน | เห็น | ทำได้ |
|---|---|---|---|
| `owner` | อีเมล + รหัสผ่าน | ทุกโครงการ ทุกตัวเลข กำไร audit log | ทุกอย่าง · อนุมัติ/ตีกลับ · ปิดรอบจ่ายค่าแรง · CRUD ทั้งหมด |
| `site_supervisor` | PIN 6 หลัก | เฉพาะโครงการที่ดูแล **ณ ช่วงเวลานั้น** | คีย์รายจ่ายโครงการตัวเอง (เข้าคิวรออนุมัติ) · ลงชื่อคนเข้าโครงการ · **ตั้งเบิกค่าแรงให้ลูกน้อง (เข้าคิวรออนุมัติ ไม่ใช่การจ่ายเงิน)** |

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
create type advance_status as enum ('pending','approved','rejected');
```

### ตาราง

| ตาราง | สาระสำคัญ | RLS |
|---|---|---|
| `branding` | แถวเดียว: `company_name`, `logo_object_key`, `updated_at` | **`anon` SELECT ได้** (หน้า login ต้องอ่านตอนยังไม่ล็อกอิน) · UPDATE เฉพาะ owner |
| `app_settings` | แถวเดียว: ที่อยู่, เลขผู้เสียภาษี, ผู้ลงนาม, นโยบายเก็บรูป ฯลฯ | **owner เท่านั้น ทั้งอ่านและเขียน** |
| `profiles` | `id → auth.users`, `full_name`, `role`, `pin_hash` (HMAC + pepper, unique), `is_active` | อ่านตัวเอง · owner อ่าน/เขียนทั้งหมด · **`role` แก้ได้เฉพาะ owner (guard trigger)** |
| `sites` | `name`, `client_name`, `contract_amount`, `start_date`, `end_date`, `status` | owner ทั้งหมด · supervisor อ่านเฉพาะโครงการที่ดูแล |
| `site_finance` | ค่างานและ**หลักประกันสัญญา** (R11): `contract_amount`, `contract_no`, `contract_date`, `bond_kind` (`cash`/`bank_guarantee`), `bond_amount`, `bond_ref`, `handover_date` (ส่งมอบงวดสุดท้าย — คนละช่องกับ `sites.end_date`), `warranty_months` (24), **`warranty_end` generated**, `bond_returned_at/_amount`, `bond_return_txn_id` · สถานะคิดตอนอ่านใน RPC `bond_status()` / `bond_summary()` ไม่มีคอลัมน์สถานะ | **owner เท่านั้น** |
| `site_supervisors` | `site_id`, `profile_id`, **`effective_from`, `effective_to`** | owner เขียน · supervisor อ่านแถวตัวเอง |
| `site_milestones` | แผนงวดล่วงหน้า (ไม่บังคับ): `seq`, `name`, `planned_amount`, `planned_date` — ยังไม่มีคอลัมน์บอกว่างวดไหนเก็บเงินแล้ว (วางแผนไว้เป็น `collected_txn_id` แต่ยังไม่ได้สร้าง รอเฟสหลัง) | ตามโครงการ |
| `categories` | `name`, `kind`, `is_active`, `sort_order` | อ่านได้ทุก role · เขียนเฉพาะ owner |
| `employees` | `full_name`, `job_title`, `wage_type`, `daily_rate`, `monthly_salary`, `default_site_id`, `is_active`, **`profile_id`** (NULL = ไม่มีบัญชีล็อกอิน) | owner ทั้งหมด · supervisor อ่านคนที่เคยเข้าโครงการตัวเอง |
| `attendance` | `work_date`, `site_id`, `employee_id`, `work_units`, `ot_amount`, **`wage_snapshot`**, `amount` (generated), `mcp_key_id` | supervisor เขียนได้เฉพาะโครงการตัวเองและวันที่ยังไม่ปิดรอบ |
| `wage_adjustment_presets` | รายการปรับค่าแรงสำเร็จรูป (R10): `name`, `kind` (`add`/`deduct`), `amount` (ยอดเริ่มต้น), `sort_order`, `is_active` · ตั้งที่ `/settings/wage-adjustments` | **owner เท่านั้น** |
| `attendance_adjustments` | บรรทัดปรับของการลงชื่อแต่ละครั้ง: `attendance_id`, `preset_id` (null = พิมพ์เอง), `name` (สำเนา), `kind`, `amount` (บวกเสมอ ทิศทางอยู่ที่ `kind`) · **trigger `sync_attendance_ot` เขียนยอดสุทธิลง `attendance_wages.ot_amount`** — ห้ามใครเขียน `ot_amount` ตรง ให้เรียก `set_attendance_ot()` | **owner เท่านั้น** |
| `transactions` | `kind`, `site_id` (NULL = ส่วนกลาง), `category_id`, `amount`, `txn_date`, `pay_method`, `status`, `income_kind`, `installment_no`, **`mcp_key_id`** (NULL = คนคีย์เอง · มีค่า = AI คีย์ผ่านคีย์ใบนั้น) | supervisor เขียน `pending` ของโครงการตัวเอง · **แก้เป็น `approved` ได้เฉพาะ owner** |
| `attachments` | `transaction_id`, `object_key`, `thumb_key`, `byte_size`, `content_type` | ตาม transaction |
| `upload_intents` | `object_key`, `thumb_key`, `created_by`, `site_id`, `expires_at`, `consumed_at` | ของตัวเองเท่านั้น |
| `advances` | เบิกล่วงหน้า: `employee_id`, `amount`, `advance_date` (**เลือกวันเองได้ ลงย้อนหลังได้**), `pay_method`, `site_id`, `payroll_run_id` (มีค่า = หักครบทั้งใบแล้ว), **`deducted_amount`** (หักคืนไปแล้วเท่าไหร่ · > 0 แต่ไม่ครบ = ค้างไปหักรอบหน้า), `mcp_key_id`, **`status`** (R14 · `pending` = คำขอของหัวหน้าโครงการ **ยังไม่ใช่เงิน** · `approved` = จ่ายแล้ว · `rejected` + `rejected_reason`), `approved_by/_at` | supervisor ยื่นคำขอ (`pending`) ของโครงการตัวเอง และเห็นเฉพาะใบที่ตัวเองยื่น · **เปลี่ยนสถานะเองไม่ได้** |
| `payroll_runs` | `period_start`, `period_end`, `site_id`, `status`, `total_accrued`, `total_advance_deducted`, `total_paid` | **owner เท่านั้น** |
| `payroll_lines` | `run_id`, `employee_id`, `days`, `accrued`, `advance_deducted`, `net_paid` | ตาม run |
| `recurring_expenses` | ค่าใช้จ่ายรายเดือนที่ระบบลงให้เอง: `name`, `amount`, `category_id`, `site_id` (NULL = ส่วนกลาง), `employee_id` (NULL = ไม่ผูกคน), `day_of_month`, `start_month`, `end_month`, `is_active` | **owner เท่านั้น** |
| `customers` | ทะเบียนลูกค้าสำหรับเติมที่อยู่ให้ฟอร์มเอกสาร (R12): `name` (unique แบบ trim+lower), `tax_id`, `branch`, `address`, `phone`, `email` · แก้/ลบที่ `/settings/customers` · **ลบแล้วเอกสารเก่าไม่หายและไม่เปลี่ยน** เพราะใบถือสำเนาของตัวเอง | **owner เท่านั้น** |
| `doc_counters` | ตัวนับเลขที่เอกสารต่อชนิด: `kind` (pk), `prefix`, `pad`, **`last_no`** = เลข**ล่าสุดที่ออกไปแล้ว** ไม่ใช่เลขถัดไป (คำสั่งเจ้าของ 20 ก.ย. 2569) · ไม่มีค่าตั้งต้นในโค้ด — ยังไม่ตั้ง = ออกเอกสารไม่ได้ (`DOC_COUNTER_NOT_SET`) | **owner เท่านั้น** |
| `documents` | ใบเสนอราคา/**ใบแจ้งหนี้**/ใบเสร็จ (R12): `kind` (3 ค่า เรียงตามลำดับงาน), `doc_no` (null จนกว่าจะออกเลข), `status`, `site_id` (null = ไม่ผูกโครงการ), **สำเนาผู้ซื้อ+`seller` jsonb แช่แข็งตอนออกเอกสาร**, `vat_mode`, `vat_rate`, `subtotal`/`vat_amount`/`total` (trigger คิดจากบรรทัด ไม่รับจากหน้าจอ), `amount_words`, `txn_id`, `source_document_id` · ออกเลขผ่าน `issue_document()` ที่ `for update` ก่อนอ่านสถานะ | **owner เท่านั้น** |
| `document_lines` | บรรทัดรายการ: `seq`, `description`, `qty`, `unit`, `unit_price` (**ตัวเลขที่เจ้าของพิมพ์** — โหมด inclusive คือรวม VAT แล้ว), `line_total` (ยอดก่อน VAT ที่ปัดแล้ว · Σ = `subtotal` เป๊ะ) | **owner เท่านั้น** |
| `audit_log` | `table_name`, `row_id`, `action`, `actor`, `before` jsonb, `after` jsonb, `at`, **`mcp_key_id`** (มีค่า = AI ทำแทนเจ้าของ · **ไม่มี FK** โดยตั้งใจ ดู §17 ข้อ 19) | **อ่านได้เฉพาะ owner · ไม่มี policy ให้ UPDATE/DELETE กับใครทั้งนั้น** |
| `notifications` | `user_id`, `kind`, `title`, `body`, `link`, `read_at` | ของตัวเอง |
| `push_subscriptions` | `user_id`, `endpoint` (unique), `p256dh`, `auth`, `last_ok_at` | ของตัวเอง |

### "คน" กับ "ผู้ใช้ระบบ" เป็นคนละเรื่อง — อย่ายุบเป็นตารางเดียว

| | `employees` (คน) | `profiles` (ผู้ใช้ระบบ) |
|---|---|---|
| คือใคร | ทุกคนที่มีค่าแรงต้องจ่าย | ทุกคนที่ล็อกอินเข้าระบบได้ |
| ล็อกอินได้ | ไม่ (ค่าเริ่มต้น) | ใช่ |
| มี role | **ไม่มี** | `owner` / `site_supervisor` |
| ตัวอย่าง | ช่างปูน กรรมกร ที่มีแค่ชื่อกับค่าแรง | เจ้าของ · หัวหน้าโครงการ |

คนส่วนใหญ่มีแต่แถวใน `employees` · บางคน (เช่นหัวหน้าโครงการที่กินเงินเดือนด้วย) มีทั้งสองแถว
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

1. **เบิกล่วงหน้า — เบิกเกินได้ ตั้งแต่ 20 ก.ย. 2569** (คำสั่งเจ้าของ · migration
   `20260920120000_advance_overdraw.sql`) · เดิม trigger ปฏิเสธด้วย `ADVANCE_OVER_CEILING`
   ตอนนี้ไม่ปฏิเสธแล้ว — `คงเหลือ = Σ attendance.amount (ยังไม่ปิดรอบ) − Σ (advances.amount −
   deducted_amount)` **ติดลบได้** และเป็น**ตัวเลขที่เอาไปเตือน** ไม่ใช่ด่านที่ห้าม
   · สิ่งที่ยังบังคับที่ฐานข้อมูล: **ห้ามลงวันในอนาคต** (`DATE_FUTURE`) · **ใบที่ถูกหักคืน
   ไปแล้วทั้งใบหรือบางส่วน แก้ยอดและลบไม่ได้** (`PAYROLL_CLOSED` · `advances_guard_delete`)
   · 🔴 **ตอนจ่ายค่าแรง หักได้แค่เท่าค่าแรงของงวดนั้น** แล้วส่วนที่เหลือ**ค้างไว้หักรอบหน้า**
   (`deducted_amount` + FIFO ตามวันที่เบิก) — ตีตราว่าหักครบทั้งใบเมื่อไหร่ เงินส่วนที่เกิน
   หายไปถาวรโดยไม่มี error ที่ไหนเลย
1b. 🔴 **ใบเบิกที่ยังไม่ `approved` ไม่ใช่เงิน** (R14 · 21 ก.ย. 2569) — ทุกที่ที่นับ
   "เบิกไปแล้ว" ต้องมี `and status = 'approved'` เสมอ: `employee_balance` ·
   `payroll_balances` · `close_payroll_run` (ทั้งยอดที่หักและคิว FIFO) ·
   `report_summary` · `report_labor` · รายการใบเบิกบน `/payroll`
   · ลืมที่ใดที่หนึ่ง = คนงานถูกหักเงินที่ยังไม่เคยได้รับ และใบคำขอถูกตีตราว่า
   "หักแล้ว" โดยไม่มี error ที่ไหนเลย · หัวหน้าโครงการตั้งสถานะเองไม่ได้
   (`APPROVE_FORBIDDEN`) · ใบที่ถูกหักคืนไปแล้วเปลี่ยนสถานะไม่ได้ (`PAYROLL_CLOSED`)
   · 🔴 **เจ้าของ insert = `approved` เสมอ** ไม่ว่าจะส่งสถานะมาหรือไม่ (migration
   `20260922090000`) — เจ้าของคีย์เบิกคือเงินสดออกไปแล้ว ไม่ใช่คำขอ · กฎนี้ทำให้
   client เวอร์ชันเก่า (ที่ยังไม่รู้จักคอลัมน์ `status`) ปลอดภัยด้วย ซึ่งสำคัญมาก
   ในช่วงระหว่าง "apply migration" กับ "deploy โค้ด" ที่ทั้งสองอย่างไม่ได้เกิดพร้อมกัน
2. **`wage_snapshot` ห้ามแก้หลังปิดรอบ** — guard trigger บน `attendance`
3. **`transactions.status`** — supervisor เปลี่ยนเป็น `approved` ไม่ได้ · supervisor แก้/ลบรายการที่
   `approved` แล้วไม่ได้ · supervisor แก้รายการที่ `rejected` ของตัวเองได้ และ trigger จะดันสถานะ
   กลับเป็น `pending` ให้เอง (= ส่งใหม่) · **เจ้าของแก้และลบได้ทุกแถวรวมที่อนุมัติแล้ว**
   เพราะรายการที่เจ้าของคีย์เองเกิดมาเป็น `approved` ตั้งแต่วินาทีแรก ล็อกไว้แปลว่า
   พิมพ์ยอดผิดหนึ่งหลักแล้วแก้ไม่ได้ตลอดกาล — **ความรับผิดชอบอยู่ที่ `audit_log`
   (มี `before`/`after` ครบทุกครั้ง อ่านได้ที่ `/audit`) ไม่ใช่ที่การล็อกแถวไม่ให้ใครแตะ**
4. **`profiles.role`** — เปลี่ยนได้เฉพาะ owner
5. **Audit trigger** ติดกับ **ทุกตาราง** ในรายการข้างบน

### Helper `SECURITY DEFINER`
```sql
is_owner() -> boolean
supervises_site(p_site uuid, p_on date default current_date) -> boolean
employee_balance(p_employee uuid)      -- ประตูของ authenticated · **เจ้าของเท่านั้น**
employee_balance_raw(p_employee uuid)  -- สูตรเปล่า ไม่มีด่าน · เฉพาะ definer/superuser
```
⚠️ **ยอดค่าแรงเป็นความลับจากหัวหน้าโครงการ (P4.5)** — ตั้งแต่ R14 หัวหน้าโครงการ
ยุ่งกับใบเบิกได้แล้ว `employee_balance()` จึงต้องมีด่าน `is_owner()` ไม่งั้นเขายิง
RPC ตรง ๆ อ่านค่าแรงค้างจ่ายของทุกคนได้ · สคริปต์ที่รันเป็น superuser
(`seed-demo` · `verify-ship` · `verify-payroll`) เรียก `_raw` แทน — **ห้ามแก้ด้วย
ทางลัด `auth.uid() is null`**
⚠️ **ห้ามใส่ทางลัด `auth.uid() is null` เพื่อให้ service-role ผ่าน** ในฟังก์ชันที่ `anon` เรียกได้ —
นั่นคือช่องที่เปิดข้อมูลทั้งระบบให้คนที่ยังไม่ล็อกอิน
⚠️ **ขอบเขตโครงการไม่ใช่การเช็ค role** — `supervises_site()` บอกแค่ว่าอยู่โครงการนั้นไหม ไม่ได้บอกว่าอนุมัติได้

### Index
FK ทุกตัว + คอลัมน์ที่ใช้กรองจริง:
`transactions(txn_date desc)` · `transactions(site_id, txn_date desc)` · `transactions(status) where status='pending'`
`attendance(work_date, site_id)` · `attendance(employee_id, work_date)` · `advances(employee_id, advance_date)`
`audit_log(table_name, row_id)` · `audit_log(at desc)`

### สมาชิกโครงการต้องมีช่วงเวลา
`site_supervisors` **ต้อง**มี `effective_from` / `effective_to` — ถ้าเก็บแค่ "ใครดูแลโครงการไหน" แบบไม่มีวันที่
พอย้ายหัวหน้าโครงการ รายงานย้อนหลังจะเปลี่ยนเจ้าของตามไปด้วย และคนที่ย้ายออกจะเห็นข้อมูลใหม่ที่ไม่ควรเห็น
ใช้ `btree_gist` + exclusion constraint กันช่วงเวลาซ้อนกัน **ของคนเดียวกันในโครงการเดียวกัน**
— คนหนึ่งคน**ดูแลหลายโครงการพร้อมกันได้** (คำสั่งเจ้าของ 19 ก.ย. 2569 · migration
`20260919110000_supervisor_many_sites.sql`) · ที่กันคือแถวซ้ำของคน×โครงการ ไม่ใช่การดูแลหลายที่

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
- ✅ **ติดตั้งและทำงานจริงแล้ว 4 ก.ย. 2569** — `pg_cron` + `pg_net` เปิดใช้บนโปรเจ็คแล้ว
  ยิงเข้า production (`https://ruaynae.vercel.app`) ได้ 200 จริง ตรวจจาก `net._http_response`

| งาน | ตาราง (UTC) | เวลาไทย | ยิงไปที่ |
|---|---|---|---|
| `sweep-orphans` | `7 * * * *` | ทุกชั่วโมง | `/api/cron/sweep-orphans` — ลบไฟล์ R2 ที่ `upload_intents` หมดอายุแล้วไม่มีคนใช้ |
| `recurring-expenses` | `55 0 * * *` | 07:55 | `/api/cron/recurring` — ลงรายจ่ายรายเดือนที่ถึงกำหนด |
| `daily-digest` | `0 1 * * *` | 08:00 | `/api/cron/daily-digest` — สรุปของค้างส่งเจ้าของ (**ไม่มีของค้าง = ไม่ส่ง**) |
| `push-dispatch` | `*/5 * * * *` | ทุก 5 นาที | `/api/cron/push-dispatch` — ส่ง push ที่ค้างคิว |

- 🔴 **URL และ `CRON_SECRET` อยู่ใน Supabase Vault ไม่ใช่ในไฟล์ migration** —
  commit ความลับเมื่อไหร่ก็ติดอยู่ในประวัติ git ตลอดไป (§13 ข้อ 4)
  · ตัวเติมคือ `node scripts/setup-cron.mjs` ซึ่งอ่านจาก `.env.local`
  · ฟังก์ชัน `public.cron_call(path)` เป็นตัวอ่าน Vault แล้วยิง `net.http_get`
  ⚠️ **เปลี่ยนโดเมนหรือหมุน `CRON_SECRET` ต้องรัน `setup-cron.mjs` ซ้ำ**
  ไม่งั้นงานจะยิงด้วยกุญแจเดิมแล้วโดน 401 เงียบ ๆ ทุกวัน
- ตรวจว่าทำงานจริงยังไง (ไม่ใช่แค่ "ตั้งไว้แล้ว"):
  ```sql
  select jobname, schedule, active from cron.job;
  select status_code, left(content,120), error_msg from net._http_response order by id desc limit 5;
  ```
  · `cron.job_run_details` บอกว่างานถูกเรียกไหม · `net._http_response` บอกว่าปลายทางตอบอะไร
  — ต้องดูตัวที่สอง เพราะงานที่ "สำเร็จ" อาจยิงไปแล้วได้ 401 ก็ได้
- 🔴 **cron route รับกุญแจทาง header เท่านั้น** — เคยรับทาง `?secret=` ด้วยเพื่อ
  เรียกด้วยมือสะดวก แล้วมันไปนอนอยู่ใน access log ของทุกชั้นที่คำขอวิ่งผ่าน
  (dev server · Vercel · proxy) และประวัติเบราว์เซอร์ · เรียกด้วยมือใช้
  `curl -H "Authorization: Bearer <CRON_SECRET>" <url>`
- ลำดับตั้งใจ: ลงรายจ่ายรายเดือน (07:55) → แล้วค่อยสรุปของค้าง (08:00) ·
  สรุปที่ส่งก่อนรายการของวันถูกลง = สรุปที่ล้าไปหนึ่งรอบทุกวันที่ 1 ของเดือน

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
- **ตัวเลขของค้างบนเมนู** (sidebar + แถบล่าง) มาจาก `navBadges` ใน `(app)/layout.tsx`
  **ที่เดียว** — คีย์เป็น `href` ของเมนู · เพิ่มเมนูที่มีของค้างให้เติมคีย์ตรงนั้นที่เดียว
  · ปุ่ม "เพิ่มเติม" ของแถบล่างแสดง**ผลรวม**ของเมนูที่ถูกซ่อนอยู่ข้างใน ไม่งั้นตัวเลข
  จะนอนรออยู่หลังปุ่มที่ไม่มีเหตุให้ใครกด · ป้ายที่เป็น 0 ไม่วาดเลย ไม่ใช่วาดเลขศูนย์
  · ทุกตัวนับด้วย `head: true, count: 'exact'` ในฐานข้อมูล ไม่ใช่ `.filter().length`
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
    (app)/advances           ตั้งเบิกค่าแรง (หัวหน้าโครงการ) — ยื่นคำขอแทนลูกน้อง · เจ้าของเด้งไป /payroll
    (app)/reports            รายงานสรุป (เจ้าของ) — RPC `report_*` รวมยอดในฐานข้อมูล
    (app)/settings/users     ผู้ใช้ระบบ (มี login) · `?tab=workers` = คนงาน (ไม่มี login)
#                            เข้าจาก **สองปุ่มแยกกัน** บนหน้าตั้งค่า ไม่มีแถบแท็บแล้ว
    (app)/settings/branding  ชื่อบริษัท + โลโก้
    (app)/settings/wage-adjustments  รายการปรับค่าแรงสำเร็จรูป (OT · เบี้ยเลี้ยง · มาสาย)
    (app)/settings/documents  เลขที่เอกสาร (กรอก**เลขล่าสุด**) + ข้อมูลผู้ขายบนกระดาษ (R12)
    (app)/settings/customers  ทะเบียนลูกค้า — แก้/ลบได้ · มีผลกับใบถัดไปเท่านั้น
    (app)/documents/*        ใบเสนอราคา + ใบเสร็จ/ใบกำกับภาษี (เจ้าของเท่านั้น)
#                            (list) · new · [id] · [id]/edit · [id]/print
    components/documents/*   doc-form · doc-actions · doc-row · doc-filters · print-button
    components/ui/page-header.tsx  **ที่เดียวที่วางปุ่มย้อนกลับ** — ดู §15
    lib/{documents,doc-server,baht-text,date-range}.ts
#                            documents.ts = สูตรเงิน + ค่าตั้งต้นฟอร์ม (คู่กับ SQL doc_recalc)
#                            baht-text.ts = แทน BAHTTEXT ของ Excel · date-range.ts ใช้ร่วมกับ /ledger
    (app)/attendance/adjust-dialog.tsx  กล่องปรับค่าแรงของคนหนึ่งคนในหนึ่งวัน — ใช้ทั้ง /attendance และ /payroll
    (app)/payroll/site-wage-edit.tsx    ดินสอแก้ค่าแรงที่จ่ายจริงในแท็บ "ทำงานที่ไหนบ้าง"
    (app)/sites/[id]/bond-return.tsx    ปุ่ม "ได้รับหลักประกันคืนแล้ว" (R11) · api/sites/[id]/bond-return
    components/reports/bond-report.tsx  แท็บหลักประกันสัญญา · components/overview/bond-alert.tsx แถบเตือนหน้าแรก
    lib/bonds.ts                        ค่าคงที่/ตัวตรวจ/สูตรสถานะ (สูตรเดียวกับ RPC bond_status)
    api/auth/pin/route.ts
    api/branding/route.ts    ← ไม่ต้องล็อกอิน · หน้า login เรียกใช้
    api/transactions/route.ts · api/transactions/[id]/route.ts
    api/advances/route.ts · api/advances/[id]/route.ts
#                            POST = เจ้าของบันทึกจ่ายจริง (approved) · หัวหน้าโครงการยื่นคำขอ (pending)
#                            PATCH = อนุมัติ/ตีกลับ (เจ้าของ) หรือแก้คำขอของตัวเอง (= ส่งใหม่)
    api/transactions/[id]/attachments/route.ts · api/attachments/[id]/route.ts
    api/uploads/sign/route.ts · api/uploads/[id]/route.ts
    api/cron/sweep-orphans/route.ts · api/cron/daily-digest/route.ts
    api/push/subscribe/route.ts
    globals.css · layout.tsx · loading.tsx · error.tsx
  components/ui/*          ← จาก thai-admin-page-kit
  components/{sites,ledger,attendance,employees}/*
#                            ledger/txn-row.tsx (แถวรายการ ใช้ทั้ง /ledger และหน้าโครงการ)
#                            ledger/txn-edit.tsx (กล่องแก้ไข/ลบ — ตัวเดียวต่อหน้า)
  lib/supabase/{browser,server,admin,middleware}.ts
  lib/{r2,constants,dates,money,database.types}.ts
  lib/mcp/{keys-core,keys,args-core,tools,tool-names,rpc,execute,write,handler}.ts
#                            rpc.ts = ที่เดียวที่คุยกับฐานข้อมูล · write.ts = ฝั่งเขียน (R6)
#                            tool-names.ts = รายชื่อ tool ฝั่งเขียน ใช้ร่วมกับหน้า /mcp
  lib/{attachments,slip-upload}.ts   ← ผูกสลิปฝั่งเซิร์ฟเวอร์ / บีบ+อัปฝั่งเบราว์เซอร์
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
2. **seed เดโม่** ที่ครอบคลุมทุกสถานะที่หน้าจอเรนเดอร์ได้จริง: โครงการที่ใกล้ครบกำหนด · โครงการที่ต้นทุนแซงรายรับ · รายจ่าย `pending`/`approved`/`rejected` · คนเบิกเต็มเพดาน · รอบจ่ายที่ปิดแล้วและที่ยังเปิด · หน้าที่ยังว่าง
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
8. **`node scripts/remove-demo-data.mjs`** — เอาชุดเดโม่ออกโดยไม่แตะข้อมูลจริง
   · ไม่ใส่ `--confirm` = แสดงว่าจะลบอะไรเฉย ๆ · ลบตาม**ชื่อที่ seed สร้าง** ไม่ใช่ตามช่วงเวลา
   🔴 **ต้องรันหลัง `npm run verify:all` บนฐานที่มีข้อมูลจริง** — `verify-ship` เรียก seed
   เมื่อฐานยังว่าง แล้วไม่เก็บกวาด · แถว `site_supervisors` ช่วงเปิดที่มันทิ้งไว้
   ไปชน exclusion constraint กับแถวที่สคริปต์ตรวจตัวอื่นต้อง insert ให้คนเดียวกัน
   → หัวหน้าโครงการไม่ได้สิทธิ์ในโครงการทดสอบ → **ตกยกชุด 30 แถวโดยที่แอปไม่ได้ผิดอะไร**

## 14. เฟสการสร้าง

แต่ละเฟส **เขียน acceptance matrix ลง `docs/test-plan/<phase>.md` ก่อนเขียนโค้ด**

- [x] **P0 · ฐาน** — scaffold, โทเคน+`verify-contrast`, shell (sidebar ↔ bottom nav), ธีม, 4 Supabase clients, `proxy.ts`, login อีเมล + PIN (rate-limited), `profiles` + RLS + audit trigger
- [x] **P0.5 · แบรนด์ + ผู้ใช้** — `branding` + `app_settings` + `/api/branding` (ไม่ต้องล็อกอิน),
      หน้าตั้งค่าแบรนด์ (ชื่อ + อัปโหลดโลโก้เข้า R2), แสดงผลบนหน้า login และหัวระบบ พร้อม fallback,
      หน้า `/settings/users` ให้เจ้าของ CRUD ผู้ใช้ระบบ (แท็บคนงานมาเติมใน P4)
- [x] **P1 · โครงการ + ภาพรวม** — CRUD โครงการ, `site_supervisors` มีช่วงเวลา, การ์ด 3 แถบ, ป้ายเตือนต้นทุนแซงรายรับ, หน้าโครงการ
- [x] **P2 · รายรับ-รายจ่าย + R2** — หมวด, ฟอร์มบันทึก, ผูกโครงการ/ส่วนกลาง, บีบรูป, presigned PUT/GET, `upload_intents` + sweep, `/ledger` + ค้นหา/กรอง + pagination
- [x] **P3 · อนุมัติ + แจ้งเตือนในแอป** — คิวอนุมัติ, ตีกลับ+เหตุผล, guard triggers, กระดิ่ง + realtime broadcast
- [x] **P4 · พนักงาน + คนเข้าโครงการ** — CRUD คนงานที่ `/settings/users?tab=workers` (ไม่มี login ไม่มี role)
      · มีปุ่มของตัวเองบนหน้าตั้งค่า ต่อจากปุ่มผู้ใช้ระบบ,
      ตั้งค่าแรง**รายคน** (รายวัน/รายเดือน + เรตของแต่ละคน), ผูก `profile_id` ได้ถ้าคนนั้นล็อกอินด้วย,
      ลงชื่อรายวัน + `wage_snapshot`, ยอดค่าแรงวันนี้, ต้นทุนโครงการขึ้นทันที
- [x] **P5 · เบิก + รอบจ่าย** — `advances` + trigger เพดาน, `payroll_runs`/`payroll_lines`, ปิดรอบ, สรุปค่าแรงรายคน
- [x] **P6 · Audit** — หน้า `/audit` + กรอง + pagination, ตรวจว่าทุกตารางมี trigger จริง
- [x] **P7 · PWA + push** — manifest, SW, subscribe, ส่ง push ตอนมีรายการรออนุมัติ/ถูกตีกลับ, badge
- [x] **P8 · seed/reset + ตรวจรับ** — ตาม §13 แล้วไล่ acceptance matrix ทุกเฟสให้ปิด
- [x] **P9 · ตัวเชื่อม MCP อ่านอย่างเดียว** (ฝั่งเขียนมาเพิ่มใน R6 ข้างล่าง) — `mcp_keys`/`mcp_call_log`, ฟังก์ชัน `mcp_*` 6 ตัวที่
      **สวมสิทธิ์เจ้าของแล้วเรียก RPC เงินตัวเดิม** (สูตรอยู่ที่เดียว), tool 7 ตัว + prompt 3 อัน,
      เซิร์ฟเวอร์ Streamable HTTP เขียนเอง (`POST /api/mcp/[key]` + `Authorization: Bearer`),
      หน้า `/mcp` ออก/เพิกถอนคีย์ + คู่มือเชื่อมต่อ · `MCP_KEY_PEPPER` (§18)
      · 🔴 **401 ห้ามมี `WWW-Authenticate`** — header นั้นทำให้ client เริ่ม OAuth discovery แล้วค้าง

- [x] **R6 · MCP เขียนข้อมูลได้** — `mcp_key_id` บนสี่ตาราง + `audit_row()` แยก "AI ทำแทน",
      ฟังก์ชัน `mcp_*` ฝั่งเขียน 7 ตัว (สวมสิทธิ์เจ้าของแล้ว insert ลงตารางจริง — guard trigger
      เดิมทุกตัวยังบังคับครบ), tool ใหม่ 7 ตัว (`list_categories` `list_employees` `record_transaction`
      `update_transaction` `delete_transaction` `record_attendance` `record_advance`),
      ป้าย "บันทึกผ่าน AI" ที่ `/ledger` · หน้าโครงการ · `/audit`
      · 🔴 **การยืนยันเกิดในแชท** — รายการเข้าเป็น `approved` ทันที ไม่มีคิวอนุมัติรับต่อ
      คำอธิบาย tool คือด่านเดียวที่บังคับให้ AI สรุปแล้วถามก่อนบันทึก
      · 🔴 **รูปในแชทไม่ถูกเก็บเข้าระบบ** (MCP รับแต่ JSON) เก็บเฉพาะตัวเลขที่อ่านได้

- [x] **R7 · ลบคนงาน** — `delete_employee()` ลบคนพร้อมประวัติลงชื่อ/ใบเบิกในทรานแซกชันเดียว
      · **คนที่เคยอยู่ในรอบจ่ายที่ปิดแล้วลบไม่ได้** (`payroll_lines` คือหลักฐานการจ่ายเงิน) ให้ปิดใช้งานแทน
      · `employees_delete_info()` ส่งยอดค้างจ่ายมาพร้อมหน้า กล่องยืนยันจึงบอกได้ทันทีว่ากำลังจะเสียอะไร
- [x] **R8 · มุมมองการ์ดของคนเข้าโครงการ** — ปุ่มสลับมุมมอง + การ์ดสองคอลัมน์สำหรับเลือกด้วยนิ้วเดียว
- [x] **R10 · รายการปรับค่าแรง + แก้ค่าแรงที่จ่ายจริง** (19 ก.ย. 2569) — `wage_adjustment_presets`
      + `attendance_adjustments` · `ot_amount` กลายเป็น "ยอดสุทธิของรายการปรับ" (บวก − หัก) ที่
      trigger คำนวณให้ · ถอด check `ot_amount >= 0` แล้วคุมที่ **ค่าแรงสุทธิของวันห้ามติดลบ** แทน
      · กล่อง "ปรับ" บนการ์ด/รายชื่อ/แถวที่ลงแล้วของ `/attendance` · การ์ดสรุปของวันอยู่บนสุดไม่ลอย
      · ดินสอในแท็บ "ทำงานที่ไหนบ้าง" แก้ค่าแรงฐานรายวัน (`save_attendance_day` ไม่ส่ง `p_ot` =
      ไม่แตะรายการปรับ) · ⚠️ **ยังไม่ได้ apply migration** (Supabase MCP ในเครื่องที่ทำชี้ผิดโปรเจ็ค)
      — ต้อง apply + `generate_typescript_types` แล้ว diff กับที่เขียนมือต้องว่าง (`R10-DB-01`)
- [x] **R11 · หลักประกันสัญญา + ประกันผลงาน** (19 ก.ย. 2569) — คอลัมน์บน `site_finance` ·
      `warranty_end` = ส่งมอบงวดสุดท้าย + ระยะประกัน (generated) · RPC `bond_status`/`bond_summary`
      (security invoker — RLS ของ `site_finance` กรอง · service role เห็นครบ) · แท็บ "หลักประกันสัญญา"
      ใน `/reports` · แถบเตือนแดง/ส้มบนหน้าแรก (เจ้าของ) · สรุปเช้าส่งเมื่อเกินกำหนดหรือวันสำคัญ
      (เหลือ 30 วัน / ครบวันนี้) · ปุ่ม "ได้รับหลักประกันคืนแล้ว" — **เงินสดลงเป็นรายรับ** หมวด
      "หลักประกันสัญญาคืน" ทันที · หนังสือค้ำแค่บันทึกวัน · ยอด 5% เติมให้แล้วแก้ได้
      · `scripts/import-bonds.mjs` นำเข้าสเปรดชีตเก่า (พ.ศ. → ค.ศ. ในสคริปต์)
- [x] **R12 · ใบเสนอราคา + ใบแจ้งหนี้ + ใบเสร็จรับเงิน/ใบกำกับภาษี** (21 ก.ย. 2569) — ตาราง `customers` ·
      `doc_counters` · `documents` · `document_lines` (owner-only ทั้งสี่) · สูตรเงิน
      **inclusive แบบ VAT รับเศษ** ที่สร้างไฟล์ของเจ้าของซ้ำได้เป๊ะทั้งสองใบ ·
      `bahtText()` แทน `BAHTTEXT` ของ Excel · เลขที่เอกสารเจ้าของกรอก**เลขล่าสุด**
      (`RC1140` → ใบแรก `RC1141`) ไม่มีค่าตั้งต้นในโค้ด · `issue_document()` ออกเลข
      แบบอะตอมมิก (`for update` ก่อนอ่านสถานะ) · ผูกหรือไม่ผูกโครงการก็ได้ และที่ผูก
      โผล่ในหน้าโครงการ · พิมพ์ผ่าน `@media print` (ยังไม่ทำ PDF จริง) · ทะเบียนลูกค้า
      ที่ `/settings/customers` · **ใบแจ้งหนี้เป็นชนิดที่สาม** เดินเลขชุดของตัวเอง
      และแปลงต่อกันได้ตามลำดับงาน (เสนอราคา → แจ้งหนี้ → เก็บเงิน · ข้ามใบแจ้งหนี้ได้)
      · ตารางตรวจรับ `docs/test-plan/R12.md` 148 แถว
- [ ] **R14 · หัวหน้าโครงการตั้งเบิกค่าแรงให้ลูกน้อง + คิวอนุมัติ** (21 ก.ย. 2569) — `advance_status`
      + `status`/`rejected_reason`/`approved_by`/`approved_at` บน `advances` · RLS ให้หัวหน้า
      โครงการ **ยื่นคำขอ** ของโครงการตัวเอง และเห็นเฉพาะใบที่ตัวเองยื่น · `guard_advance`
      ตั้งสถานะตาม role (เหมือน `guard_transaction`) และแก้ใบที่ถูกตีกลับ = ส่งใหม่ ·
      `notify_advance` + `notification_kind` อีก 3 ค่า · คิวคำขอบน `/approvals` พร้อม
      **คำเตือนยอดที่เกินค่าแรงค้างจ่าย (เตือน ไม่ใช่ห้าม)** · หน้า `/advances` ของหัวหน้า
      โครงการ · ป้ายตัวเลขรวมคำขอเข้าเมนู "รออนุมัติ"
      · 🔴 **ทุกสูตรที่นับ "เบิกไปแล้ว" ต้องกรอง `status='approved'`** (§5 ข้อ 1b)
      · ✅ **apply บนฐานจริงแล้ว 22 ก.ย. 2569** · types ที่ generate มา diff กับที่เขียนมือ
      **ว่างเปล่า** · ใบเบิกเดิม 16 ใบเป็น `approved` ครบ ยอดคงเหลือ 12 คนเท่าเดิมทุกบาท
      · advisors ERROR 0 · **`node scripts/verify-advance-db.mjs` 25/25 ผ่านบนฐานจริง**
      (ทุกอย่างอยู่ใน `do` block ที่จบด้วย `raise exception` = rollback ทั้งก้อน จึงรันบน
      ฐานลูกค้าได้โดยไม่ทิ้งของค้าง และสวมสิทธิ์ด้วย `set local role authenticated` จึง
      ทดสอบ RLS จริง) · ยังเหลือ **ฝั่ง API กับหน้าจอ** ที่ต้องรันบนฐานที่มีบัญชี `SEED_*`
      และไล่แถว 👤 บนเบราว์เซอร์ · ตารางตรวจรับ `docs/test-plan/R14-advance-requests.md`
- [x] **R9 · รอบคำสั่งเจ้าของ 4 ก.ย. 2569** — เรียกหน่วยงานว่า "โครงการ" ทั้งระบบ · ปิดการ์ด
      "งานวันนี้" · ต้นทุนสะสมแยกสามก้อน (ค่าแรง/ค่าวัสดุ/อื่น ๆ) + ธง `categories.is_material`
      · ยอดรวมแยกหมวดในหน้าโครงการ · **จ่ายค่าแรงรายคนปุ่มเดียว** (เลิกใช้คำว่า "รอบจ่าย"
      บนหน้าจอ แต่กลไกรอบที่ปิดแล้วยังอยู่ เพราะมันคือตัวกันจ่ายซ้ำ/ล็อกค่าแรง/ฐานเพดานเบิก)
      · แท็บ "ทำงานที่ไหนบ้าง" รายคน–รายโครงการ · **ค่าใช้จ่ายรายเดือน** ที่ลงย้อนหลังให้เอง
      (ไม่แตะฐานข้อมูลและ API เลย เป็นมุมมองใหม่ของข้อมูลชุดเดิม)

**เฟสหลัง (ยังไม่ทำ):** PDF ไทย A4 · Excel/CSV · งบประมาณต่อโครงการ+เตือน · ปันส่วนเงินเดือนเข้าโครงการตามวัน

## 15. กติกาที่ห้ามละเมิด

- ภาษาไทยทั้งระบบ · **lucide ห้าม emoji** · **sonner ห้าม `alert()`** · radix สำหรับ confirm/ask
- ⚠️ **"ค่าแรง" กับ "เงินเดือน" เข้าต้นทุนคนละทาง ห้ามตั้งซ้อนกัน** — คนรายวัน
  ได้ค่าแรงตอนติ๊กเข้าโครงการ (accrual) · คนรายเดือนมี `wage_snapshot = 0` จึงเข้า
  เฉพาะ OT แล้วรับเงินเดือนผ่านกฎใน `recurring_expenses` แทน · ตั้งกฎเงินเดือนให้
  คนรายวันเมื่อไหร่ ต้นทุนเป็นสองเท่าทันที — `guard_recurring` กันไว้ที่ฐานข้อมูล
  และหน้าจอไม่แสดงคนรายวันในกล่องเลือกเลย
- ⚠️ **หน่วยงานเรียกว่า "โครงการ" เท่านั้น** (คำสั่งเจ้าของ 4 ก.ย. 2569) — ไม่มีคำว่า
  "ไซต์" หรือ "ไซต์งาน" ในข้อความที่ผู้ใช้เห็นอีกแล้ว รวมถึงข้อความที่ฐานข้อมูล
  **คืนกลับมาเป็นข้อมูล** (เช่นป้าย `'ส่วนกลาง (ไม่ผูกโครงการ)'` ใน `report_by_site`)
  · ตัวระบุในโค้ดและฐานข้อมูลยังเป็น `sites` / `site_id` / `supervises_site()` เหมือนเดิม
  — เปลี่ยนคำบนจอไม่ใช่เหตุผลพอที่จะเขียนฐานข้อมูลใหม่ทั้งใบ
- ⚠️ **ทุกหน้าใต้ `(app)` ต้องมีหัวข้อผ่าน `PageHeader` เท่านั้น** (คำสั่งเจ้าของ
  21 ก.ย. 2569) — ปุ่มย้อนกลับ **อยู่แถวเดียวกับชื่อหน้าและชิดขวาของจอเสมอ**
  ปุ่มของหน้าไปอยู่แถวถัดไป · ห้ามหน้าไหนวาง `<BackButton />` เอง และห้ามใส่
  `flex-wrap` ในแถวหัวข้อ (จอแคบจะพับปุ่มลงไปใต้หัวข้อ ซึ่งคืออาการที่เจ้าของแจ้ง)
  · บังคับด้วย `BACK-07` (ซอร์ส) และ `BACK-08` (วัดพิกัดจริงในเบราว์เซอร์ 3 ความกว้าง)
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

1. **ต้นทุนค่าแรงบวกซ้ำ** — ติ๊กคนเข้าโครงการคือ *ต้นทุนเกิด* (accrual) ส่วนเบิกล่วงหน้าและปิดรอบจ่ายคือ *เงินสดออก*
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
6. **`loading.tsx` กลืนรหัสสถานะของ `notFound()` และ `redirect()`** — segment ที่มี `loading.tsx`
   ถูกห่อด้วย Suspense แล้วคำตอบกลายเป็นสตรีมที่ **ส่งหัว 200 ออกไปแล้ว** ก่อน page จะได้ทำงาน
   · `/sites/<uuid ที่ไม่มีอยู่>` เปลี่ยนจาก 404 เป็น 200 และหน้าเฉพาะเจ้าของ 4 หน้าเปลี่ยนจาก
   เด้งจริงเป็น 200 พร้อมกัน โดยไม่มี error ให้เห็นเลย · **แก้:** เช็ค role ไว้ใน `layout.tsx`
   (เรนเดอร์นอก Suspense ของ page) และใช้ route group `(list)`/`(overview)`/`(main)` กันไม่ให้
   ขอบเขต Suspense คลุม segment ที่เป็น dynamic
7. **`documentElement.scrollWidth` วัดการล้นไม่ได้ เพราะเชลล์ `overflow-x: clip` ตัดทิ้งไปแล้ว** —
   ตัวเลขเป็น 0 เสมอ ต่อให้ยัด div กว้าง 3000px เข้าไป · ต้องวัด **ขอบขวาของแต่ละอิลิเมนต์**
   เทียบความกว้างจอ · "ถูกตัดทิ้ง" แย่กว่า "เลื่อนได้" เพราะไม่มีแถบเลื่อนบอกว่ามีอะไรหายไป
   · ที่เจอจริง: grid item ไม่มี `min-w-0` (ช่อง `1fr` = `minmax(auto,1fr)` ถูกดันด้วย min-content)
   และ `truncate` บน `<span>` แบบ inline ซึ่ง `overflow: hidden` ไม่มีผลกับกล่อง inline
8. **CTE ที่ `insert` แล้วอ่านกลับในคำสั่งเดียวกันมองไม่เห็นแถวของตัวเอง** — ทุกส่วนของคำสั่ง
   เห็น snapshot เดียวกัน · seed จึงผ่านตลอดบนฐานที่เคย seed แล้ว และพังครั้งแรกบนฐานที่ล้างใหม่
   ซึ่งคือสภาพเครื่องลูกค้าตอนติดตั้ง · แยกเป็นสองคำสั่ง: เขียนให้จบ แล้วค่อยอ่าน
9. **สคริปต์ตรวจต้องคืนฐานข้อมูลให้เหมือนตอนที่เจอ ใน `finally`** — และล้างเฉพาะเมื่อ
   **ตอนเริ่มมันว่างจริง** เท่านั้น · ตัวที่ปล่อยข้อมูลค้างไว้ทำให้สคริปต์อื่นแดง 31 แถวพร้อมกัน
   ส่วนตัวที่ล้างแบบไม่มีเงื่อนไขคือสคริปต์ที่ลบข้อมูลลูกค้าได้ในวันที่มีคนรันผิดเครื่อง
10. **แถวที่ค้าง `☐` แปลว่า "ไม่เคยถูกตรวจ" ไม่ใช่ "ตรวจแล้วรอติ๊ก"** — ปิด P0 โดยเหลือ 18 แถว
   แล้วเดินหน้าต่ออีกแปดเฟส · ตอนไล่ปิด พบว่าหนึ่งแถวอธิบายฟอร์มเปลี่ยนรหัสผ่านที่
   **ไม่เคยถูกสร้างเลย** · ห้ามปิดเฟสโดยเหลือ `☐` — ถ้าปิดไม่ได้ให้เปลี่ยนเป็น `👤` หรือ `⚠️`
   ซึ่งบังคับให้เขียนเหตุผล แล้ว "ยังไม่ได้เขียนโค้ด" จะโผล่ตอนนั้นแทนที่จะโผล่แปดเฟสให้หลัง
11. **CORS ของ bucket ไม่ครอบโดเมน production = อัปรูปตายทั้งเว็บจริง โดยไม่มี log ที่ไหนเลย**
   `setup-r2-cors.mjs` เคยอนุญาตแค่ localhost พร้อมคอมเมนต์ว่า "เพิ่มโดเมน production
   ตอน deploy" — ไม่มีใครเพิ่ม · เบราว์เซอร์บล็อกตั้งแต่ preflight (R2 ตอบ **403 ไม่มี
   `access-control-allow-origin`**) `fetch` โยน TypeError ซึ่ง**แยกจากเน็ตหลุดไม่ได้ตาม
   การออกแบบของเบราว์เซอร์** · ไบต์ไม่เคยผ่าน Vercel อยู่แล้ว **log ฝั่งเซิร์ฟเวอร์จึง
   ว่างเปล่าสนิท** และตัวตรวจทั้งชุดยังเขียวหมดเพราะรันจาก node ซึ่งไม่มี CORS
   · **แก้:** origin ทั้งหมดอยู่ใน `scripts/app-origins.mjs` ที่เดียว · `verify-r2`
   ยิง preflight จริงทีละ origin (P05-R2-11) และเช็คว่าไม่ได้ตั้ง `*` (P05-R2-12)
   · **คอมเมนต์ไม่ใช่การบังคับใช้ — กฎที่ไม่มีตัวตรวจคือกฎที่ยังไม่มีอยู่จริง**
12. **ตัวบีบรูปที่ทำงานก่อนตรวจชนิดไฟล์ ทำให้ข้อความดี ๆ ที่เขียนไว้แล้วไปไม่ถึงตาผู้ใช้**
   `browser-image-compression` throw ทันทีกับไฟล์ที่เบราว์เซอร์ decode ไม่ได้ (HEIC
   จากไอโฟนเป็นเคสที่เจอบ่อยที่สุด) · ถ้าเรียกมันก่อนเช็ค `file.type` ทุกอย่างจะตกลง
   catch รวมแล้วได้ข้อความกลาง ๆ ส่วน `'รองรับเฉพาะ PNG, JPG, WebP'` ที่มีอยู่ในโค้ด
   จะไม่มีวันถูกแสดง เพราะมันรอคำตอบจากเซิร์ฟเวอร์ที่ไม่เคยถูกเรียก
   · และ `accept` ของช่องเลือกไฟล์กันได้แค่ค่าเริ่มต้นของกล่องเลือกไฟล์ ผู้ใช้กด
   "ไฟล์ทั้งหมด" ได้เสมอ · **แต่การใส่ `accept` ให้แคบมีผลจริงข้อหนึ่ง:** iOS จะ
   แปลง HEIC เป็น JPEG ให้อัตโนมัติเมื่อ `accept` ไม่มี HEIC — `accept="image/*"`
   ทำให้ไอโฟนส่ง HEIC ดิบมาแล้วพังทุกครั้ง
13. **`catch (e) { toast.error(e.message) }` คือการเอาข้อความอังกฤษของเบราว์เซอร์ขึ้นจอ**
   `"Failed to fetch"` โผล่ให้คนงานกลางโครงการอ่าน · แสดงเฉพาะข้อความที่เราเขียนเอง
   (ติดป้าย `name` ไว้แล้วเช็ค) ที่เหลือใช้ประโยคกลางภาษาไทย
14. **สคริปต์ตรวจที่ "ล้างของค้างก่อนวัด" อาจกำลังลบของจริงของลูกค้า**
   `verify-r2` ลบทุกไฟล์ใน `branding/` แล้วอัปโลโก้ปลอมทับ เพื่อวัดว่าไฟล์เก่าถูกลบจริง
   — แล้วไม่เคยคืนให้ · ใครรัน `npm run verify:all` โลโก้บริษัทจะกลายเป็นจุดขาว 1×1 ถาวร
   · ต่างจากข้อ 9 ตรงที่ตรงนี้ล้างไม่ได้เลยไม่ว่าตอนเริ่มจะว่างหรือไม่ **ต้องถ่ายสำเนา
   ไบต์เดิมไว้แล้วคืนทั้งไฟล์และคีย์ใน `finally`**

15. **โทเคนที่ประกาศใน `:root` แต่ลืมส่งเข้า `@theme inline` = คลาสที่ไม่มีอยู่จริง**
   Tailwind ไม่รู้จัก `text-sidebar-title` แล้ว**ไม่สร้าง CSS ให้เลย ไม่มี error ที่ไหน** ·
   `tsc` เขียว `next build` เขียว `verify-contrast` เขียว (มันวัดค่าสีในไฟล์ ไม่ได้วัดว่า
   คลาสถูกสร้าง) · ตัวหนังสือตกไปใช้สีที่สืบทอดมาแทน — ที่เจอจริงคือชื่อบริษัทกับชื่อผู้ใช้
   กลายเป็น `--ink` (เกือบดำ) บนแผงกรมท่า **อ่านไม่ออกทั้งแผง** และลิงก์เมนูไม่มี hover
   (`bg-sidebar-hover` ก็หายไปด้วย) อยู่แบบนั้นข้ามหลายเฟสจนผู้ใช้เป็นคนแจ้ง
   · **แก้:** `scripts/verify-tokens.mjs` อ่านคลาสเชิงสีจากซอร์สแล้วเทียบกับ CSS ที่
   build ออกมาจริง (ไม่ใช่เทียบรายชื่อโทเคนกับตัวเอง ซึ่งจะเขียวตลอด) · ต่อเข้า
   `npm run gate` แล้ว รันหลัง `next build` เสมอ

16. **`beforeinstallprompt` ยิงครั้งเดียวและยิงก่อน React mount — คอมโพเนนต์ที่ดักเองจะไม่ได้ event เลย**
   ปุ่ม "ติดตั้งแอป" หายไปเฉย ๆ ทั้งที่เบราว์เซอร์พร้อมติดตั้ง · **ไม่มี error ที่ไหน**
   เพราะในมุมของ React ก็แค่ state ที่ไม่เคยถูกอัปเดต · ต้องดัก **ตอน import โมดูล**
   (นอก React) แล้วแจกด้วย `useSyncExternalStore` — `src/lib/pwa-install.ts`
   · และห้ามเทสต์บนเครื่องที่ติดตั้งแอปนี้ไปแล้ว เพราะเบราว์เซอร์จะไม่ยิง event นี้อีกเลย
   ซึ่งหน้าตาเหมือนโค้ดพังเป๊ะ
   · ต่อเนื่องกัน: **สถานะที่ฝั่งเซิร์ฟเวอร์ไม่มีทางรู้** (ติดตั้งแล้วไหม · ปิดคำชวนไปหรือยัง ·
   ธีมไหน) ห้ามเขียนเป็น `useState(false)` + `useEffect(() => setState(true), [])`
   — React 19 นับเป็น cascading render (`react-hooks/set-state-in-effect` เป็น **error**
   ไม่ใช่ warning) · ใช้ `useIsClient()` ใน `src/lib/use-is-client.ts` แทน
   ซึ่งมีช่อง `getServerSnapshot` ให้ตอบค่าฝั่งเซิร์ฟเวอร์แยกอยู่แล้ว

17. **กฎที่ล็อกแถวไว้ ต้องถามก่อนว่ามันล็อก *ใคร* จริง ๆ**
   "แก้ `amount` หลัง `approved` ไม่ได้" อ่านเหมือนกฎที่ทำให้การอนุมัติมีความหมาย
   แต่ในระบบนี้ **เจ้าของคือคนอนุมัติ และรายการที่เจ้าของคีย์เองเป็น `approved`
   ตั้งแต่วินาทีแรก** (route ตั้งให้ตาม role) · กฎนี้จึงไม่ได้กันเจ้าของจากใครเลย
   มันแค่แปลว่าพิมพ์ยอดผิดหนึ่งหลักแล้วแก้ไม่ได้และลบไม่ได้ตลอดกาล — ทางออกเดียว
   ที่เหลือคือปล่อยตัวเลขผิดค้างในรายงาน · คำถามที่ถูกคือ "ใครถูกกันจากใคร"
   ไม่ใช่ "แถวนี้ล็อกแล้วหรือยัง" · **ร่องรอยความรับผิดชอบอยู่ที่ `audit_log`
   ซึ่งเก็บ before/after ทุกครั้ง ไม่ใช่ที่การล็อกแถวไม่ให้ใครแตะ**
   · เจอตอนเจ้าของแจ้งว่าแก้รายการที่บันทึกไปแล้วไม่ได้เลยสักรายการ (31 ส.ค. 2569)

18. **ข้อความบนหน้าจอที่สัญญาสิ่งที่ policy ไม่อนุญาต — ไม่มี error ให้ใครเห็น**
   กล่องตีกลับเขียนว่า *"คนที่คีย์จะได้รับแจ้งเตือนพร้อมเหตุผลนี้ เพื่อให้แก้แล้วส่งใหม่ได้"*
   แต่ `transactions_update` ยอมให้แก้เฉพาะแถวที่ `status = 'pending'` · หัวหน้าโครงการ
   ที่ถูกตีกลับจึงแก้ใบเดิมไม่ได้ ลบก็ไม่ได้ ทำได้อย่างเดียวคือคีย์ใบใหม่แล้วทิ้ง
   ใบเก่าค้างไว้ในระบบตลอดไป · อาการฝั่งผู้ใช้คือกดแล้ว "สำเร็จ" แต่ไม่มีอะไรเปลี่ยน
   (RLS ตัดเหลือ 0 แถว แล้ว PostgREST ตอบ 200) · **ทุกประโยคบนหน้าจอที่บอกว่า
   "ทำได้" คือข้อกำหนดหนึ่งข้อที่ต้องมีแถวตรวจรับรองรับ ไม่ใช่คำโฆษณา**

19. **audit trigger ที่มี FK ล้มการเขียนของธุรกิจได้ — และมันจะล้มในวันที่คุณไม่ได้ดู**
   ตอนเพิ่ม `audit_log.mcp_key_id` ใส่ `references mcp_keys(id)` ไปด้วยตามสัญชาตญาณ
   · ซ้อมกับฐานจริงแล้วเจอทันที: id ที่ไม่มีในตาราง ทำให้ `update categories` ล้ม
   ทั้งคำสั่งด้วย `23503` — **ความล้มเหลวมาจากตัวบันทึกร่องรอย ไม่ใช่จากงานที่ทำ**
   · `audit_row()` ติดกับทุกตารางในระบบ อะไรก็ตามที่ทำให้มันโยน exception ได้
   คือสิ่งที่หยุดคนทำงานทั้งบริษัทได้ · ร่องรอยที่ชี้ไปแถวที่ถูกลบแล้วยังมีค่ากว่ามาก
   → คอลัมน์นี้เป็น uuid เปล่า ๆ ไม่มี FK ส่วนอีกสามตาราง (`transactions` ·
   `attendance` · `advances`) มี FK ได้เพราะค่าที่ใส่มาจากคีย์ที่กำลังเรียกอยู่จริง ๆ

20. **ป้ายที่บอกที่มาของแถว ต้องล็อกไม่ให้แก้ ไม่งั้นมันเป็นแค่ของประดับ**
   `mcp_key_id` ที่ใครก็ PATCH ทับได้ ตอบคำถาม "แถวนี้ AI คีย์หรือคนคีย์" ไม่ได้เลย
   · trigger `keep_mcp_key` (before update ทั้งสามตาราง) ดันค่าเดิมกลับเสมอ
   แบบเดียวกับที่ `guard_transaction` ทำกับ `created_by`
   · ⚠️ และเมื่อฟังก์ชัน MCP **สวมสิทธิ์เจ้าของจริง ๆ** `audit_log.actor` จะเป็น
   เจ้าของทุกแถวไม่ว่าจะมาจากมือหรือจากแชท — ถ้าไม่แยกไว้อีกคอลัมน์
   ประวัติจะอ่านว่าเจ้าของนั่งกดเองทั้งหมด ซึ่งเป็นความจริงครึ่งเดียวที่ไล่ต่อไม่ได้

21. **ถอด check ที่ตั้งชื่ออัตโนมัติด้วยการเทียบนิยาม — นิยามที่ Postgres พิมพ์ไม่ใช่ที่คุณเขียน**
   เขียน `check (ot_amount >= 0)` แต่ `pg_get_constraintdef()` คืน `(ot_amount >= (0)::numeric)`
   · `ilike '%ot_amount >= 0%'` จึงไม่เจอ · DO block วนศูนย์รอบ **ไม่มี error** · migration "สำเร็จ"
   · check เดิมยังอยู่ และไปบล็อกกรณีที่ตั้งใจให้ผ่าน (หักจนสุทธิติดลบ) โดยที่ตัวทดสอบ
   "หักเกินต้องถูกบล็อก" ยังเขียว เพราะถูกบล็อกอยู่ดี แค่ผิดตัว — **ต้องเช็คด้วยว่าใครบล็อก**
   (`sqlerrm like '%ชื่อ constraint ที่ตั้งใจ%'`) และมีคู่ตรงข้ามที่ต้องผ่าน · ใช้ regex ที่ยอมรับ
   วงเล็บ/cast (`~ 'ot_amount >= \(?0'`) แล้ว select ชื่อ constraint ออกมาดูหลัง apply ทุกครั้ง
   (เจอตอนตรวจ R10-DB-07 บนฐานจริง 19 ก.ย. 2569)

22. **กฎที่ปฏิเสธอยู่ อาจเป็นสิ่งเดียวที่ทำให้โค้ดอีกที่ "ถูก" มาตลอด — ถอดกฎเมื่อไหร่ รูเปิดทันที**
   `close_payroll_run()` หักเบิกด้วย `least(accrued, total)` แล้วบรรทัดถัดไปตีตรา
   ใบเบิก **ทุกใบ** ว่าหักแล้ว (`update advances set payroll_run_id = p_run
   where payroll_run_id is null`) · สองบรรทัดนี้ขัดกันเอง แต่ไม่เคยแสดงอาการ
   เพราะ `guard_advance` ห้ามเบิกเกิน ทำให้ `total ≤ accrued` เสมอ `least()`
   จึงไม่เคยตัดอะไรเลยสักครั้ง · วินาทีที่เจ้าของสั่งให้เบิกเกินได้ (20 ก.ย. 2569)
   ส่วนที่หักไม่ครบจะถูกตีตราว่าหักแล้วทันที = **บริษัทเสียเงินก้อนนั้นถาวร
   โดยไม่มี error ที่ไหนเลย และยอดทุกหน้าจอยังดูสมเหตุสมผล**
   · ทางแก้: `advances.deducted_amount` + หักแบบ FIFO เท่าที่หักได้จริง
   · **บทเรียน:** ก่อนถอดกฎที่ "ปฏิเสธ" ออก ต้องไล่หาก่อนว่ามีโค้ดตรงไหน
   ที่ถูกต้องอยู่ได้**เพราะ**กฎนั้น — `grep` หาโค้ดที่แตะตารางเดียวกัน แล้วถามทีละที่ว่า
   "ถ้าเงื่อนไขนี้เป็นเท็จได้ ที่นี่ยังถูกอยู่ไหม" · ตัวที่จับได้คือแถวตรวจรับที่มี
   ตัวเลขของทั้งสองฝั่ง (จ่ายจริง ฿0 · หักได้ ฿1,100 · **ค้างต่อ ฿700**) ไม่ใช่แถวที่ถามว่า "ผ่านไหม"

23. **ตัวตรวจเอกสารมองเห็นแค่ครึ่งเดียวของงาน แล้วรายงานว่าเขียวสนิท** *(ยังไม่แก้ — ดูข้อควรทำข้างล่าง)*
   `verify-matrix.mjs` กระทบยอด "แถวที่ติ๊ก" กับ "check ที่รันได้" ด้วย
   `/P\d+-[A-Z][A-Z0-9]*-\d+/` ซึ่ง **ไม่แมตช์คำนำหน้า `R`** · เฟส R1–R13 ทั้งหมด
   จึงไม่เคยถูกตรวจเลยสักแถว ตั้งแต่วันที่เริ่มใช้คำนำหน้านี้
   · เปลี่ยนเป็น `[PR]\d+` **ทั้งสองที่** (บรรทัด `const ID` และ regex ที่อ่านแถวในตาราง)
   แล้วจำนวนแถวกระโดดจาก **492 → 908** พร้อมของค้าง 2 ก้อน:
   **55 แถวที่ติ๊ก ✅ โดยไม่มี check รองรับ** (R1 · R2 · R3 · R4-PWA · R6-DB/SEC ·
   R7-DB · R10 · R11) และ **14 check ที่อ้างแถวซึ่งไม่มีในตาราง** (R9-DIG · R9-REC · R6-TOOL-03b)
   · ส่วนหนึ่งเป็นของจริง อีกส่วนเป็นเพราะเอกสารเฟส R ใช้รูปแบบหลักฐานคนละแบบ
   (`👤 verify-xxx` · `F=...`) ที่ตัวตรวจยังอ่านไม่เป็น — **ต้องแยกให้ออกก่อนแก้**
   · 🔴 ยังไม่เปลี่ยนใน repo เพราะจะทำให้ `npm run verify:all` แดงทันที 69 แถว
   ซึ่งเป็นงานคนละก้อนกับที่กำลังทำอยู่ (เจอ 20 ก.ย. 2569 ตอนทำเรื่องเบิกเกิน)
   · **บทเรียน:** ตัวตรวจที่ "เขียวมาตลอด" ต้องถูกถามเป็นระยะว่ามันนับอะไรอยู่กี่ชิ้น
   — ตัวเลข `แถวทั้งหมด 492` พิมพ์อยู่บนจอทุกครั้งที่รัน และไม่มีใครเทียบมันกับ
   จำนวนแถวจริงในโฟลเดอร์เลยสักครั้ง

24. **"แถวกำพร้า" ไม่ใช่เครื่องหมายว่าเป็นของทดสอบ — มันคือประวัติที่ลูกค้าลบข้อมูลของตัวเอง**
   เขียนตัวเก็บกวาด `audit_log` ของสคริปต์ตรวจ โดยใช้เงื่อนไข "แถว `attendance_wages`
   ที่ `attendance_id` ไม่มีอยู่แล้ว" เพราะ `attendance_wages` ไม่มีคอลัมน์ `id`
   audit จึงเก็บ `row_id` เป็น `null` ไล่ตามตรง ๆ ไม่ได้
   · ผลคือ **ลบประวัติจริงของลูกค้าไป 66 แถว** ในคำสั่งเดียว — ทุกครั้งที่ลูกค้า
   ติ๊กคนออกจากโครงการ แถว `attendance` ถูกลบ แถว audit ของค่าแรงวันนั้นก็กลายเป็น
   กำพร้าเหมือนกันเป๊ะ · ร่องรอย "ใครลบวันไหน" (`attendance` DELETE) ยังอยู่ครบ
   แต่ยอดค่าแรงของวันที่ถูกลบหายไปแล้ว กู้ไม่ได้
   · **แก้:** เก็บ `id` ของแถวที่ fixture สร้างเอง **ตั้งแต่ตอน insert**
   (`returning id`) แล้วลบตามรายการนั้น — อย่าอนุมานความเป็นเจ้าของจากสภาพของข้อมูล
   · ต่อเนื่องจาก §17 ข้อ 14 แต่แสบกว่า เพราะข้อ 14 ลบไฟล์ที่ "เห็นได้ว่าหาย"
   ส่วนข้อนี้ลบประวัติที่ไม่มีใครเปิดดูจนกว่าจะต้องใช้
   · และ `delete ... where site_id = …` ที่คลุมหลายคนในคำสั่งเดียว ถ้ามีแถวเดียว
   ที่ guard ปฏิเสธ (วันที่จ่ายเงินไปแล้ว) **ทั้งคำสั่งล้ม ไม่มีอะไรถูกลบเลย**
   แล้วสคริปต์ยังพิมพ์ว่า "ลบข้อมูลทดสอบแล้ว" — ต้องลบรอบจ่ายก่อนเสมอ และต้อง
   **อ่านกลับมานับ** ว่าเหลือ 0 แถวจริง ไม่ใช่เชื่อว่าคำสั่ง delete สำเร็จ

25. **ฟังก์ชันที่ export จากโมดูล `'use client'` แล้วเรียกจากเซิร์ฟเวอร์ = หน้าพังให้ผู้ใช้ทุกคน โดยทุกไฟเขียว**
   กัดสองครั้งในวันเดียวกัน (21 ก.ย. 2569): `wageRowKey()` ที่ `/payroll?tab=sites`
   และ `emptyDraft()` ที่ `/documents/new` · อาการเหมือนกันเป๊ะ —
   `tsc --noEmit` เขียว · `next build` เขียว · **ตัวตรวจที่ยิงด้วย `fetch` ได้ 200
   พร้อม HTML ที่ดูปกติ** เพราะโครงร่างของ `loading.tsx` ถูกส่งออกไปก่อนแล้ว
   ส่วน error เกิดตอน **เบราว์เซอร์ประมวลผลสตรีม RSC** เท่านั้น
   (`"Attempted to call emptyDraft() from the server but emptyDraft is on the client"`)
   · เจ้าของเป็นคนแจ้งครั้งแรก ตัวตรวจไม่เคยเห็น
   · **แก้:** ย้ายฟังก์ชันไปไฟล์ล้วนใน `src/lib/` แล้วให้ทั้งสองฝั่ง import จากที่นั่น
   (`src/lib/wage-row-key.ts` · `emptyDraft` ใน `src/lib/documents.ts` ·
   `rangeDates`/`detectRange` ใน `src/lib/date-range.ts` ซึ่งย้ายออกมาก่อนจะโดน)
   · **ตัวจับ:** `scripts/verify-client-boundary.mjs` (`P0-BOUNDARY-01`) อ่านซอร์สล้วน ๆ
   หาไฟล์ที่ไม่มี `'use client'` แต่ import **ค่า**ชื่อขึ้นต้นตัวพิมพ์เล็กจากไฟล์ที่มี
   — ต่อเข้า `npm run gate` แล้ว (เร็วกว่ารอ `P0-BROWSER-01` ที่ต้องเปิด Chrome ไล่ทุกหน้า)
   · red-test แล้ว: ใส่บั๊กกลับ → แดงพร้อมชี้บรรทัด · ถอดออก → เขียว

26. **`on delete set null` ยิง `UPDATE` เข้า guard ของตารางลูก — แล้วการลบแถวแม่ล้มทั้งคำสั่ง**
   `documents.site_id` เป็น `on delete set null` · `guard_document` ห้ามเปลี่ยน
   `site_id` ของใบที่ส่งให้ลูกค้าแล้ว · ผลคือ **ลบโครงการที่เคยออกใบเสร็จไปแล้ว
   ไม่ได้เลยตลอดกาล** และข้อความที่เจ้าของเห็นคือ `DOC_LOCKED` ซึ่งไม่ได้พูดถึง
   โครงการสักคำ — อ่านแล้วนึกว่าระบบพัง
   · **แก้:** guard ต้องแยก "ค่ากลายเป็น null เพราะแถวที่อ้างถึงหายไปแล้ว"
   (`not exists (select 1 from sites where id = old.site_id)`) ออกจาก "มีคนย้ายโครงการ"
   · **บทเรียนทั่วไป:** ก่อนเขียน guard บนคอลัมน์ที่เป็น FK ให้ไล่ดูว่า FK นั้นมี
   `on delete`/`on update` action อะไร — action พวกนั้นเขียนคอลัมน์ผ่าน guard ของเรา
   เหมือนคนกดแก้ทุกประการ และมันจะล้มในวันที่เราไม่ได้ดู (เหมือน §17 ข้อ 19)
   · ต้องมี**คู่ตรงข้าม**ในตารางตรวจรับเสมอ (`R12-DB-10` ลบได้ / `R12-DB-10b` ย้ายไม่ได้)
   ไม่งั้นการแก้ข้อนี้จะกลายเป็นการเปิดรูให้ย้ายใบที่ล็อกแล้วเงียบ ๆ

27. **enum ที่เพิ่มค่าใหม่ ต้องไล่หา "สำเนารายการค่า" ที่กระจายอยู่ในโค้ด — ไม่งั้นชนิดใหม่มีครบทุกที่ยกเว้นประตูทางเข้า**
   เพิ่ม `invoice` เข้า `doc_kind` แล้วแก้ `DocKind` · `DOC_KINDS` · `isDocKind`
   ครบหมด · `tsc --noEmit` เขียว · `next build` เขียว · types ที่ generate มาจาก
   ฐานข้อมูลก็มีสามค่าครบ · แต่ `POST /api/documents` **ปฏิเสธใบแจ้งหนี้ทุกใบ**
   ด้วย `DOC_KIND_INVALID` เพราะ `doc-server.ts` มี `isDocKindValue` ที่เป็น
   **สำเนา** `v === 'quotation' || v === 'receipt'` เขียนไว้เองอีกที่หนึ่ง
   · TypeScript จับไม่ได้เลย เพราะ type guard ที่แคบเกินจริงยัง type-check ผ่าน
   (มันแค่ narrow ลงมามากกว่าที่ควร) และไม่มีใครเรียกมันด้วยค่าใหม่ตอน compile
   · **แก้:** ตัวตรวจชนิดมีตัวเดียวที่ `src/lib/documents.ts` ที่เหลือ re-export
   · **วิธีหา:** `grep` หาค่าเก่าทุกค่าของ enum เป็นสตริง (`'quotation'` ·
   `'receipt'`) ไม่ใช่แค่ grep ชื่อ type — สำเนาแบบนี้ไม่ได้อ้างชื่อ type เลย
   · เจอเพราะเขียนแถวตรวจรับที่ **ออกเอกสารชนิดใหม่จริง** (R12-INV-02) ไม่ใช่
   แถวที่ถามว่า "enum มีสามค่าไหม" ซึ่งเขียวตั้งแต่วินาทีที่ apply migration

28. **red test ที่ "คาดว่าจะถูกปฏิเสธ" ต้องจด id ของแถวที่มันสร้าง เผื่อวันที่มันไม่ถูกปฏิเสธ**
   `R12-INV-03` ยัดเลขที่ซ้ำเข้าไปตรง ๆ เพื่อดูว่า unique index ทำงานไหม ·
   รอบแรกกฎยังพัง แถวจึง **ถูกเขียนสำเร็จ** และสคริปต์ไม่ได้จด id ไว้
   (เพราะเขียนโดยสมมติว่ามันต้องล้มเสมอ) → เหลือใบแจ้งหนี้ `IV0301` ค้างในฐานจริง
   · รอบถัดไป `setCounter('IV0300')` โดน `DOC_NO_BEHIND` แล้วแถวอื่นอีกสามแถว
   แดงตามกันเป็นลูกโซ่ **ด้วยเหตุผลที่ไม่เกี่ยวกับสิ่งที่มันตรวจเลย**
   · **แก้:** `insert … returning id` แล้ว `track()` ทุกครั้ง แม้ในกิ่งที่คาดว่าจะล้ม
   · **บทเรียน:** โค้ดเก็บกวาดต้องเขียนโดยสมมติว่า **ทุก assertion ในไฟล์อาจเป็นเท็จ**
   — มันคือโค้ดชิ้นเดียวที่ต้องทำงานถูกในวันที่ของอื่นพังหมด (ต่อจาก §17 ข้อ 9)

29. **เปิดสิทธิ์ให้ role หนึ่งเขียนตารางเดิม = ทุกสูตรที่เคยอ่านตารางนั้นต้องถูกถามใหม่ว่ายังจริงไหม**
   ตอนเปิดให้หัวหน้าโครงการยื่นคำขอเบิก (R14) ของใหม่ในตาราง `advances` คือแถวที่
   **ยังไม่ใช่เงิน** · แต่สูตรทั้งห้าที่เขียนไว้ตั้งแต่สมัยที่ทุกแถวแปลว่า "จ่ายแล้ว"
   ยังนับมันเป็นเงินหมด — `employee_balance` · `payroll_balances` ·
   `close_payroll_run` · `report_summary` · `report_labor`
   · อาการถ้าพลาด: คนงานถูกหักค่าแรงคืนสำหรับเงินที่ยังไม่เคยได้รับ และใบคำขอ
   ถูกตีตราว่าหักแล้วในทรานแซกชันเดียวกัน **ไม่มี error ที่ไหนเลย ทุกยอดบนจอ
   ยังดูสมเหตุสมผล** — ตรงกับข้อ 22 เป๊ะ แค่คนละทิศ (ข้อ 22 คือถอดกฎ · ข้อนี้คือ
   เพิ่มค่าใหม่ให้คอลัมน์ที่โค้ดเก่าอ่านอยู่)
   · **วิธีหา:** `grep -n "from public.advances"` ทุก migration แล้วไล่ทีละที่ว่า
   "ถ้าแถวนี้แปลว่าคำขอ ที่นี่ยังถูกอยู่ไหม" ไม่ใช่ grep ชื่อฟังก์ชันที่คิดว่าเกี่ยว
   · และ **default ของคอลัมน์สถานะต้องเป็นค่าที่ปลอดภัยที่สุด** (`pending`)
   แล้วให้ทางที่จ่ายเงินจริงระบุ `approved` เอง — ตรงข้ามกันเมื่อไหร่ แถวที่
   ใครสักคนลืมระบุจะกลายเป็นเงินที่จ่ายออกไปแล้วโดยไม่มีใครกด
   · ของที่ต้องตามแก้พร้อมกันคือ **คนเขียนที่ไม่ใช่หน้าจอ**: `mcp_create_advance`
   (AI คีย์แทนเจ้าของ = อนุมัติแล้ว) · `seed-demo.mjs` · `verify-payroll.mjs`
   ซึ่ง insert ผ่าน PostgREST/SQL ตรงโดยไม่เคยส่งคอลัมน์นี้มาก่อน

30. **ตรวจกฎบนฐานจริงได้โดยไม่ทิ้งของค้าง — `do` block ที่จบด้วย `raise exception`**
   โค้ดเก็บกวาดของสคริปต์ตรวจคือต้นเหตุของบาดแผลสี่ข้อในหน้านี้ (ข้อ 9 · 14 · 24 · 28)
   ทุกข้อมาจากสมมติฐานเดียวกัน: "ลบสิ่งที่ตัวเองสร้างได้ถูกต้องเสมอ"
   · ทางที่ไม่ต้องเชื่อสมมติฐานนั้นเลยคือ **ไม่ commit ตั้งแต่แรก** — ยัด fixture
   การยืนยัน และรายงานผลไว้ใน `do $$ ... $$` ก้อนเดียว แล้วปิดท้ายด้วย
   `raise exception '%', v_out;` · exception ม้วนทุกอย่างกลับ (แถวข้อมูล · แจ้งเตือน
   ที่ trigger สร้าง · `audit_log` · รอบจ่าย) พร้อมกัน และข้อความที่ raise คือรายงานผล
   ที่ฝั่ง client อ่านได้จาก error body
   · **สวมสิทธิ์เพื่อทดสอบ RLS จริง:** `perform set_config('request.jwt.claims',
   json_build_object('sub', <uuid>, 'role','authenticated')::text, true)` แล้ว
   `execute 'set local role authenticated'` · `reset role` เพื่อกลับมาเป็น superuser
   — ถ้าไม่สลับ role ทุก policy จะถูกข้ามและสคริปต์จะเขียวโดยไม่ได้ตรวจอะไรเลย
   · 🔴 **ถ้าคำสั่งสำเร็จแทนที่จะโยน exception = แดงทันที** ไม่ใช่เขียว เพราะแปลว่า
   รายงานไม่ถูกส่งกลับ และอาจมีของค้างจริง · ตัวอย่าง: `scripts/verify-advance-db.mjs`
   (R14 · 25 แถว รันบนฐานลูกค้า 22 ก.ย. 2569 · ตรวจของค้างหลังรัน = 0 ทุกตาราง)

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
MCP_KEY_PEPPER=                      # สร้างให้ (random 32 bytes) · pepper ของคีย์ตัวเชื่อม MCP
#                                      ไม่มีค่า fallback โดยเจตนา — ไม่ตั้ง = /api/mcp ตอบ 500
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
4. **โดเมนที่จะ deploy ต้องอยู่ใน `scripts/app-origins.mjs` และรัน
   `node scripts/setup-r2-cors.mjs` แล้ว** — ไม่งั้นอัปรูปตายทั้งเว็บโดยไม่มี
   error ที่ไหนเลย (§17 ข้อ 11) · ยืนยันด้วย `node scripts/verify-r2.mjs`
   ซึ่งยิง preflight จริงทีละ origin · **การเปลี่ยนโดเมนภายหลังต้องรันซ้ำ**
5. `MCP_KEY_PEPPER` ใน Vercel ต้องเป็น **ค่าเดียวกับในเครื่อง** — สร้างใหม่ = คีย์ที่ออกให้เจ้าของ
   ไปแล้วตายทุกใบพร้อมกัน โดยอาการที่เจ้าของเห็นคือ connector ที่เคยใช้ได้กลายเป็น 401 เฉย ๆ
   ไม่มีข้อความบอกว่าเพราะอะไร · และต้องใช้ URL **production** ไม่ใช่ preview
   (Deployment Protection ของ preview ตอบกำแพงล็อกอินที่ connector ผ่านไปไม่ได้)

⚠️ **ห้ามเขียนทับค่าที่มีอยู่แล้ว** — สร้าง VAPID ใหม่ = subscription ของทุกเครื่องตายหมด
⚠️ ตอน deploy ต้องคัดลอก `PIN_PEPPER` / `CRON_SECRET` / `MCP_KEY_PEPPER` / VAPID ชุดเดียวกันไปใส่ใน Vercel env
⚠️ `NEXT_PUBLIC_*` ถูกฝังตอนเริ่ม dev server — แก้แล้วต้องรีสตาร์ท ไม่ใช่แค่ refresh

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
