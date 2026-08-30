-- ════════════════════════════════════════════════════════════════════════
-- P3-a · ตารางแจ้งเตือน · trigger ที่สร้างแจ้งเตือน · broadcast เข้า realtime
-- ครอบแถว P3-DB-01..17 ใน docs/test-plan/P3.md
-- ════════════════════════════════════════════════════════════════════════

do $$ begin
  create type public.notification_kind as enum ('txn_pending', 'txn_approved', 'txn_rejected');
  exception when duplicate_object then null;
end $$;

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       public.notification_kind not null,
  title      text not null,
  body       text,
  -- เส้นทางภายในแอปเท่านั้น — เก็บ URL เต็มไว้ในฐานข้อมูลคือการฝังโดเมนลงในข้อมูล
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

-- กระดิ่งอ่าน "ของฉัน เรียงใหม่ก่อน" และนับ "ของฉันที่ยังไม่อ่าน" — คนละดัชนี
create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications(user_id) where read_at is null;

alter table public.notifications enable row level security;

-- ── RLS ──────────────────────────────────────────────────────────────
-- 🔴 **ไม่มี** insert policy และ **ไม่มี** delete policy โดยตั้งใจ
-- มี insert policy ให้ `authenticated` เมื่อไหร่ ใครก็ยิงแจ้งเตือนปลอมเข้ากระดิ่ง
-- เจ้าของได้ · แจ้งเตือนเกิดจาก trigger ที่เป็น `security definer` ซึ่งไม่ผ่าน RLS อยู่แล้ว
-- และลบไม่ได้เพราะกระดิ่งที่ลบหลักฐานตัวเองได้ก็ไม่ใช่หลักฐาน
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── guard: แก้ได้เฉพาะ `read_at` ─────────────────────────────────────
-- RLS บอกได้แค่ว่า "แถวไหน" ไม่ได้บอกว่า "คอลัมน์ไหน" — ส่วนนั้นเป็นงานของ trigger
-- และ trigger ยังได้เปรียบตรงที่ `raise exception` บอกเหตุผลกลับไปได้
-- ต่างจาก policy ที่ปฏิเสธแล้วเงียบ (0 แถว = สำเร็จ ในสายตาของ PostgREST)
create or replace function public.guard_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.kind is distinct from old.kind
     or new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.link is distinct from old.link
     or new.created_at is distinct from old.created_at then
    raise exception 'NOTIFICATION_READONLY: แจ้งเตือนแก้ได้เฉพาะสถานะอ่านแล้ว';
  end if;
  return new;
end $$;

drop trigger if exists notifications_guard on public.notifications;
create trigger notifications_guard before update on public.notifications
  for each row execute function public.guard_notification();

-- ── broadcast ────────────────────────────────────────────────────────
-- 🔴 broadcast-from-database ไม่ใช่ subscribe ตาราง (CLAUDE.md §8)
-- subscribe ตารางส่งทุกแถวที่เปลี่ยนไปหาทุกคนที่ฟัง แล้วค่อยกรองที่ client
-- ซึ่งแปลว่าข้อมูลออกจากฐานไปแล้วก่อนถูกกรอง · topic ต่อคนจึงเป็นทางเดียวที่ปลอดภัย
create or replace function public.broadcast_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('id', new.id, 'kind', new.kind, 'title', new.title),
    'new',
    'notif:' || new.user_id::text,
    true
  );
  return null;
end $$;

drop trigger if exists notifications_broadcast on public.notifications;
create trigger notifications_broadcast after insert on public.notifications
  for each row execute function public.broadcast_notification();

-- อ่าน broadcast ได้เฉพาะ topic ของตัวเอง
-- `realtime.topic()` คืนชื่อ topic ที่ client กำลังขอ subscribe อยู่
drop policy if exists notifications_broadcast_read on realtime.messages;
create policy notifications_broadcast_read on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and (select realtime.topic()) = 'notif:' || (select auth.uid())::text
  );

-- ── สร้างแจ้งเตือนจากความเคลื่อนไหวของ transactions ──────────────────
-- 🔴 อยู่ที่ trigger ไม่ใช่ที่ route — เส้นทางไหนที่ลืมใส่จะเงียบหายไป
-- โดยไม่มีใครรู้ว่าหาย (เหตุผลเดียวกับ audit log ใน DESIGN.md §5.9)
create or replace function public.notify_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_site  text;
  v_money text := '฿' || to_char(new.amount, 'FM999,999,999');
  v_what  text;
begin
  select s.name into v_site from public.sites s where s.id = new.site_id;
  v_what := coalesce(nullif(btrim(coalesce(new.note, '')), ''),
                     (select c.name from public.categories c where c.id = new.category_id));

  if tg_op = 'INSERT' then
    -- รายการที่เจ้าของคีย์เองเข้าเป็น `approved` ทันที ไม่มีใครต้องรู้
    if new.status = 'pending' then
      insert into public.notifications (user_id, kind, title, body, link)
      select p.id,
             'txn_pending',
             'มีรายจ่ายรออนุมัติ',
             v_money || ' · ' || coalesce(v_site, 'ส่วนกลาง') || ' · ' || coalesce(v_what, 'ไม่มีรายละเอียด'),
             '/approvals'
      from public.profiles p
      where p.role = 'owner'
        and p.is_active
        -- ไม่ต้องบอกตัวเองว่าตัวเองคีย์อะไรไว้
        and p.id is distinct from new.created_by;
    end if;
    return null;
  end if;

  -- 🔴 เงื่อนไข `is distinct from` สำคัญ — กดอนุมัติซ้ำ (หรือ update ที่ไม่ได้
  -- เปลี่ยนสถานะ) ต้องไม่ยิงแจ้งเตือนใบที่สองใส่คนคีย์
  if new.status is distinct from old.status
     and new.created_by is not null
     and new.created_by is distinct from v_actor then
    if new.status = 'approved' then
      insert into public.notifications (user_id, kind, title, body, link)
      values (new.created_by, 'txn_approved', 'รายการของคุณได้รับอนุมัติแล้ว',
              v_money || ' · ' || coalesce(v_site, 'ส่วนกลาง') || ' · ' || coalesce(v_what, ''),
              '/ledger?status=approved');
    elsif new.status = 'rejected' then
      insert into public.notifications (user_id, kind, title, body, link)
      values (new.created_by, 'txn_rejected', 'รายการของคุณถูกตีกลับ',
              -- เหตุผลจริงต้องอยู่ในตัวข้อความ ไม่ใช่ "กรุณาตรวจสอบ" ลอย ๆ
              -- ที่บังคับให้คนต้องเปิดหาเองว่าผิดตรงไหน
              coalesce(nullif(btrim(coalesce(new.rejected_reason, '')), ''), 'ไม่ได้ระบุเหตุผล')
                || ' (' || v_money || ')',
              '/ledger?status=rejected');
    end if;
  end if;
  return null;
end $$;

drop trigger if exists transactions_notify on public.transactions;
create trigger transactions_notify after insert or update on public.transactions
  for each row execute function public.notify_transaction();

-- audit ครอบทุกตาราง ไม่มีข้อยกเว้น (CLAUDE.md §5)
drop trigger if exists notifications_audit on public.notifications;
create trigger notifications_audit after insert or update or delete on public.notifications
  for each row execute function public.audit_row();

-- ── สิทธิ์เรียกฟังก์ชัน ───────────────────────────────────────────────
-- ฟังก์ชันของ trigger ไม่มีใครควรเรียกได้ตรง ๆ · Postgres ไม่ตรวจสิทธิ์ EXECUTE
-- ตอนรัน trigger อยู่แล้ว การถอนสิทธิ์จึงไม่กระทบการทำงาน แต่ปิดทางที่คนยิง
-- `select public.notify_transaction()` เข้ามาเองเพื่อสร้างแจ้งเตือนปลอม
revoke execute on function public.guard_notification()     from public, anon, authenticated;
revoke execute on function public.broadcast_notification() from public, anon, authenticated;
revoke execute on function public.notify_transaction()     from public, anon, authenticated;
