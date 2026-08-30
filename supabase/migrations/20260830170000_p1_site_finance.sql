-- ════════════════════════════════════════════════════════════════════════
-- ค่างานตามสัญญาเป็นความลับจากหัวหน้าไซต์ (เจ้าของตัดสิน 30 ส.ค. 2569)
-- ปิดแถว P1-DB-14 · ครอบแถวใหม่ P1-DB-15 ถึง P1-DB-17
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 ทำไมต้อง **แยกตาราง** ไม่ใช่ revoke สิทธิ์ระดับคอลัมน์
--
-- สิทธิ์ระดับคอลัมน์ของ Postgres ให้กับ **role ของฐานข้อมูล** แต่ทั้งเจ้าของและ
-- หัวหน้าไซต์เข้ามาเป็น role เดียวกันคือ `authenticated` — ตัวตนที่ต่างกันอยู่ใน
-- JWT ไม่ได้อยู่ใน role · `revoke select (contract_amount) from authenticated`
-- จึงปิดเจ้าของไปด้วย และไม่มีทางเขียนให้แยกกันได้เลย
--
-- RLS คุมได้ระดับ**แถว** เท่านั้น · ค่าที่คนละบทบาทต้องเห็นไม่เท่ากันจึงต้อง
-- ไปอยู่คนละ**แถว** ซึ่งแปลว่าคนละ**ตาราง** — กฎเดียวกับที่แยก `branding`
-- (สาธารณะ) ออกจาก `app_settings` (ลับ) ใน P0.5

create table if not exists public.site_finance (
  site_id         uuid primary key references public.sites(id) on delete cascade,
  contract_amount numeric(14,2) not null default 0 check (contract_amount >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── ย้ายข้อมูลเดิมก่อน แล้วค่อยทิ้งคอลัมน์ ─────────────────────────────
do $$
declare
  n_sites int;
  n_fin   int;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sites' and column_name = 'contract_amount'
  ) then
    insert into public.site_finance (site_id, contract_amount)
    select id, contract_amount from public.sites
    on conflict (site_id) do nothing;

    select count(*) into n_sites from public.sites;
    select count(*) into n_fin   from public.site_finance;

    -- 🔴 ห้ามทิ้งคอลัมน์ก่อนพิสูจน์ว่าคัดลอกครบ · migration ที่ทำข้อมูลหาย
    -- จะรู้ตัวตอนที่ไม่มีอะไรให้กู้แล้ว
    if n_fin < n_sites then
      raise exception 'ย้ายค่างานไม่ครบ: sites=% site_finance=% — ยกเลิกการทิ้งคอลัมน์', n_sites, n_fin;
    end if;

    alter table public.sites drop column contract_amount;
  end if;
end $$;

-- ── ทุกไซต์ต้องมีแถวการเงินเสมอ ───────────────────────────────────────
-- 🔴 สร้างด้วย trigger ไม่ใช่ให้ API เขียนสองครั้ง · สองคำขอที่แยกกันมีจังหวะ
-- ที่คำขอแรกสำเร็จแล้วคำขอที่สองพัง → ไซต์ที่ไม่มีแถวการเงิน ซึ่งจะอ่านเป็น
-- "ยังไม่ได้ตั้งค่างาน" ตลอดไปโดยไม่มีใครรู้ว่ามันเป็นบั๊ก ไม่ใช่ความตั้งใจ
create or replace function public.ensure_site_finance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.site_finance (site_id) values (new.id)
  on conflict (site_id) do nothing;
  return new;
end $$;
revoke execute on function public.ensure_site_finance() from public, anon, authenticated;

drop trigger if exists sites_ensure_finance on public.sites;
create trigger sites_ensure_finance after insert on public.sites
  for each row execute function public.ensure_site_finance();

insert into public.site_finance (site_id)
select id from public.sites
on conflict (site_id) do nothing;

-- ── updated_at + audit ────────────────────────────────────────────────
drop trigger if exists site_finance_set_updated_at on public.site_finance;
create trigger site_finance_set_updated_at before update on public.site_finance
  for each row execute function public.set_updated_at();

drop trigger if exists site_finance_audit on public.site_finance;
create trigger site_finance_audit after insert or update or delete on public.site_finance
  for each row execute function public.audit_row();

-- ── RLS: เจ้าของเท่านั้น ทั้งอ่านและเขียน ──────────────────────────────
alter table public.site_finance enable row level security;

drop policy if exists site_finance_select on public.site_finance;
drop policy if exists site_finance_insert on public.site_finance;
drop policy if exists site_finance_update on public.site_finance;
drop policy if exists site_finance_delete on public.site_finance;

create policy site_finance_select on public.site_finance
  for select to authenticated using ((select public.is_owner()));
create policy site_finance_insert on public.site_finance
  for insert to authenticated with check ((select public.is_owner()));
create policy site_finance_update on public.site_finance
  for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy site_finance_delete on public.site_finance
  for delete to authenticated using ((select public.is_owner()));

-- ── ตัวเลขสรุปของหน้าภาพรวม ───────────────────────────────────────────
-- 🔴 คืน **null** ไม่ใช่ 0 เมื่อคนเรียกไม่มีสิทธิ์เห็นตัวเลข
-- หน้าจอซ่อนการ์ดที่ได้ null ได้ แต่มันจะวาด ฿0 อย่างมั่นใจ แล้วคนอ่านจะเชื่อว่า
-- นั่นคือคำตอบ — "ศูนย์" กับ "คุณไม่มีสิทธิ์เห็น" เป็นคนละเรื่องกันโดยสิ้นเชิง
create or replace function public.site_overview(p_on date)
returns table (
  total_count      int,
  active_count     int,
  active_contract  numeric,
  due_soon_count   int,
  overdue_count    int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*)::int,
    count(*) filter (where s.status = 'active')::int,
    case
      when (select public.is_owner())
        then coalesce(sum(f.contract_amount) filter (where s.status = 'active'), 0)
      else null
    end,
    count(*) filter (
      where s.status = 'active' and s.end_date is not null
        and s.end_date >= p_on and s.end_date < p_on + 30
    )::int,
    count(*) filter (
      where s.status = 'active' and s.end_date is not null and s.end_date < p_on
    )::int
  from public.sites s
  left join public.site_finance f on f.site_id = s.id;
$$;

revoke execute on function public.site_overview(date) from public, anon;
grant execute on function public.site_overview(date) to authenticated;
