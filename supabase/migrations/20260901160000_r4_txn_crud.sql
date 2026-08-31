-- ════════════════════════════════════════════════════════════════════════
-- R4 · แก้ไข / ลบ รายการเงินที่บันทึกไปแล้ว
-- ════════════════════════════════════════════════════════════════════════
--
-- ก่อนหน้านี้ "บันทึกแล้ว = แก้ไม่ได้ตลอดกาล" สำหรับเกือบทุกแถวในระบบจริง:
--
-- 🔴 รายการที่ **เจ้าของ** คีย์เองเป็น `approved` ตั้งแต่วินาทีแรก
--    (`/api/transactions` ตั้งให้ตาม role) — กฎ "แก้ยอดหลังอนุมัติไม่ได้"
--    จึงไม่ได้ปกป้องอะไรเลย มันแค่แปลว่าพิมพ์ยอดผิดหนึ่งหลักแล้วแก้ไม่ได้
--    และลบทิ้งก็ไม่ได้ · ทางออกเดียวที่เหลือคือปล่อยตัวเลขผิดค้างในรายงาน
--
-- 🔴 รายการที่ **หัวหน้าไซต์** คีย์แล้วถูกตีกลับ ติดตายเหมือนกัน — policy
--    ยอมให้แก้เฉพาะ `pending` ทั้งที่หน้าจอเขียนไว้ว่า "แก้แล้วส่งใหม่ได้"
--    และแจ้งเตือนที่ส่งไปก็บอกเหตุผลที่ต้องแก้ · คนที่ถูกตีกลับจึงทำได้
--    อย่างเดียวคือคีย์ใบใหม่ แล้วทิ้งใบเก่าค้างไว้ในระบบตลอดไป
--
-- สิ่งที่ยังไม่เปลี่ยน — การอนุมัติยังมีความหมายเหมือนเดิม:
--  · หัวหน้าไซต์ยังเปลี่ยนสถานะเองไม่ได้ และยังแตะรายการที่อนุมัติแล้วไม่ได้
--  · ทุกการแก้และการลบถูกบันทึกลง `audit_log` (before/after) ครบเหมือนเดิม
--    ซึ่งเจ้าของเปิดดูย้อนหลังได้ที่ `/audit` — **ความรับผิดชอบอยู่ที่นั่น
--    ไม่ใช่ที่การล็อกแถวไม่ให้ใครแก้**

-- ── guard trigger ───────────────────────────────────────────────────────
-- ต่อจาก `20260830181000_p2_created_by_guard.sql` · เปลี่ยนสามจุด:
--   1. ลบรายการที่อนุมัติแล้ว — เจ้าของทำได้ หัวหน้าไซต์ยังไม่ได้
--   2. แก้ยอด/ชนิด/ไซต์ของรายการที่อนุมัติแล้ว — เจ้าของทำได้ หัวหน้าไซต์ยังไม่ได้
--   3. หัวหน้าไซต์แก้รายการที่ถูกตีกลับ = **ส่งใหม่** สถานะกลับเข้าคิวอัตโนมัติ
create or replace function public.guard_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_owner boolean := public.is_owner();
  v_service  boolean := auth.uid() is null;
  v_cat_kind public.txn_kind;
begin
  if tg_op = 'DELETE' then
    -- 🔴 เงื่อนไขเปลี่ยนจาก "ห้ามทุกคน" เป็น "ห้ามทุกคนยกเว้นเจ้าของ"
    -- เจ้าของเป็นคนอนุมัติเอง การห้ามเจ้าของลบของที่ตัวเองอนุมัติจึงไม่ได้
    -- กันใครจากใคร · ร่องรอยการลบอยู่ใน audit_log พร้อมค่าเดิมทั้งแถว
    if old.status = 'approved' and not v_is_owner and not v_service then
      raise exception 'APPROVED_IMMUTABLE: ลบรายการที่อนุมัติแล้วไม่ได้';
    end if;
    return old;
  end if;

  select c.kind into v_cat_kind from public.categories c where c.id = new.category_id;
  if v_cat_kind is null or v_cat_kind <> new.kind then
    raise exception 'CATEGORY_KIND_MISMATCH: หมวดไม่ตรงกับชนิดรายการ';
  end if;

  if tg_op = 'INSERT' then
    -- ผู้บันทึกมาจากเซสชันเสมอ ไม่ใช่จาก payload
    if not v_service then
      new.created_by := auth.uid();
    end if;

    if not v_is_owner and not v_service then
      if new.kind = 'income' then
        raise exception 'INCOME_FORBIDDEN: หัวหน้าไซต์บันทึกรายรับไม่ได้';
      end if;
      if new.site_id is null then
        raise exception 'SITE_REQUIRED: หัวหน้าไซต์ต้องเลือกไซต์ รายจ่ายส่วนกลางเป็นของเจ้าของ';
      end if;
      if new.status <> 'pending' then
        raise exception 'APPROVE_FORBIDDEN: หัวหน้าไซต์ตั้งสถานะเองไม่ได้';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE — ผู้บันทึกเดิมห้ามถูกเขียนทับ ไม่งั้นประวัติเปลี่ยนเจ้าของได้
  new.created_by := old.created_by;

  if not v_is_owner and not v_service then
    if old.status = 'rejected' then
      -- 🔴 แก้ของที่ถูกตีกลับ = ส่งใหม่ · บังคับที่นี่ ไม่ใช่ที่ route
      -- เพราะสถานะเป็นเรื่องที่ client ห้ามเป็นคนตัดสิน (เหตุผลเดียวกับ
      -- ตอน insert) · ค่าที่ส่งมาถูกทับทิ้งเสมอ ไม่ว่าจะส่งอะไรมา
      new.status := 'pending';
      new.rejected_reason := null;
      new.approved_by := null;
      new.approved_at := null;
    elsif new.status is distinct from old.status then
      raise exception 'APPROVE_FORBIDDEN: หัวหน้าไซต์เปลี่ยนสถานะไม่ได้';
    end if;
  end if;

  -- 🔴 ยอดของรายการที่อนุมัติแล้ว **หัวหน้าไซต์**แก้ไม่ได้ (policy ก็กัน
  -- อยู่แล้วอีกชั้น — ตรงนี้คือด่านที่บอกเหตุผลได้) · เจ้าของแก้ได้ เพราะ
  -- เจ้าของคือคนอนุมัติ และรายการที่เจ้าของคีย์เองเกิดมาเป็น approved เลย
  if old.status = 'approved' and not v_is_owner and not v_service then
    if new.amount is distinct from old.amount then
      raise exception 'AMOUNT_LOCKED: แก้จำนวนเงินของรายการที่อนุมัติแล้วไม่ได้';
    end if;
    if new.kind is distinct from old.kind or new.site_id is distinct from old.site_id then
      raise exception 'AMOUNT_LOCKED: แก้ชนิดหรือไซต์ของรายการที่อนุมัติแล้วไม่ได้';
    end if;
  end if;

  if new.status = 'approved' and old.status <> 'approved' then
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;

  return new;
end $$;
revoke execute on function public.guard_transaction() from public, anon, authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────
-- ⚠️ กฎเดิมจาก `p2_created_by_guard` ยังใช้อยู่: **ห้ามใส่เงื่อนไขสถานะ
-- ใน `with check`** ไม่งั้น update ที่ถูกปฏิเสธจะโดน RLS ตัดเป็น 0 แถว
-- แล้ว PostgREST ตอบ 200 สำเร็จ ก่อนที่ trigger จะได้อธิบายว่าทำไมถึงไม่ได้
drop policy if exists transactions_update on public.transactions;
create policy transactions_update on public.transactions
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

-- ลบของตัวเองที่ยังไม่อนุมัติ — รวมของที่ถูกตีกลับ ซึ่งเจ้าตัวเป็นคนเดียว
-- ที่รู้ว่าจะแก้ส่งใหม่หรือทิ้งไปเลย
drop policy if exists transactions_delete on public.transactions;
create policy transactions_delete on public.transactions
  for delete to authenticated using (
    (select public.is_owner())
    or (created_by = (select auth.uid()) and status in ('pending', 'rejected'))
  );

-- ── สลิปของรายการที่แก้ได้ ──────────────────────────────────────────────
-- เดิมเงื่อนไขคือ "รายการนี้ pending" เฉย ๆ ซึ่งแปลว่าหัวหน้าไซต์คนหนึ่ง
-- ลบสลิปของอีกคนในไซต์เดียวกันได้ · ยังไม่เคยมี endpoint ไหนเรียกจริง
-- ตอนนี้ปุ่มแก้ไขเรียกแล้ว จึงต้องผูกกับ "ของตัวเอง" ให้ตรงกับ transactions
drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
  for insert to authenticated with check (
    exists (
      select 1 from public.transactions t
      where t.id = transaction_id
        and ((select public.is_owner())
             or (t.created_by = (select auth.uid())
                 and t.status in ('pending', 'rejected')))
    )
  );

drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments
  for delete to authenticated using (
    exists (
      select 1 from public.transactions t
      where t.id = transaction_id
        and ((select public.is_owner())
             or (t.created_by = (select auth.uid())
                 and t.status in ('pending', 'rejected')))
    )
  );

-- ── แจ้งเตือน ───────────────────────────────────────────────────────────
-- 🔴 การส่งใหม่หลังถูกตีกลับต้องเด้งหาเจ้าของ · ของเดิมเงียบสนิท เพราะ
-- เงื่อนไขที่มีอยู่คือ "คนทำ ≠ คนคีย์" ซึ่งการแก้ของตัวเองไม่เข้าเงื่อนไข
-- ผลคือใบที่แก้แล้วนอนอยู่ในคิวโดยไม่มีอะไรบอกว่ามันกลับมา
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

  -- แก้แล้วส่งใหม่ — เจ้าของต้องรู้ว่ามีของกลับเข้าคิว ต่อให้คนแก้คือคนคีย์เอง
  if new.status = 'pending' and old.status = 'rejected' then
    insert into public.notifications (user_id, kind, title, body, link)
    select p.id,
           'txn_pending',
           'รายการที่ตีกลับถูกแก้แล้วส่งใหม่',
           v_money || ' · ' || coalesce(v_site, 'ส่วนกลาง') || ' · ' || coalesce(v_what, 'ไม่มีรายละเอียด'),
           '/approvals'
    from public.profiles p
    where p.role = 'owner'
      and p.is_active
      and p.id is distinct from v_actor;
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
revoke execute on function public.notify_transaction() from public, anon, authenticated;
