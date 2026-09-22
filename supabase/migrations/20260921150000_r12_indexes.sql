-- R12 (แก้) · index ตามที่ `get_advisors` ชี้หลัง apply
--
-- 1 · FK สองตัวยังไม่มี index คลุม (`created_by` · `issued_by`) — กฎของโปรเจ็ค
--     คือ **FK ทุกตัวต้องมี index** (CLAUDE.md §5) เพราะ Postgres ต้องสแกน
--     ตารางลูกทั้งใบตอนลบแถวแม่ · ลบผู้ใช้ทีเดียวล็อกตารางเอกสารทั้งตาราง
--
-- 2 · `documents_status_idx` ถูกรายงานว่าไม่เคยถูกใช้ — และมันจะไม่ถูกใช้เลย
--     เพราะทุกคำถามในแอปถาม `status` **คู่กับ `kind` เสมอ** (แท็บสองชนิดอยู่
--     เหนือชิปสถานะ) · index ที่ไม่มีใครใช้ไม่ได้ฟรี มันถูกเขียนทุกครั้งที่
--     แถวเปลี่ยนสถานะ → เปลี่ยนเป็น `(kind, status)` ที่ตรงกับคำถามจริง

create index if not exists documents_created_by_idx on public.documents(created_by);
create index if not exists documents_issued_by_idx  on public.documents(issued_by);

create index if not exists documents_kind_status_idx on public.documents(kind, status);
drop index if exists public.documents_status_idx;
