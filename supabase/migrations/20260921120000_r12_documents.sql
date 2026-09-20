-- ════════════════════════════════════════════════════════════════════════
-- R12 · ใบเสนอราคา + ใบเสร็จรับเงิน/ใบกำกับภาษี
-- ════════════════════════════════════════════════════════════════════════
--
-- ถอดกติกามาจากไฟล์จริงของเจ้าของสองใบ (`RC1136` · `CM011`):
-- ทั้งสองใบ **ไม่ได้คิดจากราคาต่อหน่วย** แต่คิดจากยอดสุทธิที่ตกลงกัน
-- แล้วถอดกลับหารด้วย 1.07 (ราคา/หน่วยในไฟล์คือ 122500/1.07 และ 580000/1.07 เป๊ะ)
--
-- 🔴 VAT เป็น **ตัวรับเศษ** ในโหมด inclusive
-- ถ้าใช้ `ROUND(subtotal × 7%, 2)` กับ CM011 จะได้ยอดรวม 579,999.99
-- หายไปหนึ่งสตางค์จากยอดที่ตกลงไว้ · Excel รอดมาได้เพราะไม่ปัดตรงกลาง
-- แต่เราเก็บลงฐานข้อมูลต้องปัด → ให้ VAT ดูดเศษไป ยอดรวมจึงตรงกับที่ตกลงเสมอ
--
-- 🔴 `unit_price` เก็บ **ตัวเลขที่เจ้าของพิมพ์** ไม่ใช่ราคาก่อน VAT
-- โหมด inclusive แปลว่าตัวเลขนั้นรวม VAT แล้ว · `line_total` ต่างหากที่เป็น
-- ยอดก่อน VAT ที่ปัดแล้ว และผลบวกของมันคือ `subtotal` ที่พิมพ์บนกระดาษ
-- — บรรทัดบนใบกำกับภาษีต้องบวกได้ยอดข้างล่างเป๊ะ ไม่งั้นสรรพากรถาม
--
-- ตัดสินใจไว้แล้ว (ดู `docs/test-plan/R12.md` หมวด 0):
--   D1 ไม่มีหัก ณ ที่จ่ายบนกระดาษ · D2 ไม่มีประกันผลงานบนกระดาษ
--   D3 ผูกรายรับด้วยยอดเต็ม · D4 แก้ได้จนกว่าจะทำเครื่องหมายว่าส่งแล้ว
--   D5 เลขที่ตั้งเองจาก "เลขล่าสุด" · D6 รอบนี้สองชนิด

do $$ begin create type public.doc_kind as enum ('quotation', 'receipt');
  exception when duplicate_object then null; end $$;
do $$ begin create type public.doc_status as enum ('draft', 'issued', 'sent', 'accepted', 'void');
  exception when duplicate_object then null; end $$;
do $$ begin create type public.vat_mode as enum ('inclusive', 'exclusive', 'none');
  exception when duplicate_object then null; end $$;

-- ── 1 · ทะเบียนลูกค้า ────────────────────────────────────────────────
-- มาจากชีต "ลูกค้า" ในไฟล์ของเจ้าของ ซึ่งใช้ VLOOKUP เติมที่อยู่ให้
create table if not exists public.customers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 120),
  tax_id     text check (tax_id is null or length(btrim(tax_id)) between 10 and 20),
  -- สำนักงานใหญ่ / สาขาที่ n — ใบกำกับภาษีเต็มรูปต้องระบุ
  branch     text check (branch is null or length(branch) <= 40),
  address    text check (address is null or length(address) <= 300),
  phone      text check (phone is null or length(phone) <= 40),
  email      text check (email is null or length(email) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists customers_name_uniq on public.customers(lower(btrim(name)));

-- ── 2 · ตัวนับเลขที่เอกสาร ───────────────────────────────────────────
-- 🔴 เก็บ **เลขล่าสุดที่ออกไปแล้ว** ไม่ใช่ "เลขถัดไป" (คำสั่งเจ้าของ 20 ก.ย. 2569)
-- เจ้าของกรอก `RC1140` แล้วใบแรกที่ระบบออกคือ `RC1141` — ไม่ต้องให้คนบวกเอง
-- · ไม่มีค่าตั้งต้นในโค้ด · ยังไม่ตั้ง = ออกเอกสารไม่ได้ (`DOC_COUNTER_NOT_SET`)
create table if not exists public.doc_counters (
  kind       public.doc_kind primary key,
  prefix     text not null check (length(prefix) between 0 and 10),
  -- จำนวนหลักของเลข — `CM011` คือ pad 3 ไม่ใช่ 4 · ออกใบถัดไปได้ `CM012`
  pad        int  not null check (pad between 1 and 9),
  last_no    int  not null check (last_no >= 0),
  updated_at timestamptz not null default now()
);

-- ── 3 · เอกสาร ───────────────────────────────────────────────────────
create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  kind        public.doc_kind not null,
  -- `null` จนกว่าจะกด "ออกเอกสาร" — ร่างที่ทิ้งไปจึงไม่กินเลข
  doc_no      text,
  status      public.doc_status not null default 'draft',
  -- `null` = เอกสารที่ไม่ผูกโครงการ (เสนอราคางานที่ยังไม่รับ)
  site_id     uuid references public.sites(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,

  -- 🔴 สำเนาผู้ซื้อและผู้ขาย **แช่แข็งตอนออกเอกสาร** ไม่ได้ join กลับไปตอนพิมพ์
  -- เหตุผลเดียวกับ `wage_snapshot`: วันที่เจ้าของแก้ที่อยู่บริษัท ใบเสร็จที่ออกไป
  -- เมื่อปีที่แล้วต้องไม่เปลี่ยนตาม เพราะลูกค้าถือกระดาษอีกใบอยู่
  customer_name    text not null check (length(btrim(customer_name)) between 1 and 120),
  customer_tax_id  text,
  customer_branch  text,
  customer_address text,
  customer_phone   text,
  seller           jsonb,

  doc_date    date not null,
  -- ใบเสนอราคาเท่านั้น
  valid_until date,

  vat_mode    public.vat_mode not null default 'inclusive',
  vat_rate    numeric(5,4) not null default 0.07 check (vat_rate >= 0 and vat_rate <= 1),
  subtotal    numeric(14,2) not null default 0,
  vat_amount  numeric(14,2) not null default 0,
  total       numeric(14,2) not null default 0,
  -- ข้อความภาษาไทยของยอดสุทธิ — สำเนาเหมือนกัน แก้ฟังก์ชันแปลงทีหลังแล้วใบเก่าไม่เปลี่ยน
  amount_words text not null default '',

  note        text check (note is null or length(note) <= 500),
  -- รายรับที่ผูกกับใบเสร็จนี้ · `null` = ยังไม่ได้ลงรายรับ
  txn_id      uuid references public.transactions(id) on delete set null,
  -- ใบเสนอราคาที่ใบนี้ถูกสร้างต่อมา
  source_document_id uuid references public.documents(id) on delete set null,

  issued_at   timestamptz,
  issued_by   uuid references public.profiles(id) on delete set null,
  sent_at     timestamptz,
  accepted_at timestamptz,
  voided_at   timestamptz,
  void_reason text check (void_reason is null or length(btrim(void_reason)) between 1 and 200),

  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint documents_valid_until_after check (valid_until is null or valid_until >= doc_date),
  -- ออกเลขแล้วต้องมีเลข · ยังเป็นร่างต้องไม่มี
  constraint documents_no_when_issued check (
    (status = 'draft' and doc_no is null) or (status <> 'draft' and doc_no is not null))
);

-- เลขที่ห้ามซ้ำ **ต่อชนิด** — ใบเสนอราคากับใบเสร็จเดินเลขคนละชุด
create unique index if not exists documents_kind_no_uniq
  on public.documents(kind, doc_no) where doc_no is not null;
create index if not exists documents_kind_date_idx on public.documents(kind, doc_date desc);
create index if not exists documents_site_idx on public.documents(site_id, doc_date desc);
create index if not exists documents_customer_idx on public.documents(customer_id);
create index if not exists documents_txn_idx on public.documents(txn_id);
create index if not exists documents_source_idx on public.documents(source_document_id);
create index if not exists documents_status_idx on public.documents(status);

-- ── 4 · บรรทัดรายการ ─────────────────────────────────────────────────
create table if not exists public.document_lines (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  seq         int not null check (seq between 1 and 99),
  description text not null check (length(btrim(description)) between 1 and 300),
  qty         numeric(14,3) not null default 1 check (qty > 0),
  unit        text check (unit is null or length(unit) <= 20),
  -- ตัวเลขที่เจ้าของพิมพ์ · โหมด inclusive = รวม VAT แล้ว
  unit_price  numeric(14,4) not null default 0 check (unit_price >= 0),
  -- ยอดก่อน VAT ที่ปัดแล้ว — ผลบวกของคอลัมน์นี้คือ `documents.subtotal` เป๊ะ
  line_total  numeric(14,2) not null default 0,
  created_at  timestamptz not null default now(),

  constraint document_lines_seq_uniq unique (document_id, seq)
);
create index if not exists document_lines_doc_idx on public.document_lines(document_id, seq);

-- ── 5 · เติมช่องผู้ขายที่กระดาษต้องมีแต่ระบบยังไม่มี ─────────────────
alter table public.app_settings
  add column if not exists phone        text,
  add column if not exists email        text,
  add column if not exists branch_label text,
  add column if not exists bank_account text,
  add column if not exists doc_footer   text;

comment on column public.app_settings.branch_label is
  'สำนักงานใหญ่ / สาขาที่ n — ใบกำกับภาษีเต็มรูปต้องระบุของผู้ขายด้วย';

-- ── 6 · คิดยอดใหม่จากบรรทัดเสมอ ──────────────────────────────────────
-- 🔴 หน้าจอส่งยอดรวมมาเองไม่ได้ · กระดาษจะขัดกับบรรทัดของตัวเองไม่ได้
create or replace function public.doc_recalc(p_doc uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc   public.documents%rowtype;
  v_net   numeric(14,2);
  v_gross numeric(14,2);
begin
  select * into v_doc from public.documents d where d.id = p_doc;
  if not found then return; end if;

  -- ยอดก่อน VAT = ผลบวกของบรรทัด (บรรทัดถูกปัดมาแล้วทีละบรรทัด)
  select coalesce(sum(l.line_total), 0) into v_net
  from public.document_lines l where l.document_id = p_doc;

  if v_doc.vat_mode = 'inclusive' then
    -- ยอดที่ตกลงกับลูกค้า = ผลบวกของ (จำนวน × ราคาที่พิมพ์) ปัดทีละบรรทัด
    select coalesce(sum(round(l.qty * l.unit_price, 2)), 0) into v_gross
    from public.document_lines l where l.document_id = p_doc;

    update public.documents
       set subtotal   = v_net,
           vat_amount = v_gross - v_net,   -- 🔴 VAT รับเศษ ยอดรวมจึงตรงกับที่ตกลง
           total      = v_gross,
           updated_at = now()
     where id = p_doc;

  elsif v_doc.vat_mode = 'exclusive' then
    update public.documents
       set subtotal   = v_net,
           vat_amount = round(v_net * v_doc.vat_rate, 2),
           total      = v_net + round(v_net * v_doc.vat_rate, 2),
           updated_at = now()
     where id = p_doc;

  else
    update public.documents
       set subtotal = v_net, vat_amount = 0, total = v_net, updated_at = now()
     where id = p_doc;
  end if;
end $$;

revoke execute on function public.doc_recalc(uuid) from public, anon, authenticated;

create or replace function public.doc_lines_recalc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc uuid := case when tg_op = 'DELETE' then old.document_id else new.document_id end;
begin
  -- ยอดก่อน VAT ของบรรทัด คิดจากโหมดของเอกสารแม่
  if tg_op <> 'DELETE' then
    update public.document_lines l
       set line_total = case
             when d.vat_mode = 'inclusive'
               then round(l.qty * l.unit_price / (1 + d.vat_rate), 2)
             else round(l.qty * l.unit_price, 2)
           end
      from public.documents d
     where l.id = new.id and d.id = l.document_id;
  end if;

  perform public.doc_recalc(v_doc);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists document_lines_recalc on public.document_lines;
create trigger document_lines_recalc after insert or update or delete on public.document_lines
  for each row execute function public.doc_lines_recalc();

revoke execute on function public.doc_lines_recalc() from public, anon, authenticated;

-- เปลี่ยนโหมด/อัตราภาษีบนหัวเอกสาร = ต้องคิดบรรทัดใหม่ทั้งใบ
create or replace function public.doc_head_recalc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.vat_mode is distinct from old.vat_mode or new.vat_rate is distinct from old.vat_rate then
    update public.document_lines l
       set line_total = case
             when new.vat_mode = 'inclusive'
               then round(l.qty * l.unit_price / (1 + new.vat_rate), 2)
             else round(l.qty * l.unit_price, 2)
           end
     where l.document_id = new.id;
    perform public.doc_recalc(new.id);
  end if;
  return new;
end $$;

drop trigger if exists documents_head_recalc on public.documents;
create trigger documents_head_recalc after update on public.documents
  for each row execute function public.doc_head_recalc();

revoke execute on function public.doc_head_recalc() from public, anon, authenticated;

-- ── 7 · guard: ส่งให้ลูกค้าแล้วห้ามแก้ยอด ────────────────────────────
-- 🔴 เหตุผลไม่ใช่ "การอนุมัติต้องมีความหมาย" (§17 ข้อ 17 เตือนเรื่องนั้นไว้)
-- แต่เพราะ **ลูกค้าถือกระดาษอีกใบอยู่** — แก้เงียบ ๆ = มีสองใบเลขเดียวกัน
-- ยอดไม่ตรงกัน · ตราบใดที่ยังไม่ได้ส่ง แก้ได้ตามสบาย (คำสั่งเจ้าของ 20 ก.ย. 2569)
create or replace function public.guard_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locked boolean;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    return new;
  end if;

  new.created_by := old.created_by;

  v_locked := old.status in ('sent', 'accepted', 'void') or old.txn_id is not null;

  if v_locked and (
       new.vat_mode        is distinct from old.vat_mode
    or new.vat_rate        is distinct from old.vat_rate
    or new.customer_name   is distinct from old.customer_name
    or new.customer_tax_id is distinct from old.customer_tax_id
    or new.doc_date        is distinct from old.doc_date
    or new.site_id         is distinct from old.site_id
  ) then
    raise exception 'DOC_LOCKED: เอกสารนี้ส่งให้ลูกค้าหรือผูกรายรับไปแล้ว แก้ไม่ได้ ให้ยกเลิกแล้วออกใบใหม่';
  end if;

  -- เลขที่เอกสารเปลี่ยนไม่ได้เด็ดขาด — เลขคือตัวอ้างอิงที่ลูกค้าถืออยู่
  if old.doc_no is not null and new.doc_no is distinct from old.doc_no then
    raise exception 'DOC_NO_IMMUTABLE: เลขที่เอกสารเปลี่ยนไม่ได้';
  end if;

  return new;
end $$;

drop trigger if exists documents_guard on public.documents;
create trigger documents_guard before insert or update on public.documents
  for each row execute function public.guard_document();

revoke execute on function public.guard_document() from public, anon, authenticated;

create or replace function public.guard_document_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'draft' then
    raise exception 'DOC_DELETE_ISSUED: เอกสารที่ออกเลขแล้วลบไม่ได้ ให้ยกเลิกแทน (เลขจะไม่ถูกใช้ซ้ำ)';
  end if;
  return old;
end $$;

drop trigger if exists documents_guard_delete on public.documents;
create trigger documents_guard_delete before delete on public.documents
  for each row execute function public.guard_document_delete();

revoke execute on function public.guard_document_delete() from public, anon, authenticated;

-- บรรทัดของเอกสารที่ล็อกแล้วก็แตะไม่ได้ ไม่งั้นเลี่ยง guard ข้างบนได้ทันที
create or replace function public.guard_document_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc uuid := case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  v_st  public.doc_status;
  v_txn uuid;
begin
  select d.status, d.txn_id into v_st, v_txn from public.documents d where d.id = v_doc;
  -- ลบทั้งเอกสาร (cascade) ไม่ต้องกัน — `guard_document_delete` กันที่หัวไปแล้ว
  if v_st is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if v_st in ('sent', 'accepted', 'void') or v_txn is not null then
    raise exception 'DOC_LOCKED: เอกสารนี้ส่งให้ลูกค้าหรือผูกรายรับไปแล้ว แก้รายการไม่ได้';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists document_lines_guard on public.document_lines;
create trigger document_lines_guard before insert or update or delete on public.document_lines
  for each row execute function public.guard_document_line();

revoke execute on function public.guard_document_line() from public, anon, authenticated;

-- ── 8 · ออกเลขที่เอกสาร ──────────────────────────────────────────────
-- `update ... returning` ล็อกแถวตัวนับไว้เอง — ยิงพร้อมกันก็ได้คนละเลข
create or replace function public.next_doc_no(p_kind public.doc_kind)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_no text;
begin
  if not (select public.is_owner()) then
    raise exception 'FORBIDDEN: เฉพาะเจ้าของเท่านั้นที่ออกเอกสารได้';
  end if;

  update public.doc_counters c
     set last_no = c.last_no + 1, updated_at = now()
   where c.kind = p_kind
  returning c.prefix || lpad(c.last_no::text, c.pad, '0') into v_no;

  if v_no is null then
    raise exception 'DOC_COUNTER_NOT_SET: ยังไม่ได้ตั้งเลขที่เอกสารของชนิดนี้';
  end if;
  return v_no;
end $$;

revoke execute on function public.next_doc_no(public.doc_kind) from public, anon;
grant execute on function public.next_doc_no(public.doc_kind) to authenticated;

-- ── 9 · RLS + audit — เจ้าของเท่านั้นทั้งสี่ตาราง ────────────────────
-- เอกสารมีค่างานและกำไรอยู่ในตัว จึงเป็นของเจ้าของเหมือน `site_finance`
alter table public.customers      enable row level security;
alter table public.doc_counters   enable row level security;
alter table public.documents      enable row level security;
alter table public.document_lines enable row level security;

do $$
declare t text;
begin
  foreach t in array array['customers', 'doc_counters', 'documents', 'document_lines'] loop
    execute format('drop policy if exists %I_owner_select on public.%I', t, t);
    execute format('create policy %I_owner_select on public.%I for select to authenticated
                      using ((select public.is_owner()))', t, t);
    execute format('drop policy if exists %I_owner_insert on public.%I', t, t);
    execute format('create policy %I_owner_insert on public.%I for insert to authenticated
                      with check ((select public.is_owner()))', t, t);
    execute format('drop policy if exists %I_owner_update on public.%I', t, t);
    execute format('create policy %I_owner_update on public.%I for update to authenticated
                      using ((select public.is_owner())) with check ((select public.is_owner()))', t, t);
    execute format('drop policy if exists %I_owner_delete on public.%I', t, t);
    execute format('create policy %I_owner_delete on public.%I for delete to authenticated
                      using ((select public.is_owner()))', t, t);

    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I
                      for each row execute function public.audit_row()', t, t);

    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
  end loop;
end $$;

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at before update on public.customers
  for each row execute function public.set_updated_at();
drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at before update on public.documents
  for each row execute function public.set_updated_at();
