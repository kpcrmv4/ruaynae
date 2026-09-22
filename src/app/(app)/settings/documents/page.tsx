import { getSupabaseServer } from '@/lib/supabase/server'
import { DOC_KINDS, type DocKind } from '@/lib/documents'
import { DataError } from '@/components/ui/data-error'
import { DocSettingsClient } from './documents-client'

export const metadata = { title: 'ตั้งค่าเอกสาร' }

export default async function DocumentSettingsPage() {
  const sb = await getSupabaseServer()
  const [{ data: counters, error: cErr }, { data: settings, error: sErr }] = await Promise.all([
    sb.from('doc_counters').select('kind, prefix, pad, last_no').range(0, 9),
    sb
      .from('app_settings')
      .select('phone, email, branch_label, bank_account, doc_footer')
      .maybeSingle(),
  ])

  if (cErr || sErr) {
    console.error('[settings/documents] โหลดไม่ได้', cErr?.message ?? sErr?.message)
    return <DataError message="โหลดตั้งค่าเอกสารไม่สำเร็จ" />
  }

  // 🔴 วนจาก `DOC_KINDS` ไม่ใช่เขียนชื่อชนิดทีละตัว — เพิ่มชนิดที่สี่วันไหน
  // หน้านี้ได้ช่องของมันเอง ไม่ใช่ลืมไว้เงียบ ๆ แล้วออกเอกสารชนิดนั้นไม่ได้
  const of = (kind: DocKind) => {
    const row = (counters ?? []).find((c) => c.kind === kind)
    return row ? `${row.prefix}${String(row.last_no).padStart(row.pad, '0')}` : ''
  }
  const lastNos = Object.fromEntries(DOC_KINDS.map((k) => [k, of(k)])) as Record<DocKind, string>

  return (
    <DocSettingsClient
      lastNos={lastNos}
      phone={settings?.phone ?? ''}
      email={settings?.email ?? ''}
      branchLabel={settings?.branch_label ?? ''}
      bankAccount={settings?.bank_account ?? ''}
      docFooter={settings?.doc_footer ?? ''}
    />
  )
}
