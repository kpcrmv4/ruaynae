-- ════════════════════════════════════════════════════════════════════════
-- แยกต้นทุนสะสมของโครงการเป็น ค่าแรง | ค่าวัสดุ | ค่าใช้จ่ายอื่น ๆ
-- + จำนวนวันที่มีการลงเวลาเข้าโครงการ  (คำสั่งเจ้าของ 4 ก.ย. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 "ค่าวัสดุ" ต้องเป็น **ธงบนหมวด** ไม่ใช่การเทียบชื่อหมวดในโค้ด
-- เจ้าของแก้ชื่อหมวดได้เองจาก /settings/categories · โค้ดที่เทียบ
-- `name = 'ค่าวัสดุก่อสร้าง'` จะกลายเป็นศูนย์เงียบ ๆ ในวันที่มีคนพิมพ์ชื่อใหม่
-- และไม่มี error ที่ไหนให้เห็น · ธงยังรองรับกรณีที่เจ้าของเพิ่มหมวดวัสดุ
-- อันที่สอง (ค่าเหล็ก · ค่าปูน) ซึ่งการเทียบชื่อทำไม่ได้เลย
--
-- 🔴 ยอดสามก้อนต้องรวมกันได้ `cost_total` เป๊ะ ไม่งั้นแถบสีจะโกหก
-- จึงคืนมาจากฐานข้อมูลแค่ `cost_material` แล้วให้ฝั่งแอปหัก
-- `อื่น ๆ = cost_total − cost_wage − cost_material` เอง — เก็บสองคอลัมน์
-- ที่ต้องตรงกันเองคือการเปิดช่องให้มันไม่ตรงกันวันหนึ่ง

-- ── 1 · ธง "หมวดนี้คือค่าวัสดุ" ──────────────────────────────────────
alter table public.categories
  add column if not exists is_material boolean not null default false;

comment on column public.categories.is_material is
  'true = รายจ่ายในหมวดนี้ถูกนับเป็น "ค่าวัสดุ" ในแถบต้นทุนของโครงการ · เจ้าของติ๊กเองที่ /settings/categories';

-- รายรับไม่มีทางเป็นค่าวัสดุ — กันไม่ให้ติ๊กผิดฝั่งตั้งแต่ในฐานข้อมูล
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'categories_material_expense_only'
  ) then
    alter table public.categories
      add constraint categories_material_expense_only
      check (not is_material or kind = 'expense');
  end if;
end $$;

-- ค่าตั้งต้นของเครื่องที่ติดตั้งใหม่และของเครื่องที่ใช้อยู่ — เติมให้หมวด
-- วัสดุที่ seed สร้างไว้ **เฉพาะตอนที่ยังไม่มีใครติ๊กอะไรเลย** เพื่อไม่ให้
-- migration นี้ไปล้างการตั้งค่าที่เจ้าของทำไว้เอง ถ้าวันหน้ามีคนรันซ้ำ
update public.categories
set    is_material = true
where  kind = 'expense'
  and  name = 'ค่าวัสดุก่อสร้าง'
  and  not exists (select 1 from public.categories where is_material);

-- ── 2 · ตัวเลขเงินของโครงการ ────────────────────────────────────────
-- เพิ่ม `cost_material` และ `attendance_days` · ที่เหลือเหมือนเดิมทุกตัว
-- (ฐานเดิม: 20260831000000_p45_wage_secrecy.sql — ต้นทุนทุกก้อนเป็นของเจ้าของ
--  เท่านั้น คืน null ให้หัวหน้าโครงการ ไม่ใช่ยอดที่ขาดค่าแรงซึ่งเป็นตัวเลขผิด
--  ที่ดูน่าเชื่อถือ)
--
-- `attendance_days` **ไม่ใช่ตัวเลขเงิน** จึงไม่ปิดจากหัวหน้าโครงการ ·
-- `security invoker` + RLS ทำให้เขานับได้เฉพาะโครงการที่ตัวเองดูแลอยู่แล้ว
drop function if exists public.site_money(uuid);

create or replace function public.site_money(p_site uuid default null)
returns table (
  site_id          uuid,
  contract_amount  numeric,
  income_approved  numeric,
  income_pending   numeric,
  cost_expense     numeric,
  cost_wage        numeric,
  cost_material    numeric,  -- ส่วนหนึ่งของ cost_expense ไม่ใช่ยอดที่ต้องบวกเพิ่ม
  cost_total       numeric,
  cost_pending     numeric,
  attendance_days  int       -- กี่ **วัน** ที่มีคนถูกลงชื่อ (ไม่ใช่จำนวนคน-วัน)
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
    case when (select public.is_owner()) then coalesce(m.cost_approved, 0) end,
    case when (select public.is_owner()) then coalesce(w.wage_cost, 0) end,
    case when (select public.is_owner()) then coalesce(m.cost_material, 0) end,
    case when (select public.is_owner())
      then coalesce(m.cost_approved, 0) + coalesce(w.wage_cost, 0) end,
    case when (select public.is_owner()) then coalesce(m.cost_pending, 0) end,
    coalesce(w.work_days, 0)
  from public.sites s
  left join public.site_finance f on f.site_id = s.id
  left join lateral (
    select
      sum(t.amount) filter (where t.kind = 'income'  and t.status = 'approved') as income_approved,
      sum(t.amount) filter (where t.kind = 'income'  and t.status = 'pending')  as income_pending,
      sum(t.amount) filter (where t.kind = 'expense' and t.status = 'approved') as cost_approved,
      sum(t.amount) filter (where t.kind = 'expense' and t.status = 'pending')  as cost_pending,
      -- หมวดถูกลบไม่ได้ (FK เป็น on delete restrict) แต่ `category_id` เป็น null
      -- ได้ · แถวไม่มีหมวดจึงตกไปเป็น "ค่าใช้จ่ายอื่น ๆ" ตามที่ควรเป็น
      sum(t.amount) filter (
        where t.kind = 'expense' and t.status = 'approved' and c.is_material
      ) as cost_material
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    where t.site_id = s.id
  ) m on true
  left join lateral (
    select
      sum(aw.amount)             as wage_cost,
      count(distinct a.work_date) as work_days
    from public.attendance a
    join public.attendance_wages aw on aw.attendance_id = a.id
    where a.site_id = s.id
  ) w on true
  where p_site is null or s.id = p_site
  order by s.id;
$$;

revoke execute on function public.site_money(uuid) from public, anon;
grant execute on function public.site_money(uuid) to authenticated;
