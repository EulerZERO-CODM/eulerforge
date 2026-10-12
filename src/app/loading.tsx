import { SkeletonCard } from '../components/ui/states';

/** Route-level loading state. Kept layout-shaped so content does not jump when it resolves. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8 sm:px-6" aria-busy="true">
      <SkeletonCard lines={2} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
      </div>
      <p role="status" className="sr-only">
        Loading
      </p>
    </div>
  );
}
