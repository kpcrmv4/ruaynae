-- ════════════════════════════════════════════════════════════════════════
-- ล้างข้อมูลธุรกิจทั้งหมด — คืนฐานข้อมูลให้ว่างเปล่าเหมือนวันแรก
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 ไฟล์นี้ **จงใจไม่อยู่ใน `supabase/migrations/`**
-- migration ทุกไฟล์ถูกรันอัตโนมัติเมื่อมีการ deploy หรือ `db push` ·
-- ถ้าไฟล์ที่ลบข้อมูลทั้งฐานอยู่ในนั้น วันหนึ่งมันจะรันบนข้อมูลจริง
-- ของลูกค้าโดยไม่มีใครตั้งใจ และไม่มีทางกู้กลับ
--
-- เรียกผ่าน `node scripts/reset-demo.mjs --yes` เท่านั้น
-- (สคริปต์บังคับให้พิมพ์ยืนยัน และปฏิเสธถ้าฐานข้อมูลมีข้อมูลเยอะเกินกว่าจะเป็นเดโม่)
--
-- ไม่ลบ: `profiles`/`auth.users` (บัญชีผู้ใช้) · `categories` (หมวดตั้งต้น)
-- · `branding`/`app_settings` (ตั้งค่าบริษัท) · `audit_log` (ประวัติลบไม่ได้ตามการออกแบบ)

begin;

-- เรียงตามความสัมพันธ์ — ลูกก่อนพ่อแม่เสมอ
delete from public.payroll_lines;
delete from public.advances;
delete from public.payroll_runs;

delete from public.attendance_wages;
delete from public.attendance;
delete from public.employee_wages;
delete from public.employees;

delete from public.attachments;
delete from public.upload_intents;
delete from public.transactions;

delete from public.notifications;
delete from public.push_subscriptions;

delete from public.site_milestones;
delete from public.site_supervisors;
delete from public.site_finance;
delete from public.sites;

delete from public.login_attempts;

commit;
