-- ════════════════════════════════════════════════════════════════════════
-- P4.5 · ค่าแรงเป็นความลับจากหัวหน้าไซต์
-- เจ้าของสั่ง 31 ส.ค. 2569: "หัวหน้าไซต์มีหน้าที่แค่บันทึกรายจ่าย
-- และบันทึกว่าวันนี้ใครมาทำงานที่ไซต์นี้ — ไม่ต้องเห็นรายรับ ไม่ต้องเห็นค่าแรง"
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 RLS ของ Postgres คุม**ระดับแถว** ไม่ใช่ระดับคอลัมน์ และทั้งสองบทบาท
-- เข้ามาเป็น `authenticated` เหมือนกัน จึงแยกด้วยสิทธิ์คอลัมน์ไม่ได้เลย
-- → ต้อง **แยกตาราง** เหมือนที่ทำกับ `branding`/`app_settings`
-- และ `sites`/`site_finance` มาแล้วสองครั้ง
--
-- ตารางที่ "ทุกคนอ่านได้"          ตารางที่ "เจ้าของเท่านั้น"
--   employees   ชื่อ ตำแหน่ง          employee_wages    ประเภทค่าแรง เรต เงินเดือน
--   attendance  ใคร ไซต์ไหน วันไหน    attendance_wages  เรต ณ วันนั้น OT ยอดเงิน

-- ── 1 · ค่าแรงของคนงาน ───────────────────────────────────────────────
create table if not exists public.employee_wages (
  employee_id    uuid primary key references public.employees(id) on delete cascade,
  wage_type      public.wage_type not null default 'daily',
  daily_rate     numeric(12,2),
  monthly_salary numeric(12,2),
  updated_at     timestamptz not null default now(),

  constraint wages_daily_needs_rate check (
    wage_type <> 'daily' or (daily_rate is not null and daily_rate > 0)
  ),
  constraint wages_monthly_needs_salary check (
    wage_type <> 'monthly' or (monthly_salary is not null and monthly_salary > 0)
  ),
  constraint wages_nonneg check (
    coalesce(daily_rate, 0) >= 0 and coalesce(monthly_salary, 0) >= 0
  )
);

-- ย้ายข้อมูลเดิม แล้ว **ตรวจจำนวนแถวก่อนทิ้งคอลัมน์**
-- ทิ้งคอลัมน์ก่อนตรวจ = ข้อมูลหายโดยไม่มีทางกู้ และไม่มี error ให้เห็น
do $$
declare
  n_emp int;
  n_wage int;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employees' and column_name = 'daily_rate'
  ) then
    execute $mig$
      insert into public.employee_wages (employee_id, wage_type, daily_rate, monthly_salary)
      select e.id, e.wage_type, e.daily_rate, e.monthly_salary
      from public.employees e
      on conflict (employee_id) do nothing
    $mig$;

    select count(*) into n_emp from public.employees;
    select count(*) into n_wage from public.employee_wages;
    if n_wage < n_emp then
      raise exception 'ย้ายค่าแรงไม่ครบ: employees=% employee_wages=% — ยกเลิกการทิ้งคอลัมน์', n_emp, n_wage;
    end if;

    alter table public.employees
      drop column wage_type,
      drop column daily_rate,
      drop column monthly_salary;
  end if;
end $$;

alter table public.employee_wages enable row level security;

drop policy if exists employee_wages_owner on public.employee_wages;
create policy employee_wages_owner on public.employee_wages
  for select to authenticated using ((select public.is_owner()));
drop policy if exists employee_wages_owner_insert on public.employee_wages;
create policy employee_wages_owner_insert on public.employee_wages
  for insert to authenticated with check ((select public.is_owner()));
drop policy if exists employee_wages_owner_update on public.employee_wages;
create policy employee_wages_owner_update on public.employee_wages
  for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
drop policy if exists employee_wages_owner_delete on public.employee_wages;
create policy employee_wages_owner_delete on public.employee_wages
  for delete to authenticated using ((select public.is_owner()));

drop trigger if exists employee_wages_set_updated_at on public.employee_wages;
create trigger employee_wages_set_updated_at before update on public.employee_wages
  for each row execute function public.set_updated_at();
drop trigger if exists employee_wages_audit on public.employee_wages;
create trigger employee_wages_audit after insert or update or delete on public.employee_wages
  for each row execute function public.audit_row();

-- ── 2 · ยอดเงินของแต่ละวันที่ลงชื่อ ──────────────────────────────────
create table if not exists public.attendance_wages (
  attendance_id uuid primary key references public.attendance(id) on delete cascade,
  -- สำเนาของ `attendance.work_units` — generated column ข้ามตารางไม่ได้
  -- trigger เป็นคนดูแลให้ตรงกันเสมอ ไม่ใช่ให้ใครมาแก้เอง
  work_units    numeric(3,2) not null,
  wage_snapshot numeric(12,2) not null default 0 check (wage_snapshot >= 0),
  ot_amount     numeric(12,2) not null default 0 check (ot_amount >= 0),
  amount        numeric(12,2) generated always as
                  (work_units * wage_snapshot + ot_amount) stored,
  updated_at    timestamptz not null default now()
);

create index if not exists attendance_wages_amount_idx on public.attendance_wages(attendance_id);

do $$
declare
  n_att int;
  n_wage int;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance' and column_name = 'wage_snapshot'
  ) then
    execute $mig$
      insert into public.attendance_wages (attendance_id, work_units, wage_snapshot, ot_amount)
      select a.id, a.work_units, a.wage_snapshot, a.ot_amount
      from public.attendance a
      on conflict (attendance_id) do nothing
    $mig$;

    select count(*) into n_att from public.attendance;
    select count(*) into n_wage from public.attendance_wages;
    if n_wage < n_att then
      raise exception 'ย้ายยอดค่าแรงไม่ครบ: attendance=% attendance_wages=%', n_att, n_wage;
    end if;

    -- ทิ้ง generated column ก่อน — มันอ้าง `wage_snapshot` อยู่
    -- ทิ้งพร้อมกันแบบไม่เรียงลำดับจะได้ 2BP01 และ migration ค้างครึ่งทาง
    alter table public.attendance drop column amount;
    alter table public.attendance
      drop column wage_snapshot,
      drop column ot_amount;
  end if;
end $$;

alter table public.attendance_wages enable row level security;

drop policy if exists attendance_wages_owner on public.attendance_wages;
create policy attendance_wages_owner on public.attendance_wages
  for select to authenticated using ((select public.is_owner()));
drop policy if exists attendance_wages_owner_update on public.attendance_wages;
create policy attendance_wages_owner_update on public.attendance_wages
  for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
-- ไม่มี insert/delete policy โดยตั้งใจ — แถวเกิดและตายไปพร้อมกับ `attendance`
-- ผ่าน trigger และ `on delete cascade` เท่านั้น

drop trigger if exists attendance_wages_set_updated_at on public.attendance_wages;
create trigger attendance_wages_set_updated_at before update on public.attendance_wages
  for each row execute function public.set_updated_at();
drop trigger if exists attendance_wages_audit on public.attendance_wages;
create trigger attendance_wages_audit after insert or update or delete on public.attendance_wages
  for each row execute function public.audit_row();

-- ── 3 · guard ของ attendance — ไม่แตะเงินอีกต่อไป ────────────────────
create or replace function public.guard_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean;
  v_total  numeric;
begin
  select e.is_active into v_active from public.employees e where e.id = new.employee_id;
  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND: ไม่พบคนงานคนนี้';
  end if;
  if tg_op = 'INSERT' and not v_active then
    raise exception 'EMPLOYEE_INACTIVE: คนงานคนนี้ถูกปิดใช้งานแล้ว';
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    new.created_by := old.created_by;
  end if;

  -- คนหนึ่งคนทำงานได้ไม่เกินหนึ่งวันต่อวัน — ลงเต็มวันสองไซต์คือจ่ายสองวัน
  -- สำหรับงานหนึ่งวัน ซึ่งไม่มี error ที่ไหนเลย
  select coalesce(sum(a.work_units), 0) into v_total
  from public.attendance a
  where a.employee_id = new.employee_id
    and a.work_date = new.work_date
    and a.id is distinct from new.id;

  if v_total + new.work_units > 1 then
    raise exception 'WORK_UNITS_EXCEEDED: วันนี้คนนี้ถูกลงชื่อไปแล้ว % วัน รวมกับ % จะเกิน 1 วัน',
      v_total, new.work_units;
  end if;

  return new;
end $$;

revoke execute on function public.guard_attendance() from public, anon, authenticated;

-- ── 4 · เงินตามหลังการลงชื่อ ─────────────────────────────────────────
-- 🔴 `wage_snapshot` ถ่ายครั้งเดียวตอน INSERT เท่านั้น
-- ถ่ายใหม่ทุก UPDATE เมื่อไหร่ ต้นทุนของงานที่ปิดไปแล้วจะขยับตามเรตปัจจุบัน
-- (บทเรียนจาก P4-DB-10b — เคยพลาดมาแล้วในเวอร์ชันแรกของ guard ตัวเดิม)
create or replace function public.sync_attendance_wage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.wage_type;
  v_rate numeric;
begin
  if tg_op = 'INSERT' then
    select w.wage_type, w.daily_rate into v_type, v_rate
    from public.employee_wages w where w.employee_id = new.employee_id;

    insert into public.attendance_wages (attendance_id, work_units, wage_snapshot)
    values (
      new.id,
      new.work_units,
      -- คนรายเดือนได้ 0 — เงินเดือนตัดสิ้นเดือน ไม่ใช่ต้นทุนรายวัน (DESIGN.md §5.5)
      case when v_type = 'daily' then coalesce(v_rate, 0) else 0 end
    );
  else
    -- แก้ครึ่งวัน/เต็มวันได้ แต่เรตเดิมอยู่กับที่
    update public.attendance_wages
      set work_units = new.work_units
      where attendance_id = new.id;
  end if;
  return null;
end $$;

drop trigger if exists attendance_sync_wage on public.attendance;
create trigger attendance_sync_wage after insert or update on public.attendance
  for each row execute function public.sync_attendance_wage();

revoke execute on function public.sync_attendance_wage() from public, anon, authenticated;

-- ── 5 · บันทึกคนงานพร้อมค่าแรงในคำสั่งเดียว ──────────────────────────
-- 🔴 สองตารางต้องเปลี่ยนพร้อมกันหรือไม่เปลี่ยนเลย · แยกเป็นสอง request
-- แล้ววันหนึ่งอันที่สองจะล้ม เหลือคนงานที่ไม่มีค่าแรง ซึ่ง `guard` จะคิดให้เป็น ฿0
create or replace function public.save_employee(
  p_id           uuid,
  p_full_name    text,
  p_job_title    text,
  p_wage_type    public.wage_type,
  p_daily        numeric,
  p_monthly      numeric,
  p_default_site uuid,
  p_is_active    boolean,
  p_profile      uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- 🔴 `security definer` ปิด RLS ทิ้ง — ต้องเช็คสิทธิ์เองที่นี่
  -- ไม่ใช่หวังว่า policy จะทำงาน เพราะมันไม่ทำงานแล้วในฟังก์ชันนี้
  if not (select public.is_owner()) then
    raise exception 'FORBIDDEN: เฉพาะเจ้าของเท่านั้นที่จัดการคนงานได้';
  end if;

  if p_id is null then
    insert into public.employees (full_name, job_title, default_site_id, is_active, profile_id)
    values (btrim(p_full_name), nullif(btrim(coalesce(p_job_title, '')), ''),
            p_default_site, coalesce(p_is_active, true), p_profile)
    returning id into v_id;
  else
    update public.employees
      set full_name = btrim(p_full_name),
          job_title = nullif(btrim(coalesce(p_job_title, '')), ''),
          default_site_id = p_default_site,
          is_active = coalesce(p_is_active, is_active),
          profile_id = p_profile
      where id = p_id
      returning id into v_id;
    if v_id is null then
      raise exception 'NOT_FOUND: ไม่พบคนงานคนนี้';
    end if;
  end if;

  insert into public.employee_wages (employee_id, wage_type, daily_rate, monthly_salary)
  values (
    v_id,
    p_wage_type,
    case when p_wage_type = 'daily' then p_daily end,
    case when p_wage_type = 'monthly' then p_monthly end
  )
  on conflict (employee_id) do update
    set wage_type = excluded.wage_type,
        daily_rate = excluded.daily_rate,
        monthly_salary = excluded.monthly_salary;

  return v_id;
end $$;

revoke execute on function public.save_employee(uuid, text, text, public.wage_type, numeric, numeric, uuid, boolean, uuid) from public, anon;
grant execute on function public.save_employee(uuid, text, text, public.wage_type, numeric, numeric, uuid, boolean, uuid) to authenticated;

-- ── 6 · ตัวเลขเงินอ่านจากตารางใหม่ ───────────────────────────────────
-- `security invoker` ตามเดิม → หัวหน้าไซต์อ่าน `attendance_wages` ไม่ได้เลย
-- ยอดค่าแรงที่เขาจะได้จึงเป็น 0 · หน้าจอจึงต้อง**ไม่แสดงยอดต้นทุนให้เขาเลย**
-- ไม่ใช่แสดงตัวเลขที่ขาดค่าแรงไปโดยไม่บอก (ดู `moneyBars()` ฝั่งแอป)
drop function if exists public.site_money(uuid);

create or replace function public.site_money(p_site uuid default null)
returns table (
  site_id          uuid,
  contract_amount  numeric,
  income_approved  numeric,
  income_pending   numeric,
  cost_expense     numeric,
  cost_wage        numeric,
  cost_total       numeric,
  cost_pending     numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    s.id,
    case when (select public.is_owner()) then coalesce(f.contract_amount, 0) end,
    case when (select public.is_owner()) then coalesce(m.income_approved, 0) end,
    case when (select public.is_owner()) then coalesce(m.income_pending, 0) end,
    -- 🔴 ทุกตัวเลขต้นทุนเป็นของเจ้าของเท่านั้นแล้ว — คืน null ไม่ใช่ยอดที่ขาดค่าแรง
    case when (select public.is_owner()) then coalesce(m.cost_approved, 0) end,
    case when (select public.is_owner()) then coalesce(w.wage_cost, 0) end,
    case when (select public.is_owner())
      then coalesce(m.cost_approved, 0) + coalesce(w.wage_cost, 0) end,
    case when (select public.is_owner()) then coalesce(m.cost_pending, 0) end
  from public.sites s
  left join public.site_finance f on f.site_id = s.id
  left join lateral (
    select
      sum(t.amount) filter (where t.kind = 'income'  and t.status = 'approved') as income_approved,
      sum(t.amount) filter (where t.kind = 'income'  and t.status = 'pending')  as income_pending,
      sum(t.amount) filter (where t.kind = 'expense' and t.status = 'approved') as cost_approved,
      sum(t.amount) filter (where t.kind = 'expense' and t.status = 'pending')  as cost_pending
    from public.transactions t
    where t.site_id = s.id
  ) m on true
  left join lateral (
    select sum(aw.amount) as wage_cost
    from public.attendance a
    join public.attendance_wages aw on aw.attendance_id = a.id
    where a.site_id = s.id
  ) w on true
  where p_site is null or s.id = p_site
  order by s.id;
$$;

revoke execute on function public.site_money(uuid) from public, anon;
grant execute on function public.site_money(uuid) to authenticated;

drop function if exists public.site_overview(date);

create or replace function public.site_overview(p_on date)
returns table (
  total_count      int,
  active_count     int,
  active_contract  numeric,
  due_soon_count   int,
  overdue_count    int,
  active_income    numeric,
  active_cost      numeric,
  pending_count    int,
  pending_total    numeric
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
    end,
    count(*) filter (
      where s.status = 'active' and s.end_date is not null
        and s.end_date >= p_on and s.end_date < p_on + 30
    )::int,
    count(*) filter (
      where s.status = 'active' and s.end_date is not null and s.end_date < p_on
    )::int,
    case
      when (select public.is_owner()) then (
        select coalesce(sum(t.amount), 0)
        from public.transactions t
        join public.sites a on a.id = t.site_id and a.status = 'active'
        where t.kind = 'income' and t.status = 'approved'
      )
    end,
    case
      when (select public.is_owner()) then (
        select coalesce(sum(t.amount), 0)
        from public.transactions t
        join public.sites a on a.id = t.site_id and a.status = 'active'
        where t.kind = 'expense' and t.status = 'approved'
      ) + (
        select coalesce(sum(aw.amount), 0)
        from public.attendance at
        join public.attendance_wages aw on aw.attendance_id = at.id
        join public.sites a on a.id = at.site_id and a.status = 'active'
      )
    end,
    (select count(*)::int from public.transactions t where t.status = 'pending'),
    (select coalesce(sum(t.amount), 0) from public.transactions t where t.status = 'pending')
  from public.sites s
  left join public.site_finance f on f.site_id = s.id;
$$;

revoke execute on function public.site_overview(date) from public, anon;
grant execute on function public.site_overview(date) to authenticated;

create or replace function public.site_day_wage(p_site uuid, p_on date)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select case when (select public.is_owner()) then coalesce(sum(aw.amount), 0) end
  from public.attendance a
  join public.attendance_wages aw on aw.attendance_id = a.id
  where a.site_id = p_site and a.work_date = p_on;
$$;

revoke execute on function public.site_day_wage(uuid, date) from public, anon;
grant execute on function public.site_day_wage(uuid, date) to authenticated;
