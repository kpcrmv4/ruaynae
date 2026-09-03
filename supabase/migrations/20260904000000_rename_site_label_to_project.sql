-- ═══════════════════════════════════════════════════════════════════
-- เปลี่ยนคำเรียกหน่วยงานจาก "ไซต์ / ไซต์งาน" → "โครงการ" (คำสั่งเจ้าของ 4 ก.ย. 2569)
--
-- ทั้งระบบเปลี่ยนที่ชั้นแสดงผล ตัวระบุในฐานข้อมูลไม่ถูกแตะเลย — ตาราง `sites`
-- คอลัมน์ `site_id` และชื่อฟังก์ชัน `report_by_site` ยังเหมือนเดิมทุกตัว
-- เพราะการเปลี่ยนชื่อเหล่านั้นคือการเขียนแอปใหม่ทั้งใบเพื่อเปลี่ยนคำบนจอคำเดียว
--
-- ที่ต้องแก้ในฐานข้อมูลมีแค่ **ข้อความที่ถูกส่งกลับไปเป็นข้อมูล** สองจุด —
-- ข้อความพวกนี้ไปโผล่บนหน้าจอตรง ๆ ถ้าไม่แก้ที่นี่ หน้ารายงานจะยังเขียนว่า
-- "ไซต์" อยู่ ทั้งที่ทั้งแอปเปลี่ยนไปแล้ว · ส่วนข้อความใน `raise exception`
-- ไม่ต้องแก้ เพราะแอปอ่านแค่รหัสหน้าบรรทัด (SITE_REQUIRED ฯลฯ) แล้วเลือก
-- ประโยคไทยของตัวเองมาแสดง — ข้อความในฐานข้อมูลไม่เคยถึงตาผู้ใช้
-- ═══════════════════════════════════════════════════════════════════

-- ── 1 · หน้ารายงาน → ตาราง "แยกตามโครงการ" ──────────────────────────
-- แถวสุดท้ายของตารางคือรายการที่ไม่ผูกโครงการไหน · ป้ายของแถวนี้มาจาก
-- ฐานข้อมูล ไม่ใช่จากหน้าจอ (หน้าจอวาด site_name ที่ได้มาตรง ๆ)
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
    'ส่วนกลาง (ไม่ผูกโครงการ)',
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

-- ── 2 · ตัวเชื่อม MCP → รอบจ่ายค่าแรงที่ไม่ได้ผูกโครงการไหน ─────────────
-- เจ้าของอ่านผลลัพธ์นี้ผ่าน Claude ตรง ๆ จึงต้องใช้คำเดียวกับที่เห็นในแอป
create or replace function public.mcp_payroll(p_actor uuid, p_limit int default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  n int := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  perform public.mcp_assume_owner(p_actor);

  select jsonb_build_object(
    -- payroll_balances() เป็น security definer ที่เช็ค is_owner() ข้างใน
    -- จึงต้องสวมสิทธิ์ก่อน (ทำไปแล้วข้างบน) ไม่งั้นได้ 0 แถวโดยไม่มี error
    'balances', coalesce((
      select jsonb_agg(to_jsonb(b) order by b.full_name)
      from public.payroll_balances() b
    ), '[]'::jsonb),
    'runs', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.period_start desc) from (
        select pr.id, pr.period_start, pr.period_end, pr.status,
               coalesce(s.name, 'ทุกโครงการ') as site_name,
               pr.total_accrued, pr.total_advance_deducted, pr.total_paid
        from public.payroll_runs pr
        left join public.sites s on s.id = pr.site_id
        order by pr.period_start desc
        limit n
      ) r
    ), '[]'::jsonb)
  ) into v;

  return v;
end $$;

-- 🔴 สิทธิ์ต้องตั้งใหม่ทุกครั้งที่ `create or replace` — ค่าเดิมไม่ติดมาเอง
-- ถ้าลืม หัวหน้าโครงการที่ล็อกอินอยู่ยิง RPC ตรงจากเบราว์เซอร์แล้วได้ตัวเลข
-- เงินทั้งบริษัท (เหตุผลเดียวกับตอนสร้างใน 20260901010000_p9_mcp_functions.sql)
revoke execute on function public.mcp_payroll(uuid, int) from public, anon, authenticated;
grant execute on function public.mcp_payroll(uuid, int) to service_role;
