import { PageSkeleton } from '@/components/ui/page-skeleton'

export default function Loading() {
  return <PageSkeleton metrics={3} rows={5} titleWidth="w-40" />
}
