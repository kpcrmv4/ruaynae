-- ยอดค่าแรงค้างจ่ายรวมทั้งบริษัท — แถวเดียว (คำสั่งเจ้าของ 21 ก.ย. 2569)
--
-- หน้า `/ledger` ต้องแสดง "ค่าแรงค้างจ่ายรวม" ไว้ที่ส่วนหัว · ตัวเลขนี้มีอยู่แล้ว
-- ใน `payroll_balances()` แต่เป็น **รายคน** — ถ้าหน้ารายการดึงมาทั้งชุดแล้วบวกใน
-- JavaScript มันจะผิดกฎ §7 (ห้ามดึงแถวมานับ/บวกเอง) และจะพังเงียบ ๆ วันที่
-- คนงานเกิน 1,000 คน เพราะ PostgREST ตัดผลลัพธ์ทิ้งโดยไม่มี error
--
-- 🔴 **ไม่ใช่ SECURITY DEFINER** โดยตั้งใจ — `payroll_balances()` เป็น definer และ
-- มี `where is_owner()` อยู่ข้างในแล้ว · ใส่ definer ซ้ำอีกชั้นคือการสร้างประตู
-- บานที่สองที่ต้องจำไปตรวจทุกครั้งที่กฎเปลี่ยน · หัวหน้าโครงการเรียกได้ แต่ได้
-- ศูนย์ทุกช่อง — หน้าจอจึงต้อง **ไม่วาดการ์ดนี้ให้เขาเลย** ไม่ใช่วาดเลขศูนย์
-- (ศูนย์ที่แปลว่า "ไม่มีสิทธิ์เห็น" กับศูนย์ที่แปลว่า "ไม่มีของค้าง" ห้ามปนกัน)

create or replace function public.payroll_outstanding()
returns table (
  people   int,
  accrued  numeric,
  advanced numeric,
  balance  numeric
)
language sql
stable
set search_path = ''
as $$
  select
    count(*)::int,
    coalesce(sum(b.accrued), 0),
    coalesce(sum(b.advanced), 0),
    coalesce(sum(b.accrued), 0) - coalesce(sum(b.advanced), 0)
  from public.payroll_balances() b
$$;

revoke execute on function public.payroll_outstanding() from public, anon;
grant execute on function public.payroll_outstanding() to authenticated;
