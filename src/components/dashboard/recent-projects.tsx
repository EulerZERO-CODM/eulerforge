'use client';

import { FolderPlus, LayoutTemplate } from 'lucide-react';
import Link from 'next/link';

import { Button } from '../ui/button';
import { EmptyState, SkeletonCard } from '../ui/states';
import { ProjectCard } from '../projects/project-card';
import { useForgeServices } from '../../state/forge-provider';
import { useDocuments } from '../../state/hooks';
import { pluralise } from '../../lib/format';

/**
 * Recent projects.
 *
 * Reads the local project library through the documents store and reports genuinely empty, loading
 * and failure states. There is no fabricated activity data here — the count is the count.
 */
export function RecentProjects({ limit = 3 }: { readonly limit?: number }) {
  const { documents, toasts } = useForgeServices();
  const state = useDocuments();

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <EmptyState
        icon={<FolderPlus aria-hidden />}
        title="Projects could not be loaded"
        description={state.error?.message ?? 'Local storage is unavailable in this browser.'}
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              void documents.load();
            }}
          >
            Try again
          </Button>
        }
      />
    );
  }

  if (state.documents.length === 0) {
    return (
      <EmptyState
        icon={<LayoutTemplate aria-hidden />}
        title="No projects yet"
        description="Projects you create are stored in this browser on this device. Nothing is uploaded, and nothing is synced — so this list starts empty and stays local."
        actions={
          <>
            <Button asChild variant="primary">
              <Link href="/create">Create your first project</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/learn/your-first-project">Follow the tutorial instead</Link>
            </Button>
          </>
        }
      />
    );
  }

  const visible = state.documents.slice(0, limit);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((document) => (
          <ProjectCard
            key={document.id}
            document={document}
            onDelete={(target) => {
              void documents.remove(target.id).then((result) => {
                if (result.ok)
                  toasts.success(
                    'Project deleted',
                    `“${target.title}” was removed from this browser.`,
                  );
                else toasts.error('Could not delete project', result.error.message);
              });
            }}
          />
        ))}
      </div>
      <p className="text-fg-subtle text-xs">
        {pluralise(state.documents.length, 'project')} stored in this browser.{' '}
        <Link
          href="/projects"
          className="hover:text-fg-muted underline decoration-1 underline-offset-2"
        >
          Open the full library
        </Link>
      </p>
    </div>
  );
}
