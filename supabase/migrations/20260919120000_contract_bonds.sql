-- ════════════════════════════════════════════════════════════════════════
-- R11 · หลักประกันสัญญา + ประกันผลงาน (คำสั่งเจ้าของ 19 ก.ย. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- งานราชการทุกงานถูกหัก **หลักประกันสัญญา** (ราว 5% ของค่าจ้าง — เงินสดหักไว้
-- หรือหนังสือค้ำประกันจากธนาคาร) และจะได้คืนเมื่อ **ครบประกันผลงาน 2 ปี
-- นับถัดจากวันส่งมอบงวดสุดท้าย** · เจ้าของเคยไล่ดูในสเปรดชีตเองว่างานไหนครบแล้ว
-- และช่องที่ว่างคือเงินที่ยังไม่ได้ทวงคืน
--
-- 🔴 ทุกคอลัมน์อยู่ที่ `site_finance` (owner-only) ไม่ใช่ `sites` — ยอดหลักประกัน
--    และเลขที่สัญญาเป็นเรื่องเงิน หัวหน้าโครงการไม่ควรเห็น (เหตุผลเดียวกับ contract_amount)
-- 🔴 **วันครบประกันเป็น generated column** — คำนวณจากวันส่งมอบ + ระยะประกัน
--    ไม่มีใครกรอกเอง จึงไม่มีวันขัดกับสองค่าต้นทาง
-- 🔴 สถานะ (ในประกัน · ใกล้ครบ · ครบแล้วรอทวง · คืนแล้ว) **คิดจากวันที่ตอนอ่าน**
--    ใน RPC ไม่ได้เก็บเป็นคอลัมน์ — คอลัมน์สถานะต้องมีใครสักคนคอยอัปเดตทุกวัน
--    ซึ่งคือ cron อีกตัวที่วันหนึ่งจะเงียบไป
-- 🔴 เงินสดที่ได้คืนถูกบันทึกเป็น **รายรับของโครงการ** (หมวด "หลักประกันสัญญาคืน")
--    เพราะมันคือเงินเข้าจริง · หนังสือค้ำแค่บันทึกว่ารับคืน ไม่ใช่เงิน — ตัดสินใจโดยเจ้าของ

-- ── 1 · ชนิดของหลักประกัน ──────────────────────────────────────────
do $$ begin
  create type public.bond_kind as enum ('cash', 'bank_guarantee');
exception when duplicate_object then null; end $$;

-- ── 2 · คอลัมน์บน site_finance ────────────────────────────────────
alter table public.site_finance
  add column if not exists contract_no          text,
  add column if not exists contract_date        date,
  add column if not exists bond_kind            public.bond_kind,
  add column if not exists bond_amount          numeric(14,2) not null default 0
    check (bond_amount >= 0),
  -- เลขที่หนังสือค้ำ / ธนาคาร — ข้อความอิสระ
  add column if not exists bond_ref             text,
  -- วันส่งมอบงวดสุดท้าย — คนละช่องกับ sites.end_date (กำหนดส่งมอบตามสัญญา)
  -- จากตารางจริงสองวันนี้ต่างกันเป็นเดือน ๆ บ่อยมาก
  add column if not exists handover_date        date,
  add column if not exists warranty_months      int not null default 24
    check (warranty_months between 0 and 120),
  add column if not exists bond_returned_at     date,
  add column if not exists bond_returned_amount numeric(14,2)
    check (bond_returned_amount is null or bond_returned_amount >= 0),
  -- รายรับที่ระบบลงให้ตอนได้เงินสดคืน · ลบรายรับแล้วช่องนี้ว่างเอง (ไม่พาโครงการล้ม)
  add column if not exists bond_return_txn_id   uuid references public.transactions(id) on delete set null;

-- generated column ต้องเพิ่มแยก — `add column if not exists ... generated` ใน
-- คำสั่งเดียวกับคอลัมน์ต้นทางจะมองไม่เห็นคอลัมน์ต้นทาง
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'site_finance' and column_name = 'warranty_end'
  ) then
    alter table public.site_finance
      add column warranty_end date generated always as (
        case when handover_date is null then null
             else (handover_date + make_interval(months => warranty_months))::date end
      ) stored;
  end if;
end $$;

comment on column public.site_finance.warranty_end is
  'วันครบประกันผลงาน = วันส่งมอบงวดสุดท้าย + ระยะประกัน (เดือน) · ทวงหลักประกันคืนได้ตั้งแต่วันถัดไป';

-- ได้คืนแล้วต้องมีวัน · ยอดที่คืนไม่ควรเกินยอดที่ตั้งไว้ (กรอกผิดหลัก)
alter table public.site_finance drop constraint if exists site_finance_bond_return_consistent;
alter table public.site_finance add constraint site_finance_bond_return_consistent
  check (bond_returned_amount is null or bond_returned_at is not null);

create index if not exists site_finance_warranty_end_idx
  on public.site_finance(warranty_end) where warranty_end is not null and bond_returned_at is null;
create index if not exists site_finance_bond_return_txn_idx
  on public.site_finance(bond_return_txn_id) where bond_return_txn_id is not null;

-- ── 3 · หมวดรายรับสำหรับเงินสดที่ได้คืน ───────────────────────────
-- ต้องมีตั้งแต่แรก ไม่งั้นปุ่ม "ได้รับคืนแล้ว" เปิดมาแล้วบันทึกไม่ได้จนกว่าจะมีคนสร้างหมวด
insert into public.categories (name, kind, sort_order)
values ('หลักประกันสัญญาคืน', 'income', 90)
on conflict do nothing;

-- ── 4 · สถานะหลักประกันของทุกโครงการ ─────────────────────────────
-- security invoker: RLS ของ site_finance กรองให้เอง — หัวหน้าโครงการได้ 0 แถว
-- · service role (cron สรุปเช้า) ข้าม RLS จึงเห็นครบโดยไม่ต้องมีทางลัด auth.uid()
drop function if exists public.bond_status(date, int);
create or replace function public.bond_status(p_on date, p_soon_days int default 30)
returns table (
  site_id              uuid,
  site_name            text,
  site_status          public.site_status,
  contract_no          text,
  contract_date        date,
  contract_amount      numeric,
  bond_kind            public.bond_kind,
  bond_amount          numeric,
  bond_ref             text,
  handover_date        date,
  warranty_months      int,
  warranty_end         date,
  bond_returned_at     date,
  bond_returned_amount numeric,
  bond_return_txn_id   uuid,
  -- วันที่เหลือจนครบประกัน · ติดลบ = เลยมาแล้วกี่วัน · null = ยังไม่ส่งมอบ
  days_left            int,
  -- none · pending_handover · in_warranty · due_soon · overdue · returned
  status               text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    s.id, s.name, s.status,
    f.contract_no, f.contract_date, f.contract_amount,
    f.bond_kind, f.bond_amount, f.bond_ref,
    f.handover_date, f.warranty_months, f.warranty_end,
    f.bond_returned_at, f.bond_returned_amount, f.bond_return_txn_id,
    case when f.warranty_end is null then null else (f.warranty_end - p_on)::int end,
    case
      when f.bond_kind is null or f.bond_amount <= 0 then 'none'
      when f.bond_returned_at is not null then 'returned'
      when f.handover_date is null then 'pending_handover'
      when f.warranty_end < p_on then 'overdue'
      when f.warranty_end - p_on <= p_soon_days then 'due_soon'
      else 'in_warranty'
    end
  from public.site_finance f
  join public.sites s on s.id = f.site_id
  where s.status <> 'cancelled'
  order by
    -- เร่งด่วนก่อน: เลยกำหนด → ใกล้ครบ → ในประกัน → รอส่งมอบ → คืนแล้ว → ไม่มี
    case
      when f.bond_kind is null or f.bond_amount <= 0 then 6
      when f.bond_returned_at is not null then 5
      when f.handover_date is null then 4
      when f.warranty_end < p_on then 1
      when f.warranty_end - p_on <= p_soon_days then 2
      else 3
    end,
    f.warranty_end nulls last,
    s.name;
$$;

revoke execute on function public.bond_status(date, int) from public, anon;
grant execute on function public.bond_status(date, int) to authenticated;

-- ── 5 · ตัวเลขสรุปสำหรับหน้าแรก / สรุปเช้า — นับในฐานข้อมูล (§7) ────
drop function if exists public.bond_summary(date, int);
create or replace function public.bond_summary(p_on date, p_soon_days int default 30)
returns table (
  overdue_count   int,
  overdue_amount  numeric,
  due_soon_count  int,
  due_soon_amount numeric,
  -- งานที่ "ครบพอดีวันนี้" หรือ "เหลือพอดี 30 วัน" — วันที่ควรส่งแจ้งเตือน
  event_count     int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*) filter (where b.status = 'overdue')::int,
    coalesce(sum(b.bond_amount) filter (where b.status = 'overdue'), 0),
    count(*) filter (where b.status = 'due_soon')::int,
    coalesce(sum(b.bond_amount) filter (where b.status = 'due_soon'), 0),
    count(*) filter (where b.status in ('due_soon', 'overdue') and b.days_left in (p_soon_days, 0, -1))::int
  from public.bond_status(p_on, p_soon_days) b;
$$;

revoke execute on function public.bond_summary(date, int) from public, anon;
grant execute on function public.bond_summary(date, int) to authenticated;
