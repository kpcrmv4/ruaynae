-- ════════════════════════════════════════════════════════════════════════
-- P4-c · ค่าแรงจากการลงชื่อเข้าไซต์เข้าเป็นต้นทุนของไซต์
-- ครอบแถว P4-CALC-01..06 ใน docs/test-plan/P4.md
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 ต้นทุนไซต์ = รายจ่ายที่ **อนุมัติแล้ว** + ค่าแรงที่ **เกิดขึ้นแล้ว**
-- ค่าแรงไม่ต้องผ่านการอนุมัติ เพราะติ๊กคนเข้าไซต์คือการยืนยันว่างานเกิดขึ้นจริง
-- ไปแล้ว (accrual) · เบิกล่วงหน้าและปิดรอบจ่าย (P5) คือเงินสดออก **ห้ามบวกซ้ำ**
--
-- 🔴 แยกเป็นสามตัวเลข: `cost_expense` · `cost_wage` · `cost_total`
-- ยุบเหลือตัวเดียวแล้ววันที่ตัวเลขไม่ตรงใจ จะไม่มีใครรู้ว่ามาจากฝั่งไหน
-- และคนที่ต้องอธิบายให้ลูกค้าฟังจะต้องเปิดฐานข้อมูลเอง

drop function if exists public.site_money(uuid);

create or replace function public.site_money(p_site uuid default null)
returns table (
  site_id          uuid,
  contract_amount  numeric,  -- null = ไม่มีสิทธิ์เห็น
  income_approved  numeric,  -- null = ไม่มีสิทธิ์เห็น
  income_pending   numeric,  -- null = ไม่มีสิทธิ์เห็น
  cost_expense     numeric,  -- รายจ่ายที่อนุมัติแล้ว
  cost_wage        numeric,  -- ค่าแรงจากการลงชื่อเข้าไซต์ (accrual)
  cost_total       numeric,  -- สองอันข้างบนรวมกัน — ตัวที่เอาไปวาดแถบ
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
    coalesce(m.cost_approved, 0),
    coalesce(w.wage_cost, 0),
    coalesce(m.cost_approved, 0) + coalesce(w.wage_cost, 0),
    coalesce(m.cost_pending, 0)
  from public.sites s
  left join public.site_finance f on f.site_id = s.id
  -- `t.site_id = s.id` ตัดรายจ่ายส่วนกลางออกโดยอัตโนมัติ
  left join lateral (
    select
      sum(t.amount) filter (where t.kind = 'income'  and t.status = 'approved') as income_approved,
      sum(t.amount) filter (where t.kind = 'income'  and t.status = 'pending')  as income_pending,
      sum(t.amount) filter (where t.kind = 'expense' and t.status = 'approved') as cost_approved,
      sum(t.amount) filter (where t.kind = 'expense' and t.status = 'pending')  as cost_pending
    from public.transactions t
    where t.site_id = s.id
  ) m on true
  -- `amount` เป็น generated column: work_units × wage_snapshot + ot_amount
  -- คนรายเดือนได้ wage_snapshot = 0 จึงเข้ามาเฉพาะ OT ตามที่ DESIGN.md §5.5 กำหนด
  left join lateral (
    select sum(a.amount) as wage_cost
    from public.attendance a
    where a.site_id = s.id
  ) w on true
  where p_site is null or s.id = p_site
  order by s.id;
$$;

revoke execute on function public.site_money(uuid) from public, anon;
grant execute on function public.site_money(uuid) to authenticated;

-- ── ตัวเลขสรุปหน้าภาพรวม ─────────────────────────────────────────────
drop function if exists public.site_overview(date);

create or replace function public.site_overview(p_on date)
returns table (
  total_count      int,
  active_count     int,
  active_contract  numeric,  -- null = ไม่มีสิทธิ์เห็น
  due_soon_count   int,
  overdue_count    int,
  active_income    numeric,
  active_cost      numeric,  -- รายจ่ายอนุมัติแล้ว + ค่าแรงที่เกิดขึ้นแล้ว
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
    (
      select coalesce(sum(t.amount), 0)
      from public.transactions t
      join public.sites a on a.id = t.site_id and a.status = 'active'
      where t.kind = 'expense' and t.status = 'approved'
    ) + (
      select coalesce(sum(at.amount), 0)
      from public.attendance at
      join public.sites a on a.id = at.site_id and a.status = 'active'
    ),
    (select count(*)::int from public.transactions t where t.status = 'pending'),
    (select coalesce(sum(t.amount), 0) from public.transactions t where t.status = 'pending')
  from public.sites s
  left join public.site_finance f on f.site_id = s.id;
$$;

revoke execute on function public.site_overview(date) from public, anon;
grant execute on function public.site_overview(date) to authenticated;

-- ── ยอดค่าแรงของไซต์หนึ่งในวันหนึ่ง ──────────────────────────────────
-- 🔴 บวกในฐานข้อมูล ไม่ใช่บวกแถวที่หน้าจอโหลดมาแสดง
-- ไซต์ที่มีคนงานเกินหนึ่งหน้า ยอดจะน้อยกว่าความจริงโดยไม่มี error ให้จับ
create or replace function public.site_day_wage(p_site uuid, p_on date)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(a.amount), 0)
  from public.attendance a
  where a.site_id = p_site and a.work_date = p_on;
$$;

revoke execute on function public.site_day_wage(uuid, date) from public, anon;
grant execute on function public.site_day_wage(uuid, date) to authenticated;
