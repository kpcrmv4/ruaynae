-- ════════════════════════════════════════════════════════════════════════
-- P4-a · คนงาน และการลงชื่อเข้าไซต์รายวัน
-- ครอบแถว P4-DB-01..22 ใน docs/test-plan/P4.md
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 ติ๊กคนเข้าไซต์ = **ต้นทุนเกิดขึ้น** (accrual) ไม่ใช่เงินสดออก
-- เบิกล่วงหน้าและปิดรอบจ่าย (P5) คือเงินสดออก ซึ่งเป็นการล้างหนี้ที่เกิดไปแล้ว
-- นับสองอย่างเป็นรายจ่ายเมื่อไหร่ ต้นทุนเป็นสองเท่าทันที (DESIGN.md §5.4)

do $$ begin
  create type public.wage_type as enum ('daily', 'monthly');
  exception when duplicate_object then null;
end $$;

-- ── คนงาน ────────────────────────────────────────────────────────────
-- "คน" กับ "ผู้ใช้ระบบ" เป็นคนละเรื่อง (CLAUDE.md §5) — คนส่วนใหญ่มีแค่แถวนี้
-- `profile_id` ไม่ null เฉพาะคนที่ล็อกอินด้วย เช่นหัวหน้าไซต์ที่กินเงินเดือน
create table if not exists public.employees (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null check (length(btrim(full_name)) > 0),
  job_title       text,
  wage_type       public.wage_type not null default 'daily',
  daily_rate      numeric(12,2),
  monthly_salary  numeric(12,2),
  -- เงินเดือนของคนรายเดือนลงไซต์ประจำ หรือส่วนกลางถ้าเป็น null (DESIGN.md §5.5)
  default_site_id uuid references public.sites(id) on delete set null,
  is_active       boolean not null default true,
  profile_id      uuid unique references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- 🔴 คนรายวันที่ไม่มีเรต = ต้นทุน ฿0 ตลอดไปโดยไม่มีใครสังเกต
  -- กฎแบบนี้ต้องอยู่ที่ schema ไม่ใช่หวังว่าฟอร์มจะบังคับให้
  constraint employees_daily_needs_rate check (
    wage_type <> 'daily' or (daily_rate is not null and daily_rate > 0)
  ),
  constraint employees_monthly_needs_salary check (
    wage_type <> 'monthly' or (monthly_salary is not null and monthly_salary > 0)
  ),
  constraint employees_rates_nonneg check (
    coalesce(daily_rate, 0) >= 0 and coalesce(monthly_salary, 0) >= 0
  )
);

create index if not exists employees_active_idx on public.employees(is_active, full_name);
create index if not exists employees_default_site_idx on public.employees(default_site_id);
create index if not exists employees_profile_idx on public.employees(profile_id);

-- ── การลงชื่อเข้าไซต์ ────────────────────────────────────────────────
create table if not exists public.attendance (
  id            uuid primary key default gen_random_uuid(),
  work_date     date not null,
  site_id       uuid not null references public.sites(id) on delete restrict,
  employee_id   uuid not null references public.employees(id) on delete restrict,
  -- เต็มวัน หรือครึ่งวัน — ไม่มีค่าอื่น เพราะเศษวันที่ละเอียดกว่านี้
  -- ไม่มีใครนับได้จริงหน้างาน แล้วจะกลายเป็นตัวเลขที่เถียงกันตอนจ่ายเงิน
  work_units    numeric(3,2) not null default 1 check (work_units in (0.5, 1)),
  ot_amount     numeric(12,2) not null default 0 check (ot_amount >= 0),
  -- 🔴 เรต ณ วันที่ลงชื่อ — ห้าม join ไปอ่านเรตปัจจุบัน
  -- ไม่งั้นวันที่เจ้าของขึ้นค่าแรง ต้นทุนของงานที่ปิดไปแล้วจะขยับตามเงียบ ๆ
  wage_snapshot numeric(12,2) not null default 0 check (wage_snapshot >= 0),
  amount        numeric(12,2) generated always as
                  (work_units * wage_snapshot + ot_amount) stored,
  note          text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- กดซ้ำเพราะเน็ตช้าต้องไม่กลายเป็นค่าแรงสองเท่า
  constraint attendance_once_per_site unique (employee_id, work_date, site_id)
);

create index if not exists attendance_date_site_idx on public.attendance(work_date, site_id);
create index if not exists attendance_employee_date_idx on public.attendance(employee_id, work_date);
create index if not exists attendance_site_idx on public.attendance(site_id);
create index if not exists attendance_created_by_idx on public.attendance(created_by);

alter table public.employees enable row level security;
alter table public.attendance enable row level security;

-- ── RLS ──────────────────────────────────────────────────────────────
-- หัวหน้าไซต์อ่านคนที่ยัง `is_active` ได้ทั้งหมด — ไม่งั้นคนงานใหม่ที่ยังไม่เคย
-- เข้าไซต์ไหนเลยจะไม่มีวันโผล่ในกล่องเลือก แล้ววันแรกของเขาจะลงชื่อไม่ได้
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  for select to authenticated
  using ((select public.is_owner()) or is_active);

drop policy if exists employees_owner_insert on public.employees;
create policy employees_owner_insert on public.employees
  for insert to authenticated with check ((select public.is_owner()));
drop policy if exists employees_owner_update on public.employees;
create policy employees_owner_update on public.employees
  for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
drop policy if exists employees_owner_delete on public.employees;
create policy employees_owner_delete on public.employees
  for delete to authenticated using ((select public.is_owner()));

-- 🔴 ขอบเขตผูกกับ `work_date` ของแถวนั้น ไม่ใช่ `current_date`
-- ใช้วันนี้เมื่อไหร่ พอหัวหน้าไซต์ย้ายไซต์ ประวัติเก่าจะเปลี่ยนเจ้าของทันที
-- คนที่ย้ายออกจะเห็นข้อมูลใหม่ที่ไม่ควรเห็น และเข้าไม่ถึงของเก่าที่ตัวเองบันทึก
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance
  for select to authenticated
  using ((select public.is_owner()) or public.supervises_site(site_id, work_date));

drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance
  for insert to authenticated
  with check ((select public.is_owner()) or public.supervises_site(site_id, work_date));

drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance
  for update to authenticated
  using ((select public.is_owner()) or public.supervises_site(site_id, work_date))
  with check ((select public.is_owner()) or public.supervises_site(site_id, work_date));

drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance
  for delete to authenticated
  using ((select public.is_owner()) or public.supervises_site(site_id, work_date));

-- ── guard: เรต · ผู้บันทึก · เพดานหนึ่งวันต่อคนต่อวัน ────────────────
create or replace function public.guard_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp    public.employees%rowtype;
  v_total  numeric;
begin
  select * into v_emp from public.employees e where e.id = new.employee_id;
  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND: ไม่พบคนงานคนนี้';
  end if;
  if not v_emp.is_active then
    raise exception 'EMPLOYEE_INACTIVE: คนงานคนนี้ถูกปิดใช้งานแล้ว';
  end if;

  -- 🔴 เรตมาจากฐานข้อมูลเสมอ ค่าที่ client ส่งมาถูกเพิกเฉย
  -- `default` ใช้ไม่ได้เพราะ client ส่งค่าทับได้ (พิสูจน์แล้วที่ P2-DB-20)
  -- คนรายเดือนได้ 0 — เงินเดือนตัดสิ้นเดือน ไม่ใช่ต้นทุนรายวัน (DESIGN.md §5.5)
  new.wage_snapshot := case when v_emp.wage_type = 'daily'
                            then coalesce(v_emp.daily_rate, 0) else 0 end;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    new.created_by := old.created_by;
  end if;

  -- 🔴 คนหนึ่งคนทำงานได้ไม่เกินหนึ่งวันต่อวัน
  -- ลงเต็มวันสองไซต์ = จ่ายสองวันสำหรับงานหนึ่งวัน ซึ่งไม่มี error ที่ไหนเลย
  -- และเป็นรูปแบบหนึ่งของ "ต้นทุนบวกซ้ำ" ที่บันทึกไว้ใน CLAUDE.md §17
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

drop trigger if exists attendance_guard on public.attendance;
create trigger attendance_guard before insert or update on public.attendance
  for each row execute function public.guard_attendance();

revoke execute on function public.guard_attendance() from public, anon, authenticated;

-- ── updated_at + audit ───────────────────────────────────────────────
drop trigger if exists employees_set_updated_at on public.employees;
create trigger employees_set_updated_at before update on public.employees
  for each row execute function public.set_updated_at();
drop trigger if exists attendance_set_updated_at on public.attendance;
create trigger attendance_set_updated_at before update on public.attendance
  for each row execute function public.set_updated_at();

drop trigger if exists employees_audit on public.employees;
create trigger employees_audit after insert or update or delete on public.employees
  for each row execute function public.audit_row();
drop trigger if exists attendance_audit on public.attendance;
create trigger attendance_audit after insert or update or delete on public.attendance
  for each row execute function public.audit_row();

-- ── 🔴 แก้: snapshot ต้องถูก "ถ่ายครั้งเดียว" ไม่ใช่ทุกครั้งที่แถวถูกแตะ ──
--
-- เวอร์ชันแรกของ guard ตั้ง `new.wage_snapshot` ทั้งตอน INSERT และ UPDATE
-- ผลคือ: เจ้าของขึ้นค่าแรง → ใครสักคนไปแก้โน้ตของแถวเมื่อสามเดือนก่อน
-- → ต้นทุนของงานที่ปิดไปแล้ว **ขยับขึ้นเงียบ ๆ** ซึ่งคือกฎที่ DESIGN.md §5.5
-- เขียนไว้ตรง ๆ ว่าห้ามเกิด · ตรวจไม่เจอเพราะแถวตรวจเดิมไม่เคย UPDATE หลังขึ้นเรต
--
-- ถ่ายใหม่เฉพาะตอน INSERT หรือตอนที่ "คนละคน" จริง ๆ
create or replace function public.guard_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp    public.employees%rowtype;
  v_total  numeric;
begin
  select * into v_emp from public.employees e where e.id = new.employee_id;
  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND: ไม่พบคนงานคนนี้';
  end if;

  if tg_op = 'INSERT' then
    if not v_emp.is_active then
      raise exception 'EMPLOYEE_INACTIVE: คนงานคนนี้ถูกปิดใช้งานแล้ว';
    end if;
    -- เรตมาจากฐานข้อมูลเสมอ · ค่าที่ client ส่งมาถูกเพิกเฉย (เหมือน P2-DB-20)
    -- คนรายเดือนได้ 0 — เงินเดือนตัดสิ้นเดือน ไม่ใช่ต้นทุนรายวัน
    new.wage_snapshot := case when v_emp.wage_type = 'daily'
                              then coalesce(v_emp.daily_rate, 0) else 0 end;
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    new.created_by := old.created_by;
    if new.employee_id is distinct from old.employee_id then
      -- เปลี่ยนตัวคน = เป็นการบันทึกใหม่จริง ๆ จึงถ่ายเรตใหม่
      new.wage_snapshot := case when v_emp.wage_type = 'daily'
                                then coalesce(v_emp.daily_rate, 0) else 0 end;
    else
      -- 🔴 คนเดิม = เรตเดิมเสมอ · แก้โน้ตหรือครึ่งวันต้องไม่ทำให้ต้นทุนย้อนหลังขยับ
      new.wage_snapshot := old.wage_snapshot;
    end if;
  end if;

  -- คนหนึ่งคนทำงานได้ไม่เกินหนึ่งวันต่อวัน
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
