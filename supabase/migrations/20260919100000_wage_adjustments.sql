-- ════════════════════════════════════════════════════════════════════════
-- R10 · รายการปรับค่าแรงรายวัน — OT · เบี้ยเลี้ยง · มาสาย · ฯลฯ (คำสั่งเจ้าของ 19 ก.ย. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- เดิมมีช่อง `ot_amount` ช่องเดียว (บวกได้อย่างเดียว) · เจ้าของต้องการ
--   1. ตั้ง "รายการสำเร็จรูป" ไว้ในหน้าตั้งค่า พร้อมยอดเริ่มต้น (OT 100 · เบี้ยเลี้ยง 50 · มาสาย −50)
--   2. ตอนติ๊กคนเข้าโครงการ กด + แล้วเลือกจากรายการนั้น แก้ยอดได้ หรือพิมพ์เองก็ได้
--   3. เลือกได้ว่า **จ่ายเพิ่ม** หรือ **หักออก**
--
-- 🔴 **`attendance_wages.ot_amount` ยังเป็นตัวเลขที่ทุกรายงาน/รอบจ่ายอ่านอยู่** —
--    จึงไม่ยกเลิก แต่เปลี่ยนความหมายเป็น "ยอดสุทธิของรายการปรับ" (บวก − หัก)
--    และให้ **trigger เป็นคนเขียนจากตารางรายละเอียด** ไม่ใช่ให้ใครเขียนตรง
--    · ทุกที่ที่เคย `update attendance_wages set ot_amount = x` (ตารางค่าแรง ·
--      MCP) เปลี่ยนมาเรียก `set_attendance_ot()` ซึ่งแปลง x เป็นรายการ "OT"
--      หนึ่งบรรทัด — ตัวเลขจึงมีที่มาที่เดียวเสมอ
--
-- 🔴 หักได้ → `ot_amount` ติดลบได้ → ต้องถอด `check (ot_amount >= 0)` ออก
--    แต่ **ค่าแรงสุทธิของวันห้ามติดลบ** (หักมากกว่าค่าแรงทั้งวันคือความผิดพลาด
--    ในการกรอก ไม่ใช่กรณีจริง) — ย้าย check ไปคุมที่ยอดรวมแทน
--
-- 🔴 เงินทั้งหมดเป็นของเจ้าของเท่านั้น (P4.5) — ทั้งสองตารางใหม่ owner-only
--    หัวหน้าโครงการไม่เห็นและไม่ตั้งเหมือน OT เดิม

-- ── 1 · ชนิดของรายการปรับ ───────────────────────────────────────────
do $$ begin
  create type public.adjust_kind as enum ('add', 'deduct');
exception when duplicate_object then null; end $$;

-- ── 2 · รายการสำเร็จรูป (ตั้งค่าในหน้าตั้งค่า) ────────────────────────
create table if not exists public.wage_adjustment_presets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 40),
  kind        public.adjust_kind not null default 'add',
  -- ยอดเริ่มต้น — ตอนใช้จริงแก้ได้เป็นครั้ง ๆ · เก็บเป็นบวกเสมอ ทิศทางอยู่ที่ `kind`
  amount      numeric(12,2) not null default 0 check (amount >= 0 and amount <= 999999),
  sort_order  int not null default 100 check (sort_order between 1 and 999),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ชื่อซ้ำในชนิดเดียวกันทำให้กล่องเลือกอ่านไม่รู้เรื่อง · "OT" ฝั่งบวกกับ "OT" ฝั่งหักไม่ควรมี
create unique index if not exists wage_adjustment_presets_name_key
  on public.wage_adjustment_presets (lower(btrim(name)));

alter table public.wage_adjustment_presets enable row level security;

drop policy if exists wage_adjustment_presets_owner_all on public.wage_adjustment_presets;
create policy wage_adjustment_presets_owner_all on public.wage_adjustment_presets
  for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

drop trigger if exists wage_adjustment_presets_set_updated_at on public.wage_adjustment_presets;
create trigger wage_adjustment_presets_set_updated_at
  before update on public.wage_adjustment_presets
  for each row execute function public.set_updated_at();
drop trigger if exists wage_adjustment_presets_audit on public.wage_adjustment_presets;
create trigger wage_adjustment_presets_audit
  after insert or update or delete on public.wage_adjustment_presets
  for each row execute function public.audit_row();

-- ค่าตั้งต้นของเครื่องใหม่ — เติม**เฉพาะตอนที่ยังว่าง** เจ้าของแก้/ปิดได้จากหน้าตั้งค่า
insert into public.wage_adjustment_presets (name, kind, amount, sort_order)
select v.name, v.kind::public.adjust_kind, v.amount, v.sort_order
from (values
  ('OT',         'add',    100, 10),
  ('เบี้ยเลี้ยง', 'add',     50, 20),
  ('มาสาย',      'deduct',  50, 30)
) as v(name, kind, amount, sort_order)
where not exists (select 1 from public.wage_adjustment_presets);

-- ── 3 · รายการปรับที่ผูกกับการลงชื่อแต่ละครั้ง ────────────────────────
create table if not exists public.attendance_adjustments (
  id            uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.attendance(id) on delete cascade,
  -- ที่มา (ถ้าเลือกจากรายการสำเร็จรูป) · ลบ preset แล้วบรรทัดยังอยู่ เพราะเป็นประวัติเงิน
  preset_id     uuid references public.wage_adjustment_presets(id) on delete set null,
  -- ชื่อถูกถ่ายสำเนามาเก็บ — เปลี่ยนชื่อ preset ทีหลังต้องไม่เปลี่ยนประวัติ
  name          text not null check (length(btrim(name)) between 1 and 40),
  kind          public.adjust_kind not null default 'add',
  amount        numeric(12,2) not null check (amount > 0 and amount <= 999999),
  created_at    timestamptz not null default now()
);

create index if not exists attendance_adjustments_att_idx
  on public.attendance_adjustments(attendance_id);
-- FK ทุกตัวต้องมี index (advisor unindexed_foreign_keys) — ลบ preset แล้ว set null ต้องไล่หาแถวได้เร็ว
create index if not exists attendance_adjustments_preset_idx
  on public.attendance_adjustments(preset_id) where preset_id is not null;

alter table public.attendance_adjustments enable row level security;

drop policy if exists attendance_adjustments_owner_all on public.attendance_adjustments;
create policy attendance_adjustments_owner_all on public.attendance_adjustments
  for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

drop trigger if exists attendance_adjustments_audit on public.attendance_adjustments;
create trigger attendance_adjustments_audit
  after insert or update or delete on public.attendance_adjustments
  for each row execute function public.audit_row();

-- ── 4 · ยอดสุทธิของวันห้ามติดลบ (แทน check เดิมที่ห้าม OT ติดลบ) ─────────
do $$
declare c record;
begin
  -- check เดิมถูกตั้งชื่อให้อัตโนมัติ — หาจากนิยาม ไม่เดาชื่อ
  -- 🔴 pg_get_constraintdef พิมพ์เป็น "(ot_amount >= (0)::numeric)" ไม่ใช่ "ot_amount >= 0"
  --    pattern แรกที่ใช้ ilike '%ot_amount >= 0%' จึงไม่เจอและ check เดิมรอดมาได้เงียบ ๆ
  --    (เจอตอนตรวจ R10-DB-07 บนฐานจริง 19 ก.ย. 2569) · ใช้ regex ที่ยอมรับวงเล็บแทน
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public' and rel.relname = 'attendance_wages'
      and con.contype = 'c'
      and con.conname <> 'attendance_wages_amount_nonneg'
      and pg_get_constraintdef(con.oid) ~ 'ot_amount >= \(?0'
  loop
    execute format('alter table public.attendance_wages drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.attendance_wages drop constraint if exists attendance_wages_amount_nonneg;
alter table public.attendance_wages add constraint attendance_wages_amount_nonneg
  check (work_units * wage_snapshot + ot_amount >= 0);

-- ── 5 · trigger: รายละเอียด → ยอดสุทธิใน attendance_wages ────────────────
-- 🔴 ทิศทางเดียวเสมอ: แก้บรรทัด → ยอดสุทธิถูกคำนวณใหม่ · ไม่มีใครเขียน `ot_amount` ตรง
create or replace function public.sync_attendance_ot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_att uuid := coalesce(new.attendance_id, old.attendance_id);
  v_net numeric;
begin
  select coalesce(sum(case when aa.kind = 'add' then aa.amount else -aa.amount end), 0)
    into v_net
  from public.attendance_adjustments aa
  where aa.attendance_id = v_att;

  update public.attendance_wages
     set ot_amount = v_net
   where attendance_id = v_att
     and ot_amount is distinct from v_net;

  return null;
end $$;

revoke execute on function public.sync_attendance_ot() from public, anon, authenticated;

drop trigger if exists attendance_adjustments_sync on public.attendance_adjustments;
create trigger attendance_adjustments_sync
  after insert or update or delete on public.attendance_adjustments
  for each row execute function public.sync_attendance_ot();

-- ── 6 · guard: วันที่จ่ายเงินไปแล้วแก้ไม่ได้ ────────────────────────────
-- กติกาเดียวกับ `attendance_wages` (guard_attendance_wage_closed) — ใช้
-- `attendance_paid()` ตัวเดียวกัน ไม่เขียนสูตรซ้ำ
create or replace function public.guard_attendance_adjustment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_att public.attendance%rowtype;
begin
  select * into v_att from public.attendance a
   where a.id = coalesce(new.attendance_id, old.attendance_id);
  if not found then
    -- แถว attendance ถูกลบ → cascade กำลังลบบรรทัดนี้อยู่ ปล่อยผ่าน
    return coalesce(new, old);
  end if;
  if public.attendance_paid(v_att.employee_id, v_att.work_date, v_att.site_id) then
    raise exception 'PAYROLL_CLOSED: วันนี้ถูกจ่ายไปแล้ว แก้รายการปรับค่าแรงไม่ได้';
  end if;
  if tg_op = 'UPDATE' and new.attendance_id <> old.attendance_id then
    raise exception 'ADJUSTMENT_MOVE: ย้ายรายการปรับไปวันอื่นไม่ได้ ให้ลบแล้วสร้างใหม่';
  end if;
  -- ⚠️ ห้ามใช้ `new is not null` — กับ composite มันแปลว่า "ทุกคอลัมน์ไม่ null"
  -- ซึ่งเป็นเท็จทันทีที่ preset_id ว่าง · ต้องดูจากชนิดของเหตุการณ์แทน
  if tg_op <> 'DELETE' then
    new.name := btrim(new.name);
    return new;
  end if;
  return old;
end $$;

revoke execute on function public.guard_attendance_adjustment() from public, anon, authenticated;

drop trigger if exists attendance_adjustments_guard on public.attendance_adjustments;
create trigger attendance_adjustments_guard
  before insert or update or delete on public.attendance_adjustments
  for each row execute function public.guard_attendance_adjustment();

-- ── 7 · ตัวแปลง "OT ตัวเลขเดียว" → รายการหนึ่งบรรทัด ─────────────────────
-- ให้ตารางค่าแรง (`save_attendance_day`) และ MCP ที่ยังคิดเป็น OT ตัวเดียว
-- เขียนผ่านทางนี้ · ยอดเท่าเดิม = ไม่แตะ (รักษารายละเอียดที่เจ้าของเคยแยกไว้)
-- 🔴 revoke จากทุก role — เรียกได้จากฟังก์ชัน definer ตัวอื่นเท่านั้น
create or replace function public.set_attendance_ot(p_att uuid, p_ot numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cur numeric;
  v_ot  numeric := coalesce(p_ot, 0);
begin
  select coalesce(aw.ot_amount, 0) into v_cur
  from public.attendance_wages aw where aw.attendance_id = p_att;
  if v_cur = v_ot then
    return;
  end if;

  delete from public.attendance_adjustments where attendance_id = p_att;
  if v_ot > 0 then
    insert into public.attendance_adjustments (attendance_id, name, kind, amount)
    values (p_att, 'OT', 'add', v_ot);
  elsif v_ot < 0 then
    insert into public.attendance_adjustments (attendance_id, name, kind, amount)
    values (p_att, 'หัก', 'deduct', -v_ot);
  end if;
  -- trigger sync เขียน ot_amount ให้แล้ว · กรณีลบจนว่าง sync ก็เขียน 0 ให้เช่นกัน
end $$;

revoke execute on function public.set_attendance_ot(uuid, numeric) from public, anon, authenticated;

-- ── 8 · ตารางค่าแรง: OT ที่เจ้าของกรอกในช่อง → ผ่านตัวแปลง ───────────────
-- เนื้อหาเดิมทั้งหมดจาก r3b_report_invoker · เปลี่ยนสองอย่าง:
--   · บรรทัด ot_amount → `set_attendance_ot()`
--   · `p_ot` ค่าเริ่มต้นเป็น **null = ไม่แตะรายการปรับ** (เดิม 0) — กล่องแก้ค่าแรง
--     ในแท็บ "ทำงานที่ไหนบ้าง" แก้เฉพาะฐาน ต้องไม่ล้าง OT/เบี้ยเลี้ยงที่ตั้งไว้เงียบ ๆ
--     · ตารางการทำงานส่งตัวเลขมาเสมอเหมือนเดิม จึงไม่กระทบ
-- drop ก่อนเพราะ create or replace เปลี่ยนค่าเริ่มต้นของพารามิเตอร์ไม่ได้
drop function if exists public.save_attendance_day(uuid, uuid, date, numeric, numeric, numeric);
create or replace function public.save_attendance_day(
  p_employee   uuid,
  p_site       uuid,
  p_date       date,
  p_work_units numeric,
  p_wage       numeric,
  p_ot         numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if not (select public.is_owner()) then
    raise exception 'FORBIDDEN: เฉพาะเจ้าของเท่านั้นที่แก้ตารางค่าแรงได้';
  end if;

  if p_date > v_today then
    raise exception 'DATE_FUTURE: ลงชื่อล่วงหน้าไม่ได้ — ค่าแรงของวันที่ยังไม่มาถึงคือต้นทุนที่ยังไม่เกิด';
  end if;
  if p_work_units is null or p_work_units not in (0.5, 1) then
    raise exception 'WORK_UNITS_INVALID: ลงได้เฉพาะเต็มวันหรือครึ่งวัน';
  end if;
  -- OT ในตารางค่าแรงยังเป็นช่องบวกอย่างเดียว · การหักทำจากหน้าคนเข้าโครงการ
  if p_wage is null or p_wage < 0 or coalesce(p_ot, 0) < 0 then
    raise exception 'AMOUNT_INVALID: ค่าแรงติดลบไม่ได้';
  end if;
  if public.attendance_paid(p_employee, p_date, p_site) then
    raise exception 'PAYROLL_CLOSED: วันนี้ถูกจ่ายไปแล้ว แก้ไม่ได้';
  end if;

  delete from public.attendance a
   where a.employee_id = p_employee
     and a.work_date = p_date
     and a.site_id is distinct from p_site;

  insert into public.attendance (employee_id, site_id, work_date, work_units)
  values (p_employee, p_site, p_date, p_work_units)
  on conflict (employee_id, work_date, site_id)
    do update set work_units = excluded.work_units
  returning id into v_id;

  update public.attendance_wages
     set wage_snapshot = p_wage,
         work_units = p_work_units
   where attendance_id = v_id;

  -- null = ไม่แตะรายการปรับ · ยอดเท่าเดิม = ไม่แตะ · เปลี่ยน = แทนที่ด้วยบรรทัด OT บรรทัดเดียว
  if p_ot is not null then
    perform public.set_attendance_ot(v_id, p_ot);
  end if;

  return v_id;
end $$;

revoke execute on function public.save_attendance_day(uuid, uuid, date, numeric, numeric, numeric)
  from public, anon;
grant execute on function public.save_attendance_day(uuid, uuid, date, numeric, numeric, numeric)
  to authenticated;

-- ── 9 · MCP: ลงชื่อพร้อม OT → ผ่านตัวแปลงเช่นกัน ─────────────────────────
-- เนื้อหาเดิมทั้งหมดจาก r6_mcp_write §5 · เปลี่ยนเฉพาะบรรทัด ot_amount
create or replace function public.mcp_record_attendance(
  p_actor   uuid,
  p_key     uuid,
  p_site    uuid,
  p_date    date,
  p_entries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        record;
  v_att    uuid;
  v_name   text;
  v_units  numeric;
  v_ot     numeric;
  v_ok     jsonb := '[]'::jsonb;
  v_skip   jsonb := '[]'::jsonb;
  v_today  date := (now() at time zone 'Asia/Bangkok')::date;
  v_count  int;
begin
  perform public.mcp_begin_write(p_actor, p_key);

  if not exists (select 1 from public.sites s where s.id = p_site) then
    raise exception 'SITE_NOT_FOUND: ไม่พบไซต์นี้';
  end if;
  if p_date > v_today then
    raise exception 'DATE_FUTURE: ลงชื่อล่วงหน้าไม่ได้';
  end if;

  select count(*) into v_count from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb));
  if v_count = 0 then
    raise exception 'ENTRIES_REQUIRED: ต้องระบุอย่างน้อยหนึ่งคน';
  end if;

  for r in
    select * from jsonb_to_recordset(p_entries)
      as x(employee_id uuid, work_units numeric, ot_amount numeric)
  loop
    v_units := coalesce(r.work_units, 1);
    v_ot    := coalesce(r.ot_amount, 0);
    select e.full_name into v_name from public.employees e where e.id = r.employee_id;

    begin
      insert into public.attendance (site_id, employee_id, work_date, work_units, mcp_key_id)
      values (p_site, r.employee_id, p_date, v_units, p_key)
      returning id into v_att;

      -- ยอดเงินอยู่คนละตาราง และ trigger สร้างแถวให้แล้ว — OT เป็นรายการปรับหนึ่งบรรทัด
      if v_ot > 0 then
        perform public.set_attendance_ot(v_att, v_ot);
      end if;

      v_ok := v_ok || jsonb_build_object(
        'employee_id', r.employee_id, 'full_name', v_name,
        'attendance_id', v_att, 'work_units', v_units, 'ot_amount', v_ot);

    exception
      when unique_violation then
        v_skip := v_skip || jsonb_build_object(
          'employee_id', r.employee_id, 'full_name', v_name, 'reason', 'ALREADY_SIGNED_IN');
      when others then
        v_skip := v_skip || jsonb_build_object(
          'employee_id', r.employee_id, 'full_name', v_name,
          'reason', split_part(sqlerrm, ':', 1),
          'detail', btrim(substr(sqlerrm, strpos(sqlerrm, ':') + 1)));
    end;
  end loop;

  return jsonb_build_object(
    'ok', true, 'site_id', p_site, 'work_date', p_date,
    'recorded', v_ok, 'skipped', v_skip);
end $$;

-- ── 10 · ย้ายของเดิม: OT ที่เคยกรอกไว้ → บรรทัด "OT" ให้ครบ ───────────────
-- ไม่งั้นเปิดกล่องปรับค่าแรงของวันเก่าจะว่างเปล่า ทั้งที่ยอดสุทธิบอกว่ามี OT อยู่
-- · idempotent: เติมเฉพาะแถวที่ยังไม่มีบรรทัดใด ๆ · ข้ามวันที่จ่ายแล้ว (guard ปฏิเสธ)
insert into public.attendance_adjustments (attendance_id, name, kind, amount)
select aw.attendance_id, 'OT', 'add', aw.ot_amount
from public.attendance_wages aw
join public.attendance a on a.id = aw.attendance_id
where aw.ot_amount > 0
  and not exists (select 1 from public.attendance_adjustments x where x.attendance_id = aw.attendance_id)
  and not public.attendance_paid(a.employee_id, a.work_date, a.site_id);
