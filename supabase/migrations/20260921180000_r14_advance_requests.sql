-- ════════════════════════════════════════════════════════════════════════
-- R14 · หัวหน้าโครงการตั้งเบิกค่าแรงให้ลูกน้อง แล้วเจ้าของอนุมัติทีหลัง
-- (คำสั่งเจ้าของ 21 ก.ย. 2569)
-- ครอบแถว R14-DB-01..23 ใน docs/test-plan/R14-advance-requests.md
-- ════════════════════════════════════════════════════════════════════════
--
-- เจ้าของสั่ง: *"พี่เพิ่มให้หัวหน้างานส่งตั้งเบิกค่าแรงให้ลูกน้องคนอื่นได้ไหมครับ
-- แล้วค่อยให้ผมอนุมัติ … เบิกเกินได้ครับ … แค่ให้เค้าส่งเสนอมาก่อน บางครั้งผม
-- ไม่ได้อยู่หน้างาน เค้าจะแจ้งหัวหน้างานมาว่าขอเบิกเงิน"*
--
-- 🔴 หัวใจของเฟสนี้มีข้อเดียว: **คำขอไม่ใช่เงิน**
-- ใบเบิกที่ยังไม่อนุมัติต้องไม่ถูกนับเป็นเงินที่จ่ายออกไปแล้วที่ไหนเลย —
-- ไม่ใช่ในยอดคงเหลือ ไม่ใช่ตอนหักคืนตอนจ่ายค่าแรง ไม่ใช่ในรายงาน
-- · ถ้าพลาดข้อนี้ข้อเดียว คนงานจะถูกหักเงินที่ยังไม่เคยได้รับ **โดยไม่มี
--   error ที่ไหนเลย และยอดทุกหน้าจอยังดูสมเหตุสมผล** (เหมือน §17 ข้อ 22 เป๊ะ)
-- → ทุกจุดที่เคยเขียน `where ad.payroll_run_id is null` ต้องมี
--   `and ad.status = 'approved'` ต่อท้ายเสมอ · ไฟล์นี้ไล่แก้ครบทั้ง 5 ที่
--
-- 🔴 ข้อที่สอง: เพดานเบิกยังไม่กลับมา (20 ก.ย. 2569 ยังมีผล) — เบิกเกินได้
-- คนตัดสินใจคือเจ้าของตอนกดอนุมัติ ฐานข้อมูลมีหน้าที่บอกตัวเลข ไม่ใช่ห้าม

-- ── 1 · สถานะของใบเบิก ───────────────────────────────────────────────
do $$ begin
  create type public.advance_status as enum ('pending', 'approved', 'rejected');
  exception when duplicate_object then null;
end $$;

-- 🔴 ลำดับสองบรรทัดนี้สำคัญ: เพิ่มคอลัมน์ด้วย default `approved` ก่อน
-- เพื่อให้ **ใบเบิกเก่าทุกใบซึ่งเป็นเงินที่จ่ายไปแล้วจริง ๆ** กลายเป็น
-- `approved` ทั้งหมด แล้วค่อยเปลี่ยน default เป็น `pending` สำหรับใบใหม่
-- · สลับลำดับเมื่อไหร่ ประวัติการเบิกทั้งบริษัทจะกลายเป็น "รออนุมัติ"
--   พร้อมกันในวินาทีเดียว และยอดค้างจ่ายของทุกคนจะเด้งขึ้นเท่ายอดที่เบิกไปแล้ว
alter table public.advances
  add column if not exists status public.advance_status not null default 'approved';
alter table public.advances alter column status set default 'pending';

alter table public.advances add column if not exists rejected_reason text;
alter table public.advances add column if not exists approved_by uuid
  references public.profiles(id) on delete set null;
alter table public.advances add column if not exists approved_at timestamptz;

comment on column public.advances.status is
  'pending = หัวหน้าโครงการยื่นคำขอไว้ ยังไม่ใช่เงินที่จ่ายออก · approved = จ่ายแล้ว นับเข้ายอดเบิก · rejected = เจ้าของไม่อนุมัติ';

-- ตีกลับโดยไม่บอกเหตุผล = ส่งงานกลับไปโดยไม่บอกว่าต้องแก้อะไร (เหมือน transactions)
alter table public.advances drop constraint if exists advances_rejected_needs_reason;
alter table public.advances add constraint advances_rejected_needs_reason
  check (status <> 'rejected' or length(btrim(coalesce(rejected_reason, ''))) > 0);

create index if not exists advances_pending_idx on public.advances(status)
  where status = 'pending';
create index if not exists advances_created_by_idx  on public.advances(created_by);
create index if not exists advances_approved_by_idx on public.advances(approved_by);

-- ── 2 · ชนิดแจ้งเตือนใหม่ ────────────────────────────────────────────
-- ⚠️ ค่าที่เพิ่งเพิ่มเข้า enum ใช้ใน **ทรานแซกชันเดียวกัน** ไม่ได้ —
-- ที่นี่ใช้แค่เป็นสตริงในตัวฟังก์ชัน (plpgsql ไม่ตีความตอนสร้าง) จึงผ่าน
-- แต่ถ้าวันหน้ามีใครเขียน `insert ... values ('advance_pending')` ลงใน
-- migration เดียวกัน มันจะล้มด้วย "unsafe use of new value of enum type"
alter type public.notification_kind add value if not exists 'advance_pending';
alter type public.notification_kind add value if not exists 'advance_approved';
alter type public.notification_kind add value if not exists 'advance_rejected';

-- ── 3 · RLS — หัวหน้าโครงการยื่นคำขอของโครงการตัวเองได้ ───────────────
-- เดิมทั้งตารางเป็น "เจ้าของเท่านั้น" (คำสั่งเจ้าของ 31 ส.ค. 2569)
-- · คำสั่งใหม่เปิดเฉพาะ **การยื่นคำขอ** ไม่ใช่การจ่ายเงิน
-- · หัวหน้าโครงการเห็นเฉพาะ **ใบที่ตัวเองยื่น** ไม่ใช่ทุกใบของโครงการ —
--   ยอดเบิกของคนอื่นคือค่าแรงกลาย ๆ ซึ่งเป็นความลับจากเขา (P4.5)
drop policy if exists advances_owner_select on public.advances;
drop policy if exists advances_owner_insert on public.advances;
drop policy if exists advances_owner_update on public.advances;
drop policy if exists advances_owner_delete on public.advances;
drop policy if exists advances_select on public.advances;
drop policy if exists advances_insert on public.advances;
drop policy if exists advances_update on public.advances;
drop policy if exists advances_delete on public.advances;

create policy advances_select on public.advances
  for select to authenticated using (
    (select public.is_owner())
    or created_by = (select auth.uid())
  );

create policy advances_insert on public.advances
  for insert to authenticated with check (
    (select public.is_owner())
    or (site_id is not null and public.supervises_site(site_id))
  );

-- ⚠️ กฎเดิมจาก R4 ยังใช้อยู่: **ห้ามใส่เงื่อนไขสถานะใน `with check`**
-- ไม่งั้น update ที่ถูกปฏิเสธจะโดน RLS ตัดเหลือ 0 แถว แล้ว PostgREST ตอบ 200
-- สำเร็จ ก่อนที่ guard trigger จะได้อธิบายว่าทำไมถึงไม่ได้
create policy advances_update on public.advances
  for update to authenticated
  using (
    (select public.is_owner())
    or (created_by = (select auth.uid()) and status in ('pending', 'rejected')
        and site_id is not null and public.supervises_site(site_id))
  )
  with check (
    (select public.is_owner())
    or (created_by = (select auth.uid())
        and site_id is not null and public.supervises_site(site_id))
  );

create policy advances_delete on public.advances
  for delete to authenticated using (
    (select public.is_owner())
    or (created_by = (select auth.uid()) and status in ('pending', 'rejected'))
  );

-- ── 4 · guard: ใครตั้งสถานะได้ และแตะอะไรไม่ได้บ้าง ───────────────────
-- ต่อจาก `20260920120000_advance_overdraw.sql` · กฎเดิมอยู่ครบทุกข้อ
-- (ห้ามวันอนาคต · ใบที่ถูกหักคืนแล้วแก้ยอดไม่ได้ · created_by ทับไม่ได้)
-- และเพิ่มกติกาของคิวอนุมัติเข้ามา
create or replace function public.guard_advance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_owner boolean := public.is_owner();
  -- ไม่มีเซสชัน = service role (สคริปต์ · cron · seed) — ไม่ใช่หัวหน้าโครงการ
  v_service  boolean := auth.uid() is null;
  v_locked   boolean;
begin
  -- 🔴 ลงย้อนหลังได้ แต่ลงวันในอนาคตไม่ได้ (คำสั่งเจ้าของ 20 ก.ย. 2569)
  if new.advance_date > (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'DATE_FUTURE: บันทึกเบิกของวันในอนาคตไม่ได้';
  end if;

  if tg_op = 'INSERT' then
    if not v_service then new.created_by := auth.uid(); end if;

    if not v_is_owner and not v_service then
      -- คำขอต้องผูกโครงการเสมอ — ขอบเขตของหัวหน้าโครงการคือโครงการ
      -- (policy กันอยู่แล้วอีกชั้น · ตรงนี้คือด่านที่บอกเหตุผลกลับไปได้)
      if new.site_id is null then
        raise exception 'SITE_REQUIRED: หัวหน้าโครงการต้องเลือกโครงการ';
      end if;
      -- 🔴 ไม่ทับค่าให้เงียบ ๆ แต่ **ปฏิเสธ** — ค่าที่ client ส่งมาแล้วถูก
      -- กลืนหายคือบั๊กที่ไม่มีใครเห็น ส่วน error คือสิ่งที่ตัวตรวจจับได้
      if new.status <> 'pending' then
        raise exception 'APPROVE_FORBIDDEN: หัวหน้าโครงการตั้งสถานะเองไม่ได้';
      end if;
      if new.payroll_run_id is not null or new.deducted_amount <> 0 then
        raise exception 'APPROVE_FORBIDDEN: หัวหน้าโครงการตั้งยอดที่หักแล้วเองไม่ได้';
      end if;
    end if;

    if new.status = 'approved' and not v_service then
      new.approved_by := auth.uid();
      new.approved_at := now();
    end if;
    if new.status <> 'rejected' then new.rejected_reason := null; end if;
    -- ไม่มีเพดาน — เบิกเกินค่าแรงค้างจ่ายได้ หน้าจอเป็นคนเตือน
    return new;
  end if;

  -- ── UPDATE ─────────────────────────────────────────────────────────
  new.created_by := old.created_by;
  -- เงินถูกหักคืนไปแล้ว ไม่ว่าครบใบหรือบางส่วน = ใบนี้แช่แข็ง
  v_locked := old.payroll_run_id is not null or old.deducted_amount > 0;

  if not v_is_owner and not v_service then
    if old.status = 'rejected' then
      -- 🔴 แก้ของที่ถูกตีกลับ = ส่งใหม่ · บังคับที่นี่ ไม่ใช่ที่ route
      -- เพราะสถานะเป็นเรื่องที่ client ห้ามเป็นคนตัดสิน
      new.status := 'pending';
      new.rejected_reason := null;
      new.approved_by := null;
      new.approved_at := null;
    elsif new.status is distinct from old.status then
      raise exception 'APPROVE_FORBIDDEN: หัวหน้าโครงการเปลี่ยนสถานะไม่ได้';
    end if;
  end if;

  if v_locked then
    if new.amount is distinct from old.amount then
      raise exception 'PAYROLL_CLOSED: ใบเบิกนี้ถูกหักตอนจ่ายค่าแรงไปแล้ว แก้ยอดไม่ได้';
    end if;
    -- 🔴 ถอนอนุมัติใบที่ถูกหักไปแล้ว = ยอดที่หักคืนไปลอยอยู่โดยไม่มีใบรองรับ
    -- และ `employee_balance` จะคืนเงินก้อนนั้นให้คนงานอีกรอบ
    if new.status is distinct from old.status then
      raise exception 'PAYROLL_CLOSED: ใบเบิกนี้ถูกหักตอนจ่ายค่าแรงไปแล้ว เปลี่ยนสถานะไม่ได้';
    end if;
  end if;

  -- ตาข่ายรองของ check constraint — ข้อความไทยที่ route ส่งต่อได้
  if new.deducted_amount > new.amount then
    raise exception 'ADVANCE_DEDUCTED_EXCEEDS: ยอดที่หักคืนแล้วมากกว่ายอดในใบเบิก';
  end if;

  if new.status = 'approved' and old.status <> 'approved' then
    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif new.status <> 'approved' and old.status = 'approved' then
    new.approved_by := null;
    new.approved_at := null;
  end if;
  if new.status <> 'rejected' then new.rejected_reason := null; end if;

  return new;
end $$;

drop trigger if exists advances_guard on public.advances;
create trigger advances_guard before insert or update on public.advances
  for each row execute function public.guard_advance();

revoke execute on function public.guard_advance() from public, anon, authenticated;

-- ── 5 · แจ้งเตือน ────────────────────────────────────────────────────
-- 🔴 อยู่ที่ trigger ไม่ใช่ที่ route — เส้นทางไหนที่ลืมใส่จะเงียบหายไป
-- โดยไม่มีใครรู้ว่าหาย (เหตุผลเดียวกับ `notify_transaction`)
create or replace function public.notify_advance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_money text := '฿' || to_char(new.amount, 'FM999,999,999');
  v_who   text;
  v_site  text;
  v_body  text;
begin
  select e.full_name into v_who  from public.employees e where e.id = new.employee_id;
  select s.name      into v_site from public.sites s     where s.id = new.site_id;
  v_body := coalesce(v_who, 'คนงาน') || ' · ' || v_money || ' · '
            || coalesce(v_site, 'ไม่ระบุโครงการ');

  if tg_op = 'INSERT' then
    -- ใบที่เจ้าของคีย์เองเข้าเป็น `approved` ทันที ไม่มีใครต้องรู้
    if new.status = 'pending' then
      insert into public.notifications (user_id, kind, title, body, link)
      select p.id, 'advance_pending', 'มีคำขอเบิกค่าแรงรออนุมัติ', v_body, '/approvals'
      from public.profiles p
      where p.role = 'owner' and p.is_active
        and p.id is distinct from new.created_by;
    end if;
    return null;
  end if;

  -- แก้แล้วส่งใหม่ — เจ้าของต้องรู้ว่ามีของกลับเข้าคิว
  if new.status = 'pending' and old.status = 'rejected' then
    insert into public.notifications (user_id, kind, title, body, link)
    select p.id, 'advance_pending', 'คำขอเบิกที่ตีกลับถูกแก้แล้วส่งใหม่', v_body, '/approvals'
    from public.profiles p
    where p.role = 'owner' and p.is_active
      and p.id is distinct from v_actor;
    return null;
  end if;

  -- 🔴 `is distinct from` สำคัญ — กดอนุมัติซ้ำต้องไม่ยิงแจ้งเตือนใบที่สอง
  if new.status is distinct from old.status
     and new.created_by is not null
     and new.created_by is distinct from v_actor then
    if new.status = 'approved' then
      insert into public.notifications (user_id, kind, title, body, link)
      values (new.created_by, 'advance_approved', 'คำขอเบิกของคุณได้รับอนุมัติแล้ว',
              v_body, '/advances');
    elsif new.status = 'rejected' then
      insert into public.notifications (user_id, kind, title, body, link)
      values (new.created_by, 'advance_rejected', 'คำขอเบิกของคุณถูกตีกลับ',
              -- เหตุผลจริงต้องอยู่ในตัวข้อความ ไม่ใช่ "กรุณาตรวจสอบ" ลอย ๆ
              coalesce(nullif(btrim(coalesce(new.rejected_reason, '')), ''), 'ไม่ได้ระบุเหตุผล')
                || ' (' || v_body || ')',
              '/advances');
    end if;
  end if;
  return null;
end $$;

drop trigger if exists advances_notify on public.advances;
create trigger advances_notify after insert or update on public.advances
  for each row execute function public.notify_advance();

revoke execute on function public.notify_advance() from public, anon, authenticated;

-- ── 6 · ยอดคงเหลือรายคน — คำขอที่ยังไม่อนุมัติไม่ใช่เงินที่จ่ายไปแล้ว ──
-- 🔴 แยกเป็นสองชั้นโดยตั้งใจ:
--   `employee_balance_raw()` = สูตร · ไม่มีด่าน · ให้ฟังก์ชัน definer และ
--                              สคริปต์ที่รันเป็น superuser เรียก
--   `employee_balance()`     = ประตูที่ `authenticated` เรียกได้ · **เจ้าของเท่านั้น**
-- เพราะตั้งแต่วันนี้หัวหน้าโครงการมีเรื่องต้องยุ่งกับใบเบิกแล้ว และ
-- `grant execute ... to authenticated` แบบไม่มีด่านแปลว่าเขายิง RPC ตรง ๆ
-- เพื่ออ่าน **ค่าแรงค้างจ่ายของคนงานทุกคน** ได้ ซึ่งขัดกับ P4.5 ทั้งฉบับ
-- · ห้ามแก้ด้วยทางลัด `auth.uid() is null` (CLAUDE.md §5) — แยกฟังก์ชันแทน
create or replace function public.employee_balance_raw(p_employee uuid)
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
    -- 🔴 `status = 'approved'` คือบรรทัดที่กันคนงานถูกหักเงินที่ยังไม่เคยได้รับ
    select sum(ad.amount - ad.deducted_amount) as total
    from public.advances ad
    where ad.employee_id = p_employee
      and ad.payroll_run_id is null
      and ad.status = 'approved'
  ) adv;
$$;

revoke execute on function public.employee_balance_raw(uuid) from public, anon, authenticated;

create or replace function public.employee_balance(p_employee uuid)
returns table (accrued numeric, advanced numeric, balance numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_owner()) then
    raise exception 'FORBIDDEN: ค่าแรงเป็นความลับจากหัวหน้าโครงการ';
  end if;
  return query select b.accrued, b.advanced, b.balance
  from public.employee_balance_raw(p_employee) b;
end $$;

revoke execute on function public.employee_balance(uuid) from public, anon;
grant execute on function public.employee_balance(uuid) to authenticated;

-- ── 7 · ยอดของทุกคนในหน้าเดียว (ฉบับจริงคือของ R9 payroll_breakdown) ──
-- ⚠️ คัดลอกฉบับที่รันอยู่มาทั้งตัว แล้วแก้ **เฉพาะ lateral ของ advances**
-- คัดลอกฉบับเก่ากว่ามาเมื่อไหร่ คอลัมน์ base/extra/deduct จะหายไปเงียบ ๆ
-- แล้วหน้า /payroll จะโชว์ ฿0 ทุกช่องโดยไม่มี error (§17 ข้อของ overdraw)
create or replace function public.payroll_balances()
returns table (
  employee_id uuid,
  full_name   text,
  job_title   text,
  days        numeric,
  base        numeric,
  extra       numeric,
  deduct      numeric,
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
    coalesce(acc.base, 0),
    coalesce(adj.extra, 0),
    coalesce(adj.deduct, 0),
    coalesce(acc.total, 0),
    coalesce(adv.total, 0),
    coalesce(acc.total, 0) - coalesce(adv.total, 0)
  from public.employees e
  left join lateral (
    select
      sum(a.work_units)                       as days,
      sum(aw.work_units * aw.wage_snapshot)   as base,
      sum(aw.amount)                          as total
    from public.attendance a
    join public.attendance_wages aw on aw.attendance_id = a.id
    where a.employee_id = e.id
      and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
  ) acc on true
  left join lateral (
    select
      sum(ad.amount) filter (where ad.kind = 'add')    as extra,
      sum(ad.amount) filter (where ad.kind = 'deduct') as deduct
    from public.attendance_adjustments ad
    join public.attendance a on a.id = ad.attendance_id
    where a.employee_id = e.id
      and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
  ) adj on true
  left join lateral (
    select sum(ad.amount - ad.deducted_amount) as total
    from public.advances ad
    where ad.employee_id = e.id
      and ad.payroll_run_id is null
      and ad.status = 'approved'
  ) adv on true
  where (select public.is_owner())
    and (coalesce(acc.total, 0) <> 0 or coalesce(adv.total, 0) <> 0)
  order by e.full_name;
$$;

revoke execute on function public.payroll_balances() from public, anon;
grant execute on function public.payroll_balances() to authenticated;

-- ── 8 · ปิดรอบจ่าย: หักคืนเฉพาะใบที่อนุมัติแล้ว ──────────────────────
-- 🔴 จุดที่อันตรายที่สุดของไฟล์นี้ · ฉบับเดิม (20 ก.ย. 2569) หักจากใบเบิก
-- **ทุกใบที่ยังไม่ผูกรอบ** · วินาทีที่มีใบ `pending` อยู่ในตาราง มันจะถูก
-- หักจากค่าแรงทันที = คนงานถูกหักเงินที่ยังไม่เคยได้รับ และใบคำขอจะถูก
-- ตีตราว่า "หักแล้ว" ทั้งที่เจ้าของยังไม่เคยกดอนุมัติเลยสักครั้ง
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
    where ad.employee_id = c.employee_id
      and ad.payroll_run_id is null
      and ad.status = 'approved'
  ) d on true;

  -- ตัดใบเบิกแบบเรียงตามวันที่เบิก (FIFO) และเท่าที่หักได้จริง
  -- ใบที่หักครบถูกผูกกับรอบนี้ · ใบที่หักได้บางส่วนยังค้างด้วยยอดที่เหลือ
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
      and ad.status = 'approved'
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

-- ── 9 · รายงาน: "เบิกไปแล้ว" ต้องหมายถึงเงินที่ออกจริง ───────────────
-- ตัวเลขนี้อยู่คู่กับ "จ่ายค่าแรงแล้ว" บนหน้ารายงาน · นับคำขอที่ยังไม่อนุมัติ
-- เข้าไปด้วยเมื่อไหร่ เจ้าของจะอ่านว่าเงินออกจากมือไปแล้วทั้งที่ยังไม่ออก
create or replace function public.report_summary(
  p_from date,
  p_to date,
  p_site uuid default null
)
returns table (
  income_approved  numeric,
  income_pending   numeric,
  expense_approved numeric,
  expense_pending  numeric,
  expense_cash     numeric,
  expense_transfer numeric,
  wage_cost        numeric,
  cost_total       numeric,
  profit           numeric,
  txn_count        int,
  advance_paid     numeric,
  payroll_paid     numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(t.income_approved, 0),
    coalesce(t.income_pending, 0),
    coalesce(t.expense_approved, 0),
    coalesce(t.expense_pending, 0),
    coalesce(t.expense_cash, 0),
    coalesce(t.expense_transfer, 0),
    coalesce(w.wage_cost, 0),
    coalesce(t.expense_approved, 0) + coalesce(w.wage_cost, 0),
    coalesce(t.income_approved, 0)
      - (coalesce(t.expense_approved, 0) + coalesce(w.wage_cost, 0)),
    coalesce(t.txn_count, 0),
    coalesce(a.advance_paid, 0),
    coalesce(p.payroll_paid, 0)
  from (values (1)) as one(x)
  left join lateral (
    select
      sum(x.amount) filter (where x.kind = 'income'  and x.status = 'approved') as income_approved,
      sum(x.amount) filter (where x.kind = 'income'  and x.status = 'pending')  as income_pending,
      sum(x.amount) filter (where x.kind = 'expense' and x.status = 'approved') as expense_approved,
      sum(x.amount) filter (where x.kind = 'expense' and x.status = 'pending')  as expense_pending,
      sum(x.amount) filter (
        where x.kind = 'expense' and x.status = 'approved' and x.pay_method = 'cash'
      ) as expense_cash,
      sum(x.amount) filter (
        where x.kind = 'expense' and x.status = 'approved' and x.pay_method = 'transfer'
      ) as expense_transfer,
      count(*)::int as txn_count
    from public.transactions x
    where x.txn_date between p_from and p_to
      and (p_site is null or x.site_id = p_site)
  ) t on true
  left join lateral (
    select sum(aw.amount) as wage_cost
    from public.attendance a2
    join public.attendance_wages aw on aw.attendance_id = a2.id
    where a2.work_date between p_from and p_to
      and (p_site is null or a2.site_id = p_site)
  ) w on true
  left join lateral (
    select sum(v.amount) as advance_paid
    from public.advances v
    where v.advance_date between p_from and p_to
      and v.status = 'approved'
      and (p_site is null or v.site_id = p_site)
  ) a on true
  left join lateral (
    select sum(r.total_paid) as payroll_paid
    from public.payroll_runs r
    where r.status = 'closed'
      and r.period_end between p_from and p_to
      and (p_site is null or r.site_id = p_site)
  ) p on true
  where (select public.is_owner());
$$;

revoke execute on function public.report_summary(date, date, uuid) from public, anon;
grant execute on function public.report_summary(date, date, uuid) to authenticated;

-- ⚠️ ฉบับที่รันอยู่คือของ 4 ก.ย. 2569 ซึ่งมี `work_days` เพิ่มมา — คัดลอก
-- ฉบับนั้นมาแก้ ไม่ใช่ฉบับ R2 ที่ไม่มีคอลัมน์นั้น
create or replace function public.report_labor(
  p_from date,
  p_to date,
  p_site uuid default null
)
returns table (
  work_units    numeric,
  work_days     int,
  worker_count  int,
  wage_total    numeric,
  ot_total      numeric,
  advance_paid  numeric,
  payroll_paid  numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(a.work_units, 0),
    coalesce(a.work_days, 0),
    coalesce(a.worker_count, 0),
    coalesce(a.wage_total, 0),
    coalesce(a.ot_total, 0),
    coalesce(v.advance_paid, 0),
    coalesce(r.payroll_paid, 0)
  from (values (1)) as one(x)
  left join lateral (
    select
      sum(at.work_units) as work_units,
      count(distinct at.work_date)::int as work_days,
      count(distinct at.employee_id)::int as worker_count,
      sum(aw.amount) as wage_total,
      sum(aw.ot_amount) as ot_total
    from public.attendance at
    join public.attendance_wages aw on aw.attendance_id = at.id
    where at.work_date between p_from and p_to
      and (p_site is null or at.site_id = p_site)
  ) a on true
  left join lateral (
    select sum(ad.amount) as advance_paid
    from public.advances ad
    where ad.advance_date between p_from and p_to
      and ad.status = 'approved'
      and (p_site is null or ad.site_id = p_site)
  ) v on true
  left join lateral (
    select sum(pr.total_paid) as payroll_paid
    from public.payroll_runs pr
    where pr.status = 'closed'
      and pr.period_end between p_from and p_to
      and (p_site is null or pr.site_id = p_site)
  ) r on true
  where (select public.is_owner());
$$;

revoke execute on function public.report_labor(date, date, uuid) from public, anon;
grant execute on function public.report_labor(date, date, uuid) to authenticated;

-- ── 10 · MCP: AI คีย์แทนเจ้าของ = อนุมัติแล้วตั้งแต่วินาทีแรก ─────────
-- 🔴 ตั้งแต่ default ของคอลัมน์เป็น `pending` ใบที่ฟังก์ชันนี้ insert โดย
-- ไม่ระบุสถานะจะกลายเป็นคำขอที่ไม่มีใครเห็น — การยืนยันของฝั่ง MCP เกิดใน
-- แชทไปแล้ว (R6) ไม่มีคิวอนุมัติมารับต่อ · ต้องระบุ `approved` ให้ชัด
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
    employee_id, amount, advance_date, pay_method, site_id, note, mcp_key_id, status)
  values (
    p_employee, p_amount, p_date, coalesce(p_pay_method, 'cash')::public.pay_method,
    p_site, nullif(btrim(coalesce(p_note, '')), ''), p_key, 'approved')
  returning id into v_id;

  select b.balance into v_balance from public.employee_balance_raw(p_employee) b;

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
