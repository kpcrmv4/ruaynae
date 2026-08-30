-- ════════════════════════════════════════════════════════════════════════
-- P0.5 · แบรนด์ (สาธารณะ) และการตั้งค่าระบบ (ลับ)
--
-- 🔴 ต้องเป็น **สองตาราง** ไม่ใช่สองคอลัมน์ในตารางเดียว
-- RLS ของ Postgres คุมได้ระดับ "แถว" ไม่ใช่ระดับ "คอลัมน์"
-- ถ้าชื่อบริษัทอยู่ตารางเดียวกับเลขผู้เสียภาษี/เลขบัญชีธนาคาร วันที่มีคนเติม
-- ข้อมูลพวกนั้นเข้าไป มันจะหลุดออกหน้าล็อกอินทันทีโดยไม่มีใครสังเกต
-- ════════════════════════════════════════════════════════════════════════

-- ── branding — อ่านได้โดยไม่ต้องล็อกอิน ─────────────────────────────────
-- id เป็น boolean ที่ต้องเป็น true เสมอ = มีได้แถวเดียวตลอดกาล
-- บังคับที่ schema ดีกว่าเขียนโค้ดคอยระวังว่าอย่าเผลอ insert แถวที่สอง
create table if not exists public.branding (
  id              boolean primary key default true check (id),
  company_name    text not null default '',
  logo_object_key text,
  updated_at      timestamptz not null default now()
);
insert into public.branding (id) values (true) on conflict (id) do nothing;

-- ── app_settings — เจ้าของเท่านั้น ──────────────────────────────────────
create table if not exists public.app_settings (
  id                   boolean primary key default true check (id),
  address              text,
  tax_id               text,
  signatory_name       text,
  signatory_title      text,
  slip_retention_years int,
  updated_at           timestamptz not null default now()
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists branding_set_updated_at on public.branding;
create trigger branding_set_updated_at before update on public.branding
  for each row execute function public.set_updated_at();

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

drop trigger if exists branding_audit on public.branding;
create trigger branding_audit after insert or update or delete on public.branding
  for each row execute function public.audit_row();

drop trigger if exists app_settings_audit on public.app_settings;
create trigger app_settings_audit after insert or update or delete on public.app_settings
  for each row execute function public.audit_row();

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.branding     enable row level security;
alter table public.app_settings enable row level security;

-- อ่านได้ทุกคนรวมทั้งคนที่ยังไม่ล็อกอิน — หน้าล็อกอินต้องใช้
-- ตารางนี้ห้ามมีคอลัมน์ที่เป็นความลับเด็ดขาด ทุกอย่างในนี้คือข้อมูลสาธารณะ
drop policy if exists branding_select_all on public.branding;
create policy branding_select_all on public.branding
  for select to anon, authenticated using (true);

drop policy if exists branding_update_owner on public.branding;
create policy branding_update_owner on public.branding
  for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- ไม่มี policy insert/delete — แถวเดียวถูกสร้างไว้แล้วและห้ามลบ

drop policy if exists app_settings_select_owner on public.app_settings;
create policy app_settings_select_owner on public.app_settings
  for select to authenticated using ((select public.is_owner()));

drop policy if exists app_settings_update_owner on public.app_settings;
create policy app_settings_update_owner on public.app_settings
  for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
