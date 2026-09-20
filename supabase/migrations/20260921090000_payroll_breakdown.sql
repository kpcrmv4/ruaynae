-- ════════════════════════════════════════════════════════════════════════
-- แยกยอดค้างจ่ายเป็น ค่าจ้าง / ค่าพิเศษ / ค่าหัก + บอกว่าเบี้ยแต่ละอย่างได้วันไหนบ้าง
-- (คำสั่งเจ้าของ 21 ก.ย. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- เจ้าของถาม: *"เราจะดูเบี้ยต่างจังหวัดตรงไหนหรอ ว่าแต่ละคนได้วันไหนบ้าง
-- เรื่องของเรื่องผมกลัวให้ไม่ครบวันที่เค้าออกต่างจังหวัด"*
--
-- 🔴 คำถามคือ **"ครบไหม"** ไม่ใช่ "รวมเท่าไหร่" — ยอดรวมตอบคำถามนี้ไม่ได้เลย
-- ฿1,500 อาจเป็น 3 วัน × ฿500 หรือ 5 วัน × ฿300 ก็ได้ · สิ่งที่ต้องเห็นคือ
-- **รายการวันที่** เอาไปกางเทียบกับวันที่เขาออกต่างจังหวัดจริง
--
-- ทั้งสองฟังก์ชันนับเฉพาะ **วันที่ยังไม่ถูกจ่าย** ด้วยเงื่อนไขเดียวกับ
-- `payroll_balances()` เดิม (`attendance_paid()`) — ยอดบนหน้าจอจึงเป็นชุดเดียวกัน
-- ถ้าแยกเงื่อนไขกัน วันจ่ายเงินจริงกับยอดที่โชว์จะเริ่มไม่ตรงกันโดยไม่มีใครรู้

-- ── 1 · ยอดค้างจ่ายรายคน แบบแยกก้อน ─────────────────────────────────
-- ⚠️ เปลี่ยนชนิดที่คืน → ต้อง `drop` ก่อน (`cannot change return type`)
drop function if exists public.payroll_balances();
create or replace function public.payroll_balances()
returns table (
  employee_id uuid,
  full_name   text,
  job_title   text,
  days        numeric,
  -- ค่าจ้างฐาน = วันแรง × เรตของวันนั้น (ไม่รวมรายการปรับ)
  base        numeric,
  -- ค่าพิเศษ / ค่าหัก = ผลรวมของ `attendance_adjustments` แยกตามทิศทาง
  extra       numeric,
  deduct      numeric,
  -- ค่าแรงรวม = base + extra − deduct (ตรงกับ `attendance_wages.amount` เสมอ)
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
    coalesce(acc.base, 0),
    coalesce(adj.extra, 0),
    coalesce(adj.deduct, 0),
    coalesce(acc.total, 0),
    coalesce(adv.total, 0),
    coalesce(acc.total, 0) - coalesce(adv.total, 0)
  from public.employees e
  left join lateral (
    select
      sum(a.work_units)                       as days,
      sum(aw.work_units * aw.wage_snapshot)   as base,
      sum(aw.amount)                          as total
    from public.attendance a
    join public.attendance_wages aw on aw.attendance_id = a.id
    where a.employee_id = e.id
      and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
  ) acc on true
  left join lateral (
    select
      sum(ad.amount) filter (where ad.kind = 'add')    as extra,
      sum(ad.amount) filter (where ad.kind = 'deduct') as deduct
    from public.attendance_adjustments ad
    join public.attendance a on a.id = ad.attendance_id
    where a.employee_id = e.id
      and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
  ) adj on true
  left join lateral (
    select sum(ad.amount - ad.deducted_amount) as total
    from public.advances ad
    where ad.employee_id = e.id and ad.payroll_run_id is null
  ) adv on true
  where (select public.is_owner())
    and (coalesce(acc.total, 0) <> 0 or coalesce(adv.total, 0) <> 0)
  order by e.full_name;
$$;

revoke execute on function public.payroll_balances() from public, anon;
grant execute on function public.payroll_balances() to authenticated;

-- ── 2 · เบี้ยแต่ละอย่างของแต่ละคน — **พร้อมวันที่** ──────────────────
-- คืนหนึ่งแถวต่อ (คน × ชื่อรายการ) พร้อมอาเรย์ของวันที่ เรียงจากเก่าไปใหม่
-- เพื่อให้หน้าจอกางให้ดูได้ว่า "ได้วันไหนบ้าง" ไม่ใช่แค่ยอดรวม
create or replace function public.payroll_adjustment_days()
returns table (
  employee_id uuid,
  name        text,
  kind        public.adjust_kind,
  total       numeric,
  times       int,
  days        date[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.employee_id,
    ad.name,
    ad.kind,
    sum(ad.amount)                      as total,
    count(*)::int                       as times,
    array_agg(a.work_date order by a.work_date) as days
  from public.attendance_adjustments ad
  join public.attendance a on a.id = ad.attendance_id
  where (select public.is_owner())
    and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
  group by a.employee_id, ad.name, ad.kind
  order by a.employee_id, ad.kind, ad.name;
$$;

revoke execute on function public.payroll_adjustment_days() from public, anon;
grant execute on function public.payroll_adjustment_days() to authenticated;
