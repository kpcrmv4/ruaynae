-- ════════════════════════════════════════════════════════════════════════
-- P5-a · เบิกล่วงหน้า และรอบจ่ายค่าแรง
-- ครอบแถว P5-DB-01..21 ใน docs/test-plan/P5.md
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 กฎที่ทั้งเฟสนี้มีอยู่เพื่อรักษา (DESIGN.md §5.4)
-- ติ๊กคนเข้าไซต์ = ต้นทุนเกิด (accrual) · เบิกและปิดรอบจ่าย = **เงินสดออก**
-- ทั้งสองอย่างห้ามบวกกันเป็นต้นทุน ไม่งั้นต้นทุนเป็นสองเท่า
-- → ไฟล์นี้จึง **ไม่แตะ** `site_money` / `site_overview` เลยแม้แต่บรรทัดเดียว
--
-- 🔴 เจ้าของเท่านั้นทั้งเฟส — คำสั่งเจ้าของ 31 ส.ค. 2569

do $$ begin
  create type public.payroll_status as enum ('open', 'closed');
  exception when duplicate_object then null;
end $$;

-- ── รอบจ่ายค่าแรง ────────────────────────────────────────────────────
create table if not exists public.payroll_runs (
  id                      uuid primary key default gen_random_uuid(),
  period_start            date not null,
  period_end              date not null,
  -- `null` = รอบรวมทุกไซต์ · ระบุไซต์ = จ่ายเฉพาะคนที่ทำงานไซต์นั้น
  site_id                 uuid references public.sites(id) on delete restrict,
  status                  public.payroll_status not null default 'open',
  total_accrued           numeric(14,2) not null default 0,
  total_advance_deducted  numeric(14,2) not null default 0,
  total_paid              numeric(14,2) not null default 0,
  closed_at               timestamptz,
  closed_by               uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint payroll_period_order check (period_end >= period_start)
);

create index if not exists payroll_runs_period_idx on public.payroll_runs(period_start, period_end);
create index if not exists payroll_runs_site_idx on public.payroll_runs(site_id);
create index if not exists payroll_runs_open_idx on public.payroll_runs(status) where status = 'open';

-- 🔴 รอบที่ช่วงเวลาซ้อนกันของไซต์เดียวกัน = ค่าแรงวันเดียวถูกจ่ายสองรอบ
-- ต้องกันที่ฐานข้อมูล ไม่ใช่หวังว่าคนกดจะจำได้ว่าเปิดรอบไหนไปแล้ว
create extension if not exists btree_gist;
alter table public.payroll_runs drop constraint if exists payroll_runs_no_overlap;
alter table public.payroll_runs add constraint payroll_runs_no_overlap
  exclude using gist (
    coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    daterange(period_start, period_end + 1, '[)') with &&
  );

-- ── บรรทัดจ่ายรายคน ──────────────────────────────────────────────────
create table if not exists public.payroll_lines (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id       uuid not null references public.employees(id) on delete restrict,
  days              numeric(6,2) not null default 0,
  accrued           numeric(14,2) not null default 0,
  advance_deducted  numeric(14,2) not null default 0,
  net_paid          numeric(14,2) not null default 0,
  created_at        timestamptz not null default now(),

  constraint payroll_lines_once unique (run_id, employee_id)
);

create index if not exists payroll_lines_run_idx on public.payroll_lines(run_id);
create index if not exists payroll_lines_employee_idx on public.payroll_lines(employee_id);

-- ── เบิกล่วงหน้า ─────────────────────────────────────────────────────
create table if not exists public.advances (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.employees(id) on delete restrict,
  amount          numeric(12,2) not null check (amount > 0),
  advance_date    date not null,
  pay_method      public.pay_method not null default 'cash',
  site_id         uuid references public.sites(id) on delete set null,
  -- `null` = ยังไม่ถูกหักในรอบไหน · มีค่า = ถูกหักไปแล้วในรอบนั้น
  payroll_run_id  uuid references public.payroll_runs(id) on delete set null,
  note            text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists advances_employee_date_idx on public.advances(employee_id, advance_date);
create index if not exists advances_open_idx on public.advances(employee_id) where payroll_run_id is null;
create index if not exists advances_run_idx on public.advances(payroll_run_id);
create index if not exists advances_site_idx on public.advances(site_id);

alter table public.payroll_runs enable row level security;
alter table public.payroll_lines enable row level security;
alter table public.advances enable row level security;

-- ── RLS: เจ้าของเท่านั้น ทั้งสามตาราง ────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['payroll_runs', 'payroll_lines', 'advances'] loop
    execute format('drop policy if exists %I_owner_select on public.%I', t, t);
    execute format(
      'create policy %I_owner_select on public.%I for select to authenticated
         using ((select public.is_owner()))', t, t);
    execute format('drop policy if exists %I_owner_insert on public.%I', t, t);
    execute format(
      'create policy %I_owner_insert on public.%I for insert to authenticated
         with check ((select public.is_owner()))', t, t);
    execute format('drop policy if exists %I_owner_update on public.%I', t, t);
    execute format(
      'create policy %I_owner_update on public.%I for update to authenticated
         using ((select public.is_owner())) with check ((select public.is_owner()))', t, t);
    execute format('drop policy if exists %I_owner_delete on public.%I', t, t);
    execute format(
      'create policy %I_owner_delete on public.%I for delete to authenticated
         using ((select public.is_owner()))', t, t);

    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I
         for each row execute function public.audit_row()', t, t);
  end loop;
end $$;

drop trigger if exists payroll_runs_set_updated_at on public.payroll_runs;
create trigger payroll_runs_set_updated_at before update on public.payroll_runs
  for each row execute function public.set_updated_at();
drop trigger if exists advances_set_updated_at on public.advances;
create trigger advances_set_updated_at before update on public.advances
  for each row execute function public.set_updated_at();

-- ── ยอดค้างจ่ายของคนหนึ่งคน ──────────────────────────────────────────
-- เพดานที่เบิกได้ = Σ ค่าแรงที่ยังไม่ถูกปิดรอบ − Σ เบิกที่ยังไม่ถูกหัก
--
-- 🔴 "ยังไม่ถูกปิดรอบ" ตัดสินจาก `attendance` ที่ยังไม่มี `payroll_lines`
-- ครอบวันนั้น · ไม่ใช่ "ทุกแถวที่มี" ซึ่งจะทำให้เบิกได้ซ้ำจากค่าแรงที่จ่ายไปแล้ว
create or replace function public.employee_balance(p_employee uuid)
returns table (accrued numeric, advanced numeric, balance numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(acc.total, 0),
    coalesce(adv.total, 0),
    coalesce(acc.total, 0) - coalesce(adv.total, 0)
  from (
    select sum(aw.amount) as total
    from public.attendance a
    join public.attendance_wages aw on aw.attendance_id = a.id
    where a.employee_id = p_employee
      -- ยังไม่ถูกปิดรอบ = ไม่มีรอบที่ปิดแล้วครอบวันนั้นและครอบคนนั้น
      and not exists (
        select 1
        from public.payroll_lines pl
        join public.payroll_runs pr on pr.id = pl.run_id
        where pl.employee_id = a.employee_id
          and pr.status = 'closed'
          and a.work_date between pr.period_start and pr.period_end
          and (pr.site_id is null or pr.site_id = a.site_id)
      )
  ) acc
  cross join (
    select sum(ad.amount) as total
    from public.advances ad
    where ad.employee_id = p_employee and ad.payroll_run_id is null
  ) adv;
$$;

revoke execute on function public.employee_balance(uuid) from public, anon;
grant execute on function public.employee_balance(uuid) to authenticated;

-- ── guard: เพดานเบิก ─────────────────────────────────────────────────
create or replace function public.guard_advance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_accrued  numeric;
  v_advanced numeric;
  v_ceiling  numeric;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    new.created_by := old.created_by;
    -- แถวที่ถูกหักในรอบที่ปิดแล้ว แก้ยอดไม่ได้ — เงินจ่ายออกไปแล้ว
    if old.payroll_run_id is not null
       and new.amount is distinct from old.amount then
      raise exception 'PAYROLL_CLOSED: เบิกใบนี้ถูกหักในรอบที่ปิดแล้ว แก้ยอดไม่ได้';
    end if;
  end if;

  -- 🔴 เพดานคิดจาก **ยอดที่เบิกไปแล้วทั้งหมด** ไม่ใช่เทียบใบนี้ใบเดียว
  -- เทียบทีละใบเมื่อไหร่ เบิก ฿2,000 สองครั้งบนค้างจ่าย ฿3,300 จะผ่านทั้งคู่
  select b.accrued, b.advanced into v_accrued, v_advanced
  from public.employee_balance(new.employee_id) b;

  -- ยอดของแถวเดิม (ตอน UPDATE) ไม่ต้องนับซ้ำ
  if tg_op = 'UPDATE' and old.payroll_run_id is null then
    v_advanced := v_advanced - old.amount;
  end if;

  v_ceiling := v_accrued - v_advanced;

  if new.payroll_run_id is null and new.amount > v_ceiling then
    raise exception
      'ADVANCE_OVER_CEILING: เบิกได้ไม่เกิน % บาท (ค่าแรงค้างจ่าย % − เบิกไปแล้ว %)',
      to_char(v_ceiling, 'FM999999999.00'),
      to_char(v_accrued, 'FM999999999.00'),
      to_char(v_advanced, 'FM999999999.00');
  end if;

  return new;
end $$;

drop trigger if exists advances_guard on public.advances;
create trigger advances_guard before insert or update on public.advances
  for each row execute function public.guard_advance();

revoke execute on function public.guard_advance() from public, anon, authenticated;

-- ── guard: แตะข้อมูลของรอบที่ปิดแล้วไม่ได้ ───────────────────────────
-- 🔴 ตัวเลขที่จ่ายเงินไปแล้วเปลี่ยนย้อนหลังไม่ได้ · ไม่งั้นยอดที่จ่ายจริง
-- กับยอดที่ระบบคำนวณจะไม่ตรงกันตลอดไป โดยไม่มี error ที่ไหนเลย
create or replace function public.guard_attendance_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attendance%rowtype := case when tg_op = 'DELETE' then old else new end;
begin
  if exists (
    select 1
    from public.payroll_lines pl
    join public.payroll_runs pr on pr.id = pl.run_id
    where pl.employee_id = v_row.employee_id
      and pr.status = 'closed'
      and v_row.work_date between pr.period_start and pr.period_end
      and (pr.site_id is null or pr.site_id = v_row.site_id)
  ) then
    raise exception 'PAYROLL_CLOSED: วันนี้อยู่ในรอบจ่ายที่ปิดแล้ว แก้หรือลบไม่ได้';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists attendance_guard_closed on public.attendance;
create trigger attendance_guard_closed before update or delete on public.attendance
  for each row execute function public.guard_attendance_closed();

revoke execute on function public.guard_attendance_closed() from public, anon, authenticated;

-- เรตของวันที่อยู่ในรอบที่ปิดแล้ว ก็แก้ไม่ได้เช่นกัน
create or replace function public.guard_attendance_wage_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_att public.attendance%rowtype;
begin
  select * into v_att from public.attendance a where a.id = new.attendance_id;
  if found and exists (
    select 1
    from public.payroll_lines pl
    join public.payroll_runs pr on pr.id = pl.run_id
    where pl.employee_id = v_att.employee_id
      and pr.status = 'closed'
      and v_att.work_date between pr.period_start and pr.period_end
      and (pr.site_id is null or pr.site_id = v_att.site_id)
  ) then
    raise exception 'PAYROLL_CLOSED: ค่าแรงของวันนี้ถูกจ่ายไปแล้ว แก้ไม่ได้';
  end if;
  return new;
end $$;

drop trigger if exists attendance_wages_guard_closed on public.attendance_wages;
create trigger attendance_wages_guard_closed before update on public.attendance_wages
  for each row execute function public.guard_attendance_wage_closed();

revoke execute on function public.guard_attendance_wage_closed() from public, anon, authenticated;

-- ── ปิดรอบจ่าย ───────────────────────────────────────────────────────
-- 🔴 ทุกอย่างอยู่ใน RPC เดียว = ทรานแซกชันเดียว
-- แยกเป็นหลาย request แล้ววันหนึ่งจะปิดรอบสำเร็จแต่หักเบิกไม่สำเร็จ
-- เหลือเบิกที่ยังไม่ถูกหักซึ่งจะถูกหักซ้ำในรอบถัดไป
create or replace function public.close_payroll_run(p_run uuid)
returns table (lines int, accrued numeric, deducted numeric, paid numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.payroll_runs%rowtype;
  v_n   int;
begin
  if not (select public.is_owner()) then
    raise exception 'FORBIDDEN: เฉพาะเจ้าของเท่านั้นที่ปิดรอบจ่ายได้';
  end if;

  select * into v_run from public.payroll_runs r where r.id = p_run for update;
  if not found then
    raise exception 'NOT_FOUND: ไม่พบรอบจ่ายนี้';
  end if;
  if v_run.status = 'closed' then
    raise exception 'ALREADY_CLOSED: รอบนี้ปิดไปแล้ว';
  end if;

  -- ค่าแรงในช่วง แยกรายคน — เฉพาะวันที่ยังไม่ถูกปิดรอบไหน
  create temporary table _acc on commit drop as
  select
    a.employee_id,
    sum(a.work_units)  as days,
    sum(aw.amount)     as accrued
  from public.attendance a
  join public.attendance_wages aw on aw.attendance_id = a.id
  where a.work_date between v_run.period_start and v_run.period_end
    and (v_run.site_id is null or a.site_id = v_run.site_id)
    and not exists (
      select 1
      from public.payroll_lines pl
      join public.payroll_runs pr on pr.id = pl.run_id
      where pl.employee_id = a.employee_id
        and pr.status = 'closed'
        and a.work_date between pr.period_start and pr.period_end
        and (pr.site_id is null or pr.site_id = a.site_id)
    )
  group by a.employee_id
  having sum(aw.amount) > 0;

  select count(*) into v_n from _acc;
  if v_n = 0 then
    raise exception 'NOTHING_TO_PAY: ไม่มีค่าแรงค้างจ่ายในช่วงนี้';
  end if;

  insert into public.payroll_lines (run_id, employee_id, days, accrued, advance_deducted, net_paid)
  select
    p_run,
    c.employee_id,
    c.days,
    c.accrued,
    least(c.accrued, coalesce(d.total, 0)),
    c.accrued - least(c.accrued, coalesce(d.total, 0))
  from _acc c
  left join lateral (
    select sum(ad.amount) as total
    from public.advances ad
    where ad.employee_id = c.employee_id and ad.payroll_run_id is null
  ) d on true;

  -- เบิกที่ถูกหักแล้วผูกกับรอบนี้ — รอบถัดไปจะไม่หักซ้ำ
  update public.advances ad
    set payroll_run_id = p_run
    where ad.payroll_run_id is null
      and ad.employee_id in (select employee_id from _acc);

  update public.payroll_runs r
    set status = 'closed',
        closed_at = now(),
        closed_by = auth.uid(),
        total_accrued = (select coalesce(sum(l.accrued), 0) from public.payroll_lines l where l.run_id = p_run),
        total_advance_deducted = (select coalesce(sum(l.advance_deducted), 0) from public.payroll_lines l where l.run_id = p_run),
        total_paid = (select coalesce(sum(l.net_paid), 0) from public.payroll_lines l where l.run_id = p_run)
    where r.id = p_run;

  return query
    select v_n,
           r.total_accrued, r.total_advance_deducted, r.total_paid
    from public.payroll_runs r where r.id = p_run;
end $$;

revoke execute on function public.close_payroll_run(uuid) from public, anon;
grant execute on function public.close_payroll_run(uuid) to authenticated;
