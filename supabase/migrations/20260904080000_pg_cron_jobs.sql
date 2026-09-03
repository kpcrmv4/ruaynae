-- ════════════════════════════════════════════════════════════════════════
-- งานตามเวลาด้วย pg_cron + pg_net (CLAUDE.md §8)
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 **pg_cron ทำงานเป็น UTC** — งานที่ต้องยิงตอน 8 โมงเช้าไทยคือ `0 1 * * *`
-- เขียน `0 8 * * *` เมื่อไหร่ มันจะไปยิงตอนบ่ายสามของไทยโดยไม่มีอะไรฟ้อง
--
-- 🔴 **ความลับไม่ได้อยู่ในไฟล์นี้** — URL กับ `CRON_SECRET` อ่านจาก Vault
-- ตอนงานทำงานจริง · ใส่ลงในไฟล์ migration เมื่อไหร่ = ความลับติดอยู่ใน
-- ประวัติ git ตลอดไป ลบไฟล์ทีหลังก็ยังอยู่ (§13 ข้อ 4)
-- · ตัวเติม Vault คือ `node scripts/setup-cron.mjs` ซึ่งอ่านจาก .env.local
--
-- ⚠️ ต้องรัน `setup-cron.mjs` **ก่อน** ไฟล์นี้ ไม่งั้นงานจะทำงานแล้วข้ามไป
-- เงียบ ๆ ทุกครั้ง (`cron_call` ออกโดยไม่ยิงเมื่อยังไม่มีค่าใน Vault)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── ตัวยิง HTTP ที่อ่านความลับจาก Vault ────────────────────────────
-- คืน `request_id` ของ pg_net หรือ `null` เมื่อยังตั้งค่าไม่ครบ
create or replace function public.cron_call(p_path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base   text;
  v_secret text;
begin
  select decrypted_secret into v_base
  from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'cron_secret';

  if v_base is null or v_secret is null then
    -- 🔴 ดังพอให้เห็นใน log ของฐานข้อมูล — งานตามเวลาที่เงียบหายคืองาน
    -- ที่ไม่มีใครรู้ว่าไม่ทำงานจนกว่าจะมีคนสังเกตว่าข้อมูลขาด
    raise warning 'cron_call: ยังไม่ได้ตั้ง app_base_url/cron_secret ใน Vault — ข้าม %', p_path;
    return null;
  end if;

  return net.http_get(
    url     := v_base || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 20000
  );
end $$;

revoke execute on function public.cron_call(text) from public, anon, authenticated;

-- ── ตารางงาน ───────────────────────────────────────────────────────
-- `cron.schedule` ใช้ชื่อเป็นคีย์ — เรียกซ้ำด้วยชื่อเดิมคือการแก้ ไม่ใช่เพิ่มซ้ำ
select cron.schedule(
  'sweep-orphans',
  '7 * * * *',                       -- ทุกชั่วโมง นาทีที่ 7 (เลี่ยงนาทีที่ 0 ที่ทุกอย่างแย่งกันทำงาน)
  $$select public.cron_call('/api/cron/sweep-orphans')$$
);

select cron.schedule(
  'recurring-expenses',
  '0 1 * * *',                       -- 08:00 เวลาไทย
  $$select public.cron_call('/api/cron/recurring')$$
);

select cron.schedule(
  'push-dispatch',
  '*/5 * * * *',                     -- ส่ง push ที่ค้างคิวทุก 5 นาที
  $$select public.cron_call('/api/cron/push-dispatch')$$
);
