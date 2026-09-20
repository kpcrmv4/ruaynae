import { getSupabaseServer } from '@/lib/supabase/server'
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

  const of = (kind: 'quotation' | 'receipt') => {
    const row = (counters ?? []).find((c) => c.kind === kind)
    return row ? `${row.prefix}${String(row.last_no).padStart(row.pad, '0')}` : ''
  }

  return (
    <DocSettingsClient
      quotationLastNo={of('quotation')}
      receiptLastNo={of('receipt')}
      phone={settings?.phone ?? ''}
      email={settings?.email ?? ''}
      branchLabel={settings?.branch_label ?? ''}
      bankAccount={settings?.bank_account ?? ''}
      docFooter={settings?.doc_footer ?? ''}
    />
  )
}
