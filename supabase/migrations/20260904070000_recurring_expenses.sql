-- ════════════════════════════════════════════════════════════════════════
-- ค่าใช้จ่ายรายเดือนที่ระบบลงให้เอง — เงินเดือน ค่าเช่า ค่าอินเทอร์เน็ต ฯลฯ
-- (คำสั่งเจ้าของ 4 ก.ย. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 **ห้ามนับซ้ำกับค่าแรง** — คนรายวันมีค่าแรงเกิดตอนติ๊กเข้าโครงการอยู่แล้ว
-- ถ้าตั้งกฎเงินเดือนให้คนรายวันด้วย ต้นทุนจะเป็นสองเท่า · คนรายเดือนมี
-- `wage_snapshot = 0` การติ๊กจึงเข้าเฉพาะ OT — กฎเงินเดือนเป็น**ชิ้นที่ขาดอยู่**
-- ของคนกลุ่มนี้พอดี ไม่ใช่ของซ้ำ · จึงบังคับที่ฐานข้อมูล: ผูกคนได้เฉพาะรายเดือน
--
-- 🔴 ลงย้อนหลังได้ตั้งแต่เดือนที่เลือกจนถึงเดือนปัจจุบัน และ**กดซ้ำได้**
-- โดยไม่เกิดรายการซ้ำ — unique (recurring_id, period_month) เป็นตัวกัน
-- ไม่ใช่ความจำของคนกด

-- ── 1 · หมวดสำหรับเงินเดือน ─────────────────────────────────────────
-- ต้องมีหมวดให้ผูกตั้งแต่แรก ไม่งั้นฟีเจอร์เปิดมาแล้วใช้ไม่ได้จนกว่าจะมีคน
-- ไปสร้างหมวดเอง · `on conflict do nothing` = เครื่องที่มีหมวดนี้แล้วไม่ซ้ำ
insert into public.categories (name, kind, sort_order)
values ('เงินเดือนพนักงาน', 'expense', 15)
on conflict do nothing;

-- ── 2 · กฎรายเดือน ─────────────────────────────────────────────────
create table if not exists public.recurring_expenses (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  amount        numeric(12,2) not null check (amount > 0),
  category_id   uuid not null references public.categories(id) on delete restrict,
  -- null = ส่วนกลาง (ไม่ผูกโครงการ) — ค่าเริ่มต้นของเงินเดือน
  site_id       uuid references public.sites(id) on delete restrict,
  -- null = ไม่ผูกกับคน (ค่าเช่า ค่าเน็ต) · มีค่า = เงินเดือนของคนนั้น
  employee_id   uuid references public.employees(id) on delete restrict,
  day_of_month  int not null default 1 check (day_of_month between 1 and 31),
  -- เก็บเป็นวันที่ 1 ของเดือนเสมอ — normalize ด้วย trigger ข้างล่าง
  start_month   date not null,
  end_month     date,
  pay_method    public.pay_method not null default 'transfer',
  is_active     boolean not null default true,
  note          text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint recurring_month_order check (end_month is null or end_month >= start_month)
);

create index if not exists recurring_active_idx
  on public.recurring_expenses(is_active) where is_active;
create index if not exists recurring_employee_idx
  on public.recurring_expenses(employee_id) where employee_id is not null;

-- วันที่ 1 ของเดือนเสมอ + กันผูกคนรายวัน (ซึ่งจะทำให้ต้นทุนเป็นสองเท่า)
create or replace function public.guard_recurring()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_type public.wage_type;
begin
  new.start_month := date_trunc('month', new.start_month)::date;
  if new.end_month is not null then
    new.end_month := date_trunc('month', new.end_month)::date;
  end if;

  if new.employee_id is not null then
    select w.wage_type into v_type
    from public.employee_wages w where w.employee_id = new.employee_id;
    if v_type is distinct from 'monthly' then
      raise exception 'EMPLOYEE_NOT_MONTHLY: ตั้งเงินเดือนอัตโนมัติได้เฉพาะคนที่รับเป็นรายเดือน — คนรายวันมีค่าแรงจากการลงชื่อเข้าโครงการอยู่แล้ว';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists recurring_guard on public.recurring_expenses;
create trigger recurring_guard before insert or update on public.recurring_expenses
  for each row execute function public.guard_recurring();

revoke execute on function public.guard_recurring() from public, anon, authenticated;

drop trigger if exists recurring_audit on public.recurring_expenses;
create trigger recurring_audit after insert or update or delete on public.recurring_expenses
  for each row execute function public.audit_row();

alter table public.recurring_expenses enable row level security;

drop policy if exists recurring_owner_all on public.recurring_expenses;
create policy recurring_owner_all on public.recurring_expenses
  for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- ── 3 · รายการที่ถูกสร้างจากกฎ ─────────────────────────────────────
alter table public.transactions
  add column if not exists recurring_id uuid references public.recurring_expenses(id) on delete set null;
alter table public.transactions
  add column if not exists period_month date;

comment on column public.transactions.recurring_id is
  'มีค่า = รายการนี้ระบบสร้างจากกฎรายเดือน ไม่ใช่คนคีย์';

-- 🔴 ตัวกันรายการซ้ำ — กดปุ่ม "ลงย้อนหลัง" กี่ครั้งก็ได้ผลเท่าเดิม
create unique index if not exists transactions_recurring_once
  on public.transactions(recurring_id, period_month)
  where recurring_id is not null;

-- ── 4 · ตัวสร้างรายการ ─────────────────────────────────────────────
-- แยกเป็นตัวใน (ไม่เช็คสิทธิ์) กับตัวนอกสองตัว เพื่อไม่ให้สูตรถูกเขียนสองรอบ
-- 🔴 ตัวในถูก revoke จากทุก role — เข้าถึงได้ผ่านตัวนอกเท่านั้น
create or replace function public.gen_recurring(p_rule uuid, p_through date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recurring_expenses%rowtype;
  m date;
  d date;
  n int := 0;
begin
  select * into r from public.recurring_expenses where id = p_rule;
  if not found or not r.is_active then return 0; end if;

  m := r.start_month;
  while m <= date_trunc('month', p_through)::date loop
    exit when r.end_month is not null and m > r.end_month;

    -- วันที่ 31 ในเดือนที่มี 30 วัน = วันสุดท้ายของเดือนนั้น ไม่ใช่ข้ามเดือน
    d := least(
      (m + (r.day_of_month - 1))::date,
      (m + interval '1 month - 1 day')::date
    );

    -- ยังไม่ถึงวันจ่ายของเดือนนี้ = ยังไม่ลง · ลงล่วงหน้าคือยอดที่ยังไม่เกิด
    if d <= p_through then
      insert into public.transactions (
        kind, site_id, category_id, amount, txn_date, pay_method, status,
        note, created_by, recurring_id, period_month
      )
      values (
        'expense', r.site_id, r.category_id, r.amount, d, r.pay_method, 'approved',
        coalesce(r.note, r.name), r.created_by, r.id, m
      )
      on conflict (recurring_id, period_month) where recurring_id is not null
      do nothing;

      if found then n := n + 1; end if;
    end if;

    m := (m + interval '1 month')::date;
  end loop;

  return n;
end $$;

revoke execute on function public.gen_recurring(uuid, date) from public, anon, authenticated;

-- เจ้าของกดเองจากหน้าตั้งค่า (ตอนสร้างกฎ = ลงย้อนหลังทันที)
create or replace function public.run_recurring_expense(p_rule uuid, p_through date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_owner()) then
    raise exception 'FORBIDDEN: เฉพาะเจ้าของเท่านั้น';
  end if;
  return public.gen_recurring(p_rule, p_through);
end $$;

revoke execute on function public.run_recurring_expense(uuid, date) from public, anon;
grant execute on function public.run_recurring_expense(uuid, date) to authenticated;

-- งานตามเวลา — เรียกจาก /api/cron/recurring ด้วย service-role เท่านั้น
create or replace function public.run_recurring_expenses(p_through date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  x uuid;
  n int := 0;
begin
  for x in select id from public.recurring_expenses where is_active loop
    n := n + public.gen_recurring(x, p_through);
  end loop;
  return n;
end $$;

revoke execute on function public.run_recurring_expenses(date) from public, anon, authenticated;
grant execute on function public.run_recurring_expenses(date) to service_role;

-- ── 5 · สรุปให้หน้าจอ: กฎแต่ละข้อลงไปแล้วกี่เดือน ค้างกี่เดือน ─────────
create or replace function public.recurring_status(p_through date)
returns table (
  id            uuid,
  posted_months int,
  posted_total  numeric,
  last_month    date,
  due_months    int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    r.id,
    coalesce(t.n, 0)::int,
    coalesce(t.total, 0),
    t.last_month,
    -- กี่เดือนที่ถึงกำหนดแล้วแต่ยังไม่มีรายการ — ตัวเลขที่บอกว่าต้องกดปุ่มไหม
    greatest(
      0,
      (
        select count(*)::int
        from generate_series(
          r.start_month,
          least(coalesce(r.end_month, date_trunc('month', p_through)::date),
                date_trunc('month', p_through)::date),
          interval '1 month'
        ) g(m)
        where least(
                (g.m::date + (r.day_of_month - 1))::date,
                (g.m + interval '1 month - 1 day')::date
              ) <= p_through
      ) - coalesce(t.n, 0)
    )
  from public.recurring_expenses r
  left join lateral (
    select count(*)::int as n, sum(x.amount) as total, max(x.period_month) as last_month
    from public.transactions x
    where x.recurring_id = r.id
  ) t on true
  where (select public.is_owner());
$$;

revoke execute on function public.recurring_status(date) from public, anon;
grant execute on function public.recurring_status(date) to authenticated;
