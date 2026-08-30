# เช็คลิสต์ก่อน deploy

> **รันก่อนเสมอ:** `node scripts/verify-ship.mjs`
> สคริปต์ตรวจข้อที่เครื่องตัดสินได้เอง 14 ข้อ แล้วพิมพ์รายการที่ยังค้างออกมา —
> เอกสารฉบับนี้อธิบาย *ทำไม* และ *ทำยังไง* ของข้อที่เครื่องกดแทนไม่ได้

---

## 0. สภาพปัจจุบัน

```
npm run gate         # tsc + verify-contrast + next build   → ต้องเขียว
npm run verify:all   # 395 แถว                              → ต้อง 0 ตก
```

`verify:all` ต้องมี dev server อยู่ที่ `http://localhost:3100` (`npm run dev -- -p 3100`)
เพราะแถว E2E ยิงใส่เบราว์เซอร์จริง

---

## 1. สี่ข้อที่ต้องทำด้วยมือก่อนส่งมอบ

### 1.1 เปลี่ยนรหัสผ่านและ PIN ของบัญชีทดสอบ  · `P8-SHIP-03`

ชุดปัจจุบันเป็นของทดสอบ: เจ้าของใช้รหัสสั้นกว่า 12 ตัว · PIN คือ `246810` และ `135791`

- เจ้าของเปลี่ยนรหัสตัวเองได้จาก **ตั้งค่า → รหัสผ่านของคุณ** (ต้องกรอกรหัสปัจจุบัน)
- PIN ของหัวหน้าไซต์: **ตั้งค่า → ผู้ใช้ระบบ → ตั้ง PIN ใหม่**
- ⚠️ **PIN ห้ามซ้ำกันระหว่างคน** — หน้าล็อกอินมีแต่แป้นตัวเลข ระบบระบุตัวตนจาก PIN
  อย่างเดียว · ฐานข้อมูลมี unique index กันไว้แล้ว แต่ให้รู้ว่าทำไม

### 1.2 เปิด Leaked Password Protection  · `P8-SHIP-02`

Supabase → **Authentication → Password** → เปิด

**ต้องทำหลังข้อ 1.1** — เปิดก่อนแล้วรหัสทดสอบจะถูกปฏิเสธทันที และล็อกอินไม่ได้

### 1.3 ตั้ง pg_cron (หลัง deploy แล้วมี URL สาธารณะ)  · `P8-SHIP-05`

pg_cron ทำงานเป็น **UTC** — 8 โมงเช้าไทยคือ `0 1 * * *`

```sql
select cron.schedule('sweep-orphans', '0 * * * *', $$
  select net.http_post(
    url := 'https://<โดเมนจริง>/api/cron/sweep-orphans',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
  )$$);

select cron.schedule('push-dispatch', '* * * * *', $$
  select net.http_post(
    url := 'https://<โดเมนจริง>/api/cron/push-dispatch',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
  )$$);

select cron.schedule('daily-digest', '0 1 * * *', $$
  select net.http_post(
    url := 'https://<โดเมนจริง>/api/cron/daily-digest',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
  )$$);
```

ตรวจว่าเข้าจริง: `select jobname, schedule, active from cron.job;`

### 1.4 เปลี่ยนไอคอนแอปเป็นโลโก้จริง  · `P8-SHIP-09b`

ตอนนี้เป็นรูปหมวกนิรภัยที่ `scripts/make-icons.mjs` วาดเอง
เมื่อได้ไฟล์โลโก้จากเจ้าของ ให้แทน `public/icon-192.png` · `icon-512.png` · `apple-touch-icon.png`

> ⚠️ ไอคอนคนละเรื่องกับ **โลโก้บริษัทในระบบ** ซึ่งอัปโหลดได้เองจาก
> **ตั้งค่า → ชื่อบริษัทและโลโก้** และเก็บใน R2 ไม่ใช่ในโค้ด

---

## 2. ตัวแปรสภาพแวดล้อมบน Vercel

### ต้อง **ไม่มี** เด็ดขาด  · `P8-SHIP-01`

```
ENABLE_DEMO_LOGIN   SEED_OWNER_EMAIL   SEED_OWNER_PASSWORD
SEED_SUPERVISOR1_NAME   SEED_SUPERVISOR1_PIN
SEED_SUPERVISOR2_NAME   SEED_SUPERVISOR2_PIN
```

ขั้วเป็น **opt-in**: ไม่มีตัวแปร = ปิด · ถ้าใช้ขั้วตรงข้าม ทุก preview branch
และทุก fork ที่ไม่ได้ตั้งค่าจะกลายเป็นประตูสาธารณะเข้าแอปโดยปริยาย

### ต้องคัดลอกไปให้ **ตรงกับของเดิม**

```
PIN_PEPPER   CRON_SECRET   VAPID_PUBLIC_KEY   VAPID_PRIVATE_KEY
NEXT_PUBLIC_VAPID_PUBLIC_KEY   VAPID_SUBJECT
```

🔴 **สร้าง VAPID ใหม่ = subscription ของทุกเครื่องตายหมดทันที**
🔴 **เปลี่ยน `PIN_PEPPER` = ทุกคนล็อกอินด้วย PIN ไม่ได้อีกเลย** เพราะค่าใน
`profiles.pin_hash` คำนวณจาก pepper เดิม และไม่มีทางคำนวณกลับ

### ที่เหลือ

```
NEXT_PUBLIC_SUPABASE_URL   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
R2_ACCOUNT_ID   R2_BUCKET   R2_ACCESS_KEY_ID   R2_SECRET_ACCESS_KEY
```

`SUPABASE_ACCESS_TOKEN` และ `SUPABASE_PROJECT_REF` เป็นของเครื่องพัฒนา (MCP + สคริปต์)
**ไม่ต้องมีบน Vercel**

---

## 3. ข้อที่สคริปต์ตรวจให้แล้ว — ไม่ต้องทำเอง

| ข้อ | ตรวจโดย |
|---|---|
| ปิดสมัครสมาชิกสาธารณะ · ไม่เปิด anonymous sign-in | `P8-SHIP-04` |
| ไม่มีไฟล์ `.env` จริงถูก track · ไม่มีคีย์ลับในซอร์ส | `P8-SHIP-06` |
| advisors ไม่มี ERROR ทั้ง security และ performance | `P8-SHIP-07` |
| ทุกตารางใน `public` เปิด RLS | `P8-SHIP-08` |
| `VAPID_SUBJECT` เป็นอีเมลจริง | `P8-SHIP-09` |
| ปุ่มเดโม่เป็นขั้ว opt-in จริง (ไม่ตั้ง = 404) | `P8-SHIP-01b` |

---

## 4. ตอน deploy

- `vercel.json` ตั้ง `{ "regions": ["sin1"] }` ไว้แล้ว — ฟังก์ชันต้องอยู่ภูมิภาคเดียว
  กับโปรเจ็ค Supabase (สิงคโปร์) ไม่งั้นทุกคิวรีเดินทางข้ามทวีปสองรอบ
- CORS ของ bucket R2 ต้องอนุญาต origin จริงของโดเมน (ตอนนี้ตั้งไว้สำหรับ localhost)
  ไม่งั้น **อัปโหลดสลิปจะพังเงียบ ๆ** ทั้งที่หน้าเว็บดูปกติ
- หลัง deploy รอบแรก: ล็อกอินจริงหนึ่งครั้ง แล้วเปิด `/settings` กด "เปิดแจ้งเตือน"
  เพื่อยืนยันว่า service worker ลงทะเบียนได้บนโดเมนจริง (`P8-E2E-06` — ต้องใช้เครื่องจริง)

---

## 5. ข้อมูลตัวอย่าง

```bash
node scripts/seed-demo.mjs              # ใส่ข้อมูลเดโม่ครบทุกสถานะ
node scripts/db.mjs file supabase/reset.sql   # ล้างข้อมูลธุรกิจทั้งหมด
```

`reset.sql` **ไม่ลบ** บัญชีผู้ใช้ หมวดตั้งต้น การตั้งค่าบริษัท และ `audit_log`
· ลบ `profiles` แล้วผู้ใช้ที่ยังล็อกอินค้างจะติดวนระหว่าง `/` กับ `/login`

🔴 **ห้ามรัน seed หรือ reset บนฐานข้อมูลที่มีข้อมูลจริงของลูกค้าแล้ว**
