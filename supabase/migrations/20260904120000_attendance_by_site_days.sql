-- ════════════════════════════════════════════════════════════════════════
-- แก้ "รวมกี่วัน" ของแท็บทำงานที่ไหนบ้าง — นับวันจริง ไม่ใช่บวกของทุกคน
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 อาการที่เจ้าของเห็น: หัวข้อโครงการเขียน "รวม 29 วัน" ทั้งที่เดือนนั้น
-- โครงการเปิดทำงานจริงแค่ 4 วัน — เพราะฝั่งแอปบวก `days` ของทุกคนเข้าด้วยกัน
-- (8 คน × 3–4 วัน) ซึ่งคือ **วันแรง** ไม่ใช่ **จำนวนวันที่มีคนเข้าทำงาน**
--
-- สองตัวเลขนี้ตอบคนละคำถามและต่างกันเป็นเท่าตัวเสมอเมื่อมีคนหลายคน:
--   วันแรง (`days` ต่อแถว)  — เอาไปคูณค่าแรง · ยังต้องมีในแต่ละแถว
--   วันที่มีคนเข้าทำงาน     — "โครงการนี้เดือนนี้เดินไปกี่วัน" · ตัวที่หัวข้อต้องการ
--
-- 🔴 นับ `count(distinct work_date)` ในฐานข้อมูล ไม่ใช่ให้แอปเดาจากแถวที่ได้ไป
-- เพราะแถวที่ส่งไปเป็นระดับ คน×โครงการ ซึ่งบอกไม่ได้ว่าวันซ้ำกันหรือเปล่า

drop function if exists public.attendance_by_site(date, date);
create or replace function public.attendance_by_site(p_from date, p_to date)
returns table (
  employee_id        uuid,
  full_name          text,
  job_title          text,
  site_id            uuid,
  site_name          text,
  days               numeric,  -- วันแรงของคนนี้ที่โครงการนี้ (ครึ่งวัน = 0.5)
  amount             numeric,  -- null = ไม่มีสิทธิ์เห็นยอดเงิน
  site_work_days     int,      -- โครงการนี้มีคนเข้าทำงานกี่วัน (นับวันไม่ซ้ำ)
  employee_work_days int       -- คนนี้มาทำงานกี่วัน (นับวันไม่ซ้ำ ข้ามทุกโครงการ)
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select
      a.employee_id,
      a.site_id,
      a.work_date,
      a.work_units,
      aw.amount,
      aw.attendance_id
    from public.attendance a
    left join public.attendance_wages aw on aw.attendance_id = a.id
    where a.work_date between p_from and p_to
  ),
  pair as (
    select
      b.employee_id,
      b.site_id,
      sum(b.work_units) as days,
      -- null = ไม่มีสิทธิ์เห็น · 0 = ทำงานแล้วแต่ค่าแรงเป็นศูนย์ (คนรายเดือน)
      case when count(b.attendance_id) > 0 then coalesce(sum(b.amount), 0) end as amount
    from base b
    group by b.employee_id, b.site_id
  ),
  site_days as (
    select b.site_id, count(distinct b.work_date)::int as d from base b group by b.site_id
  ),
  emp_days as (
    select b.employee_id, count(distinct b.work_date)::int as d from base b group by b.employee_id
  )
  select
    e.id, e.full_name, e.job_title,
    s.id, s.name,
    p.days, p.amount,
    sd.d, ed.d
  from pair p
  join public.employees e on e.id = p.employee_id
  join public.sites s on s.id = p.site_id
  join site_days sd on sd.site_id = p.site_id
  join emp_days ed on ed.employee_id = p.employee_id
  order by e.full_name, s.name;
$$;

revoke execute on function public.attendance_by_site(date, date) from public, anon;
grant execute on function public.attendance_by_site(date, date) to authenticated;
