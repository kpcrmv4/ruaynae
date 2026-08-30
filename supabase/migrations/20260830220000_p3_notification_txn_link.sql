-- ════════════════════════════════════════════════════════════════════════
-- P3-a2 · ผูกแจ้งเตือนกลับไปหารายการที่มันพูดถึง
-- ครอบแถว P3-DB-18 · ทำให้ P3-DB-15 ตรวจได้ตรง ๆ แทนการเดาจากข้อความ
-- ════════════════════════════════════════════════════════════════════════
--
-- ทำไมต้องมีคอลัมน์นี้ ทั้งที่ข้อความก็บอกยอดเงินอยู่แล้ว:
--
-- 1. **แจ้งเตือนที่ชี้ไปหาของที่ถูกลบไปแล้วคือกระดิ่งที่โกหก** — รายการ `pending`
--    ลบได้ พอลบแล้วแจ้งเตือน "มีรายจ่ายรออนุมัติ" ยังค้างอยู่ กดแล้วไม่เจออะไร
--    `on delete cascade` ทำให้เรื่องนี้เป็นไปไม่ได้ตั้งแต่ระดับฐานข้อมูล
-- 2. **ตัวตรวจต้องผูกแจ้งเตือนกับรายการได้** — ไม่งั้นต้องเดาจากสตริงยอดเงิน
--    ซึ่งจะชนกันทันทีที่มีสองรายการยอดเท่ากัน
-- 3. P7 จะเอาไปทำลิงก์ลึกถึงรายการได้โดยไม่ต้องแก้โครงอีกรอบ

alter table public.notifications
  add column if not exists txn_id uuid references public.transactions(id) on delete cascade;

create index if not exists notifications_txn_idx on public.notifications(txn_id);

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
      insert into public.notifications (user_id, kind, title, body, link, txn_id)
      select p.id,
             'txn_pending',
             'มีรายจ่ายรออนุมัติ',
             v_money || ' · ' || coalesce(v_site, 'ส่วนกลาง') || ' · ' || coalesce(v_what, 'ไม่มีรายละเอียด'),
             '/approvals',
             new.id
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
      insert into public.notifications (user_id, kind, title, body, link, txn_id)
      values (new.created_by, 'txn_approved', 'รายการของคุณได้รับอนุมัติแล้ว',
              v_money || ' · ' || coalesce(v_site, 'ส่วนกลาง') || ' · ' || coalesce(v_what, ''),
              '/ledger?status=approved', new.id);
    elsif new.status = 'rejected' then
      insert into public.notifications (user_id, kind, title, body, link, txn_id)
      values (new.created_by, 'txn_rejected', 'รายการของคุณถูกตีกลับ',
              -- เหตุผลจริงต้องอยู่ในตัวข้อความ ไม่ใช่ "กรุณาตรวจสอบ" ลอย ๆ
              -- ที่บังคับให้คนต้องเปิดหาเองว่าผิดตรงไหน
              coalesce(nullif(btrim(coalesce(new.rejected_reason, '')), ''), 'ไม่ได้ระบุเหตุผล')
                || ' (' || v_money || ')',
              '/ledger?status=rejected', new.id);
    end if;
  end if;
  return null;
end $$;

revoke execute on function public.notify_transaction() from public, anon, authenticated;

-- `txn_id` ก็แก้ไม่ได้เหมือนคอลัมน์อื่น — แก้ได้เฉพาะ `read_at`
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
     or new.txn_id is distinct from old.txn_id
     or new.created_at is distinct from old.created_at then
    raise exception 'NOTIFICATION_READONLY: แจ้งเตือนแก้ได้เฉพาะสถานะอ่านแล้ว';
  end if;
  return new;
end $$;

revoke execute on function public.guard_notification() from public, anon, authenticated;
