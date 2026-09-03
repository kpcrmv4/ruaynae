-- ════════════════════════════════════════════════════════════════════════
-- `list_categories` ของตัวเชื่อม MCP บอกด้วยว่าหมวดไหนถูกนับเป็น "ค่าวัสดุ"
-- ════════════════════════════════════════════════════════════════════════
--
-- นิยามตัวเลขที่ส่งให้โมเดล (`METRIC_DEFINITIONS`) เขียนว่า "ดู `is_material`
-- ได้จาก list_categories" — คำอธิบายที่ชี้ไปยังฟิลด์ที่ไม่มีอยู่จริงแย่กว่า
-- ไม่เขียนเลย เพราะโมเดลจะพยายามอ่านมันแล้วได้ undefined แล้วเดาต่อเอง

create or replace function public.mcp_categories(p_actor uuid, p_kind text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb;
begin
  perform public.mcp_assume_owner(p_actor);

  select coalesce(jsonb_agg(to_jsonb(r) order by r.kind, r.sort_order, r.name), '[]'::jsonb)
  into v
  from (
    select c.id, c.name, c.kind::text as kind, c.sort_order, c.is_material
    from public.categories c
    -- หมวดที่ปิดแล้วไม่ควรถูกเลือกใหม่ — มันหายจากฟอร์มในแอปไปแล้วเหมือนกัน
    where c.is_active and (p_kind is null or c.kind::text = p_kind)
  ) r;

  return v;
end $$;

-- สิทธิ์ไม่ติดมากับ `create or replace` — ต้องตั้งใหม่ทุกครั้ง
revoke execute on function public.mcp_categories(uuid, text) from public, anon, authenticated;
grant execute on function public.mcp_categories(uuid, text) to service_role;
