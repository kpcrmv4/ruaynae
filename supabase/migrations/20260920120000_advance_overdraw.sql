-- ════════════════════════════════════════════════════════════════════════
-- เบิกเกินค่าแรงค้างจ่ายได้ + ยกยอดส่วนที่หักไม่ครบไปรอบหน้า
-- (คำสั่งเจ้าของ 20 ก.ย. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- เจ้าของสั่ง: *"อยากให้เบิกเกินได้ด้วยครับ ตอนนี้คนงานเบิกเกินไม่ได้
-- ถ้าเบิกเกินอาจจะมีความเตือนว่าคนนี้เบิกเกินแล้ว"*
--
-- เพดานเดิม (`ADVANCE_OVER_CEILING`) เป็น **ด่านที่ปฏิเสธ** — เบิกเกินไม่ได้เลย
-- ของจริงคือคนงานขอล่วงหน้าเกินค่าแรงที่ทำไปแล้วเป็นเรื่องปกติ และเจ้าของ
-- เป็นคนตัดสินใจเอง ไม่ใช่ฐานข้อมูล · เพดานจึงกลายเป็น **ตัวเลขที่เอาไปเตือน**
-- ไม่ใช่ตัวที่ห้าม
--
-- 🔴 แต่การเปิดให้เบิกเกินเปิดรูที่เงียบมากรูหนึ่งพร้อมกัน:
-- `close_payroll_run()` เดิมตัดใบเบิก **ทุกใบ** ว่า "หักแล้ว" ตอนจ่ายค่าแรง
-- (`update advances set payroll_run_id = p_run where payroll_run_id is null`)
-- ทั้งที่ยอดที่หักได้จริงถูกตัดด้วย `least(accrued, total)` มาก่อนแล้ว
-- · ตราบใดที่เบิกเกินไม่ได้ สองยอดนี้เท่ากันเสมอ รูนี้จึงไม่เคยเปิด
-- · วินาทีที่เบิกเกินได้ ส่วนที่หักไม่ครบจะถูกตีตราว่าหักแล้วทั้งที่ยังไม่เคย
--   ถูกหัก = บริษัทเสียเงินก้อนนั้นถาวร โดยไม่มี error ที่ไหนเลย
-- → คอลัมน์ `deducted_amount` เก็บว่าใบนั้นถูกหักไปแล้วเท่าไหร่ และ
--   `payroll_run_id` ถูกตั้งก็ต่อเมื่อหัก **ครบทั้งใบ** แล้วเท่านั้น

-- ── 1 · ใบเบิกหักได้บางส่วน ─────────────────────────────────────────
alter table public.advances
  add column if not exists deducted_amount numeric(12,2) not null default 0;

alter table public.advances drop constraint if exists advances_deducted_range;
alter table public.advances add constraint advances_deducted_range
  check (deducted_amount >= 0 and deducted_amount <= amount);

comment on column public.advances.deducted_amount is
  'หักคืนจากค่าแรงไปแล้วเท่าไหร่ · เท่ากับ amount = หักครบ (payroll_run_id จะถูกตั้งพร้อมกัน) · มากกว่า 0 แต่ไม่ครบ = หักบางส่วน ยอดที่เหลือค้างไปรอบหน้า';

-- ใบเก่าที่ถูกผูกกับรอบไปแล้ว = หักครบทั้งใบ (สมัยที่เบิกเกินไม่ได้ ยอดหักเท่ากับยอดใบเสมอ)
update public.advances
   set deducted_amount = amount
 where payroll_run_id is not null and deducted_amount = 0;

-- ── 2 · ยอดค้างเบิกนับเฉพาะส่วนที่ยังไม่ถูกหัก ───────────────────────
-- 🔴 `balance` **ติดลบได้แล้ว** = เบิกเกินค่าแรงที่ทำไปแล้ว · หน้าจอเอาไปเตือน
create or replace function public.employee_balance(p_employee uuid)
returns table (accrued numeric, advanced numeric, balance numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(acc.total, 0),
    coalesce(adv.total, 0),
    coalesce(acc.total, 0) - coalesce(adv.total, 0)
  from (
    select sum(aw.amount) as total
    from public.attendance a
    join public.attendance_wages aw on aw.attendance_id = a.id
    where a.employee_id = p_employee
      and not exists (
        select 1
        from public.payroll_lines pl
        join public.payroll_runs pr on pr.id = pl.run_id
        where pl.employee_id = a.employee_id
          and pr.status = 'closed'
          and a.work_date between pr.period_start and pr.period_end
          and (pr.site_id is null or pr.site_id = a.site_id)
      )
  ) acc
  cross join (
    -- เดิม: sum(amount) · ตอนนี้ใบหนึ่งใบถูกหักบางส่วนได้ จึงนับเฉพาะส่วนที่ยังค้าง
    select sum(ad.amount - ad.deducted_amount) as total
    from public.advances ad
    where ad.employee_id = p_employee and ad.payroll_run_id is null
  ) adv;
$$;

revoke execute on function public.employee_balance(uuid) from public, anon;
grant execute on function public.employee_balance(uuid) to authenticated;

-- ⚠️ ตัวจริงที่รันอยู่คือฉบับ R3 (`20260901140000_r3_attendance_grid.sql`) ซึ่ง
-- **มีคอลัมน์ `days`** และใช้ `attendance_paid()` แทน NOT EXISTS แบบเดิม
-- · ฉบับใน `20260831020000_p5_balances.sql` ล้าไปแล้ว — คัดลอกจากไฟล์นั้นมาแก้เมื่อไหร่
--   จะได้ `cannot change return type of existing function` (ถ้าโชคดี) หรือ
--   `days` หายไปเงียบ ๆ จนหน้า /payroll โชว์ "0 วัน" ทุกคน (ถ้าโชคร้ายกว่า)
-- → ที่นี่แก้ **เฉพาะ lateral ของ advances** บรรทัดเดียว ที่เหลือคงไว้ตามตัวจริง
create or replace function public.payroll_balances()
returns table (
  employee_id uuid,
  full_name   text,
  job_title   text,
  days        numeric,
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
    coalesce(acc.total, 0),
    coalesce(adv.total, 0),
    coalesce(acc.total, 0) - coalesce(adv.total, 0)
  from public.employees e
  left join lateral (
    select sum(a.work_units) as days, sum(aw.amount) as total
    from public.attendance a
    join public.attendance_wages aw on aw.attendance_id = a.id
    where a.employee_id = e.id
      and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
  ) acc on true
  left join lateral (
    -- เดิม: sum(ad.amount) · ตอนนี้ใบหนึ่งใบถูกหักบางส่วนได้
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

-- ── 3 · guard: เลิกห้ามเบิกเกิน แต่ล็อกใบที่ถูกหักไปแล้ว ─────────────
-- 🔴 สิ่งที่ยังต้องล็อกคือ **ใบที่เงินถูกหักคืนไปแล้ว** ไม่ว่าจะครบใบหรือบางส่วน
-- — แก้ยอดย้อนหลังเมื่อไหร่ ยอดที่จ่ายจริงกับยอดที่ระบบคำนวณจะไม่ตรงกันตลอดไป
create or replace function public.guard_advance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 🔴 ลงย้อนหลังได้ (คำสั่งเจ้าของ 20 ก.ย. 2569) แต่ลงวันในอนาคตไม่ได้
  -- · เดิมกฎนี้อยู่ใน route กับ `mcp_create_advance` เท่านั้น — พอวันที่กลายเป็น
  --   ค่าที่ผู้ใช้เลือกเอง กฎที่ไม่ได้บังคับที่ฐานข้อมูลคือกฎที่หายไปทันที
  --   ที่มีใครเขียนผ่านทางอื่น (สคริปต์ · SQL ตรง · client ที่ลืมเช็ค)
  if new.advance_date > (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'DATE_FUTURE: บันทึกเบิกของวันในอนาคตไม่ได้';
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    -- ไม่มีเพดานแล้ว — เบิกเกินค่าแรงค้างจ่ายได้ หน้าจอเป็นคนเตือน
    return new;
  end if;

  new.created_by := old.created_by;

  if new.amount is distinct from old.amount
     and (old.payroll_run_id is not null or old.deducted_amount > 0) then
    raise exception 'PAYROLL_CLOSED: ใบเบิกนี้ถูกหักตอนจ่ายค่าแรงไปแล้ว แก้ยอดไม่ได้';
  end if;

  -- ตาข่ายรองของ check constraint — ข้อความไทยที่ route ส่งต่อได้
  if new.deducted_amount > new.amount then
    raise exception 'ADVANCE_DEDUCTED_EXCEEDS: ยอดที่หักคืนแล้วมากกว่ายอดในใบเบิก';
  end if;

  return new;
end $$;

drop trigger if exists advances_guard on public.advances;
create trigger advances_guard before insert or update on public.advances
  for each row execute function public.guard_advance();

revoke execute on function public.guard_advance() from public, anon, authenticated;

-- 🔴 เดิมกฎ "ใบที่ถูกหักแล้วลบไม่ได้" อยู่ใน route เท่านั้น — กฎที่ไม่มีตัวบังคับ
-- ที่ฐานข้อมูลคือกฎที่หายไปทันทีที่มีคนเรียกอีกทาง (MCP · SQL · สคริปต์)
create or replace function public.guard_advance_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.payroll_run_id is not null or old.deducted_amount > 0 then
    raise exception 'PAYROLL_CLOSED: ใบเบิกนี้ถูกหักตอนจ่ายค่าแรงไปแล้ว ลบไม่ได้';
  end if;
  return old;
end $$;

drop trigger if exists advances_guard_delete on public.advances;
create trigger advances_guard_delete before delete on public.advances
  for each row execute function public.guard_advance_delete();

revoke execute on function public.guard_advance_delete() from public, anon, authenticated;

-- ── 4 · ปิดรอบ: หักเท่าที่ค่าแรงรับไหว ที่เหลือค้างไปรอบหน้า ──────────
create or replace function public.close_payroll_run(p_run uuid)
returns table (lines int, accrued numeric, deducted numeric, paid numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.payroll_runs%rowtype;
  v_n   int;
begin
  if not (select public.is_owner()) then
    raise exception 'FORBIDDEN: เฉพาะเจ้าของเท่านั้นที่ปิดรอบจ่ายได้';
  end if;

  select * into v_run from public.payroll_runs r where r.id = p_run for update;
  if not found then
    raise exception 'NOT_FOUND: ไม่พบรอบจ่ายนี้';
  end if;
  if v_run.status = 'closed' then
    raise exception 'ALREADY_CLOSED: รอบนี้ปิดไปแล้ว';
  end if;

  create temporary table _acc on commit drop as
  select
    a.employee_id,
    sum(a.work_units)  as days,
    sum(aw.amount)     as accrued
  from public.attendance a
  join public.attendance_wages aw on aw.attendance_id = a.id
  where a.work_date between v_run.period_start and v_run.period_end
    and (v_run.site_id is null or a.site_id = v_run.site_id)
    and (v_run.employee_id is null or a.employee_id = v_run.employee_id)
    and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
  group by a.employee_id
  having sum(aw.amount) > 0;

  select count(*) into v_n from _acc;
  if v_n = 0 then
    raise exception 'NOTHING_TO_PAY: ไม่มีค่าแรงค้างจ่ายในช่วงนี้';
  end if;

  -- หักเบิกได้มากสุดเท่าค่าแรงของงวดนี้ — จ่ายจริงจึงไม่ติดลบ
  insert into public.payroll_lines (run_id, employee_id, days, accrued, advance_deducted, net_paid)
  select
    p_run,
    c.employee_id,
    c.days,
    c.accrued,
    least(c.accrued, coalesce(d.total, 0)),
    c.accrued - least(c.accrued, coalesce(d.total, 0))
  from _acc c
  left join lateral (
    select sum(ad.amount - ad.deducted_amount) as total
    from public.advances ad
    where ad.employee_id = c.employee_id and ad.payroll_run_id is null
  ) d on true;

  -- 🔴 ตัดใบเบิกแบบ **เรียงตามวันที่เบิก (FIFO) และเท่าที่หักได้จริง**
  -- ใบที่หักครบถูกผูกกับรอบนี้ · ใบที่หักได้บางส่วนยังค้างอยู่ด้วยยอดที่เหลือ
  -- · เดิมบรรทัดนี้คือ `update ... set payroll_run_id = p_run` แบบไม่มีเงื่อนไข
  --   ซึ่งกลืนส่วนที่หักไม่ครบทิ้งทั้งก้อน
  with target as (
    select l.employee_id, l.advance_deducted as take
    from public.payroll_lines l
    where l.run_id = p_run and l.advance_deducted > 0
  ),
  queue as (
    select
      ad.id,
      ad.employee_id,
      ad.amount,
      ad.deducted_amount,
      ad.amount - ad.deducted_amount as open_amount,
      coalesce(sum(ad.amount - ad.deducted_amount) over (
        partition by ad.employee_id
        order by ad.advance_date, ad.id
        rows between unbounded preceding and 1 preceding
      ), 0) as before_amount
    from public.advances ad
    where ad.payroll_run_id is null
      and ad.employee_id in (select t.employee_id from target t)
  ),
  alloc as (
    select
      q.id,
      q.amount,
      q.deducted_amount,
      greatest(0, least(q.open_amount, t.take - q.before_amount)) as take
    from queue q
    join target t on t.employee_id = q.employee_id
  )
  update public.advances ad
     set deducted_amount = ad.deducted_amount + a.take,
         payroll_run_id  = case
                             when ad.deducted_amount + a.take >= ad.amount then p_run
                             else null
                           end
    from alloc a
   where a.id = ad.id and a.take > 0;

  update public.payroll_runs r
    set status = 'closed',
        closed_at = now(),
        closed_by = auth.uid(),
        total_accrued = (select coalesce(sum(l.accrued), 0) from public.payroll_lines l where l.run_id = p_run),
        total_advance_deducted = (select coalesce(sum(l.advance_deducted), 0) from public.payroll_lines l where l.run_id = p_run),
        total_paid = (select coalesce(sum(l.net_paid), 0) from public.payroll_lines l where l.run_id = p_run)
    where r.id = p_run;

  return query
    select v_n,
           r.total_accrued, r.total_advance_deducted, r.total_paid
    from public.payroll_runs r where r.id = p_run;
end $$;

revoke execute on function public.close_payroll_run(uuid) from public, anon;
grant execute on function public.close_payroll_run(uuid) to authenticated;

-- ── 5 · MCP: ส่งยอดคงเหลือกลับไปให้ AI เตือนเจ้าของได้ ────────────────
-- เมื่อฐานข้อมูลไม่ห้ามแล้ว คำเตือนต้องมาจากคนที่เห็นตัวเลข — หน้าจอเห็นอยู่แล้ว
-- ส่วนฝั่งแชทเห็นเฉพาะสิ่งที่ฟังก์ชันคืนกลับไป จึงต้องคืน `balance` ไปด้วย
-- ⚠️ ชื่อพารามิเตอร์ต้องตรงกับของเดิมเป๊ะ — `create or replace` เปลี่ยนชื่อ
-- พารามิเตอร์ไม่ได้ (`cannot change name of input parameter`) ต้อง drop ก่อนเท่านั้น
create or replace function public.mcp_create_advance(
  p_actor      uuid,
  p_key        uuid,
  p_employee   uuid,
  p_amount     numeric,
  p_date       date,
  p_pay_method text default 'cash',
  p_site       uuid default null,
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_name    text;
  v_balance numeric;
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
begin
  perform public.mcp_begin_write(p_actor, p_key);

  if p_date > v_today then
    raise exception 'DATE_FUTURE: บันทึกเบิกของวันในอนาคตไม่ได้';
  end if;

  select e.full_name into v_name from public.employees e where e.id = p_employee;
  if v_name is null then
    raise exception 'EMPLOYEE_NOT_FOUND: ไม่พบคนงานคนนี้';
  end if;

  insert into public.advances (
    employee_id, amount, advance_date, pay_method, site_id, note, mcp_key_id)
  values (
    p_employee, p_amount, p_date, coalesce(p_pay_method, 'cash')::public.pay_method,
    p_site, nullif(btrim(coalesce(p_note, '')), ''), p_key)
  returning id into v_id;

  select b.balance into v_balance from public.employee_balance(p_employee) b;

  return jsonb_build_object(
    'ok', true, 'advance_id', v_id, 'employee_id', p_employee,
    'full_name', v_name, 'amount', p_amount, 'advance_date', p_date,
    -- ติดลบ = เบิกเกินค่าแรงที่ทำไปแล้ว · AI ต้องบอกเจ้าของตรง ๆ ในคำตอบ
    'balance', v_balance, 'overdrawn', v_balance < 0);
end $$;

revoke execute on function public.mcp_create_advance(uuid, uuid, uuid, numeric, date, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.mcp_create_advance(uuid, uuid, uuid, numeric, date, text, uuid, text)
  to service_role;
