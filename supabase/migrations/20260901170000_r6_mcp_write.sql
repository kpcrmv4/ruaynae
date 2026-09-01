-- ════════════════════════════════════════════════════════════════════════
-- R6 · ให้ตัวเชื่อม MCP **บันทึกข้อมูลได้** ไม่ใช่อ่านอย่างเดียว
-- ครอบแถว R6-DB-* / R6-FN-* ใน docs/test-plan/R6-mcp-write.md
-- ════════════════════════════════════════════════════════════════════════
--
-- ที่มา: เจ้าของถ่ายสลิปส่งเข้าแชท ให้ AI อ่านแล้วบันทึกให้ · การยืนยันเกิดขึ้น
-- **ในแชท** (AI สรุปให้ดูแล้วถามก่อนทุกครั้ง) ไม่ใช่ในคิวอนุมัติ — รายการที่เข้ามา
-- ทางนี้จึงเป็น `approved` เหมือนที่เจ้าของคีย์เองในแอป (route ก็ตั้งจาก role แบบนี้)
--
-- 🔴 กฎทุกข้อยังบังคับที่ trigger เดิมทั้งหมด ไม่มีทางลัดสำหรับ MCP:
--    `guard_transaction` · `guard_attendance` · `guard_advance` ·
--    `guard_attendance_closed` ยังทำงานครบ เพราะฟังก์ชันในไฟล์นี้
--    **insert ลงตารางจริง** ไม่ได้เขียนเลี่ยงไปทางไหน
--
-- 🔴 `auth.uid()` ต้องเป็นเจ้าของ **ก่อน** แตะตาราง ไม่งั้น `guard_transaction`
--    จะเห็น `auth.uid() is null` = service (v_service) แล้ว **ข้าม** การเติม
--    `created_by` ทั้งหมด → ได้แถวไร้เจ้าของ ซึ่งสาขา `created_by = auth.uid()`
--    ของทุก policy จะตายกับแถวนั้นตลอดไปโดยไม่มี error ที่ไหน (บทเรียน P2-DB-04)
--    · `mcp_begin_write()` จึงเรียก `mcp_assume_owner()` เป็นบรรทัดแรกเสมอ

-- ── 0 · ร่องรอยว่าแถวไหน AI เป็นคนคีย์ ───────────────────────────────
-- ⚠️ `null` = คนคีย์เอง · มีค่า = คีย์ MCP ใบนั้นคีย์ผ่าน AI
-- เก็บเป็น **id ของคีย์** ไม่ใช่ boolean เพราะเจ้าของออกคีย์ได้หลายใบ
-- (โน้ตบุ๊ก · มือถือ · เครื่องของลูกน้อง) แล้ววันที่ต้องสอบย้อนว่ามาจากเครื่องไหน
-- boolean จะตอบไม่ได้เลย และย้อนไปเติมทีหลังไม่ได้ด้วย
alter table public.transactions add column if not exists mcp_key_id uuid
  references public.mcp_keys(id) on delete set null;
alter table public.attendance   add column if not exists mcp_key_id uuid
  references public.mcp_keys(id) on delete set null;
alter table public.advances     add column if not exists mcp_key_id uuid
  references public.mcp_keys(id) on delete set null;

-- FK ทุกตัวต้องมี index (CLAUDE.md §5) · partial เพราะแถวส่วนใหญ่เป็น null
create index if not exists transactions_mcp_key_idx on public.transactions(mcp_key_id)
  where mcp_key_id is not null;
create index if not exists attendance_mcp_key_idx on public.attendance(mcp_key_id)
  where mcp_key_id is not null;
create index if not exists advances_mcp_key_idx on public.advances(mcp_key_id)
  where mcp_key_id is not null;

-- 🔴 ป้าย "บันทึกผ่าน AI" ต้องแก้ไม่ได้หลังแถวเกิดแล้ว — ไม่งั้นมันเป็นแค่
-- ข้อความประดับที่ใครก็ตั้งได้ ไม่ใช่ร่องรอย · PostgREST เปิดให้เจ้าของ PATCH
-- ทุกคอลัมน์ที่ policy ยอม การไม่ล็อกไว้แปลว่าค่านี้เชื่อไม่ได้ตั้งแต่วันแรก
create or replace function public.keep_mcp_key()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.mcp_key_id := old.mcp_key_id;
  return new;
end $$;

revoke execute on function public.keep_mcp_key() from public, anon, authenticated;

drop trigger if exists transactions_keep_mcp_key on public.transactions;
create trigger transactions_keep_mcp_key before update on public.transactions
  for each row execute function public.keep_mcp_key();

drop trigger if exists attendance_keep_mcp_key on public.attendance;
create trigger attendance_keep_mcp_key before update on public.attendance
  for each row execute function public.keep_mcp_key();

drop trigger if exists advances_keep_mcp_key on public.advances;
create trigger advances_keep_mcp_key before update on public.advances
  for each row execute function public.keep_mcp_key();

-- ── 1 · audit_log ต้องแยกออกว่า "เจ้าของกดเอง" กับ "AI กดแทนเจ้าของ" ──
-- 🔴 ฟังก์ชัน MCP สวมสิทธิ์เจ้าของ → `auth.uid()` เป็นเจ้าของจริง ๆ
-- ทุกแถวใน audit_log จึงเขียนว่าเจ้าของเป็นคนทำ **ทั้งที่เจ้าของไม่ได้แตะเครื่อง**
-- ถ้าไม่แยกไว้ วันที่มีตัวเลขผิดจะไล่ไม่ได้เลยว่ามาจากมือหรือมาจากแชท
-- · เก็บผ่าน GUC เพราะ audit_row() เป็นตัวเดียวกันของทุกตาราง — ส่งพารามิเตอร์
--   เข้าไปไม่ได้ และการแก้ทุก trigger ให้รับพารามิเตอร์คือการแก้ทั้งระบบ
-- 🔴 คอลัมน์นี้ **ไม่มี FK** ต่างจากอีกสามตาราง — ตั้งใจ · audit_row() ทำงาน
-- ในทุกการเขียนของทั้งระบบ ถ้ามันโยน FK violation ได้เมื่อไหร่ (เช่นคีย์ถูกลบ
-- ทิ้งระหว่างทาง) การเขียนของธุรกิจจะล้มเพราะ**ตัวบันทึกร่องรอย** ซึ่งไม่ควร
-- มีอำนาจนั้น · พิสูจน์แล้วตอนซ้อมกับฐานจริง: uuid ที่ไม่มีในตาราง = insert ล้ม
-- ทั้งคำสั่ง · ร่องรอยที่ชี้ไปคีย์ที่ถูกลบแล้วยังมีค่ากว่าการบล็อกคนทำงาน
alter table public.audit_log add column if not exists mcp_key_id uuid;
create index if not exists audit_log_mcp_key_idx on public.audit_log(mcp_key_id)
  where mcp_key_id is not null;

-- 🔴 คัดลอกมาทั้งดุ้นจาก 20260901000000_p9_mcp_tables.sql · ที่เพิ่มคือ
-- ตัวแปร `v_key` กับคอลัมน์ที่ 7 ของ insert เท่านั้น
-- ⚠️ ห้ามลบ `- 'pin_hash' - 'key_hash'` ออกไม่ว่ากรณีใด
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_row_id text;
  v_key    uuid;
begin
  if tg_op = 'DELETE' then
    v_before := to_jsonb(old);
    v_after  := null;
    v_row_id := v_before->>'id';
  elsif tg_op = 'INSERT' then
    v_before := null;
    v_after  := to_jsonb(new);
    v_row_id := v_after->>'id';
  else
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    v_row_id := v_after->>'id';
  end if;

  v_before := v_before - 'pin_hash' - 'key_hash';
  v_after  := v_after  - 'pin_hash' - 'key_hash';

  -- ค่าถูกตั้งโดย mcp_begin_write() และผูกกับทรานแซกชัน (is_local) จึงหมดอายุเอง
  -- ⚠️ ต้องมี `true` (missing_ok) ไม่งั้นทุก trigger ของทั้งระบบจะพังตอนไม่มีค่า
  v_key := nullif(current_setting('app.mcp_key_id', true), '')::uuid;

  insert into public.audit_log(table_name, row_id, action, actor, before, after, mcp_key_id)
  values (tg_table_name, v_row_id, tg_op, auth.uid(), v_before, v_after, v_key);

  return null;
end $$;

-- ── 2 · เปิดทรานแซกชันของการเขียนฝั่ง MCP ────────────────────────────
create or replace function public.mcp_begin_write(p_actor uuid, p_key uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- สิทธิ์ก่อนเสมอ — โยน MCP_ACTOR_NOT_OWNER ถ้าคนออกคีย์ถูกลดสิทธิ์/ปิดบัญชี
  perform public.mcp_assume_owner(p_actor);
  perform set_config('app.mcp_key_id', coalesce(p_key::text, ''), true);
end $$;

revoke execute on function public.mcp_begin_write(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.mcp_begin_write(uuid, uuid) to service_role;

-- ── 3 · ของที่ต้องรู้ก่อนบันทึก: หมวด และคนงาน ───────────────────────
-- 🔴 โมเดลต้องได้ id จากที่นี่เท่านั้น ห้ามเดา uuid เอง · uuid ที่แต่งขึ้นจะกลาย
-- เป็น FK violation ซึ่งอ่านไม่รู้เรื่อง หรือแย่กว่านั้นคือไปตรงกับแถวอื่นจริง ๆ
create or replace function public.mcp_categories(p_actor uuid, p_kind text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb;
begin
  perform public.mcp_assume_owner(p_actor);

  select coalesce(jsonb_agg(to_jsonb(r) order by r.kind, r.sort_order, r.name), '[]'::jsonb)
  into v
  from (
    select c.id, c.name, c.kind::text as kind, c.sort_order
    from public.categories c
    -- หมวดที่ปิดแล้วไม่ควรถูกเลือกใหม่ — มันหายจากฟอร์มในแอปไปแล้วเหมือนกัน
    where c.is_active and (p_kind is null or c.kind::text = p_kind)
  ) r;

  return v;
end $$;

create or replace function public.mcp_employees(
  p_actor uuid,
  p_on    date default null,
  p_limit int  default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  d date := coalesce(p_on, (now() at time zone 'Asia/Bangkok')::date);
  n int  := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  perform public.mcp_assume_owner(p_actor);

  select coalesce(jsonb_agg(to_jsonb(r) order by r.full_name), '[]'::jsonb) into v
  from (
    select
      e.id, e.full_name, e.job_title, e.is_active,
      w.wage_type::text as wage_type, w.daily_rate, w.monthly_salary,
      -- 🔴 คนหนึ่งคนลงชื่อได้ไม่เกินหนึ่งวันต่อวัน **ข้ามทุกไซต์** — บอกไปเลยว่า
      -- วันนั้นเขาอยู่ไซต์ไหนแล้ว ไม่ใช่ให้โมเดลยิงไปแล้วเจอ WORK_UNITS_EXCEEDED
      -- แล้วมาเดาเองว่าเพราะอะไร (แพตเทิร์นเดียวกับหน้าลงชื่อในแอป)
      (
        select jsonb_build_object(
                 'site_id', a.site_id, 'site_name', s.name, 'work_units', a.work_units)
        from public.attendance a
        join public.sites s on s.id = a.site_id
        where a.employee_id = e.id and a.work_date = d
        order by a.created_at limit 1
      ) as attendance_on_date
    from public.employees e
    left join public.employee_wages w on w.employee_id = e.id
    where e.is_active
    order by e.full_name
    limit n
  ) r;

  return jsonb_build_object('on_date', d, 'employees', v);
end $$;

-- ── 4 · บันทึกรายรับ-รายจ่าย ─────────────────────────────────────────
-- ⚠️ `p_client_ref` คือกันการบันทึกซ้ำ · โมเดลที่ไม่ได้คำตอบภายในเวลาที่รอ
-- จะเรียกซ้ำด้วยพารามิเตอร์ชุดเดิม ถ้าไม่มีตัวกันนี้ ค่าปูนถุงเดียวจะกลายเป็น
-- สองรายการที่ยอดเท่ากันเป๊ะในวันเดียวกัน ซึ่งไม่มีใครดูออกว่าผิด
create or replace function public.mcp_create_transaction(
  p_actor          uuid,
  p_key            uuid,
  p_kind           text,
  p_category       uuid,
  p_amount         numeric,
  p_date           date,
  p_site           uuid    default null,
  p_pay_method     text    default 'cash',
  p_income_kind    text    default null,
  p_installment_no int     default null,
  p_note           text    default null,
  p_client_ref     uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_status public.txn_status;
  v_today  date := (now() at time zone 'Asia/Bangkok')::date;
begin
  perform public.mcp_begin_write(p_actor, p_key);

  -- วันในอนาคตเกือบทุกครั้งคือปีผิด (พ.ศ. ที่ลืมลบ 543 จะไม่มาถึงตรงนี้เพราะ
  -- ฝั่ง TS ปัดทิ้งก่อน) — รายการที่ลงวันหน้าจะหายจากรายงานเดือนนี้เงียบ ๆ
  if p_date > v_today then
    raise exception 'DATE_FUTURE: บันทึกรายการของวันในอนาคตไม่ได้';
  end if;

  if p_client_ref is not null then
    select t.id, t.status into v_id, v_status
    from public.transactions t where t.client_ref = p_client_ref;
    if found then
      return jsonb_build_object(
        'ok', true, 'duplicate', true, 'transaction_id', v_id, 'status', v_status);
    end if;
  end if;

  insert into public.transactions (
    kind, site_id, category_id, amount, txn_date, pay_method,
    income_kind, installment_no, note, client_ref, status, mcp_key_id)
  values (
    p_kind::public.txn_kind, p_site, p_category, p_amount, p_date,
    coalesce(p_pay_method, 'cash')::public.pay_method,
    nullif(p_income_kind, '')::public.income_kind, p_installment_no,
    nullif(btrim(coalesce(p_note, '')), ''), p_client_ref,
    -- เจ้าของเป็นคนคีย์ (ผ่าน AI ที่ถามยืนยันในแชทแล้ว) = อนุมัติทันที
    -- เหมือน `/api/transactions` ที่ตั้งสถานะจาก role ไม่ใช่จากค่าที่ส่งมา
    'approved', p_key)
  returning id, status into v_id, v_status;

  return jsonb_build_object(
    'ok', true, 'duplicate', false, 'transaction_id', v_id, 'status', v_status);

-- ยิงพร้อมกันสองครั้งด้วย client_ref เดิม — แถวแรกชนะ อีกแถวคืนของเดิมไป
exception when unique_violation then
  select t.id, t.status into v_id, v_status
  from public.transactions t where t.client_ref = p_client_ref;
  if found then
    return jsonb_build_object(
      'ok', true, 'duplicate', true, 'transaction_id', v_id, 'status', v_status);
  end if;
  raise;
end $$;

-- ⚠️ แก้เฉพาะคีย์ที่ **มีอยู่จริงใน p_patch** · ส่ง `{"site_id": null}` = ย้ายไป
-- ส่วนกลาง ส่วนการไม่ส่งคีย์เลย = ไม่แตะ · สองอย่างนี้ต่างกันและ null เดียวกัน
-- ตอบทั้งคู่ไม่ได้ — ฝั่ง TS จึงส่งมาเป็น jsonb ที่ประกอบจากคีย์ที่โมเดลส่งจริง
create or replace function public.mcp_update_transaction(
  p_actor uuid,
  p_key   uuid,
  p_id    uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_today  date := (now() at time zone 'Asia/Bangkok')::date;
begin
  perform public.mcp_begin_write(p_actor, p_key);

  select to_jsonb(x) into v_before from (
    select t.id, t.kind::text as kind, t.amount, t.txn_date, t.site_id,
           t.category_id, t.pay_method::text as pay_method, t.note, t.status::text as status
    from public.transactions t where t.id = p_id
  ) x;
  if v_before is null then
    raise exception 'TXN_NOT_FOUND: ไม่พบรายการนี้';
  end if;

  if jsonb_exists(p_patch, 'txn_date') and (p_patch->>'txn_date')::date > v_today then
    raise exception 'DATE_FUTURE: บันทึกรายการของวันในอนาคตไม่ได้';
  end if;

  update public.transactions t set
    amount = case when jsonb_exists(p_patch, 'amount')
                  then (p_patch->>'amount')::numeric else t.amount end,
    txn_date = case when jsonb_exists(p_patch, 'txn_date')
                    then (p_patch->>'txn_date')::date else t.txn_date end,
    category_id = case when jsonb_exists(p_patch, 'category_id')
                       then (p_patch->>'category_id')::uuid else t.category_id end,
    site_id = case when jsonb_exists(p_patch, 'site_id')
                   then (p_patch->>'site_id')::uuid else t.site_id end,
    pay_method = case when jsonb_exists(p_patch, 'pay_method')
                      then (p_patch->>'pay_method')::public.pay_method else t.pay_method end,
    note = case when jsonb_exists(p_patch, 'note')
                then nullif(btrim(coalesce(p_patch->>'note', '')), '') else t.note end,
    income_kind = case when jsonb_exists(p_patch, 'income_kind')
                       then nullif(p_patch->>'income_kind', '')::public.income_kind
                       else t.income_kind end,
    installment_no = case when jsonb_exists(p_patch, 'installment_no')
                          then (p_patch->>'installment_no')::int else t.installment_no end
  where t.id = p_id;

  select to_jsonb(x) into v_after from (
    select t.id, t.kind::text as kind, t.amount, t.txn_date, t.site_id,
           t.category_id, t.pay_method::text as pay_method, t.note, t.status::text as status
    from public.transactions t where t.id = p_id
  ) x;

  -- คืนทั้งก่อนและหลัง เพื่อให้ AI เล่าให้เจ้าของฟังได้ว่าเปลี่ยนอะไรจริง ๆ
  -- ไม่ใช่ทวนสิ่งที่ตัวเองสั่งไป (ซึ่งจะตรงเสมอแม้ตอนที่ไม่มีอะไรเปลี่ยน)
  return jsonb_build_object('ok', true, 'before', v_before, 'after', v_after);
end $$;

create or replace function public.mcp_delete_transaction(p_actor uuid, p_key uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_row jsonb;
begin
  perform public.mcp_begin_write(p_actor, p_key);

  select to_jsonb(x) into v_row from (
    select t.id, t.kind::text as kind, t.amount, t.txn_date, t.site_id, t.note
    from public.transactions t where t.id = p_id
  ) x;
  if v_row is null then
    raise exception 'TXN_NOT_FOUND: ไม่พบรายการนี้';
  end if;

  delete from public.transactions where id = p_id;

  -- ค่าเดิมทั้งแถวยังอยู่ครบใน audit_log (`before`) พร้อม mcp_key_id ของคีย์ใบนี้
  return jsonb_build_object('ok', true, 'deleted', v_row);
end $$;

-- ── 5 · ลงชื่อคนเข้าไซต์ทีเดียวทั้งวัน ────────────────────────────────
-- 🔴 คนหนึ่งคนล้มไม่ทำให้ทั้งชุดล้ม · "วันนี้มี 6 คน" แล้วคนที่สามลงชื่อ
-- ที่ไซต์อื่นไปแล้ว ต้องได้ 5 คนที่ลงสำเร็จ + เหตุผลของคนที่ตก ไม่ใช่ error
-- ก้อนเดียวแล้วเจ้าของต้องมานั่งไล่เองว่าใครเข้าไม่ได้
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
  -- ค่าแรงของวันที่ยังไม่มาถึงคือต้นทุนที่ยังไม่เกิด
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

      -- ยอดเงินอยู่คนละตาราง และ trigger สร้างแถวให้แล้ว — เหลือแค่ OT
      if v_ot > 0 then
        update public.attendance_wages set ot_amount = v_ot where attendance_id = v_att;
      end if;

      v_ok := v_ok || jsonb_build_object(
        'employee_id', r.employee_id, 'full_name', v_name,
        'attendance_id', v_att, 'work_units', v_units, 'ot_amount', v_ot);

    exception
      -- ⚠️ จับทีละคนใน sub-block · แถวที่สำเร็จก่อนหน้าไม่ถูกย้อน
      when unique_violation then
        v_skip := v_skip || jsonb_build_object(
          'employee_id', r.employee_id, 'full_name', v_name, 'reason', 'ALREADY_SIGNED_IN');
      when others then
        v_skip := v_skip || jsonb_build_object(
          'employee_id', r.employee_id, 'full_name', v_name,
          -- ข้อความของ guard เป็นรูป `CODE: คำอธิบายไทย` — ส่งทั้งคู่ให้โมเดล
          -- เล่าต่อได้ว่าทำไมคนนี้ลงไม่ได้ ไม่ใช่ "ไม่สำเร็จ" ลอย ๆ
          'reason', split_part(sqlerrm, ':', 1),
          'detail', btrim(substr(sqlerrm, strpos(sqlerrm, ':') + 1)));
    end;
  end loop;

  return jsonb_build_object(
    'ok', true, 'site_id', p_site, 'work_date', p_date,
    'recorded', v_ok, 'skipped', v_skip);
end $$;

-- ── 6 · เบิกล่วงหน้า ─────────────────────────────────────────────────
-- เพดานยังบังคับที่ `guard_advance` เหมือนเดิม · ตรงนี้แค่ปล่อยข้อความของ
-- trigger ขึ้นไปทั้งดุ้น เพราะในนั้นมีตัวเลขเพดานที่เหลือจริงอยู่แล้ว
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
  v_id    uuid;
  v_name  text;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
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

  return jsonb_build_object(
    'ok', true, 'advance_id', v_id, 'employee_id', p_employee,
    'full_name', v_name, 'amount', p_amount, 'advance_date', p_date);
end $$;

-- ── 7 · สิทธิ์เรียก — service_role เท่านั้น เหมือนฟังก์ชันอ่านของ P9 ──
-- 🔴 `anon`/`authenticated` เรียกได้เมื่อไหร่ = ใครก็ตามที่ล็อกอินได้ (รวมหัวหน้าไซต์)
-- สั่งเขียนในนามเจ้าของได้ทันที เพราะ p_actor เป็นแค่พารามิเตอร์ที่ใครก็ส่งได้
do $$
declare f text;
begin
  foreach f in array array[
    'public.mcp_categories(uuid, text)',
    'public.mcp_employees(uuid, date, int)',
    'public.mcp_create_transaction(uuid, uuid, text, uuid, numeric, date, uuid, text, text, int, text, uuid)',
    'public.mcp_update_transaction(uuid, uuid, uuid, jsonb)',
    'public.mcp_delete_transaction(uuid, uuid, uuid)',
    'public.mcp_record_attendance(uuid, uuid, uuid, date, jsonb)',
    'public.mcp_create_advance(uuid, uuid, uuid, numeric, date, text, uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
