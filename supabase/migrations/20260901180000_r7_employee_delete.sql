-- ════════════════════════════════════════════════════════════════════════
-- R7 · ลบคนงานได้ พร้อมเตือนค่าแรงที่ยังไม่ได้จ่าย
-- ครอบแถว R7-* ใน docs/test-plan/R7-worker-delete.md
-- ════════════════════════════════════════════════════════════════════════
--
-- ที่มา: เจ้าของขอให้หน้าคนงานลบคนได้ และ "ถ้าคนนี้ยังไม่จ่ายค่าแรงตอนกดลบ
-- ให้เตือนและมีข้อมูลบอกให้ด้วย" (1 ก.ย. 2569)
--
-- 🔴 เส้นแบ่งอยู่ที่ **เงินที่จ่ายออกไปแล้ว** ไม่ใช่ที่ "มีประวัติหรือเปล่า"
--    · ยังไม่เคยปิดรอบจ่าย → ลบได้ (พร้อมเตือนยอดค้างจ่ายที่กำลังจะหายไป)
--    · เคยอยู่ในรอบจ่ายที่ปิดแล้ว → **ลบไม่ได้เด็ดขาด** เพราะ `payroll_lines`
--      คือหลักฐานว่าจ่ายเงินไปเท่าไหร่ · ลบคนทิ้งแล้วยอดรวมของรอบที่ปิดไปแล้ว
--      จะอ้างถึงคนที่ไม่มีอยู่ และต้นทุนของงานที่ส่งมอบไปแล้วจะเปลี่ยนย้อนหลัง
--      โดยไม่มี error ที่ไหนเลย · คนกลุ่มนี้ใช้ "ปิดใช้งาน" ซึ่งมีอยู่แล้ว
--
-- ⚠️ `attendance` · `advances` · `payroll_lines` เป็น `on delete restrict` ทั้งสามตัว
--    ฐานข้อมูลจึงกันการลบพลาดไว้อีกชั้นอยู่แล้ว · ฟังก์ชันนี้ลบของที่ลบได้
--    ให้ครบในทรานแซกชันเดียว ไม่ใช่ยิงลบทีละตารางจากฝั่งแอปแล้วค้างกลางทาง

-- ── 1 · ตัวเลขที่ต้องบอกก่อนกดลบ ─────────────────────────────────────
-- 🔴 กล่องยืนยันที่ถามว่า "แน่ใจไหม" โดยไม่บอกว่ากำลังจะเสียอะไร คือปุ่มที่
-- คนกดผ่านโดยไม่อ่าน · หน้าคนงานจึงต้องมีตัวเลขติดมาตั้งแต่ตอนโหลดหน้า
-- ไม่ใช่ไปถามตอนกด (ซึ่งจะได้กล่องที่ค้างรอเน็ตก่อนบอกอะไรได้สักอย่าง)
create or replace function public.employees_delete_info()
returns table (
  employee_id  uuid,
  work_days    numeric,   -- จำนวนวันที่ลงชื่อทั้งหมด (รวมที่จ่ายไปแล้ว)
  unpaid_wage  numeric,   -- ค่าแรงที่ยังไม่ถูกปิดรอบ = ที่จะหายไปถ้าลบ
  open_advance numeric,   -- เบิกล่วงหน้าที่ยังไม่ถูกหัก
  advance_count int,
  payroll_lines int       -- > 0 = ลบไม่ได้ ต้องปิดใช้งานแทน
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id,
    coalesce(d.days, 0),
    -- 🔴 สูตร "ค้างจ่าย" อยู่ที่ `employee_balance()` ที่เดียว — เขียนซ้ำที่นี่
    -- เมื่อไหร่ วันหนึ่งกล่องเตือนจะบอกคนละยอดกับหน้าค่าแรงค้างจ่าย
    b.accrued,
    b.advanced,
    coalesce(a.n, 0),
    coalesce(p.n, 0)
  from public.employees e
  cross join lateral public.employee_balance(e.id) b
  left join lateral (
    select sum(at.work_units) as days
    from public.attendance at where at.employee_id = e.id
  ) d on true
  left join lateral (
    select count(*)::int as n from public.advances ad where ad.employee_id = e.id
  ) a on true
  left join lateral (
    select count(*)::int as n from public.payroll_lines pl where pl.employee_id = e.id
  ) p on true
  where (select public.is_owner());
$$;

revoke execute on function public.employees_delete_info() from public, anon;
grant  execute on function public.employees_delete_info() to authenticated;

-- ── 2 · ลบจริง ───────────────────────────────────────────────────────
create or replace function public.delete_employee(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name    text;
  v_lines   int;
  v_days    numeric;
  v_unpaid  numeric;
  v_adv     numeric;
  v_att     int;
  v_advn    int;
begin
  -- ⚠️ เช็คสิทธิ์ในฟังก์ชัน ไม่ใช่พึ่ง RLS — `security definer` ข้าม RLS ไปแล้ว
  if not public.is_owner() then
    raise exception 'FORBIDDEN: เฉพาะเจ้าของเท่านั้นที่ลบคนงานได้';
  end if;

  select e.full_name into v_name from public.employees e where e.id = p_id;
  if v_name is null then
    raise exception 'NOT_FOUND: ไม่พบคนงานคนนี้';
  end if;

  select count(*) into v_lines from public.payroll_lines pl where pl.employee_id = p_id;
  if v_lines > 0 then
    raise exception 'EMPLOYEE_IN_PAYROLL: คนนี้อยู่ในรอบจ่ายค่าแรงที่ปิดแล้ว % รอบ', v_lines;
  end if;

  -- เก็บตัวเลขก่อนลบ เพื่อบอกเจ้าของว่าเมื่อกี้เอาอะไรออกไปบ้าง
  select coalesce(sum(at.work_units), 0), count(*)
    into v_days, v_att
  from public.attendance at where at.employee_id = p_id;
  select b.accrued into v_unpaid from public.employee_balance(p_id) b;
  select coalesce(sum(ad.amount), 0), count(*)
    into v_adv, v_advn
  from public.advances ad where ad.employee_id = p_id;

  -- ลำดับสำคัญ: ลูกก่อนพ่อแม่ · `attendance_wages` ตามไปเองด้วย cascade
  -- และ `guard_attendance_closed` ยังกันแถวของรอบที่ปิดแล้วไว้อีกชั้น
  delete from public.advances   where employee_id = p_id;
  delete from public.attendance where employee_id = p_id;
  -- `employee_wages` เป็น cascade อยู่แล้ว
  delete from public.employees  where id = p_id;

  return jsonb_build_object(
    'ok', true, 'full_name', v_name,
    'work_days', v_days, 'attendance_rows', v_att,
    'unpaid_wage', v_unpaid, 'advance_amount', v_adv, 'advance_rows', v_advn);
end $$;

revoke execute on function public.delete_employee(uuid) from public, anon;
grant  execute on function public.delete_employee(uuid) to authenticated;
