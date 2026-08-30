-- ════════════════════════════════════════════════════════════════════════
-- P0 · ตารางนับความพยายามล็อกอิน — ใช้ทำ rate limit
--
-- ต้องเก็บในฐานข้อมูล ไม่ใช่ Map ในหน่วยความจำ เพราะ serverless มีหลาย
-- instance และแต่ละตัวจำคนละเรื่อง — limiter ที่นับในหน่วยความจำจึงกันอะไร
-- ไม่ได้เลยบน Vercel
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.login_attempts (
  id          bigserial primary key,
  -- ip อาจเป็น null ได้ถ้าอ่าน header ไม่ได้ — ยังนับต่อ identifier ได้อยู่
  ip          text,
  -- 🔴 ห้ามเก็บ PIN หรือรหัสผ่านที่กรอกมาเด็ดขาด
  -- สำหรับ password เก็บอีเมล · สำหรับ pin เก็บ 'pin' เฉย ๆ เพราะยังไม่รู้ว่าใคร
  identifier  text,
  kind        text not null check (kind in ('password','pin')),
  ok          boolean not null,
  at          timestamptz not null default now()
);

-- ดัชนีสำหรับคำถามเดียวที่ limiter ถาม: "ช่วงหลังนี้พลาดไปกี่ครั้ง"
create index if not exists login_attempts_ip_at_idx
  on public.login_attempts(ip, at desc) where not ok;
create index if not exists login_attempts_ident_at_idx
  on public.login_attempts(identifier, at desc) where not ok;

alter table public.login_attempts enable row level security;

-- เจ้าของดูได้เพื่อให้การโจมตี "มองเห็น" ไม่ใช่เกิดขึ้นเงียบ ๆ
-- ไม่มี policy insert/update/delete — เขียนได้ทางเดียวคือ secret key ใน route
drop policy if exists login_attempts_select_owner on public.login_attempts;
create policy login_attempts_select_owner on public.login_attempts
  for select to authenticated
  using ((select public.is_owner()));

-- ไม่ผูก audit trigger กับตารางนี้ — มันโตเร็วและทุกแถวคือ log อยู่แล้ว
-- การ audit log ของ log คือการเพิ่มข้อมูลเป็นสองเท่าโดยไม่ได้อะไรกลับมา

-- TODO(P7): ตั้ง pg_cron ลบแถวที่เก่ากว่า 1 วัน พร้อมกับ cron job ตัวอื่น
-- ตอนนี้ตารางยังเล็กมาก ยังไม่คุ้มที่จะเปิด extension เพิ่มในเฟสนี้
