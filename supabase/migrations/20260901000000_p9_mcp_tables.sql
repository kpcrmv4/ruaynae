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
