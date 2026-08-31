import { ListSkeleton, Skeleton } from '@/components/ui/states'

export default function Loading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-8 w-52" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <ListSkeleton rows={3} />
    </div>
  )
}
