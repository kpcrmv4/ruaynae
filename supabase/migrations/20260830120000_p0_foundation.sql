-- ════════════════════════════════════════════════════════════════════════
-- P0 · ฐานระบบ — profiles, audit_log, RLS, guard trigger
--
-- ครอบแถว P0-DB-01 ถึง P0-DB-15 ใน docs/test-plan/P0.md
-- idempotent: รันซ้ำได้ไม่พัง
-- ════════════════════════════════════════════════════════════════════════

-- ── enum ────────────────────────────────────────────────────────────────
-- สร้างเฉพาะตัวที่ P0 ใช้จริง · enum ที่ไม่มีตารางใช้คือพื้นผิวที่ไม่มีใครเขียน
do $$ begin
  create type public.user_role as enum ('owner','site_supervisor');
exception when duplicate_object then null;
end $$;

-- ── helper: updated_at ──────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ── ตาราง profiles ──────────────────────────────────────────────────────
-- ผู้ใช้ที่ "ล็อกอินได้" เท่านั้น · คนงานอยู่ในตาราง employees ซึ่งไม่มี auth.users
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  role        public.user_role not null default 'site_supervisor',
  -- HMAC-SHA256(PIN_PEPPER, 'pin-lookup:' || pin) จาก src/lib/pin.ts
  -- deterministic เพราะหน้าล็อกอินมีแต่แป้นตัวเลข ต้องหาเจ้าของ PIN จากค่าที่กด
  pin_hash    text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- PIN ซ้ำ = กดแล้วเข้าเป็นบัญชีคนอื่น · บังคับที่ฐานข้อมูล ไม่ใช่แค่หน้าจอ
create unique index if not exists profiles_pin_hash_key
  on public.profiles(pin_hash) where pin_hash is not null;
create index if not exists profiles_role_idx on public.profiles(role);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ── ตาราง audit_log ─────────────────────────────────────────────────────
-- ไม่มี policy ให้ UPDATE/DELETE กับใครทั้งนั้น — เขียนได้ทางเดียวคือผ่าน trigger
create table if not exists public.audit_log (
  id          bigserial primary key,
  table_name  text not null,
  row_id      text,
  action      text not null check (action in ('INSERT','UPDATE','DELETE')),
  actor       uuid,
  before      jsonb,
  after       jsonb,
  at          timestamptz not null default now()
);
create index if not exists audit_log_at_idx on public.audit_log(at desc);
create index if not exists audit_log_table_row_idx on public.audit_log(table_name, row_id);

-- ── is_owner() ──────────────────────────────────────────────────────────
-- SECURITY DEFINER เพื่อตัดวงจร: policy บน profiles ที่อ่าน profiles จะ recurse
-- 🔴 ห้ามใส่ทางลัด `auth.uid() is null` ในฟังก์ชันนี้ — มันคือช่องที่เปิดข้อมูล
--    ทั้งระบบให้คนที่ยังไม่ล็อกอิน (แถว P0-DB-11)
create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner' and is_active
  );
$$;
revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- ── audit trigger ───────────────────────────────────────────────────────
-- ทำที่ระดับฐานข้อมูล ไม่ใช่ในโค้ดแอป เพราะเส้นทางไหนที่ลืมใส่จะหายไปเงียบ ๆ
-- และไม่มีใครรู้ว่าหาย
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_row_id text;
begin
  -- อ้าง NEW ใน DELETE trigger ไม่ได้ ต้องแยกกิ่งให้ชัด
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

  -- 🔴 อย่าเก็บ pin_hash ลง audit_log
  -- ไม่งั้นเจ้าของที่เปิดหน้าประวัติจะเห็น hash ของ PIN ทุกคน และค่านั้นจะถูก
  -- คัดลอกไปอยู่ในตารางที่ลบไม่ได้ตลอดกาล
  v_before := v_before - 'pin_hash';
  v_after  := v_after  - 'pin_hash';

  insert into public.audit_log(table_name, row_id, action, actor, before, after)
  values (tg_table_name, v_row_id, tg_op, auth.uid(), v_before, v_after);

  return null;  -- AFTER trigger ไม่สนใจค่าที่คืน
end $$;

drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function public.audit_row();

-- ── guard trigger บน profiles ───────────────────────────────────────────
-- RLS บอกได้แค่ "แถวไหน" · จะบอก "คอลัมน์ไหน" ต้องใช้ trigger
-- และ trigger `raise exception` ให้ error จริง ต่างจาก policy ที่ปฏิเสธเงียบ ๆ
-- ด้วยการ match 0 แถว ซึ่ง PostgREST รายงานว่าสำเร็จ
create or replace function public.guard_profiles_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- service-role (auth.uid() เป็น null) และเจ้าของ ผ่านได้
  -- ทางลัดนี้ปลอดภัยตรงนี้เพราะเป็น trigger ไม่ได้ถูก grant ให้ anon เรียก
  if auth.uid() is null or public.is_owner() then
    return new;
  end if;

  if old.id is distinct from auth.uid() then
    raise exception 'PROFILE_UPDATE_FORBIDDEN';
  end if;
  if new.role is distinct from old.role then
    raise exception 'ROLE_CHANGE_FORBIDDEN';
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'ACTIVE_CHANGE_FORBIDDEN';
  end if;
  if new.pin_hash is distinct from old.pin_hash then
    raise exception 'PIN_CHANGE_FORBIDDEN';
  end if;

  return new;
end $$;

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update before update on public.profiles
  for each row execute function public.guard_profiles_update();

-- ── bootstrap ผู้ใช้ใหม่ ────────────────────────────────────────────────
-- 🔴 role ตั้งฝั่งเซิร์ฟเวอร์เสมอ ห้ามอ่านจาก raw_user_meta_data ที่ client ส่งมา
--    ทุกบัญชีใหม่เป็น site_supervisor · owner เลื่อนขั้นด้วย secret key เท่านั้น
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'site_supervisor'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.profiles  enable row level security;
alter table public.audit_log enable row level security;

-- หนึ่ง policy ต่อหนึ่ง action · `for all` จะทับกับ policy ของ select
-- แล้วถูกประเมินซ้ำสองรอบทุก query
drop policy if exists profiles_select        on public.profiles;
drop policy if exists profiles_update_self   on public.profiles;
drop policy if exists profiles_insert_owner  on public.profiles;
drop policy if exists profiles_delete_owner  on public.profiles;

-- ห่อ helper ด้วย (select ...) ให้ Postgres cache ผลครั้งเดียวต่อ statement
-- ไม่ใช่เรียกใหม่ทุกแถว
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_owner()));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select public.is_owner()))
  with check (id = (select auth.uid()) or (select public.is_owner()));

create policy profiles_insert_owner on public.profiles
  for insert to authenticated
  with check ((select public.is_owner()));

create policy profiles_delete_owner on public.profiles
  for delete to authenticated
  using ((select public.is_owner()));

-- audit_log: อ่านได้เฉพาะเจ้าของ · ไม่มี policy เขียนเลย
-- trigger เขียนได้เพราะเป็น SECURITY DEFINER ซึ่งข้าม RLS
drop policy if exists audit_log_select_owner on public.audit_log;
create policy audit_log_select_owner on public.audit_log
  for select to authenticated
  using ((select public.is_owner()));

-- ── สิทธิ์เรียกฟังก์ชัน ─────────────────────────────────────────────────
-- trigger function ไม่ต้องมีใครถือ EXECUTE เลย — Postgres รันให้เองในนามเจ้าของ
-- ปล่อยไว้ = ใครก็ยิงเรียกตรง ๆ ได้ ซึ่งสำหรับ SECURITY DEFINER คือการยกสิทธิ์
-- ให้ฟรี ๆ (advisor แจ้งเป็น anon_security_definer_function_executable)
revoke execute on function public.audit_row()             from public, anon, authenticated;
revoke execute on function public.guard_profiles_update()  from public, anon, authenticated;
revoke execute on function public.handle_new_user()        from public, anon, authenticated;
revoke execute on function public.set_updated_at()         from public, anon, authenticated;

-- is_owner() ต้องเหลือไว้ให้ authenticated เพราะ policy เรียกมันในนามผู้ใช้
-- (advisor จะยังเตือน 1 รายการ ซึ่งถูกต้องแล้ว ไม่ใช่ของที่ต้องแก้)
