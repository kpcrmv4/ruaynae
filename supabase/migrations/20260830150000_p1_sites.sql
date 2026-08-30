-- ════════════════════════════════════════════════════════════════════════
-- P1 · ไซต์งาน · ผู้ดูแลไซต์ (มีช่วงเวลา) · แผนงวดเงิน
-- ครอบแถว P1-DB-01 ถึง P1-DB-12 ใน docs/test-plan/P1.md
-- ════════════════════════════════════════════════════════════════════════

-- ติดตั้งใน schema แยก ไม่ใช่ public — advisor แจ้ง extension_in_public
-- ถ้าอยู่ใน public จะเสี่ยงต่อการถูกแย่งชื่อผ่าน search_path
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'extensions') then
    create extension if not exists btree_gist with schema extensions;
  else
    create extension if not exists btree_gist;
  end if;
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.site_status as enum ('planning','active','paused','done','cancelled');
exception when duplicate_object then null;
end $$;

-- ── ไซต์งาน ─────────────────────────────────────────────────────────────
create table if not exists public.sites (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(btrim(name)) > 0),
  client_name     text,
  client_phone    text,
  address         text,
  -- ค่างานตามสัญญา — ตัวหารของแถบ "เก็บเงินแล้ว" และ "ต้นทุน"
  -- 0 ได้ (ยังไม่ได้ตั้ง) แต่ติดลบไม่ได้ · ฝั่งแอปต้องกันหารด้วยศูนย์เอง
  contract_amount numeric(14,2) not null default 0 check (contract_amount >= 0),
  start_date      date,
  end_date        date,
  status          public.site_status not null default 'active',
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- ปล่อยว่างได้ทั้งคู่ แต่ถ้าใส่ทั้งคู่ต้องเรียงถูก
  constraint sites_date_range check (start_date is null or end_date is null or end_date >= start_date)
);

create index if not exists sites_status_idx on public.sites(status);
create index if not exists sites_created_at_idx on public.sites(created_at desc);

-- ── ผู้ดูแลไซต์ — ต้องมีช่วงเวลา ────────────────────────────────────────
-- 🔴 ถ้าเก็บแค่ "ใครดูแลไซต์ไหน" แบบไม่มีวันที่ พอย้ายหัวหน้าไซต์
-- รายงานย้อนหลังจะเปลี่ยนเจ้าของตามไปด้วยเงียบ ๆ และคนที่ย้ายออก
-- จะเห็นข้อมูลใหม่ที่ไม่ควรเห็น
create table if not exists public.site_supervisors (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references public.sites(id) on delete cascade,
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  effective_from date not null default current_date,
  -- null = ยังไม่กำหนดวันสิ้นสุด · ปลายทางแบบ **รวมวันนั้น**
  effective_to   date,
  created_at     timestamptz not null default now(),
  constraint site_supervisors_range check (effective_to is null or effective_to >= effective_from)
);

-- คนเดียวอยู่สองไซต์ในวันเดียวกันไม่ได้
-- 🔴 `effective_to + 1` เพราะคอลัมน์เป็นปลายทางแบบ**รวม** แต่ daterange
-- เป็นแบบ**ไม่รวม** · ลืม +1 แล้วสองช่วงที่ต่อกันพอดี (จบ 31 ม.ค. เริ่ม 1 ก.พ.)
-- จะถูกปฏิเสธว่าทับกัน ทั้งที่ไม่ทับ
alter table public.site_supervisors drop constraint if exists site_supervisors_no_overlap;
alter table public.site_supervisors add constraint site_supervisors_no_overlap
  exclude using gist (
    profile_id with =,
    daterange(effective_from, effective_to + 1, '[)') with &&
  );

create index if not exists site_supervisors_site_idx on public.site_supervisors(site_id);
create index if not exists site_supervisors_profile_idx on public.site_supervisors(profile_id);

-- ── แผนงวดเงิน (ไม่บังคับ) ──────────────────────────────────────────────
-- เจ้าของจะตั้งแผนงวดล่วงหน้าหรือไม่ก็ได้ · ถ้าไม่ตั้ง ระบบนับงวดให้เอง
-- ตอนบันทึกรายรับ (P2)
create table if not exists public.site_milestones (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references public.sites(id) on delete cascade,
  seq            int not null check (seq > 0),
  name           text not null,
  planned_amount numeric(14,2) not null default 0 check (planned_amount >= 0),
  planned_date   date,
  created_at     timestamptz not null default now(),
  unique (site_id, seq)
);
create index if not exists site_milestones_site_idx on public.site_milestones(site_id);

-- ── updated_at + audit ──────────────────────────────────────────────────
drop trigger if exists sites_set_updated_at on public.sites;
create trigger sites_set_updated_at before update on public.sites
  for each row execute function public.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['sites','site_supervisors','site_milestones'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I
         for each row execute function public.audit_row()', t, t);
  end loop;
end $$;

-- ── helper: ดูแลไซต์นี้อยู่ ณ วันที่กำหนดไหม ────────────────────────────
-- 🔴 "ปัจจุบัน" **ไม่ใช่** `effective_to is null`
-- การย้ายล่วงหน้าจะปิดช่วงปัจจุบันไว้ ถ้าใช้เงื่อนไขนั้นคนจะหายจากไซต์เดิม
-- ทันทีที่บันทึกการย้าย ทั้งที่ยังไม่ถึงวัน
--
-- 🔴 ห้ามใส่ทางลัด `auth.uid() is null` — ฟังก์ชันนี้ถูกใช้ใน policy
create or replace function public.supervises_site(p_site uuid, p_on date default current_date)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.site_supervisors m
    where m.site_id = p_site
      and m.profile_id = auth.uid()
      and m.effective_from <= p_on
      and coalesce(m.effective_to, 'infinity'::date) >= p_on
  );
$$;
revoke execute on function public.supervises_site(uuid, date) from public, anon;
grant execute on function public.supervises_site(uuid, date) to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.sites            enable row level security;
alter table public.site_supervisors enable row level security;
alter table public.site_milestones  enable row level security;

drop policy if exists sites_select        on public.sites;
drop policy if exists sites_insert_owner  on public.sites;
drop policy if exists sites_update_owner  on public.sites;
drop policy if exists sites_delete_owner  on public.sites;

-- หัวหน้าไซต์เห็นเฉพาะไซต์ที่ดูแล ณ วันนี้
create policy sites_select on public.sites
  for select to authenticated
  using ((select public.is_owner()) or public.supervises_site(id));

-- แก้ค่างาน/วันที่/สถานะ ได้เฉพาะเจ้าของ — หัวหน้าไซต์แก้ไม่ได้เลย
create policy sites_insert_owner on public.sites
  for insert to authenticated with check ((select public.is_owner()));
create policy sites_update_owner on public.sites
  for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy sites_delete_owner on public.sites
  for delete to authenticated using ((select public.is_owner()));

drop policy if exists site_supervisors_select       on public.site_supervisors;
drop policy if exists site_supervisors_insert_owner on public.site_supervisors;
drop policy if exists site_supervisors_update_owner on public.site_supervisors;
drop policy if exists site_supervisors_delete_owner on public.site_supervisors;

create policy site_supervisors_select on public.site_supervisors
  for select to authenticated
  using ((select public.is_owner()) or profile_id = (select auth.uid()));
create policy site_supervisors_insert_owner on public.site_supervisors
  for insert to authenticated with check ((select public.is_owner()));
create policy site_supervisors_update_owner on public.site_supervisors
  for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy site_supervisors_delete_owner on public.site_supervisors
  for delete to authenticated using ((select public.is_owner()));

drop policy if exists site_milestones_select       on public.site_milestones;
drop policy if exists site_milestones_insert_owner on public.site_milestones;
drop policy if exists site_milestones_update_owner on public.site_milestones;
drop policy if exists site_milestones_delete_owner on public.site_milestones;

create policy site_milestones_select on public.site_milestones
  for select to authenticated
  using ((select public.is_owner()) or public.supervises_site(site_id));
create policy site_milestones_insert_owner on public.site_milestones
  for insert to authenticated with check ((select public.is_owner()));
create policy site_milestones_update_owner on public.site_milestones
  for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy site_milestones_delete_owner on public.site_milestones
  for delete to authenticated using ((select public.is_owner()));
