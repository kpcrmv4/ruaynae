-- ════════════════════════════════════════════════════════════════════════
-- `report_by_category` รับช่วงวันที่เป็น null ได้ = "ทั้งโครงการ ไม่จำกัดช่วง"
-- (คำสั่งเจ้าของ 4 ก.ย. 2569 — หน้ารายละเอียดโครงการต้องมียอดรวมแยกหมวด)
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 ไม่สร้างฟังก์ชันใหม่ที่ทำเรื่องเดียวกัน — สูตร "ต้นทุนแยกหมวด" ต้องอยู่
-- ที่เดียว ไม่งั้นวันที่มีคนแก้กฎ (เช่นเปลี่ยนนิยามของ approved) จะแก้ที่หนึ่ง
-- แล้วอีกที่เงียบ ๆ ไม่ตาม แล้วสองหน้าจะโชว์ยอดที่ขัดกันเองโดยไม่มี error
--
-- ตัวเรียกเดิม (หน้า /reports) ส่งวันที่มาเสมอ พฤติกรรมจึงไม่เปลี่ยนเลย
-- ที่เพิ่มมาคือ "ส่ง null = ไม่จำกัด" ซึ่งเมื่อก่อนเขียนไม่ได้ นอกจากจะ
-- แต่งช่วงกว้าง ๆ อย่าง 1900–2999 ซึ่งเป็นตัวเลขที่ไม่มีใครอธิบายได้ว่ามาจากไหน

drop function if exists public.report_by_category(date, date, uuid);
create or replace function public.report_by_category(
  p_from date default null,
  p_to date default null,
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
    and (p_from is null or t.txn_date >= p_from)
    and (p_to   is null or t.txn_date <= p_to)
    and (p_site is null or t.site_id = p_site)
  group by c.id, c.name, c.kind

  union all

  -- 🔴 ค่าแรงจากการลงชื่อเป็นแถวของตัวเอง (category_id = null)
  -- ไม่งั้นผลรวมของ "ต้นทุนแยกหมวด" จะน้อยกว่า `cost_total` โดยไม่มีคำอธิบาย
  -- ซึ่งเป็นบั๊กชนิดที่คนเห็นแล้วเลิกเชื่อทั้งหน้า (§17 ข้อ 2)
  select null::uuid, 'ค่าแรงจากการลงชื่อ', 'expense'::public.txn_kind,
         sum(aw.amount), count(*)::int
  from public.attendance a
  join public.attendance_wages aw on aw.attendance_id = a.id
  where (select public.is_owner())
    and (p_from is null or a.work_date >= p_from)
    and (p_to   is null or a.work_date <= p_to)
    and (p_site is null or a.site_id = p_site)
  having sum(aw.amount) > 0

  order by 4 desc;
$$;

revoke execute on function public.report_by_category(date, date, uuid) from public, anon;
grant execute on function public.report_by_category(date, date, uuid) to authenticated;
