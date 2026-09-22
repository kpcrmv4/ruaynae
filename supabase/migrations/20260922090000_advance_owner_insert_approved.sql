-- ════════════════════════════════════════════════════════════════════════
-- เจ้าของ insert ใบเบิก = จ่ายเงินจริง → `approved` เสมอ ไม่ว่าจะส่งสถานะมาหรือไม่
-- (ปิดช่องว่างระหว่าง "apply migration R14" กับ "deploy โค้ด R14")
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 อาการที่ปิด: R14 เปลี่ยน default ของ `advances.status` เป็น `pending`
-- ซึ่งถูกสำหรับคำขอของหัวหน้าโครงการ · แต่โค้ดที่ **ยังรันอยู่บน production**
-- (ก่อน deploy R14) insert ใบเบิกของเจ้าของโดยไม่ส่งคอลัมน์นี้เลย
-- → ใบที่เจ้าของเพิ่งจ่ายเงินสดออกไปจริง ๆ จะกลายเป็น "คำขอรออนุมัติ"
--   ไม่เข้ายอด "เบิกไปแล้ว" ไม่ถูกหักตอนจ่ายค่าแรง **และไม่มี error ที่ไหนเลย**
-- · ต่อให้ deploy เสร็จแล้วก็ยังคุ้ม เพราะมันทำให้กฎ "ใครสร้าง = สถานะไหน"
--   อยู่ที่ฐานข้อมูล ไม่ใช่ขึ้นกับว่า client เวอร์ชันไหนกำลังยิงเข้ามา
--
-- ขอบเขต: **เฉพาะเซสชันที่เป็นเจ้าของจริง** (`is_owner()`)
-- · service role (สคริปต์ · seed · ตัวตรวจ) ไม่ถูกแตะ — มันต้องสร้างแถว `pending`
--   ไว้จำลองคำขอได้ และมันระบุสถานะเองอยู่แล้วทุกที่
-- · หัวหน้าโครงการไม่ถูกแตะ — ยังถูกบังคับเป็น `pending` เหมือนเดิม
--
-- ⚠️ แปลว่า **เจ้าของสร้างใบ `pending` เองไม่ได้** ซึ่งตรงกับความจริง:
-- เจ้าของไม่ต้องยื่นคำขอกับตัวเอง · การอนุมัติคำขอของคนอื่นเป็น UPDATE ไม่ใช่ INSERT

create or replace function public.guard_advance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_owner boolean := public.is_owner();
  v_service  boolean := auth.uid() is null;
  v_locked   boolean;
begin
  if new.advance_date > (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'DATE_FUTURE: บันทึกเบิกของวันในอนาคตไม่ได้';
  end if;

  if tg_op = 'INSERT' then
    if not v_service then new.created_by := auth.uid(); end if;

    if not v_is_owner and not v_service then
      if new.site_id is null then
        raise exception 'SITE_REQUIRED: หัวหน้าโครงการต้องเลือกโครงการ';
      end if;
      if new.status <> 'pending' then
        raise exception 'APPROVE_FORBIDDEN: หัวหน้าโครงการตั้งสถานะเองไม่ได้';
      end if;
      if new.payroll_run_id is not null or new.deducted_amount <> 0 then
        raise exception 'APPROVE_FORBIDDEN: หัวหน้าโครงการตั้งยอดที่หักแล้วเองไม่ได้';
      end if;
    end if;

    -- 🔴 บรรทัดที่ปิดช่องว่าง: เจ้าของคีย์เอง = เงินออกจากมือไปแล้ว
    if v_is_owner then new.status := 'approved'; end if;

    if new.status = 'approved' and not v_service then
      new.approved_by := auth.uid();
      new.approved_at := now();
    end if;
    if new.status <> 'rejected' then new.rejected_reason := null; end if;
    return new;
  end if;

  -- ── UPDATE ─────────────────────────────────────────────────────────
  new.created_by := old.created_by;
  v_locked := old.payroll_run_id is not null or old.deducted_amount > 0;

  if not v_is_owner and not v_service then
    if old.status = 'rejected' then
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
    if new.status is distinct from old.status then
      raise exception 'PAYROLL_CLOSED: ใบเบิกนี้ถูกหักตอนจ่ายค่าแรงไปแล้ว เปลี่ยนสถานะไม่ได้';
    end if;
  end if;

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

revoke execute on function public.guard_advance() from public, anon, authenticated;
