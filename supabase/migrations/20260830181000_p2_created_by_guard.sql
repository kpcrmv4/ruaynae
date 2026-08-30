-- ════════════════════════════════════════════════════════════════════════
-- `transactions.created_by` ต้องถูกเติมโดยฐานข้อมูล ไม่ใช่โดย client
-- แก้ช่องที่ P2-DB-04 จับได้
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 อาการที่เจอ: หัวหน้าไซต์ยิง PATCH เปลี่ยน `status` เป็น `approved`
-- แล้วได้ **200 สำเร็จ** ทั้งที่สถานะไม่เปลี่ยน — ไม่มี error ให้ใครเห็น
--
-- กลไก: policy `transactions_update` มีเงื่อนไข `created_by = auth.uid()`
-- แต่ไม่มีอะไรเติม `created_by` เลย (ไม่มี default · client ไม่ได้ส่งมา)
-- ค่าจึงเป็น `null` → เงื่อนไขเป็น `null = uuid` = `null` ซึ่งไม่ใช่ `true`
-- → RLS มองไม่เห็นแถวนั้นสำหรับ UPDATE → โดน **0 แถว** → PostgREST ตอบ 200
--
-- สองผลที่ตามมา และอันที่สองแย่กว่า:
-- 1. หัวหน้าไซต์แก้รายการ pending ของตัวเองไม่ได้เลย ทั้งที่ออกแบบให้ทำได้
-- 2. **สาขา `created_by = auth.uid()` ของทุก policy ตายสนิทโดยไม่มีอะไรฟ้อง**
--    กฎที่เขียนไว้สวยงามแต่เป็นจริงไม่ได้ อ่านเหมือนมีการป้องกันอยู่
--
-- 🔴 เติมใน trigger ไม่ใช่ `default auth.uid()` เพราะ default ถูก client
-- ส่งค่ามาทับได้ · หัวหน้าไซต์ที่ส่ง `created_by` เป็น id ของคนอื่น จะสร้าง
-- รายการในนามคนอื่นได้ทันที — เรื่องเดียวกับ "ห้ามเชื่อ role ที่ client ส่งมา"

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
    if old.status = 'approved' and not v_service then
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
    if new.status is distinct from old.status then
      raise exception 'APPROVE_FORBIDDEN: หัวหน้าไซต์เปลี่ยนสถานะไม่ได้';
    end if;
  end if;

  if old.status = 'approved' and not v_service then
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

-- 🔴 policy UPDATE ต้องไม่บังคับ `status = 'pending'` ใน **with check**
-- ไม่งั้นการพยายามเปลี่ยนสถานะจะถูก RLS ตัดออกเงียบ ๆ (0 แถว = 200 สำเร็จ)
-- ก่อนที่ trigger จะได้อธิบายว่าทำไมถึงไม่ได้ · ให้ `using` คุมว่าแตะแถวไหนได้
-- แล้วปล่อยให้ **trigger เป็นคนปฏิเสธพร้อมเหตุผล** ซึ่งผู้ใช้ได้เห็นจริง
drop policy if exists transactions_update on public.transactions;
create policy transactions_update on public.transactions
  for update to authenticated
  using (
    (select public.is_owner())
    or (created_by = (select auth.uid()) and status = 'pending'
        and site_id is not null and public.supervises_site(site_id))
  )
  with check (
    (select public.is_owner())
    or (created_by = (select auth.uid())
        and site_id is not null and public.supervises_site(site_id))
  );
