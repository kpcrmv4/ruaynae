-- R12 (แก้) · ออกเลขที่เอกสารแบบอะตอมมิก + ปลดล็อกการลบโครงการที่มีเอกสารผูกอยู่
--
-- ทั้งสองข้อเจอจาก `scripts/verify-documents.mjs` รอบแรก ไม่ใช่จากการอ่านโค้ด:
--
-- 1 · **double-click ปุ่ม "ออกเอกสาร" กินเลขที่เอกสารทิ้งหนึ่งใบ**
--     route เดิมอ่านสถานะ → เรียก `next_doc_no()` → `update` เป็นสามจังหวะ
--     สองคำขอที่มาพร้อมกันจึงอ่านเห็น `draft` ทั้งคู่ แล้วขอเลขคนละใบ
--     ใบหลังไป `update` ทับแล้วโดน `DOC_NO_IMMUTABLE` → คนกดเห็น **500**
--     (ไม่ใช่ 409 ที่อ่านรู้เรื่อง) และ **เลขที่ถูกจ่ายไปแล้วหายไปเฉย ๆ**
--     → เลขบนกระดาษมีช่องว่างที่ตอบสรรพากรไม่ได้ว่าใบที่หายไปคือใบไหน
--     · แก้: ย้ายทั้งชุดลงเป็นฟังก์ชันเดียวที่ `select ... for update` ก่อนอ่าน
--       สถานะ — คำขอที่สองเข้าคิวที่บรรทัดนั้น ตื่นมาเห็น `issued` แล้วเด้งออก
--       **ก่อน**จะขอเลข จึงไม่มีเลขไหนถูกจ่ายทิ้ง
--
-- 2 · **ลบโครงการที่เคยออกใบเสร็จและส่งไปแล้ว ไม่ได้เลย**
--     `documents.site_id` เป็น `on delete set null` → การลบโครงการยิง
--     `update documents set site_id = null` เข้ามาเอง · `guard_document`
--     นับว่านั่นคือ "มีคนแก้โครงการของใบที่ล็อกแล้ว" → `DOC_LOCKED`
--     ทั้งคำสั่งลบล้ม โดยข้อความที่เจ้าของเห็นไม่ได้พูดถึงโครงการเลยสักคำ
--     · แก้: การที่ `site_id` กลายเป็น null **เพราะแถวโครงการไม่มีอยู่แล้ว**
--       ไม่ใช่การแก้เอกสาร · ย้ายโครงการของใบที่ล็อกแล้วยังห้ามเหมือนเดิม

-- ── 1 · guard: แยก "โครงการถูกลบ" ออกจาก "มีคนย้ายโครงการ" ───────────
create or replace function public.guard_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locked boolean;
  v_site_moved boolean;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    return new;
  end if;

  new.created_by := old.created_by;

  v_locked := old.status in ('sent', 'accepted', 'void') or old.txn_id is not null;

  -- 🔴 `site_id` ที่กลายเป็น null ทั้งที่แถวโครงการหายไปแล้ว = ผลของ
  -- FK `on delete set null` ไม่ใช่การกระทำของคน · ถ้านับเป็นการแก้
  -- เจ้าของจะลบโครงการที่เคยออกใบเสร็จไปแล้วไม่ได้ตลอดกาล
  v_site_moved := new.site_id is distinct from old.site_id
    and not (
      new.site_id is null
      and old.site_id is not null
      and not exists (select 1 from public.sites s where s.id = old.site_id)
    );

  if v_locked and (
       new.vat_mode        is distinct from old.vat_mode
    or new.vat_rate        is distinct from old.vat_rate
    or new.customer_name   is distinct from old.customer_name
    or new.customer_tax_id is distinct from old.customer_tax_id
    or new.doc_date        is distinct from old.doc_date
    or v_site_moved
  ) then
    raise exception 'DOC_LOCKED: เอกสารนี้ส่งให้ลูกค้าหรือผูกรายรับไปแล้ว แก้ไม่ได้ ให้ยกเลิกแล้วออกใบใหม่';
  end if;

  if old.doc_no is not null and new.doc_no is distinct from old.doc_no then
    raise exception 'DOC_NO_IMMUTABLE: เลขที่เอกสารเปลี่ยนไม่ได้';
  end if;

  return new;
end $$;

revoke execute on function public.guard_document() from public, anon, authenticated;

-- ── 2 · ออกเลขที่เอกสาร — ตรวจ ขอเลข และเขียน ในคำสั่งเดียว ──────────
-- สำเนาผู้ขาย (`p_seller`) คิดฝั่ง Next เพราะมันรวม `branding` + `app_settings`
-- ที่ route อ่านด้วยสิทธิ์ของเจ้าของอยู่แล้ว · ข้อความบาท (`amount_words`)
-- ตามมาอีกคำสั่งได้ เพราะ `issued` ไม่ใช่สถานะที่ล็อก และไม่แตะ `doc_no`
create or replace function public.issue_document(p_id uuid, p_seller jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind   public.doc_kind;
  v_status public.doc_status;
  v_lines  int;
  v_no     text;
begin
  if not (select public.is_owner()) then
    raise exception 'FORBIDDEN: เฉพาะเจ้าของเท่านั้นที่ออกเอกสารได้';
  end if;

  -- 🔴 ล็อกแถวก่อนอ่านสถานะ — สองคำขอที่กดพร้อมกันเข้าคิวกันที่บรรทัดนี้
  -- คำขอที่สองตื่นมาเห็น `issued` แล้วออกก่อนถึงบรรทัดขอเลข
  select d.kind, d.status into v_kind, v_status
    from public.documents d where d.id = p_id for update;

  if v_kind is null then
    raise exception 'DOC_NOT_FOUND: ไม่พบเอกสารนี้';
  end if;
  if v_status <> 'draft' then
    raise exception 'DOC_ALREADY_ISSUED: เอกสารนี้ออกเลขไปแล้ว';
  end if;

  select count(*) into v_lines
    from public.document_lines l where l.document_id = p_id;
  if v_lines = 0 then
    raise exception 'DOC_LINES_EMPTY: เอกสารที่ไม่มีรายการ ออกไม่ได้';
  end if;

  v_no := public.next_doc_no(v_kind);

  update public.documents
     set doc_no    = v_no,
         status    = 'issued',
         issued_at = now(),
         issued_by = auth.uid(),
         seller    = p_seller
   where id = p_id;

  return v_no;
end $$;

revoke execute on function public.issue_document(uuid, jsonb) from public, anon;
grant execute on function public.issue_document(uuid, jsonb) to authenticated;
