-- ════════════════════════════════════════════════════════════════════════
-- P5-b · ยอดค้างจ่ายของทุกคนในคำสั่งเดียว
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 ไม่ยิง `employee_balance()` ทีละคน (N+1) — ไซต์ที่มีคนงานสามสิบคน
-- คือสามสิบ round trip ต่อการโหลดหน้าหนึ่งครั้ง และจะช้าลงเรื่อย ๆ
-- โดยไม่มีใครสังเกตจนกว่าจะมีคนงานมากพอ
--
-- 🔴 `security definer` เพราะต้องอ่าน `attendance_wages` ซึ่งเป็นความลับ
-- → ต้องเช็ค `is_owner()` เองในตัวฟังก์ชัน RLS ไม่ได้ทำให้แล้ว
create or replace function public.payroll_balances()
returns table (
  employee_id uuid,
  full_name   text,
  job_title   text,
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
    coalesce(acc.total, 0),
    coalesce(adv.total, 0),
    coalesce(acc.total, 0) - coalesce(adv.total, 0)
  from public.employees e
  left join lateral (
    select sum(aw.amount) as total
    from public.attendance a
    join public.attendance_wages aw on aw.attendance_id = a.id
    where a.employee_id = e.id
      and not exists (
        select 1
        from public.payroll_lines pl
        join public.payroll_runs pr on pr.id = pl.run_id
        where pl.employee_id = a.employee_id
          and pr.status = 'closed'
          and a.work_date between pr.period_start and pr.period_end
          and (pr.site_id is null or pr.site_id = a.site_id)
      )
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
