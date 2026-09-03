-- ════════════════════════════════════════════════════════════════════════
-- `report_labor` คืน "จำนวนวันที่มีการลงชื่อ" เพิ่มมาอีกตัว (คำสั่งเจ้าของ 4 ก.ย. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 `work_units` กับ `work_days` เป็นคนละคำถาม อย่าเอามาแทนกัน
--   `work_units` = **วันแรง** — 5 คนมาทำงานวันเดียวกัน = 5 (ครึ่งวัน = 0.5)
--                  เป็นตัวตั้งของค่าแรง จึงยังต้องมีไว้ใช้ตรงที่ต้องการปริมาณแรงงาน
--   `work_days`  = **จำนวนวันตามปฏิทิน** ที่มีคนถูกลงชื่อ — 5 คนวันเดียวกัน = 1
--                  ตอบว่า "โครงการนี้เดินมากี่วันแล้ว" ซึ่งเป็นตัวที่หน้ารายงานต้องการ
--
-- กรองโครงการอยู่ → นับวันของโครงการนั้น · ไม่กรอง → นับวันที่มีคนเข้าที่ไหนก็ได้
-- ทั้งสองแบบเป็นคำตอบของ "มีการลงชื่อกี่วัน" เหมือนกัน ไม่ใช่การบวกข้ามโครงการ

drop function if exists public.report_labor(date, date, uuid);
create or replace function public.report_labor(
  p_from date,
  p_to date,
  p_site uuid default null
)
returns table (
  work_units    numeric,
  work_days     int,
  worker_count  int,
  wage_total    numeric,
  ot_total      numeric,
  advance_paid  numeric,
  payroll_paid  numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(a.work_units, 0),
    coalesce(a.work_days, 0),
    coalesce(a.worker_count, 0),
    coalesce(a.wage_total, 0),
    coalesce(a.ot_total, 0),
    coalesce(v.advance_paid, 0),
    coalesce(r.payroll_paid, 0)
  from (values (1)) as one(x)
  left join lateral (
    select
      sum(at.work_units) as work_units,
      count(distinct at.work_date)::int as work_days,
      count(distinct at.employee_id)::int as worker_count,
      sum(aw.amount) as wage_total,
      sum(aw.ot_amount) as ot_total
    from public.attendance at
    join public.attendance_wages aw on aw.attendance_id = at.id
    where at.work_date between p_from and p_to
      and (p_site is null or at.site_id = p_site)
  ) a on true
  left join lateral (
    select sum(ad.amount) as advance_paid
    from public.advances ad
    where ad.advance_date between p_from and p_to
      and (p_site is null or ad.site_id = p_site)
  ) v on true
  left join lateral (
    select sum(pr.total_paid) as payroll_paid
    from public.payroll_runs pr
    where pr.status = 'closed'
      and pr.period_end between p_from and p_to
      and (p_site is null or pr.site_id = p_site)
  ) r on true
  where (select public.is_owner());
$$;

revoke execute on function public.report_labor(date, date, uuid) from public, anon;
grant execute on function public.report_labor(date, date, uuid) to authenticated;
