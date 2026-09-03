-- ════════════════════════════════════════════════════════════════════════
-- แก้ตัวกันส่งซ้ำของสรุปประจำวันให้ `on conflict` ใช้ได้จริง
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 อาการที่เจอ: upsert ตอบ `there is no unique or exclusion constraint
-- matching the ON CONFLICT specification` แล้ว route คืน 500
--
-- สาเหตุ: ดัชนีเดิมเป็น **partial** (`where digest_date is not null`)
-- ซึ่งใช้เป็น arbiter ของ `on conflict (cols)` ไม่ได้ นอกจากจะเขียน
-- predicate กำกับไปด้วย — และ PostgREST เขียนแบบนั้นไม่ได้
--
-- ทางแก้: ดัชนีเต็ม ไม่มี predicate · ปลอดภัยเพราะ **NULL ไม่ชนกันเองใน
-- unique index** — แจ้งเตือนปกติทุกแถวมี `digest_date = null` จึงยังมีได้
-- ไม่จำกัดจำนวนต่อคนเหมือนเดิม ส่วนสรุปประจำวันมีได้วันละแถวเดียวต่อคน

drop index if exists public.notifications_digest_once;

create unique index if not exists notifications_digest_once
  on public.notifications(user_id, digest_date);
