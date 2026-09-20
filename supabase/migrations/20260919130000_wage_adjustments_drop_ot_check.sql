-- แก้ตามผลตรวจ R10: check เดิม `ot_amount >= 0` ยังอยู่ เพราะ pattern เดิมเทียบกับ
-- "ot_amount >= 0" แต่ pg_get_constraintdef พิมพ์เป็น "(ot_amount >= (0)::numeric)"
-- · จับด้วย regex ที่ยอมรับวงเล็บ และไม่แตะ attendance_wages_amount_nonneg
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public' and rel.relname = 'attendance_wages'
      and con.contype = 'c'
      and con.conname <> 'attendance_wages_amount_nonneg'
      and pg_get_constraintdef(con.oid) ~ 'ot_amount >= \(?0'
  loop
    execute format('alter table public.attendance_wages drop constraint %I', c.conname);
  end loop;
end $$;

-- advisor: FK ไม่มี index (unindexed_foreign_keys)
create index if not exists attendance_adjustments_preset_idx
  on public.attendance_adjustments(preset_id) where preset_id is not null;
