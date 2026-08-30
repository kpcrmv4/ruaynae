-- ════════════════════════════════════════════════════════════════════════
-- P2-d2 · ยอดเงินต่อไซต์ และตัวเลขเงินบนหน้าภาพรวม
-- ครอบแถว P2-CALC-01..08 · ปลดล็อก P1-CALC-07 / P1-CALC-08
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 ทั้งสองฟังก์ชันเป็น `security invoker`
-- RLS ของ `transactions` / `sites` / `site_finance` จึงยังทำงานเต็มที่
-- ถ้าเผลอเขียนเป็น `definer` ยอดของทั้งบริษัทจะไหลไปหาหัวหน้าไซต์ทันที
-- โดยหน้าจอดูปกติทุกอย่าง — เคยพลาดมาแล้วกับ `site_overview` (ดู LESSONS.md)
--
-- 🔴 บวกในฐานข้อมูล ไม่ใช่ดึงแถวมาบวกใน JS
-- PostgREST ตัดผลลัพธ์ที่ 1,000 แถวเงียบ ๆ · วันที่ไซต์ใดมีรายการเกินพัน
-- ยอดจะน้อยกว่าความจริงโดยไม่มี error ให้จับเลย
--
-- 🔴 คืน `null` ไม่ใช่ 0 เมื่อคนเรียกไม่มีสิทธิ์เห็นตัวเลข
-- หน้าจอซ่อนการ์ดที่ได้ null ได้ แต่มันจะวาด ฿0 อย่างมั่นใจ แล้วคนอ่านจะเชื่อ
-- "ยังไม่ได้ตั้งค่างาน" (0) กับ "ไม่มีสิทธิ์เห็น" (null) เป็นคนละเรื่องกัน

-- ── ยอดเงินรายไซต์ ───────────────────────────────────────────────────
-- `p_site is null` = ทุกไซต์ที่คนเรียกมองเห็น (ใช้บนหน้าภาพรวม ครั้งเดียว
-- ไม่ใช่ยิงทีละไซต์แบบ N+1)
create or replace function public.site_money(p_site uuid default null)
returns table (
  site_id          uuid,
  contract_amount  numeric,  -- null = ไม่มีสิทธิ์เห็น
  income_approved  numeric,  -- null = ไม่มีสิทธิ์เห็น
  income_pending   numeric,  -- null = ไม่มีสิทธิ์เห็น
  cost_approved    numeric,
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
    coalesce(m.cost_pending, 0)
  from public.sites s
  left join public.site_finance f on f.site_id = s.id
  -- 🔴 `t.site_id = s.id` ตัดรายจ่ายส่วนกลาง (`site_id is null`) ออกโดยอัตโนมัติ
  -- ค่าน้ำมันของเจ้าของไม่ใช่ต้นทุนของบ้านหลังไหน
  left join lateral (
    select
      sum(t.amount) filter (where t.kind = 'income'  and t.status = 'approved') as income_approved,
      sum(t.amount) filter (where t.kind = 'income'  and t.status = 'pending')  as income_pending,
      sum(t.amount) filter (where t.kind = 'expense' and t.status = 'approved') as cost_approved,
      sum(t.amount) filter (where t.kind = 'expense' and t.status = 'pending')  as cost_pending
    from public.transactions t
    where t.site_id = s.id
  ) m on true
  where p_site is null or s.id = p_site
  order by s.id;
$$;

revoke execute on function public.site_money(uuid) from public, anon;
grant execute on function public.site_money(uuid) to authenticated;

-- ── ตัวเลขสรุปหน้าภาพรวม ─────────────────────────────────────────────
-- เพิ่ม 4 คอลัมน์เงินเข้าฟังก์ชันเดิม · เปลี่ยนชนิดที่คืนจึงต้อง drop ก่อน
-- (`create or replace` เปลี่ยน return type ไม่ได้) — ไม่กระทบข้อมูลใด ๆ
drop function if exists public.site_overview(date);

create or replace function public.site_overview(p_on date)
returns table (
  total_count      int,
  active_count     int,
  active_contract  numeric,  -- null = ไม่มีสิทธิ์เห็น
  due_soon_count   int,
  overdue_count    int,
  active_income    numeric,  -- เก็บเงินแล้ว (approved) ของไซต์ที่กำลังก่อสร้าง
  active_cost      numeric,  -- ต้นทุน (approved) ของไซต์ที่กำลังก่อสร้าง
  pending_count    int,      -- รออนุมัติ — เท่าที่คนเรียกมองเห็นตาม RLS
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
    -- ใกล้ครบกำหนด = ยังไม่เลย และเหลือไม่ถึง 30 วัน
    count(*) filter (
      where s.status = 'active' and s.end_date is not null
        and s.end_date >= p_on and s.end_date < p_on + 30
    )::int,
    count(*) filter (
      where s.status = 'active' and s.end_date is not null and s.end_date < p_on
    )::int,
    -- 🔴 นับเฉพาะ `approved` — `pending` มีการ์ดของตัวเองต่างหาก (DESIGN.md §5.3)
    -- ถ้าเอา pending มารวม ตัวเลขจะเปลี่ยนตอนกดอนุมัติทั้งที่ไม่มีเงินเข้าออกจริง
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
    ),
    (select count(*)::int from public.transactions t where t.status = 'pending'),
    (select coalesce(sum(t.amount), 0) from public.transactions t where t.status = 'pending')
  from public.sites s
  left join public.site_finance f on f.site_id = s.id;
$$;

revoke execute on function public.site_overview(date) from public, anon;
grant execute on function public.site_overview(date) to authenticated;
