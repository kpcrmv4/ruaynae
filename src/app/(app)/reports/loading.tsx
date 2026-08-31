import { PageSkeleton } from '@/components/ui/page-skeleton'

export default function Loading() {
  return <PageSkeleton metrics={3} rows={6} titleWidth="w-32" />
}
