-- ════════════════════════════════════════════════════════════════════════
-- P1-c · ตัวเลขสรุปของหน้าภาพรวม
-- ครอบแถว P1-UI-09 / P1-UI-10a / P1-DB-13 ใน docs/test-plan/P1.md
-- ════════════════════════════════════════════════════════════════════════

-- 🔴 `security invoker` ไม่ใช่ `security definer`
-- ฟังก์ชันนี้ต้องเห็นเท่าที่ **คนเรียก** เห็น — RLS ของ `sites` จึงยังทำงาน
-- และหัวหน้าไซต์จะได้ตัวเลขของไซต์ตัวเองโดยอัตโนมัติ ไม่ต้องมี if ในโค้ดแอป
-- ถ้าเผลอเขียนเป็น definer ตัวเลขทั้งบริษัทจะหลุดไปหาหัวหน้าไซต์ทันที
-- โดยหน้าจอดูปกติทุกอย่าง
--
-- 🔴 นับในฐานข้อมูล ไม่ใช่ดึงแถวมานับใน JS — PostgREST ตัดที่ 1,000 แถวเงียบ ๆ
-- วันที่ไซต์เกินพันไซต์ ยอดรวมจะน้อยกว่าความจริงโดยไม่มี error
--
-- `p_on` ส่งมาจากแอปเสมอ (`todayInBangkok()`) ไม่ใช่ `current_date`
-- ของเซิร์ฟเวอร์ ซึ่งเป็น UTC และจะเปลี่ยนวันตอนหนึ่งทุ่มของไทย
create or replace function public.site_overview(p_on date)
returns table (
  total_count      int,
  active_count     int,
  active_contract  numeric,
  due_soon_count   int,
  overdue_count    int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*)::int,
    count(*) filter (where s.status = 'active')::int,
    coalesce(sum(s.contract_amount) filter (where s.status = 'active'), 0),
    -- ใกล้ครบกำหนด = ยังไม่เลย และเหลือไม่ถึง 30 วัน
    count(*) filter (
      where s.status = 'active' and s.end_date is not null
        and s.end_date >= p_on and s.end_date < p_on + 30
    )::int,
    count(*) filter (
      where s.status = 'active' and s.end_date is not null and s.end_date < p_on
    )::int
  from public.sites s;
$$;

revoke execute on function public.site_overview(date) from public, anon;
grant execute on function public.site_overview(date) to authenticated;
