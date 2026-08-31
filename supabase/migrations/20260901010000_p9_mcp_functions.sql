-- ════════════════════════════════════════════════════════════════════════
-- P9-b · ฟังก์ชันอ่านข้อมูลของตัวเชื่อม MCP
-- ครอบแถว P9-FN-* ใน docs/test-plan/P9.md
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 ปัญหา: RPC เงินทุกตัวของแอปเป็น `security invoker` และห่อคอลัมน์เงินด้วย
-- `case when public.is_owner() then …` ซึ่งอ่าน `auth.uid()`
-- service_role ไม่มี claim `sub` → `auth.uid()` เป็น null → `is_owner()` false
-- → ทุกตัวเลขคืน null · เอา RPC เดิมมาเรียกตรง ๆ จึงได้ค่าว่างทั้งแผง
--
-- 🔴 ทางแก้: `mcp_assume_owner()` ตั้ง `request.jwt.claims` ให้เป็นเจ้าของ
-- **ภายในทรานแซกชันเดียว** (`is_local := true`) แล้วเรียก RPC เดิม
-- → สูตรเงินอยู่ที่เดียว ใครแก้ site_money ฝั่ง MCP เปลี่ยนตามเอง
--
-- ⚠️ ทุกตัวเป็น **volatile** (ไม่ใส่ stable) โดยตั้งใจ — set_config เขียน GUC
-- ถ้าประกาศ stable แล้ววันหนึ่ง planner เลือก inline หรือแคชผลจะพังแบบหาไม่เจอ

-- ── 0 · สวมสิทธิ์เจ้าของชั่วคราว ─────────────────────────────────────
create or replace function public.mcp_assume_owner(p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'MCP_ACTOR_REQUIRED';
  end if;

  -- 🔴 ขอบเขตไซต์ไม่ใช่การเช็ค role และการ "มีคีย์" ก็ไม่ใช่
  -- คีย์ที่ออกโดยคนที่ถูกลดสิทธิ์หรือปิดบัญชีไปแล้ว ต้องใช้ไม่ได้ทันที
  if not exists (
    select 1 from public.profiles
    where id = p_actor and role = 'owner' and is_active
  ) then
    raise exception 'MCP_ACTOR_NOT_OWNER';
  end if;

  -- ⚠️ ต้อง **ผสม** ไม่ใช่เขียนทับ — claims เดิมมี `role` อยู่ ถ้าทับทิ้ง
  -- `auth.role()` จะเปลี่ยนไปด้วยและอะไรที่พึ่งมันจะเพี้ยนแบบเงียบ ๆ
  perform set_config(
    'request.jwt.claims',
    (
      coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      || jsonb_build_object('sub', p_actor::text, 'role', 'authenticated')
    )::text,
    true   -- ผูกกับทรานแซกชัน หมดอายุเองเมื่อจบ
  );
end $$;

revoke execute on function public.mcp_assume_owner(uuid) from public, anon, authenticated;
grant  execute on function public.mcp_assume_owner(uuid) to service_role;

-- ── 1 · ภาพรวมบริษัท ────────────────────────────────────────────────
create or replace function public.mcp_overview(p_actor uuid, p_on date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb;
begin
  perform public.mcp_assume_owner(p_actor);
  -- 🔴 "วันนี้" ต้องเป็นวันนี้ตามเวลาไทย — เซิร์ฟเวอร์รันเป็น UTC
  -- ตอนสามทุ่มครึ่งของไทยจะกลายเป็นพรุ่งนี้ แล้วยอด "วันนี้" เพี้ยนทั้งแผง
  select to_jsonb(o) into v
  from public.site_overview(
    coalesce(p_on, (now() at time zone 'Asia/Bangkok')::date)
  ) o;
  return coalesce(v, '{}'::jsonb);
end $$;

-- ── 2 · รายชื่อไซต์พร้อมตัวเลขเงิน ──────────────────────────────────
create or replace function public.mcp_sites(
  p_actor  uuid,
  p_status text default null,
  p_limit  int  default 20,
  p_offset int  default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  n int := least(greatest(coalesce(p_limit, 20), 1), 100);   -- กันซ้ำอีกชั้น
  o int := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.mcp_assume_owner(p_actor);

  -- ❗ เลือกคอลัมน์เป็นรายชื่อ ห้าม select * — คอลัมน์ที่เพิ่มวันหน้าจะไหลออกเอง
  -- (client_phone กับ address อยู่ในตารางนี้และอยู่ใน blocklist)
  select coalesce(jsonb_agg(to_jsonb(r) order by r.name), '[]'::jsonb) into v
  from (
    select
      s.id, s.name, s.client_name, s.status, s.start_date, s.end_date,
      m.contract_amount, m.income_approved, m.income_pending,
      m.cost_expense, m.cost_wage, m.cost_total, m.cost_pending,
      -- กำไรคงเหลือนับจากต้นทุนที่เกิดขึ้นแล้ว ไม่ใช่เงินที่เก็บได้ (DESIGN.md §5.1)
      (m.contract_amount - m.cost_total) as profit_remaining
    from public.sites s
    join public.site_money(null) m on m.site_id = s.id
    where p_status is null or s.status::text = p_status
    order by s.name
    offset o limit n
  ) r;

  return v;
end $$;

-- ── 3 · ไซต์เดียวแบบละเอียด ─────────────────────────────────────────
create or replace function public.mcp_site_detail(p_actor uuid, p_site uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb;
begin
  perform public.mcp_assume_owner(p_actor);

  select jsonb_build_object(
    'site', (
      select to_jsonb(x) from (
        select s.id, s.name, s.client_name, s.status, s.start_date, s.end_date,
               m.contract_amount, m.income_approved, m.income_pending,
               m.cost_expense, m.cost_wage, m.cost_total, m.cost_pending,
               (m.contract_amount - m.cost_total) as profit_remaining
        from public.sites s
        join public.site_money(p_site) m on m.site_id = s.id
        where s.id = p_site
      ) x
    ),
    -- ⚠️ ไม่มีคีย์ `collected` — `site_milestones` **ไม่มีคอลัมน์ `collected_txn_id`**
    -- ในฐานข้อมูลจริง (CLAUDE.md §5 บอกว่ามี แต่ตารางใน 20260830150000_p1_sites.sql
    -- ไม่เคยมีคอลัมน์นี้ และแอปก็ไม่เคยเขียนอ่านมัน) · ห้ามเดาสูตร "เก็บแล้ว"
    -- จาก installment_no เอาเอง เพราะจะกลายเป็นสูตรที่สองที่ไม่มีใครรู้ว่ามีอยู่
    -- แล้วเพี้ยนจากของแอปวันที่แอปเพิ่มของจริง
    'milestones', coalesce((
      select jsonb_agg(to_jsonb(y) order by y.seq) from (
        select ms.seq, ms.name, ms.planned_amount, ms.planned_date
        from public.site_milestones ms where ms.site_id = p_site
      ) y
    ), '[]'::jsonb),
    'supervisors_today', coalesce((
      select jsonb_agg(p.full_name order by p.full_name)
      from public.site_supervisors ss
      join public.profiles p on p.id = ss.profile_id
      where ss.site_id = p_site
        -- ⚠️ สมาชิกไซต์มีช่วงเวลา — ไม่กรองวันที่จะได้คนที่ย้ายออกไปแล้วด้วย
        and ss.effective_from <= (now() at time zone 'Asia/Bangkok')::date
        and (ss.effective_to is null
             or ss.effective_to >= (now() at time zone 'Asia/Bangkok')::date)
    ), '[]'::jsonb),
    'recent_transactions', coalesce((
      select jsonb_agg(to_jsonb(z) order by z.txn_date desc, z.id desc) from (
        select t.id, t.txn_date, t.kind, t.status, t.amount, t.pay_method,
               t.note, c.name as category
        from public.transactions t
        join public.categories c on c.id = t.category_id
        where t.site_id = p_site
        order by t.txn_date desc, t.id desc
        limit 10
      ) z
    ), '[]'::jsonb)
  ) into v;

  return coalesce(v, '{}'::jsonb);
end $$;

-- ── 4 · ค้นรายรับ-รายจ่าย ────────────────────────────────────────────
create or replace function public.mcp_transactions(
  p_actor  uuid,
  p_from   date default null,
  p_to     date default null,
  p_kind   text default null,
  p_status text default null,
  p_site   uuid default null,
  -- คำค้นมาเป็น **อาร์เรย์ที่แยกคำแล้ว** จากฝั่ง TS (searchTerms)
  -- ส่งสตริงดิบมาไม่ได้ ไม่งั้นต้องมาแยกคำซ้ำอีกที่แล้วสองที่จะเพี้ยนจากกัน
  p_terms  text[] default null,
  p_limit  int  default 30,
  p_offset int  default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  c int;
  n int := least(greatest(coalesce(p_limit, 30), 1), 100);
  o int := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.mcp_assume_owner(p_actor);

  -- นับก่อน แล้วค่อยดึงหน้า — โมเดลต้องรู้ว่ายังมีต่อ ไม่ใช่เดาจากจำนวนแถว
  select count(*) into c
  from public.transactions t
  where (p_from is null or t.txn_date >= p_from)
    and (p_to   is null or t.txn_date <= p_to)
    and (p_kind is null or t.kind::text = p_kind)
    and (p_status is null or t.status::text = p_status)
    and (p_site is null or t.site_id = p_site)
    and (p_terms is null or t.note ilike all (
          select '%' || term || '%' from unnest(p_terms) as term))
  ;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.txn_date desc, r.id desc), '[]'::jsonb)
  into v
  from (
    select
      t.id, t.txn_date, t.kind, t.status, t.amount, t.pay_method,
      t.note, t.rejected_reason, t.income_kind, t.installment_no,
      c2.name as category,
      -- site_id เป็น null = ส่วนกลาง ไม่ใช่ "ยังไม่ได้เลือก" — บอกให้ชัด
      coalesce(s.name, 'ส่วนกลาง') as site_name,
      t.site_id,
      -- ❗ จำนวนสลิปเท่านั้น ห้ามคืน object_key หรือลิงก์ — R2 ไม่มี RLS
      (select count(*) from public.attachments a where a.transaction_id = t.id) as attachment_count
    from public.transactions t
    join public.categories c2 on c2.id = t.category_id
    left join public.sites s on s.id = t.site_id
    where (p_from is null or t.txn_date >= p_from)
      and (p_to   is null or t.txn_date <= p_to)
      and (p_kind is null or t.kind::text = p_kind)
      and (p_status is null or t.status::text = p_status)
      and (p_site is null or t.site_id = p_site)
      and (p_terms is null or t.note ilike all (
            select '%' || term || '%' from unnest(p_terms) as term))
    order by t.txn_date desc, t.id desc
    offset o limit n
  ) r;

  return jsonb_build_object('total_count', c, 'returned', jsonb_array_length(v), 'rows', v);
end $$;

-- ── 5 · คิวรออนุมัติ ────────────────────────────────────────────────
create or replace function public.mcp_pending(p_actor uuid, p_limit int default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  n int := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  perform public.mcp_assume_owner(p_actor);

  select jsonb_build_object(
    'pending_count', (select count(*) from public.transactions where status = 'pending'),
    'pending_total', (select coalesce(sum(amount), 0) from public.transactions where status = 'pending'),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.txn_date, r.id) from (
        select t.id, t.txn_date, t.kind, t.amount, t.note,
               c.name as category, coalesce(s.name, 'ส่วนกลาง') as site_name,
               p.full_name as created_by_name,
               ((now() at time zone 'Asia/Bangkok')::date - t.txn_date) as days_waiting
        from public.transactions t
        join public.categories c on c.id = t.category_id
        left join public.sites s on s.id = t.site_id
        left join public.profiles p on p.id = t.created_by
        where t.status = 'pending'
        order by t.txn_date, t.id
        limit n
      ) r
    ), '[]'::jsonb)
  ) into v;

  return v;
end $$;

-- ── 6 · ค่าแรงค้างจ่ายและรอบจ่าย ────────────────────────────────────
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
               coalesce(s.name, 'ทุกไซต์') as site_name,
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

-- ── 7 · สิทธิ์: service_role เท่านั้น ────────────────────────────────
-- 🔴 authenticated ต้องเรียกไม่ได้ — ไม่งั้นหัวหน้าไซต์ที่ล็อกอินอยู่
-- ยิง RPC ตรงจากเบราว์เซอร์แล้วได้ตัวเลขเงินทั้งบริษัท
do $$
declare f text;
begin
  foreach f in array array[
    'public.mcp_overview(uuid, date)',
    'public.mcp_sites(uuid, text, int, int)',
    'public.mcp_site_detail(uuid, uuid)',
    'public.mcp_transactions(uuid, date, date, text, text, uuid, text[], int, int)',
    'public.mcp_pending(uuid, int)',
    'public.mcp_payroll(uuid, int)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
