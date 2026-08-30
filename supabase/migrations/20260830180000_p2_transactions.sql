-- ════════════════════════════════════════════════════════════════════════
-- P2 · รายรับ-รายจ่าย · หมวด · สลิป · ความตั้งใจอัปโหลด
-- ครอบแถว P2-DB-01 ถึง P2-DB-18 ใน docs/test-plan/P2.md
-- ════════════════════════════════════════════════════════════════════════

do $$ begin create type public.txn_kind    as enum ('income','expense');
  exception when duplicate_object then null; end $$;
do $$ begin create type public.txn_status  as enum ('pending','approved','rejected');
  exception when duplicate_object then null; end $$;
do $$ begin create type public.pay_method  as enum ('cash','transfer');
  exception when duplicate_object then null; end $$;
do $$ begin create type public.income_kind as enum ('deposit','installment','variation_order','other');
  exception when duplicate_object then null; end $$;

-- ── หมวด ────────────────────────────────────────────────────────────────
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  kind       public.txn_kind not null,
  -- ปิดหมวดแทนการลบ · ลบแล้วรายการเก่าที่อ้างอยู่จะพังทั้งหมด
  is_active  boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  unique (kind, name)
);
create index if not exists categories_kind_idx on public.categories(kind, sort_order);

-- ── รายรับ-รายจ่าย ──────────────────────────────────────────────────────
create table if not exists public.transactions (
  id              uuid primary key default gen_random_uuid(),
  kind            public.txn_kind not null,
  -- 🔴 `null` = ส่วนกลาง (ค่าน้ำมัน ค่าทางด่วน ค่าออฟฟิศ) ไม่ใช่ "ยังไม่ได้เลือก"
  -- ต้นทุนส่วนกลางห้ามถูกนับเข้าไซต์ใดไซต์หนึ่ง
  site_id         uuid references public.sites(id) on delete restrict,
  category_id     uuid not null references public.categories(id) on delete restrict,
  amount          numeric(14,2) not null check (amount > 0),
  txn_date        date not null,
  pay_method      public.pay_method not null default 'cash',
  status          public.txn_status not null default 'pending',
  -- ใช้ได้เฉพาะฝั่งรายรับ · บังคับที่ schema ไม่ใช่หวังว่า UI จะไม่ส่งมา
  income_kind     public.income_kind,
  installment_no  int check (installment_no is null or installment_no > 0),
  note            text,
  rejected_reason text,
  created_by      uuid references public.profiles(id) on delete set null,
  approved_by     uuid references public.profiles(id) on delete set null,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint txn_income_fields check (
    (kind = 'income') or (income_kind is null and installment_no is null)
  ),
  constraint txn_installment_needs_kind check (
    installment_no is null or income_kind = 'installment'
  ),
  constraint txn_rejected_needs_reason check (
    status <> 'rejected' or length(btrim(coalesce(rejected_reason, ''))) > 0
  )
);

-- ดัชนีตามคอลัมน์ที่กรองจริง (CLAUDE.md §5)
create index if not exists transactions_date_idx      on public.transactions(txn_date desc);
create index if not exists transactions_site_date_idx on public.transactions(site_id, txn_date desc);
create index if not exists transactions_pending_idx   on public.transactions(status)
  where status = 'pending';
create index if not exists transactions_category_idx  on public.transactions(category_id);
create index if not exists transactions_created_by_idx on public.transactions(created_by);
create index if not exists transactions_approved_by_idx on public.transactions(approved_by);

-- ── สลิปที่แนบ ──────────────────────────────────────────────────────────
create table if not exists public.attachments (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  -- 🔴 เก็บแค่ object_key ห้ามเก็บ URL เต็ม — ย้าย bucket/โดเมนทีหลังได้
  -- โดยไม่ต้องไล่แก้ข้อมูลเก่า และ URL ที่เซ็นแล้วมีอายุอยู่แล้ว
  object_key     text not null unique,
  thumb_key      text not null,
  byte_size      int not null check (byte_size > 0),
  content_type   text not null,
  created_at     timestamptz not null default now()
);
create index if not exists attachments_txn_idx on public.attachments(transaction_id);

-- ── ความตั้งใจอัปโหลด ───────────────────────────────────────────────────
-- 🔴 ตารางนี้มีไว้แก้ปัญหาเดียว: อัปไฟล์ขึ้น R2 สำเร็จ แล้วบันทึกแถวไม่สำเร็จ
-- ไฟล์จะค้างใน bucket ตลอดไปโดยไม่มีแถวไหนชี้ถึง และไม่มี error ที่ไหนเลย
-- ทางที่ล้มเหลวคือทางที่สร้างขยะ และเป็นทางที่ไม่มีใครทดสอบ
create table if not exists public.upload_intents (
  id          uuid primary key default gen_random_uuid(),
  object_key  text not null unique,
  thumb_key   text not null,
  created_by  uuid not null references public.profiles(id) on delete cascade,
  site_id     uuid references public.sites(id) on delete cascade,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists upload_intents_sweep_idx on public.upload_intents(expires_at)
  where consumed_at is null;
create index if not exists upload_intents_owner_idx on public.upload_intents(created_by);

-- ── guard trigger — กฎที่ต้องบังคับที่ฐานข้อมูล ────────────────────────
-- หน้าจอเป็นคำแนะนำ ฐานข้อมูลเป็นความจริง · เส้นทางไหนที่ลืมเช็คในโค้ดแอป
-- จะยังโดนกฎพวกนี้อยู่ดี
--
-- ⚠️ `auth.uid() is null` ตรงนี้คือ service-role (seed / cron / migration)
-- ปลอดภัยเพราะ **trigger ไม่ใช่ฟังก์ชันที่ anon เรียกได้** — anon เขียนอะไร
-- ไม่ได้เลยตั้งแต่ชั้น RLS · ต่างจาก `supervises_site()` ที่ policy เรียกและ
-- anon แตะถึง ซึ่งห้ามมีทางลัดนี้เด็ดขาด
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

  -- หมวดต้องเป็นหมวดของชนิดเดียวกัน — หมวด "ค่าวัสดุ" ไปโผล่ในรายรับได้
  -- คือรายงานที่เชื่อไม่ได้ทั้งใบ
  select c.kind into v_cat_kind from public.categories c where c.id = new.category_id;
  if v_cat_kind is null or v_cat_kind <> new.kind then
    raise exception 'CATEGORY_KIND_MISMATCH: หมวดไม่ตรงกับชนิดรายการ';
  end if;

  if tg_op = 'INSERT' then
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

  -- UPDATE
  if not v_is_owner and not v_service then
    if new.status is distinct from old.status then
      raise exception 'APPROVE_FORBIDDEN: หัวหน้าไซต์เปลี่ยนสถานะไม่ได้';
    end if;
  end if;

  -- 🔴 ตัวเลขที่อนุมัติแล้วเปลี่ยนย้อนหลังไม่ได้ แม้แต่เจ้าของ
  -- ไม่งั้นการอนุมัติไม่มีความหมาย — ตีกลับแล้วบันทึกใหม่คือทางที่ถูก
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

drop trigger if exists transactions_guard on public.transactions;
create trigger transactions_guard before insert or update or delete on public.transactions
  for each row execute function public.guard_transaction();

drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['categories','transactions','attachments','upload_intents'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I
         for each row execute function public.audit_row()', t, t);
  end loop;
end $$;

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.categories     enable row level security;
alter table public.transactions   enable row level security;
alter table public.attachments    enable row level security;
alter table public.upload_intents enable row level security;

drop policy if exists categories_select       on public.categories;
drop policy if exists categories_insert_owner on public.categories;
drop policy if exists categories_update_owner on public.categories;
drop policy if exists categories_delete_owner on public.categories;

create policy categories_select on public.categories
  for select to authenticated using (true);
create policy categories_insert_owner on public.categories
  for insert to authenticated with check ((select public.is_owner()));
create policy categories_update_owner on public.categories
  for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy categories_delete_owner on public.categories
  for delete to authenticated using ((select public.is_owner()));

drop policy if exists transactions_select on public.transactions;
drop policy if exists transactions_insert on public.transactions;
drop policy if exists transactions_update on public.transactions;
drop policy if exists transactions_delete on public.transactions;

-- 🔴 หัวหน้าไซต์เห็นเฉพาะ **รายจ่ายของไซต์ตัวเอง**
-- ไม่เห็นรายรับ (เงินจากลูกค้า อยู่ชั้นเดียวกับค่างานซึ่งเป็นความลับ)
-- ไม่เห็นรายจ่ายส่วนกลาง (ค่าใช้จ่ายของเจ้าของ ไม่เกี่ยวกับไซต์)
create policy transactions_select on public.transactions
  for select to authenticated using (
    (select public.is_owner())
    or (kind = 'expense' and site_id is not null and public.supervises_site(site_id))
  );

create policy transactions_insert on public.transactions
  for insert to authenticated with check (
    (select public.is_owner())
    or (kind = 'expense' and site_id is not null and public.supervises_site(site_id))
  );

-- แก้ได้เฉพาะรายการของตัวเองที่ยัง pending — อนุมัติแล้วแตะไม่ได้
create policy transactions_update on public.transactions
  for update to authenticated
  using (
    (select public.is_owner())
    or (created_by = (select auth.uid()) and status = 'pending'
        and site_id is not null and public.supervises_site(site_id))
  )
  with check (
    (select public.is_owner())
    or (created_by = (select auth.uid()) and status = 'pending'
        and site_id is not null and public.supervises_site(site_id))
  );

create policy transactions_delete on public.transactions
  for delete to authenticated using (
    (select public.is_owner())
    or (created_by = (select auth.uid()) and status = 'pending')
  );

drop policy if exists attachments_select on public.attachments;
drop policy if exists attachments_insert on public.attachments;
drop policy if exists attachments_delete on public.attachments;

-- สลิปมองผ่านรายการแม่เสมอ — ใครเห็นรายการ ก็เห็นสลิปของรายการนั้น
create policy attachments_select on public.attachments
  for select to authenticated using (
    exists (select 1 from public.transactions t where t.id = transaction_id)
  );
create policy attachments_insert on public.attachments
  for insert to authenticated with check (
    exists (select 1 from public.transactions t where t.id = transaction_id)
  );
create policy attachments_delete on public.attachments
  for delete to authenticated using (
    exists (select 1 from public.transactions t where t.id = transaction_id
            and ((select public.is_owner()) or t.status = 'pending'))
  );

drop policy if exists upload_intents_own on public.upload_intents;
create policy upload_intents_own on public.upload_intents
  for select to authenticated using (created_by = (select auth.uid()));
drop policy if exists upload_intents_insert on public.upload_intents;
create policy upload_intents_insert on public.upload_intents
  for insert to authenticated with check (created_by = (select auth.uid()));
drop policy if exists upload_intents_update on public.upload_intents;
create policy upload_intents_update on public.upload_intents
  for update to authenticated
  using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
drop policy if exists upload_intents_delete on public.upload_intents;
create policy upload_intents_delete on public.upload_intents
  for delete to authenticated using (created_by = (select auth.uid()));

-- ── หมวดตั้งต้น ─────────────────────────────────────────────────────────
-- เจ้าของแก้/เพิ่ม/ปิดได้จากหน้าตั้งค่า · ชุดนี้เป็นแค่จุดเริ่มไม่ใช่ของตายตัว
insert into public.categories (name, kind, sort_order) values
  ('มัดจำ / เงินล่วงหน้า', 'income',  10),
  ('งวดงาน',              'income',  20),
  ('ค่างานเพิ่ม (VO)',     'income',  30),
  ('รายรับอื่น ๆ',         'income',  90),
  ('ค่าวัสดุก่อสร้าง',      'expense', 10),
  ('ค่าแรงผู้รับเหมาช่วง',  'expense', 20),
  ('ค่าเช่าเครื่องจักร',    'expense', 30),
  ('ค่าขนส่ง',             'expense', 40),
  ('ค่าน้ำมัน / ทางด่วน',   'expense', 50),
  ('ค่าไฟ / น้ำ หน้างาน',   'expense', 60),
  ('ค่าธรรมเนียม / เอกสาร', 'expense', 70),
  ('รายจ่ายอื่น ๆ',        'expense', 90)
on conflict (kind, name) do nothing;
