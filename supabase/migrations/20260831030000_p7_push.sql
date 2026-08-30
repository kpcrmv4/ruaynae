-- ════════════════════════════════════════════════════════════════════════
-- P7 · web push — ที่เก็บ subscription และธงว่าส่งแล้วหรือยัง
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  -- endpoint เป็น unique ทั้งระบบ ไม่ใช่ต่อผู้ใช้ — เครื่องเดียวถูกส่งต่อ
  -- ให้คนอื่นใช้ได้ (มือถือของบริษัท) แล้ว subscription เดิมต้องย้ายเจ้าของ
  -- ไม่ใช่มีสองแถวที่ยิงไปเครื่องเดียวกันสองข้อความ
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  last_ok_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

-- ของตัวเองเท่านั้น — subscription ของคนอื่นคือช่องทางส่งข้อความถึงเขา
drop policy if exists push_own_select on public.push_subscriptions;
create policy push_own_select on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists push_own_insert on public.push_subscriptions;
create policy push_own_insert on public.push_subscriptions
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists push_own_update on public.push_subscriptions;
create policy push_own_update on public.push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists push_own_delete on public.push_subscriptions;
create policy push_own_delete on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

drop trigger if exists push_subscriptions_set_updated_at on public.push_subscriptions;
create trigger push_subscriptions_set_updated_at before update on public.push_subscriptions
  for each row execute function public.set_updated_at();
drop trigger if exists push_subscriptions_audit on public.push_subscriptions;
create trigger push_subscriptions_audit
  after insert or update or delete on public.push_subscriptions
  for each row execute function public.audit_row();

-- ธงว่าแจ้งเตือนใบนี้ถูกส่ง push แล้วหรือยัง
-- 🔴 ต้องแยกจาก `read_at` — คนอ่านในแอปแล้วไม่ได้แปลว่าเคยถูกส่ง push
-- และในทางกลับกัน · รวมสองอย่างเมื่อไหร่จะมีคนไม่ได้รับ push โดยไม่มีใครรู้
alter table public.notifications
  add column if not exists pushed_at timestamptz;

create index if not exists notifications_unpushed_idx
  on public.notifications(created_at) where pushed_at is null;
