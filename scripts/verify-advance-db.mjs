#!/usr/bin/env node
/**
 * verify-advance-db.mjs — ปิดแถว R14-DB-* ใน docs/test-plan/R14-advance-requests.md
 *
 * 🔴 **ไม่ทิ้งอะไรไว้ในฐานเลย** — ทุกอย่างอยู่ใน `do` block เดียวที่จบด้วย
 * `raise exception` พร้อมรายงานผล · exception ทำให้ทั้งก้อนถูก rollback
 * ทั้ง fixture · ใบเบิก · รอบจ่าย · แจ้งเตือน · `audit_log` หายหมดพร้อมกัน
 * — จึงรันบน **ฐานจริงของลูกค้า** ได้โดยไม่ต้องมีโค้ดเก็บกวาดที่อาจลบผิดแถว
 *   (§17 ข้อ 9 · 14 · 24 · 28 ล้วนเป็นบาดแผลจากโค้ดเก็บกวาดทั้งสิ้น)
 *
 * 🔴 ถ้าคำสั่ง **สำเร็จ** แทนที่จะโยน exception = รายงานไม่ถูกส่งกลับมา และ
 * อาจมีของค้างจริง — สคริปต์ถือว่าแดงทันที ไม่ใช่เขียว
 *
 * สิทธิ์: รันผ่าน Management API (superuser) แล้วสวมสิทธิ์ด้วย
 * `set local role authenticated` + `request.jwt.claims` เพื่อทดสอบ RLS จริง
 *
 * ใช้: node scripts/verify-advance-db.mjs
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)
const REF = env.SUPABASE_PROJECT_REF
const hostRef = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
if (!REF || hostRef !== REF) {
  throw new Error(`เป้าหมายไม่ตรงกัน: PROJECT_REF=${REF} แต่ URL ชี้ไป ${hostRef}`)
}

const run = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  const text = await r.text()
  if (r.ok) return { rolledBack: false, message: text }
  let message = text
  try { message = JSON.parse(text)?.message ?? text } catch { /* ข้อความดิบก็พอ */ }
  return { rolledBack: true, message }
}


const BLOCK1 = `do $check$
declare
  v_out   text := E'\\n── R14-DB บนฐานจริง ───────────────────────────────\\n';
  v_pass  int := 0;
  v_fail  int := 0;
  v_owner uuid;
  v_sup   uuid;
  v_site  uuid;
  v_emp   uuid;
  v_adv   uuid;
  v_adv2  uuid;
  v_run   uuid;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  r       record;
  v_err   text;
  v_st    text;
  v_num   numeric;
  v_num2  numeric;
  v_num3  numeric;
  v_bool  boolean;
begin
  perform pg_catalog.set_config('search_path', 'public', true);

  select id into v_owner from public.profiles where role = 'owner' and is_active limit 1;
  select id into v_sup   from public.profiles where role = 'site_supervisor' and is_active limit 1;

  -- fixture (จะถูก rollback ทิ้งทั้งหมด)
  insert into public.sites(name, status) values ('R14 ตรวจชั่วคราว', 'active') returning id into v_site;
  insert into public.site_supervisors(site_id, profile_id, effective_from)
    values (v_site, v_sup, v_today - 30);
  insert into public.employees(full_name, job_title) values ('R14 ตรวจชั่วคราว', 'กรรมกร') returning id into v_emp;
  insert into public.employee_wages(employee_id, wage_type, daily_rate) values (v_emp, 'daily', 500);
  insert into public.attendance(work_date, site_id, employee_id, work_units) values (v_today - 1, v_site, v_emp, 1);
  insert into public.attendance(work_date, site_id, employee_id, work_units) values (v_today - 2, v_site, v_emp, 1);

  -- ── สวมสิทธิ์หัวหน้าโครงการ ────────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sup::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- R14-DB-04 · คำขอต้องผูกโครงการ
  begin
    insert into public.advances(employee_id, amount, advance_date) values (v_emp, 300, v_today);
    v_fail := v_fail + 1; v_out := v_out || E'❌ R14-DB-04 ไม่ผูกโครงการแล้วผ่านได้\\n';
  exception when others then
    if sqlerrm like '%SITE_REQUIRED%' then v_pass := v_pass + 1;
      v_out := v_out || E'✅ R14-DB-04 ไม่ผูกโครงการ → SITE_REQUIRED\\n';
    else v_fail := v_fail + 1; v_out := v_out || format(E'❌ R14-DB-04 ได้ error อื่น: %s\\n', sqlerrm); end if;
  end;

  -- R14-DB-03 · ตั้งสถานะ approved เองไม่ได้
  begin
    insert into public.advances(employee_id, amount, advance_date, site_id, status)
      values (v_emp, 300, v_today, v_site, 'approved');
    v_fail := v_fail + 1; v_out := v_out || E'❌ R14-DB-03 หัวหน้าโครงการตั้ง approved เองได้\\n';
  exception when others then
    if sqlerrm like '%APPROVE_FORBIDDEN%' then v_pass := v_pass + 1;
      v_out := v_out || E'✅ R14-DB-03 ตั้ง approved เอง → APPROVE_FORBIDDEN\\n';
    else v_fail := v_fail + 1; v_out := v_out || format(E'❌ R14-DB-03 ได้ error อื่น: %s\\n', sqlerrm); end if;
  end;

  -- R14-DB-06 · ยื่นคำขอปกติ → pending · created_by = ตัวเอง
  insert into public.advances(employee_id, amount, advance_date, site_id, note, created_by)
    values (v_emp, 800, v_today, v_site, 'ขอเบิกค่ารถ', v_owner)  -- ส่ง created_by ผิดมาด้วย
    returning id into v_adv;
  select status::text, created_by = v_sup into v_st, v_bool from public.advances where id = v_adv;
  if v_st = 'pending' and v_bool then v_pass := v_pass + 1;
    v_out := v_out || E'✅ R14-DB-06 ยื่นคำขอ → pending · created_by ถูกทับเป็นคนยื่นเอง\\n';
  else v_fail := v_fail + 1;
    v_out := v_out || format(E'❌ R14-DB-06 status=%s created_by ตรง=%s\\n', v_st, v_bool); end if;

  -- R14-DB-21 · หัวหน้าโครงการเรียก employee_balance ไม่ได้
  begin
    perform * from public.employee_balance(v_emp);
    v_fail := v_fail + 1; v_out := v_out || E'❌ R14-DB-21 หัวหน้าโครงการอ่านยอดค่าแรงได้\\n';
  exception when others then
    if sqlerrm like '%FORBIDDEN%' then v_pass := v_pass + 1;
      v_out := v_out || E'✅ R14-DB-21 employee_balance → FORBIDDEN สำหรับคนที่ไม่ใช่เจ้าของ\\n';
    else v_fail := v_fail + 1; v_out := v_out || format(E'❌ R14-DB-21 ได้ error อื่น: %s\\n', sqlerrm); end if;
  end;

  -- R14-DB-07 · เปลี่ยนสถานะเองไม่ได้
  begin
    update public.advances set status = 'approved' where id = v_adv;
    if found then v_fail := v_fail + 1; v_out := v_out || E'❌ R14-DB-07 หัวหน้าโครงการอนุมัติเองได้\\n';
    else v_pass := v_pass + 1; v_out := v_out || E'✅ R14-DB-07 อนุมัติเอง → RLS ตัดเหลือ 0 แถว\\n'; end if;
  exception when others then
    if sqlerrm like '%APPROVE_FORBIDDEN%' then v_pass := v_pass + 1;
      v_out := v_out || E'✅ R14-DB-07 อนุมัติเอง → APPROVE_FORBIDDEN\\n';
    else v_fail := v_fail + 1; v_out := v_out || format(E'❌ R14-DB-07 ได้ error อื่น: %s\\n', sqlerrm); end if;
  end;

  -- ── กลับเป็น superuser แล้วสวมสิทธิ์เจ้าของ ─────────────────────────
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  -- R14-DB-15 · คำขอที่ยังไม่อนุมัติไม่ใช่เงิน
  select accrued, advanced, balance into v_num, v_num2, v_num3
  from public.employee_balance_raw(v_emp);
  if v_num = 1000 and v_num2 = 0 and v_num3 = 1000 then v_pass := v_pass + 1;
    v_out := v_out || E'✅ R14-DB-15 มีคำขอ ฿800 ค้าง → ค่าแรง ฿1,000 · เบิกแล้ว ฿0 · คงเหลือ ฿1,000\\n';
  else v_fail := v_fail + 1;
    v_out := v_out || format(E'❌ R14-DB-15 accrued=%s advanced=%s balance=%s\\n', v_num, v_num2, v_num3); end if;

  -- R14-DB-10 · ตีกลับต้องมีเหตุผล
  begin
    update public.advances set status = 'rejected' where id = v_adv;
    v_fail := v_fail + 1; v_out := v_out || E'❌ R14-DB-10 ตีกลับโดยไม่มีเหตุผลผ่านได้\\n';
  exception when others then
    if sqlerrm like '%advances_rejected_needs_reason%' then v_pass := v_pass + 1;
      v_out := v_out || E'✅ R14-DB-10 ตีกลับไม่ใส่เหตุผล → check advances_rejected_needs_reason\\n';
    else v_fail := v_fail + 1; v_out := v_out || format(E'❌ R14-DB-10 ได้ error อื่น: %s\\n', sqlerrm); end if;
  end;

  -- R14-DB-08 · ตีกลับแล้วผู้ยื่นแก้ = ส่งใหม่
  update public.advances set status = 'rejected', rejected_reason = 'เพิ่งเบิกไปเมื่อวาน' where id = v_adv;
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sup::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.advances set amount = 600 where id = v_adv;
  reset role;
  select status::text, rejected_reason, amount into v_st, v_err, v_num from public.advances where id = v_adv;
  if v_st = 'pending' and v_err is null and v_num = 600 then v_pass := v_pass + 1;
    v_out := v_out || E'✅ R14-DB-08 ผู้ยื่นแก้ใบที่ถูกตีกลับ → pending · เหตุผลถูกล้าง · ยอด ฿600\\n';
  else v_fail := v_fail + 1;
    v_out := v_out || format(E'❌ R14-DB-08 status=%s reason=%s amount=%s\\n', v_st, v_err, v_num); end if;

  -- R14-DB-11 · อนุมัติแล้ว approved_by/at ถูกเติมโดย trigger
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  update public.advances set status = 'approved' where id = v_adv;
  select approved_by = v_owner and approved_at is not null into v_bool from public.advances where id = v_adv;
  if v_bool then v_pass := v_pass + 1;
    v_out := v_out || E'✅ R14-DB-11 อนุมัติ → approved_by/approved_at ถูกเติมให้เอง\\n';
  else v_fail := v_fail + 1; v_out := v_out || E'❌ R14-DB-11 approved_by/at ไม่ถูกเติม\\n'; end if;

  -- R14-NOTIF-01/03 · แจ้งเตือนถึงเจ้าของและถึงผู้ยื่น
  select count(*) into v_num from public.notifications
   where kind::text = 'advance_pending' and body like '%R14 ตรวจชั่วคราว%';
  select count(*) into v_num2 from public.notifications
   where kind::text = 'advance_rejected' and body like '%เพิ่งเบิกไปเมื่อวาน%';
  if v_num >= 1 and v_num2 = 1 then v_pass := v_pass + 1;
    v_out := v_out || format(E'✅ R14-NOTIF-01/03 เจ้าของได้ %s ใบ · ผู้ยื่นได้ใบตีกลับพร้อมเหตุผล\\n', v_num);
  else v_fail := v_fail + 1;
    v_out := v_out || format(E'❌ R14-NOTIF pending=%s rejected=%s\\n', v_num, v_num2); end if;

  -- R14-DB-16/17 · จ่ายค่าแรงตอนมีคำขอค้างอยู่
  -- 🔴 คำขอต้องถูก **ยื่นโดยหัวหน้าโครงการจริง ๆ** — insert ใต้สิทธิ์เจ้าของเมื่อไหร่
  -- guard จะดันเป็นสถานะ approved ให้ (กฎ 22 ก.ย. 2569: เจ้าของคีย์เอง = จ่ายเงินแล้ว)
  -- แล้วแถวตรวจนี้จะวัดคนละเรื่องกับที่ตั้งใจ โดยที่ตัวเลขยังดูสมเหตุสมผล
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sup::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.advances(employee_id, amount, advance_date, site_id)
    values (v_emp, 900, v_today, v_site) returning id into v_adv2;
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  select run_id into v_run from public.pay_employee_wage(v_emp);
  select accrued, advance_deducted, net_paid into v_num, v_num2, v_num3
    from public.payroll_lines where run_id = v_run and employee_id = v_emp;
  if v_num = 1000 and v_num2 = 600 and v_num3 = 400 then v_pass := v_pass + 1;
    v_out := v_out || E'✅ R14-DB-16 ค่าแรง ฿1,000 · อนุมัติแล้ว ฿600 · คำขอค้าง ฿900 → หัก ฿600 จ่ายจริง ฿400\\n';
  else v_fail := v_fail + 1;
    v_out := v_out || format(E'❌ R14-DB-16 accrued=%s deducted=%s paid=%s\\n', v_num, v_num2, v_num3); end if;

  select status::text, deducted_amount, payroll_run_id is null into v_st, v_num, v_bool
    from public.advances where id = v_adv2;
  if v_st = 'pending' and v_num = 0 and v_bool then v_pass := v_pass + 1;
    v_out := v_out || E'✅ R14-DB-16b คำขอที่ยังไม่อนุมัติไม่ถูกหัก ไม่ถูกผูกกับรอบจ่าย\\n';
  else v_fail := v_fail + 1;
    v_out := v_out || format(E'❌ R14-DB-16b status=%s deducted=%s run ว่าง=%s\\n', v_st, v_num, v_bool); end if;

  -- R14-DB-13 · ใบที่ถูกหักแล้วเปลี่ยนสถานะไม่ได้
  begin
    update public.advances set status = 'rejected', rejected_reason = 'ขอถอน' where id = v_adv;
    v_fail := v_fail + 1; v_out := v_out || E'❌ R14-DB-13 ถอนอนุมัติใบที่ถูกหักไปแล้วได้\\n';
  exception when others then
    if sqlerrm like '%PAYROLL_CLOSED%' then v_pass := v_pass + 1;
      v_out := v_out || E'✅ R14-DB-13 เปลี่ยนสถานะใบที่ถูกหักแล้ว → PAYROLL_CLOSED\\n';
    else v_fail := v_fail + 1; v_out := v_out || format(E'❌ R14-DB-13 ได้ error อื่น: %s\\n', sqlerrm); end if;
  end;

  -- R14-DB-14 · ห้ามลงวันในอนาคต (กฎเดิมยังอยู่)
  begin
    insert into public.advances(employee_id, amount, advance_date, site_id, status)
      values (v_emp, 100, v_today + 1, v_site, 'approved');
    v_fail := v_fail + 1; v_out := v_out || E'❌ R14-DB-14 ลงวันในอนาคตได้\\n';
  exception when others then
    if sqlerrm like '%DATE_FUTURE%' then v_pass := v_pass + 1;
      v_out := v_out || E'✅ R14-DB-14 ลงวันในอนาคต → DATE_FUTURE\\n';
    else v_fail := v_fail + 1; v_out := v_out || format(E'❌ R14-DB-14 ได้ error อื่น: %s\\n', sqlerrm); end if;
  end;

  -- R14-DB-02 · default ของคอลัมน์ต้องเป็น pending
  select column_default into v_err from information_schema.columns
   where table_schema = 'public' and table_name = 'advances' and column_name = 'status';
  if v_err like '%pending%' then v_pass := v_pass + 1;
    v_out := v_out || E'✅ R14-DB-02 default ของ status = pending (ค่าที่ปลอดภัยที่สุด)\\n';
  else v_fail := v_fail + 1; v_out := v_out || format(E'❌ R14-DB-02 default = %s\\n', v_err); end if;

  -- R14-DB-22 · index ของคิว
  select count(*) into v_num from pg_indexes
   where schemaname = 'public' and indexname = 'advances_pending_idx';
  if v_num = 1 then v_pass := v_pass + 1; v_out := v_out || E'✅ R14-DB-22 มี index advances_pending_idx\\n';
  else v_fail := v_fail + 1; v_out := v_out || E'❌ R14-DB-22 ไม่มี index advances_pending_idx\\n'; end if;

  v_out := v_out || format(E'\\n  %s/%s ผ่าน · ทุกอย่างถูก rollback ทิ้งแล้ว\\n', v_pass, v_pass + v_fail);
  raise exception '%', v_out;
end $check$;`

const BLOCK2 = `do $check$
declare
  v_out  text := E'\\n── R14-DB รอบสอง ─────────────────────────────────\\n';
  v_pass int := 0; v_fail int := 0;
  v_owner uuid; v_sup uuid; v_sup2 uuid;
  v_site uuid; v_other uuid; v_emp uuid; v_adv uuid; v_key uuid; v_json jsonb;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_n int; v_num numeric; v_num2 numeric; v_st text; v_bool boolean;
begin
  perform pg_catalog.set_config('search_path', 'public', true);
  select id into v_owner from public.profiles where role='owner' and is_active limit 1;
  select id into v_sup  from public.profiles where role='site_supervisor' and is_active order by full_name limit 1;
  select id into v_sup2 from public.profiles where role='site_supervisor' and is_active and id <> v_sup order by full_name limit 1;

  insert into public.sites(name,status) values ('R14 ตรวจ A','active') returning id into v_site;
  insert into public.sites(name,status) values ('R14 ตรวจ B','active') returning id into v_other;
  insert into public.site_supervisors(site_id,profile_id,effective_from) values (v_site,v_sup,v_today-30);
  insert into public.site_supervisors(site_id,profile_id,effective_from) values (v_other,v_sup2,v_today-30);
  insert into public.employees(full_name,job_title) values ('R14 ตรวจ คนงาน','กรรมกร') returning id into v_emp;
  insert into public.employee_wages(employee_id,wage_type,daily_rate) values (v_emp,'daily',500);
  insert into public.attendance(work_date,site_id,employee_id,work_units) values (v_today-1,v_site,v_emp,1);
  insert into public.attendance(work_date,site_id,employee_id,work_units) values (v_today-2,v_site,v_emp,1);

  -- ── หัวหน้าโครงการคนที่ 1 ──────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub',v_sup::text,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  -- R14-DB-05 · ยื่นให้โครงการที่ไม่ได้ดูแล
  begin
    insert into public.advances(employee_id,amount,advance_date,site_id)
      values (v_emp,300,v_today,v_other);
    v_fail := v_fail+1; v_out := v_out || E'❌ R14-DB-05 ยื่นให้โครงการที่ไม่ได้ดูแลได้\\n';
  exception when others then
    if sqlerrm like '%row-level security%' then v_pass := v_pass+1;
      v_out := v_out || E'✅ R14-DB-05 โครงการที่ไม่ได้ดูแล → RLS ปฏิเสธ\\n';
    else v_fail := v_fail+1; v_out := v_out || format(E'❌ R14-DB-05 error อื่น: %s\\n', sqlerrm); end if;
  end;

  insert into public.advances(employee_id,amount,advance_date,site_id)
    values (v_emp,1500,v_today,v_site) returning id into v_adv;

  -- ── หัวหน้าโครงการคนที่ 2 มองไม่เห็นใบของคนแรก ────────────────────
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',v_sup2::text,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.advances where id = v_adv;
  if v_n = 0 then v_pass := v_pass+1;
    v_out := v_out || E'✅ R14-DB-20 หัวหน้าโครงการอีกคนมองไม่เห็นคำขอที่ไม่ใช่ของตัวเอง\\n';
  else v_fail := v_fail+1; v_out := v_out || E'❌ R14-DB-20 เห็นคำขอของคนอื่น\\n'; end if;

  -- ── เจ้าของอนุมัติ แล้วกดซ้ำ ───────────────────────────────────────
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  update public.advances set status='approved' where id = v_adv;
  select count(*) into v_n from public.notifications where kind::text='advance_approved';
  update public.advances set status='approved' where id = v_adv;           -- กดซ้ำ
  select count(*) into v_num from public.notifications where kind::text='advance_approved';
  if v_num = v_n then v_pass := v_pass+1;
    v_out := v_out || E'✅ R14-DB-12 กดอนุมัติซ้ำ → ไม่มีแจ้งเตือนใบที่สอง\\n';
  else v_fail := v_fail+1; v_out := v_out || format(E'❌ R14-DB-12 แจ้งเตือนเพิ่มจาก %s เป็น %s\\n', v_n, v_num); end if;

  -- R14-DB-18 · รายงานนับเฉพาะที่อนุมัติแล้ว
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_sup::text,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.advances(employee_id,amount,advance_date,site_id)
    values (v_emp,700,v_today,v_site);
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  select advance_paid into v_num  from public.report_summary(v_today, v_today, v_site);
  select advance_paid into v_num2 from public.report_labor(v_today, v_today, v_site);
  if v_num = 1500 and v_num2 = 1500 then v_pass := v_pass+1;
    v_out := v_out || E'✅ R14-DB-18 report_summary/report_labor นับ ฿1,500 (อนุมัติแล้ว) ไม่นับคำขอ ฿700\\n';
  else v_fail := v_fail+1;
    v_out := v_out || format(E'❌ R14-DB-18 summary=%s labor=%s (ควรได้ 1500 ทั้งคู่)\\n', v_num, v_num2); end if;

  -- R14-DB-17 · หักได้เท่าค่าแรง ส่วนที่เหลือค้างไปรอบหน้า
  perform public.pay_employee_wage(v_emp);
  select deducted_amount, payroll_run_id is null into v_num, v_bool from public.advances where id = v_adv;
  if v_num = 1000 and v_bool then v_pass := v_pass+1;
    v_out := v_out || E'✅ R14-DB-17 ใบ ฿1,500 บนค่าแรง ฿1,000 → หัก ฿1,000 · เหลือ ฿500 ค้างรอบหน้า\\n';
  else v_fail := v_fail+1;
    v_out := v_out || format(E'❌ R14-DB-17 หักไป %s · ยังไม่ผูกรอบ=%s\\n', v_num, v_bool); end if;

  -- R14-DB-09 · ผู้ยื่นแก้ใบที่อนุมัติแล้วไม่ได้
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',v_sup::text,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  update public.advances set note = 'แอบแก้' where id = v_adv;
  get diagnostics v_n = row_count;
  if v_n = 0 then v_pass := v_pass+1;
    v_out := v_out || E'✅ R14-DB-09 ผู้ยื่นแก้ใบที่อนุมัติแล้ว → RLS ตัดเหลือ 0 แถว\\n';
  else v_fail := v_fail+1; v_out := v_out || E'❌ R14-DB-09 แก้ใบที่อนุมัติแล้วได้\\n'; end if;
  reset role;

  -- R14-DB-19 · AI คีย์แทนเจ้าของ = อนุมัติแล้วทันที
  insert into public.mcp_keys(label,key_hash,key_prefix,created_by)
    values ('R14 ตรวจชั่วคราว','x','rk_test',v_owner) returning id into v_key;
  v_json := public.mcp_create_advance(v_owner, v_key, v_emp, 250, v_today, 'cash', v_site, 'ตรวจ R14');
  select status::text into v_st from public.advances where id = (v_json->>'advance_id')::uuid;
  if v_st = 'approved' then v_pass := v_pass+1;
    v_out := v_out || E'✅ R14-DB-19 mcp_create_advance → approved ทันที ไม่ตกค้างในคิว\\n';
  else v_fail := v_fail+1; v_out := v_out || format(E'❌ R14-DB-19 status=%s\\n', v_st); end if;

  v_out := v_out || format(E'\\n  %s/%s ผ่าน · rollback แล้ว\\n', v_pass, v_pass+v_fail);
  raise exception '%', v_out;
end $check$;`

const BLOCK3 = `do $c$
declare
  v_out text := E'\\n';
  v_owner uuid; v_sup uuid; v_site uuid; v_emp uuid; v_id uuid; v_st text; v_by uuid;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_pass int := 0; v_fail int := 0;
begin
  perform pg_catalog.set_config('search_path','public',true);
  select id into v_owner from public.profiles where role='owner' and is_active limit 1;
  select id into v_sup   from public.profiles where role='site_supervisor' and is_active limit 1;
  insert into public.sites(name,status) values ('R14 ตรวจ owner','active') returning id into v_site;
  insert into public.site_supervisors(site_id,profile_id,effective_from) values (v_site,v_sup,v_today-30);
  insert into public.employees(full_name,job_title) values ('R14 ตรวจ owner','กรรมกร') returning id into v_emp;

  -- R14-DB-24 · เจ้าของคีย์เบิกโดย **ไม่ส่งคอลัมน์ status** (โค้ดก่อน R14 ที่ยัง deploy อยู่)
  perform set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.advances(employee_id, amount, advance_date, site_id)
    values (v_emp, 500, v_today, v_site) returning id into v_id;
  reset role;
  select status::text, approved_by into v_st, v_by from public.advances where id = v_id;
  if v_st = 'approved' and v_by = v_owner then v_pass := v_pass+1;
    v_out := v_out || E'✅ R14-DB-24 เจ้าของ insert ไม่ส่งสถานะ → approved + approved_by (โค้ดเก่าที่ยัง deploy อยู่ปลอดภัย)\\n';
  else v_fail := v_fail+1; v_out := v_out || format(E'❌ R14-DB-24 ได้ status=%s\\n', v_st); end if;

  -- คู่ตรงข้าม: หัวหน้าโครงการยังถูกบังคับเป็น pending เหมือนเดิม
  perform set_config('request.jwt.claims', json_build_object('sub',v_sup::text,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.advances(employee_id, amount, advance_date, site_id)
    values (v_emp, 300, v_today, v_site) returning id into v_id;
  reset role;
  select status::text into v_st from public.advances where id = v_id;
  if v_st = 'pending' then v_pass := v_pass+1;
    v_out := v_out || E'✅ R14-DB-24b หัวหน้าโครงการ insert → ยังเป็น pending เหมือนเดิม\\n';
  else v_fail := v_fail+1; v_out := v_out || format(E'❌ R14-DB-24b หัวหน้าโครงการได้ status=%s\\n', v_st); end if;

  raise exception '%', v_out;
end $c$;`

console.log('\n── R14 · คำขอเบิกค่าแรง (ฐานข้อมูล) ──────────────────────────')

let pass = 0
let fail = 0

for (const [i, sql] of [BLOCK1, BLOCK2, BLOCK3].entries()) {
  const { rolledBack, message } = await run(sql)
  if (!rolledBack) {
    fail += 1
    console.log(`  ❌ ก้อนที่ ${i + 1} ไม่ได้ถูก rollback — ตรวจของค้างในฐานทันที`)
    continue
  }
  for (const line of message.split('\n')) {
    const t = line.trim()
    if (t.startsWith('✅')) { pass += 1; console.log(`  ${t}`) }
    else if (t.startsWith('❌')) { fail += 1; console.log(`  ${t}`) }
  }
}

console.log(`\n  ${pass}/${pass + fail} ผ่าน · ไม่มีแถวไหนถูกเขียนค้างไว้`)
process.exit(fail === 0 ? 0 : 1)
