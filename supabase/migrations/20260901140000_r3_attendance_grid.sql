-- ══════════════════════════════════════════════════════════════════════
-- R3 · ตารางการทำงานรายเดือน (คน × วัน) + วันค้างจ่ายรายคน
--
-- เจ้าของขอให้หน้า `/payroll` มีสองมุมมองสลับกันได้: ยอดค้างจ่ายรายคน
-- กับตารางการทำงานของเดือนที่เลือก ซึ่งแตะช่องวันแล้วแก้ได้ทันที
-- ══════════════════════════════════════════════════════════════════════

-- ── 1 · กติกา "วันนี้ถูกจ่ายไปแล้วหรือยัง" ──────────────────────────
-- 🔴 เงื่อนไขนี้เดิมถูกเขียนซ้ำอยู่ **สี่ที่** (close_payroll_run · เพดานเบิก ·
--    guard_attendance_closed · guard_attendance_wage_closed) ทุกที่เหมือนกันเป๊ะ
--    ของใหม่ทั้งหมดเรียกฟังก์ชันนี้แทน จะได้ไม่เพิ่มสำเนาที่ห้า
--    · ถ้าวันหนึ่งต้องแก้กติกา ต้องแก้ให้ครบทุกที่ — มีคิวรีเทียบไว้ใน
--      docs/test-plan (แถว R3-PAY-01) ที่ต้องได้ 0 แถวเสมอ
--
-- `security definer` เพราะถูกเรียกจากฟังก์ชัน definer ตัวอื่น และ **ถอนสิทธิ์
-- ออกจากทุก role** — ไม่ได้ตั้งใจให้ client เรียกตรง
create or replace function public.attendance_paid(
  p_employee uuid,
  p_work_date date,
  p_site uuid
)
returns boolean
language sql
stable
security definer
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

revoke execute on function public.attendance_paid(uuid, date, uuid)
  from public, anon, authenticated;

-- ── 2 · ยอดค้างจ่ายรายคน — เพิ่ม "กี่วัน" ───────────────────────────
-- เจ้าของต้องเห็นทั้ง **จำนวนวันที่ค้าง** และ **จำนวนเงินที่ค้าง** ในแถวเดียวกัน
-- ยอดเงินอย่างเดียวตอบไม่ได้ว่าคนนี้มาทำงานกี่วัน ซึ่งเป็นตัวเลขที่ใช้เถียงกันจริง
drop function if exists public.payroll_balances();
create or replace function public.payroll_balances()
returns table (
  employee_id uuid,
  full_name   text,
  job_title   text,
  days        numeric,
  accrued     numeric,
  advanced    numeric,
  balance     numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id,
    e.full_name,
    e.job_title,
    coalesce(acc.days, 0),
    coalesce(acc.total, 0),
    coalesce(adv.total, 0),
    coalesce(acc.total, 0) - coalesce(adv.total, 0)
  from public.employees e
  left join lateral (
    select sum(a.work_units) as days, sum(aw.amount) as total
    from public.attendance a
    join public.attendance_wages aw on aw.attendance_id = a.id
    where a.employee_id = e.id
      and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
  ) acc on true
  left join lateral (
    select sum(ad.amount) as total
    from public.advances ad
    where ad.employee_id = e.id and ad.payroll_run_id is null
  ) adv on true
  where (select public.is_owner())
    and (coalesce(acc.total, 0) <> 0 or coalesce(adv.total, 0) <> 0)
  order by e.full_name;
$$;

revoke execute on function public.payroll_balances() from public, anon;
grant execute on function public.payroll_balances() to authenticated;

-- ── 3 · ช่องในตาราง คน × วัน ────────────────────────────────────────
-- คืนเฉพาะ "วันที่มีการทำงาน" — วันที่ไม่มีแถวคือช่องว่างบนหน้าจอ
-- ไม่ต้องส่งช่องว่างมาให้ (เดือนหนึ่ง 30 วัน × คนงาน 20 คน = 600 ช่องเปล่า ๆ)
drop function if exists public.attendance_grid(date, date);
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
security definer
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

-- ── 4 · บันทึกช่องเดียวในตาราง ──────────────────────────────────────
-- หนึ่งครั้งที่กด "บันทึก" = หนึ่งคำสั่ง ไม่ใช่หลาย request ที่อาจสำเร็จครึ่งเดียว
--
-- 🔴 ต่างจาก `/api/attendance` ตรงที่ **เจ้าของตั้งค่าแรงของวันนั้นเองได้**
--    (ค่าเริ่มต้นดึงจากเรตของคนนั้น แต่แก้ได้) · ของเดิมยึดเรตปัจจุบันเสมอ
--    ซึ่งใช้ไม่ได้กับงานที่ตกลงราคาเป็นวัน ๆ
--
-- 🔴 guard เดิมทุกตัวยังทำงานครบ เพราะยังเขียนผ่านตารางตามปกติ:
--    เพดาน 1 วัน/คน/วัน · ห้ามแก้วันที่อยู่ในรอบที่ปิดแล้ว · audit log
--    ฟังก์ชันนี้แค่เพิ่มข้อความที่อ่านรู้เรื่องก่อนไปชน guard
drop function if exists public.save_attendance_day(uuid, uuid, date, numeric, numeric, numeric);
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
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  -- `security definer` ปิด RLS ทิ้ง — ต้องเช็คสิทธิ์เองที่นี่
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

  -- ย้ายไซต์ของวันเดิม = คนละแถว (unique คือ employee+date+site)
  -- ต้องเอาแถวเดิมออกก่อน ไม่งั้นชนเพดาน 1 วันแล้วบันทึกไม่ผ่านโดยไม่มีใครเข้าใจว่าทำไม
  -- (การลบยังผ่าน guard เดิม — วันที่จ่ายแล้วจะถูกปฏิเสธที่นั่น)
  delete from public.attendance a
   where a.employee_id = p_employee
     and a.work_date = p_date
     and a.site_id is distinct from p_site;

  insert into public.attendance (employee_id, site_id, work_date, work_units)
  values (p_employee, p_site, p_date, p_work_units)
  on conflict (employee_id, work_date, site_id)
    do update set work_units = excluded.work_units
  returning id into v_id;

  -- แถว `attendance_wages` ถูก trigger สร้างให้แล้วตอน insert (เรตปัจจุบันของคนนั้น)
  -- ตรงนี้ทับด้วยค่าที่เจ้าของกรอกจริง · `amount` เป็น generated column คิดให้เอง
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
