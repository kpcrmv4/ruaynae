-- ══════════════════════════════════════════════════════════════════════
-- R2 · ฟังก์ชันสรุปสำหรับหน้ารายงาน (/reports)
--
-- 🔴 ทุกตัวเลขในนี้ต้องมาจาก **สูตรเดียวกับที่หน้าอื่นใช้อยู่แล้ว**
--    รายรับ  = transactions kind='income'  status='approved'
--    ต้นทุน  = transactions kind='expense' status='approved' + ค่าแรงจากการลงชื่อ
--    เบิกล่วงหน้า / ปิดรอบจ่าย = **เงินสดออก ไม่ใช่ต้นทุน** (DESIGN.md §5.4)
--              จึงมีช่องของตัวเองแยกออกมา ห้ามบวกเข้า cost_total เด็ดขาด
--    นับซ้ำเมื่อไหร่ กำไรในรายงานจะไม่ตรงกับหน้าไซต์ทันที และคนดูจะเลิกเชื่อทั้งหน้า
--
-- 🔴 ทุกฟังก์ชันเป็น `security invoker` + กรองด้วย `is_owner()` — เงินทั้งหมด
--    เป็นของเจ้าของตามที่ตัดสินใจไว้ตอน P4.5 · คนอื่นเรียกได้แต่จะได้ 0 แถวกลับไป
--    ไม่ใช่ได้เลข 0 ซึ่งอ่านเหมือน "ไม่มีรายการ" ทั้งที่แปลว่า "ไม่มีสิทธิ์เห็น"
--
-- 🔴 การรวมยอดอยู่ในฐานข้อมูลทั้งหมด ไม่ใช่ดึงแถวไปบวกใน JS (CLAUDE.md §7)
--    PostgREST ตัดผลลัพธ์ที่ 1,000 แถวเงียบ ๆ — รายงานทั้งปีจะขาดโดยไม่มี error
-- ══════════════════════════════════════════════════════════════════════

-- ── 1 · สรุปช่วงเวลา ────────────────────────────────────────────────
-- เรียกสองครั้ง (ช่วงนี้ / ช่วงก่อนหน้า) เพื่อทำ % เทียบ — ไม่ต้องมีสูตรที่สอง
drop function if exists public.report_summary(date, date, uuid);
create or replace function public.report_summary(
  p_from date,
  p_to date,
  p_site uuid default null
)
returns table (
  income_approved  numeric,
  income_pending   numeric,
  expense_approved numeric,
  expense_pending  numeric,
  expense_cash     numeric,
  expense_transfer numeric,
  wage_cost        numeric,
  cost_total       numeric,
  profit           numeric,
  txn_count        int,
  advance_paid     numeric,
  payroll_paid     numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(t.income_approved, 0),
    coalesce(t.income_pending, 0),
    coalesce(t.expense_approved, 0),
    coalesce(t.expense_pending, 0),
    coalesce(t.expense_cash, 0),
    coalesce(t.expense_transfer, 0),
    coalesce(w.wage_cost, 0),
    coalesce(t.expense_approved, 0) + coalesce(w.wage_cost, 0),
    coalesce(t.income_approved, 0)
      - (coalesce(t.expense_approved, 0) + coalesce(w.wage_cost, 0)),
    coalesce(t.txn_count, 0),
    coalesce(a.advance_paid, 0),
    coalesce(p.payroll_paid, 0)
  from (values (1)) as one(x)
  left join lateral (
    select
      sum(x.amount) filter (where x.kind = 'income'  and x.status = 'approved') as income_approved,
      sum(x.amount) filter (where x.kind = 'income'  and x.status = 'pending')  as income_pending,
      sum(x.amount) filter (where x.kind = 'expense' and x.status = 'approved') as expense_approved,
      sum(x.amount) filter (where x.kind = 'expense' and x.status = 'pending')  as expense_pending,
      sum(x.amount) filter (
        where x.kind = 'expense' and x.status = 'approved' and x.pay_method = 'cash'
      ) as expense_cash,
      sum(x.amount) filter (
        where x.kind = 'expense' and x.status = 'approved' and x.pay_method = 'transfer'
      ) as expense_transfer,
      count(*)::int as txn_count
    from public.transactions x
    where x.txn_date between p_from and p_to
      and (p_site is null or x.site_id = p_site)
  ) t on true
  left join lateral (
    select sum(aw.amount) as wage_cost
    from public.attendance a2
    join public.attendance_wages aw on aw.attendance_id = a2.id
    where a2.work_date between p_from and p_to
      and (p_site is null or a2.site_id = p_site)
  ) w on true
  left join lateral (
    select sum(v.amount) as advance_paid
    from public.advances v
    where v.advance_date between p_from and p_to
      and (p_site is null or v.site_id = p_site)
  ) a on true
  left join lateral (
    select sum(r.total_paid) as payroll_paid
    from public.payroll_runs r
    where r.status = 'closed'
      and r.period_end between p_from and p_to
      and (p_site is null or r.site_id = p_site)
  ) p on true
  where (select public.is_owner());
$$;

revoke execute on function public.report_summary(date, date, uuid) from public, anon;
grant execute on function public.report_summary(date, date, uuid) to authenticated;

-- ── 2 · อนุกรมเวลา (สำหรับกราฟ) ─────────────────────────────────────
-- `generate_series` ทำให้ช่วงที่ไม่มีรายการยังมีแท่งของตัวเอง — กราฟที่ข้ามวันว่าง
-- ไปเฉย ๆ ทำให้ระยะห่างบนแกนโกหก และคนอ่านว่าเดือนนั้นทำงานติดกันทุกวัน
drop function if exists public.report_series(date, date, text, uuid);
create or replace function public.report_series(
  p_from date,
  p_to date,
  p_grain text default 'day',
  p_site uuid default null
)
returns table (
  bucket  date,
  income  numeric,
  expense numeric,
  wage    numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with g as (
    select case when p_grain = 'month' then 'month' else 'day' end as unit
  ),
  buckets as (
    select generate_series(
      date_trunc((select unit from g), p_from::timestamp),
      date_trunc((select unit from g), p_to::timestamp),
      case when (select unit from g) = 'month' then interval '1 month' else interval '1 day' end
    )::date as bucket
  ),
  txn as (
    select
      date_trunc((select unit from g), t.txn_date::timestamp)::date as bucket,
      sum(t.amount) filter (where t.kind = 'income')  as income,
      sum(t.amount) filter (where t.kind = 'expense') as expense
    from public.transactions t
    where t.status = 'approved'
      and t.txn_date between p_from and p_to
      and (p_site is null or t.site_id = p_site)
    group by 1
  ),
  wages as (
    select
      date_trunc((select unit from g), a.work_date::timestamp)::date as bucket,
      sum(aw.amount) as wage
    from public.attendance a
    join public.attendance_wages aw on aw.attendance_id = a.id
    where a.work_date between p_from and p_to
      and (p_site is null or a.site_id = p_site)
    group by 1
  )
  select b.bucket, coalesce(t.income, 0), coalesce(t.expense, 0), coalesce(w.wage, 0)
  from buckets b
  left join txn t on t.bucket = b.bucket
  left join wages w on w.bucket = b.bucket
  where (select public.is_owner())
  order by b.bucket;
$$;

revoke execute on function public.report_series(date, date, text, uuid) from public, anon;
grant execute on function public.report_series(date, date, text, uuid) to authenticated;

-- ── 3 · แยกหมวด ─────────────────────────────────────────────────────
-- 🔴 ค่าแรงจากการลงชื่อถูกใส่เป็นแถวของตัวเองด้วย (category_id = null)
--    ไม่งั้นผลรวมของ "ต้นทุนแยกหมวด" จะน้อยกว่า `cost_total` โดยไม่มีคำอธิบาย
--    ซึ่งเป็นบั๊กชนิดที่คนเห็นแล้วเลิกเชื่อทั้งหน้า (§17 ข้อ 2)
drop function if exists public.report_by_category(date, date, uuid);
create or replace function public.report_by_category(
  p_from date,
  p_to date,
  p_site uuid default null
)
returns table (
  category_id uuid,
  name        text,
  kind        public.txn_kind,
  total       numeric,
  item_count  int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.name, c.kind, sum(t.amount), count(*)::int
  from public.transactions t
  join public.categories c on c.id = t.category_id
  where (select public.is_owner())
    and t.status = 'approved'
    and t.txn_date between p_from and p_to
    and (p_site is null or t.site_id = p_site)
  group by c.id, c.name, c.kind

  union all

  select null::uuid, 'ค่าแรงจากการลงชื่อ', 'expense'::public.txn_kind,
         sum(aw.amount), count(*)::int
  from public.attendance a
  join public.attendance_wages aw on aw.attendance_id = a.id
  where (select public.is_owner())
    and a.work_date between p_from and p_to
    and (p_site is null or a.site_id = p_site)
  having sum(aw.amount) > 0

  order by 4 desc;
$$;

revoke execute on function public.report_by_category(date, date, uuid) from public, anon;
grant execute on function public.report_by_category(date, date, uuid) to authenticated;

-- ── 4 · แยกไซต์ ─────────────────────────────────────────────────────
-- รวมแถว "ส่วนกลาง" (site_id is null) ไว้ด้วย เพราะรายจ่ายกลุ่มนั้นเป็นเงินที่
-- ออกไปจริง ๆ — ตกหล่นเมื่อไหร่ ผลรวมของตารางจะไม่เท่ากับยอดรวมด้านบน
drop function if exists public.report_by_site(date, date);
create or replace function public.report_by_site(p_from date, p_to date)
returns table (
  site_id    uuid,
  name       text,
  income     numeric,
  expense    numeric,
  wage       numeric,
  cost_total numeric,
  profit     numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    s.id,
    s.name,
    coalesce(m.income, 0),
    coalesce(m.expense, 0),
    coalesce(w.wage, 0),
    coalesce(m.expense, 0) + coalesce(w.wage, 0),
    coalesce(m.income, 0) - (coalesce(m.expense, 0) + coalesce(w.wage, 0))
  from public.sites s
  left join lateral (
    select
      sum(t.amount) filter (where t.kind = 'income')  as income,
      sum(t.amount) filter (where t.kind = 'expense') as expense
    from public.transactions t
    where t.site_id = s.id
      and t.status = 'approved'
      and t.txn_date between p_from and p_to
  ) m on true
  left join lateral (
    select sum(aw.amount) as wage
    from public.attendance a
    join public.attendance_wages aw on aw.attendance_id = a.id
    where a.site_id = s.id
      and a.work_date between p_from and p_to
  ) w on true
  where (select public.is_owner())
    and (coalesce(m.income, 0) <> 0 or coalesce(m.expense, 0) <> 0 or coalesce(w.wage, 0) <> 0)

  union all

  select
    null::uuid,
    'ส่วนกลาง (ไม่ผูกไซต์)',
    coalesce(sum(t.amount) filter (where t.kind = 'income'), 0),
    coalesce(sum(t.amount) filter (where t.kind = 'expense'), 0),
    0,
    coalesce(sum(t.amount) filter (where t.kind = 'expense'), 0),
    coalesce(sum(t.amount) filter (where t.kind = 'income'), 0)
      - coalesce(sum(t.amount) filter (where t.kind = 'expense'), 0)
  from public.transactions t
  where (select public.is_owner())
    and t.site_id is null
    and t.status = 'approved'
    and t.txn_date between p_from and p_to
  having count(*) > 0

  order by 6 desc;
$$;

revoke execute on function public.report_by_site(date, date) from public, anon;
grant execute on function public.report_by_site(date, date) to authenticated;

-- ── 5 · ฝั่งคนและค่าแรง ─────────────────────────────────────────────
-- `work_units` คือ "วันแรง" (เต็มวัน = 1 · ครึ่งวัน = 0.5) ไม่ใช่จำนวนแถว
drop function if exists public.report_labor(date, date, uuid);
create or replace function public.report_labor(
  p_from date,
  p_to date,
  p_site uuid default null
)
returns table (
  work_units    numeric,
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
    coalesce(a.worker_count, 0),
    coalesce(a.wage_total, 0),
    coalesce(a.ot_total, 0),
    coalesce(v.advance_paid, 0),
    coalesce(r.payroll_paid, 0)
  from (values (1)) as one(x)
  left join lateral (
    select
      sum(at.work_units) as work_units,
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

-- ── 6 · คนที่ทำงานมากที่สุดในช่วงนั้น ───────────────────────────────
drop function if exists public.report_top_workers(date, date, uuid);
create or replace function public.report_top_workers(
  p_from date,
  p_to date,
  p_site uuid default null
)
returns table (
  employee_id uuid,
  full_name   text,
  work_units  numeric,
  wage_total  numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.id, e.full_name, sum(a.work_units), sum(aw.amount)
  from public.attendance a
  join public.attendance_wages aw on aw.attendance_id = a.id
  join public.employees e on e.id = a.employee_id
  where (select public.is_owner())
    and a.work_date between p_from and p_to
    and (p_site is null or a.site_id = p_site)
  group by e.id, e.full_name
  order by sum(aw.amount) desc, sum(a.work_units) desc;
$$;

revoke execute on function public.report_top_workers(date, date, uuid) from public, anon;
grant execute on function public.report_top_workers(date, date, uuid) to authenticated;
