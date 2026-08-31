-- ══════════════════════════════════════════════════════════════════════
-- R3b · เปลี่ยนฟังก์ชันของตารางการทำงานเป็น `security invoker`
--
-- 🔴 `get_advisors` ขึ้นเตือนสองข้อใหม่ทันทีที่ apply R3 —
--    "SECURITY DEFINER ที่ผู้ใช้ที่ล็อกอินแล้วเรียกได้" · ของเดิมในระบบมีเตือน
--    แบบนี้อยู่ 6 ตัวซึ่งจำเป็นต้องเป็น definer จริง (เช่น close_payroll_run
--    ที่ต้องเขียน payroll_lines ข้าม RLS) แต่ **สามตัวนี้ไม่จำเป็นเลย**:
--    เจ้าของมีสิทธิ์อ่าน/เขียนตารางเหล่านี้ผ่าน RLS อยู่แล้ว
--
--    invoker ปลอดภัยกว่าเพราะ RLS ยังทำงาน — ถ้าวันหนึ่งเช็ค `is_owner()`
--    ในฟังก์ชันหลุดหายไป RLS ยังกันไว้เป็นด่านที่สอง ส่วน definer ที่เช็คหลุด
--    = เปิดข้อมูลทั้งตารางให้ทุกคนที่ล็อกอิน
-- ══════════════════════════════════════════════════════════════════════

-- กติกา "วันนี้ถูกจ่ายไปแล้วหรือยัง" — invoker แล้ว RLS ของ payroll_runs/lines
-- (เจ้าของเท่านั้น) เป็นตัวกรองให้เอง · คนอื่นเรียกได้แต่ได้ false เสมอ
-- ซึ่งไม่ได้รั่วอะไร เพราะเขาอ่าน attendance_wages ไม่ได้อยู่แล้ว
create or replace function public.attendance_paid(
  p_employee uuid,
  p_work_date date,
  p_site uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.payroll_lines pl
    join public.payroll_runs pr on pr.id = pl.run_id
    where pl.employee_id = p_employee
      and pr.status = 'closed'
      and p_work_date between pr.period_start and pr.period_end
      and (pr.site_id is null or pr.site_id = p_site)
  );
$$;

revoke execute on function public.attendance_paid(uuid, date, uuid) from public, anon;
grant execute on function public.attendance_paid(uuid, date, uuid) to authenticated;

create or replace function public.attendance_grid(p_from date, p_to date)
returns table (
  attendance_id uuid,
  employee_id   uuid,
  work_date     date,
  site_id       uuid,
  site_name     text,
  work_units    numeric,
  wage_snapshot numeric,
  ot_amount     numeric,
  amount        numeric,
  paid          boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    a.id,
    a.employee_id,
    a.work_date,
    a.site_id,
    s.name,
    a.work_units,
    coalesce(aw.wage_snapshot, 0),
    coalesce(aw.ot_amount, 0),
    coalesce(aw.amount, 0),
    public.attendance_paid(a.employee_id, a.work_date, a.site_id)
  from public.attendance a
  join public.sites s on s.id = a.site_id
  left join public.attendance_wages aw on aw.attendance_id = a.id
  where (select public.is_owner())
    and a.work_date between p_from and p_to
  order by a.employee_id, a.work_date;
$$;

revoke execute on function public.attendance_grid(date, date) from public, anon;
grant execute on function public.attendance_grid(date, date) to authenticated;

-- เขียนผ่าน RLS ตามปกติ · guard trigger ทุกตัวยังทำงานครบเหมือนเดิม
create or replace function public.save_attendance_day(
  p_employee   uuid,
  p_site       uuid,
  p_date       date,
  p_work_units numeric,
  p_wage       numeric,
  p_ot         numeric default 0
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id    uuid;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if not (select public.is_owner()) then
    raise exception 'FORBIDDEN: เฉพาะเจ้าของเท่านั้นที่แก้ตารางค่าแรงได้';
  end if;

  if p_date > v_today then
    raise exception 'DATE_FUTURE: ลงชื่อล่วงหน้าไม่ได้ — ค่าแรงของวันที่ยังไม่มาถึงคือต้นทุนที่ยังไม่เกิด';
  end if;
  if p_work_units is null or p_work_units not in (0.5, 1) then
    raise exception 'WORK_UNITS_INVALID: ลงได้เฉพาะเต็มวันหรือครึ่งวัน';
  end if;
  if p_wage is null or p_wage < 0 or coalesce(p_ot, 0) < 0 then
    raise exception 'AMOUNT_INVALID: ค่าแรงติดลบไม่ได้';
  end if;
  if public.attendance_paid(p_employee, p_date, p_site) then
    raise exception 'PAYROLL_CLOSED: วันนี้ถูกจ่ายไปแล้ว แก้ไม่ได้';
  end if;

  delete from public.attendance a
   where a.employee_id = p_employee
     and a.work_date = p_date
     and a.site_id is distinct from p_site;

  insert into public.attendance (employee_id, site_id, work_date, work_units)
  values (p_employee, p_site, p_date, p_work_units)
  on conflict (employee_id, work_date, site_id)
    do update set work_units = excluded.work_units
  returning id into v_id;

  update public.attendance_wages
     set wage_snapshot = p_wage,
         ot_amount = coalesce(p_ot, 0),
         work_units = p_work_units
   where attendance_id = v_id;

  return v_id;
end $$;

revoke execute on function public.save_attendance_day(uuid, uuid, date, numeric, numeric, numeric)
  from public, anon;
grant execute on function public.save_attendance_day(uuid, uuid, date, numeric, numeric, numeric)
  to authenticated;
