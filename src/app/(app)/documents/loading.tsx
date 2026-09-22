import { PageSkeleton } from '@/components/ui/page-skeleton'

export default function Loading() {
  return <PageSkeleton metrics={0} rows={6} toolbar titleWidth="w-32" />
}
