-- ════════════════════════════════════════════════════════════════════════
-- จ่ายค่าแรงรายคนด้วยปุ่มเดียว — เลิกให้เจ้าของต้องคิดเรื่อง "รอบจ่าย"
-- (คำสั่งเจ้าของ 4 ก.ย. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- เจ้าของถามว่า "ค่าแรงค้างจ่ายไม่เกี่ยวกับต้นทุนโครงการใช่ไหม ถ้าใช่ยกเลิก
-- รอบจ่ายไปเลยดีไหม" — ข้อแรกใช่ (ต้นทุนเกิดตอนติ๊กคนเข้าโครงการ · การจ่าย
-- คือเงินสดออก) แต่ข้อสองยกเลิกทั้งกลไกไม่ได้ เพราะ "รอบที่ปิดแล้ว" เป็น
-- **ตัวเดียว**ที่ทำสามอย่างนี้อยู่:
--   1. กันจ่ายซ้ำวันเดิม   — `attendance_paid()` อ่านจากรอบที่ปิดแล้ว
--   2. ล็อกค่าแรงย้อนหลัง  — `guard_attendance_closed` / `..._wage_closed`
--   3. ฐานของเพดานเบิก     — เพดาน = ค่าแรงที่ยังไม่ถูกจ่าย − เบิกที่ยังไม่ถูกหัก
-- ทิ้งไปเฉย ๆ = จ่ายซ้ำได้ · แก้เรตย้อนหลังหลังจ่ายได้ · เพดานเบิกเพี้ยน
--
-- 🔴 ทางออก: **เก็บกลไก เอาพิธีกรรมออก** — ปุ่มเดียวสร้าง "รอบของคนคนเดียว"
-- ที่คลุมเฉพาะวันที่เขายังไม่ได้รับเงิน แล้วปิดให้ทันทีในทรานแซกชันเดียว
-- หน้าจอไม่ต้องมีคำว่า "รอบจ่าย" อีกเลย แต่หลังบ้านยังครบเหมือนเดิมทุกข้อ

-- ── 1 · รอบที่เจาะจงคนเดียว ─────────────────────────────────────────
alter table public.payroll_runs
  add column if not exists employee_id uuid references public.employees(id) on delete restrict;

comment on column public.payroll_runs.employee_id is
  'null = รอบรวมหลายคน (แบบเดิม) · มีค่า = จ่ายให้คนคนเดียวจากปุ่ม "จ่ายค่าแรง"';

create index if not exists payroll_runs_employee_idx
  on public.payroll_runs(employee_id) where employee_id is not null;

-- 🔴 ข้อห้าม "ช่วงเวลาซ้อนกัน" ต้องแยกรายคนด้วย ไม่งั้นจ่ายให้สมชายวันที่ 1–30
-- แล้วจ่ายให้สมศรีช่วงเดียวกันไม่ได้ ซึ่งเป็นกรณีปกติที่สุดของปุ่มนี้
-- · ตัวกันจ่ายซ้ำ**จริง ๆ** คือ `attendance_paid()` ที่เช็คถึงระดับ
--   `payroll_lines.employee_id` อยู่แล้ว — ข้อห้ามนี้เป็นตาข่ายรองอีกชั้น
alter table public.payroll_runs drop constraint if exists payroll_runs_no_overlap;
alter table public.payroll_runs add constraint payroll_runs_no_overlap
  exclude using gist (
    coalesce(site_id,     '00000000-0000-0000-0000-000000000000'::uuid) with =,
    coalesce(employee_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    daterange(period_start, period_end + 1, '[)') with &&
  );

-- ── 2 · ปิดรอบ: เคารพ `employee_id` ถ้ารอบนั้นเจาะจงคนไว้ ────────────
-- สูตรเดิมทุกบรรทัด เพิ่มแค่เงื่อนไข "คนคนนี้เท่านั้น" — ไม่แตกสูตรออกไปเขียนใหม่
-- อีกที่ ไม่งั้นวันที่กติกาเปลี่ยน จะแก้ตัวหนึ่งแล้วอีกตัวเงียบ ๆ ไม่ตาม
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

  -- ค่าแรงในช่วง แยกรายคน — เฉพาะวันที่ยังไม่ถูกจ่ายในรอบไหน
  create temporary table _acc on commit drop as
  select
    a.employee_id,
    sum(a.work_units)  as days,
    sum(aw.amount)     as accrued
  from public.attendance a
  join public.attendance_wages aw on aw.attendance_id = a.id
  where a.work_date between v_run.period_start and v_run.period_end
    and (v_run.site_id is null or a.site_id = v_run.site_id)
    and (v_run.employee_id is null or a.employee_id = v_run.employee_id)
    and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
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

-- ── 3 · ปุ่มเดียวจบ ─────────────────────────────────────────────────
-- ช่วงของรอบ = **วันแรกถึงวันสุดท้ายที่เขายังไม่ได้รับเงิน** ไม่ใช่เดือนปฏิทิน
-- · เจ้าของไม่ต้องเลือกช่วง และไม่มีทางเลือกช่วงผิดจนจ่ายไม่ครบ
create or replace function public.pay_employee_wage(p_employee uuid)
returns table (run_id uuid, days numeric, accrued numeric, deducted numeric, paid numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from date;
  v_to   date;
  v_run  uuid;
  v_res  record;
begin
  if not (select public.is_owner()) then
    raise exception 'FORBIDDEN: เฉพาะเจ้าของเท่านั้นที่จ่ายค่าแรงได้';
  end if;

  if not exists (select 1 from public.employees e where e.id = p_employee) then
    raise exception 'NOT_FOUND: ไม่พบคนงานคนนี้';
  end if;

  select min(a.work_date), max(a.work_date)
  into v_from, v_to
  from public.attendance a
  join public.attendance_wages aw on aw.attendance_id = a.id
  where a.employee_id = p_employee
    and aw.amount > 0
    and not public.attendance_paid(a.employee_id, a.work_date, a.site_id);

  if v_from is null then
    raise exception 'NOTHING_TO_PAY: คนนี้ไม่มีค่าแรงค้างจ่าย';
  end if;

  insert into public.payroll_runs (period_start, period_end, site_id, employee_id)
  values (v_from, v_to, null, p_employee)
  returning id into v_run;

  -- ปิดด้วยฟังก์ชันเดิม = ทรานแซกชันเดียวกัน และใช้สูตรชุดเดียวกับรอบรวม
  select * into v_res from public.close_payroll_run(v_run);

  return query select v_run, l.days, v_res.accrued, v_res.deducted, v_res.paid
  from public.payroll_lines l
  where l.run_id = v_run and l.employee_id = p_employee;
end $$;

revoke execute on function public.pay_employee_wage(uuid) from public, anon;
grant execute on function public.pay_employee_wage(uuid) to authenticated;

-- ── 4 · ห้าม **เพิ่ม** วันลงไปในช่วงที่จ่ายไปแล้วด้วย ─────────────────
-- 🔴 เดิม guard จับแค่ update/delete · แถวที่ถูก insert ย้อนหลังเข้าไปในช่วง
-- ที่ปิดไปแล้วจะถูก `attendance_paid()` นับว่า "จ่ายแล้ว" ทันทีทั้งที่ไม่เคย
-- มีเงินออกให้ — คนทำงานวันนั้นจะไม่ได้ค่าแรงและไม่มีอะไรฟ้องเลยสักที่
-- · ปุ่มจ่ายรายคนใช้ช่วง min..max ซึ่งกว้างกว่าเดือนเดียวได้ กรณีนี้จึงเกิดง่ายขึ้น
create or replace function public.guard_attendance_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attendance%rowtype := case when tg_op = 'DELETE' then old else new end;
begin
  if public.attendance_paid(v_row.employee_id, v_row.work_date, v_row.site_id) then
    if tg_op = 'INSERT' then
      raise exception 'PAYROLL_CLOSED: วันนี้อยู่ในช่วงที่จ่ายค่าแรงไปแล้ว เพิ่มย้อนหลังไม่ได้';
    end if;
    raise exception 'PAYROLL_CLOSED: วันนี้อยู่ในช่วงที่จ่ายค่าแรงไปแล้ว แก้หรือลบไม่ได้';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists attendance_guard_closed on public.attendance;
create trigger attendance_guard_closed before insert or update or delete on public.attendance
  for each row execute function public.guard_attendance_closed();

revoke execute on function public.guard_attendance_closed() from public, anon, authenticated;

-- เรตของวันที่จ่ายไปแล้วก็แก้ไม่ได้เช่นกัน — ใช้ helper ตัวเดียวกัน ไม่ใช่สำเนาที่ห้า
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
  if found and public.attendance_paid(v_att.employee_id, v_att.work_date, v_att.site_id) then
    raise exception 'PAYROLL_CLOSED: ค่าแรงของวันนี้ถูกจ่ายไปแล้ว แก้ไม่ได้';
  end if;
  return new;
end $$;

revoke execute on function public.guard_attendance_wage_closed() from public, anon, authenticated;
