-- ════════════════════════════════════════════════════════════════════════
-- "เดือนนี้ใครไปทำงานที่โครงการไหนบ้าง" — สรุป คน × โครงการ ของช่วงที่เลือก
-- (คำสั่งเจ้าของ 4 ก.ย. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 สรุปในฐานข้อมูล ไม่ใช่ดึงแถวมา group ใน JS — เดือนที่งานเยอะมีแถว
-- ลงชื่อได้หลักพัน และ PostgREST ตัดที่ 1,000 แถวเงียบ ๆ (CLAUDE.md §7)
-- ยอดที่ขาดไปโดยไม่มี error คือยอดที่ผิดแบบดูน่าเชื่อถือ
--
-- `security invoker` — RLS ของ `attendance` / `attendance_wages` เป็นตัวกรอง
-- ให้เอง · หัวหน้าโครงการจะได้เฉพาะโครงการที่ตัวเองดูแล และไม่ได้ยอดเงิน
-- (left join จึงยังได้จำนวนวัน แต่ `amount` เป็น null ไม่ใช่ 0 ที่ชวนเข้าใจผิด)

drop function if exists public.attendance_by_site(date, date);
create or replace function public.attendance_by_site(p_from date, p_to date)
returns table (
  employee_id uuid,
  full_name   text,
  job_title   text,
  site_id     uuid,
  site_name   text,
  days        numeric,
  amount      numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.id,
    e.full_name,
    e.job_title,
    s.id,
    s.name,
    sum(a.work_units),
    -- null = ไม่มีสิทธิ์เห็นยอดเงิน · 0 = ทำงานแล้วแต่ค่าแรงเป็นศูนย์ (คนรายเดือน)
    case when count(aw.attendance_id) > 0 then coalesce(sum(aw.amount), 0) end
  from public.attendance a
  join public.employees e on e.id = a.employee_id
  join public.sites s on s.id = a.site_id
  left join public.attendance_wages aw on aw.attendance_id = a.id
  where a.work_date between p_from and p_to
  group by e.id, e.full_name, e.job_title, s.id, s.name
  order by e.full_name, s.name;
$$;

revoke execute on function public.attendance_by_site(date, date) from public, anon;
grant execute on function public.attendance_by_site(date, date) to authenticated;
