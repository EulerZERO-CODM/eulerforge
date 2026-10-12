import type { Metadata } from 'next';
import { Suspense } from 'react';

import { CreationFlow } from '../../components/create/creation-flow';
import { PageHeader } from '../../components/ui/section';
import { SkeletonCard } from '../../components/ui/states';

export const metadata: Metadata = {
  title: 'New project',
  description:
    'Create a design document from a canvas preset or exact dimensions. Saved locally in this browser.',
};

export default function CreatePage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        title="Create a project"
        lead="Four steps to a real, validated document: choose a studio, set the canvas, configure guides and palette, then review. You can change any of it afterwards, and every change is undoable."
      />
      {/* `useSearchParams` requires a Suspense boundary during static rendering. */}
      <Suspense fallback={<SkeletonCard lines={8} />}>
        <CreationFlow />
      </Suspense>
    </div>
  );
}
