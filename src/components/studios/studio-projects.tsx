'use client';

import { FolderOpen } from 'lucide-react';
import Link from 'next/link';

import { useForgeServices } from '../../state/forge-provider';
import { useDocuments } from '../../state/hooks';
import { Button } from '../ui/button';
import { EmptyState, SkeletonCard } from '../ui/states';
import { ProjectCard } from '../projects/project-card';

/** Projects belonging to one studio, shown on the studio page. */
export function StudioProjects({
  studioId,
  limit = 3,
}: {
  readonly studioId: string;
  readonly limit?: number;
}) {
  const { documents, toasts } = useForgeServices();
  const state = useDocuments();

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
      </div>
    );
  }

  const projects = state.documents.filter((document) => document.studioId === studioId);

  if (projects.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={<FolderOpen aria-hidden />}
        title="No projects in this studio yet"
        description="Create one from the button above, or start from a bundled sample template in the asset catalogue."
        actions={
          <>
            <Button asChild variant="primary" size="sm">
              <Link href={`/create?studio=${studioId}`}>Create a project</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/assets">Browse sample assets</Link>
            </Button>
          </>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.slice(0, limit).map((document) => (
          <ProjectCard
            key={document.id}
            document={document}
            onDelete={(target) => {
              void documents.remove(target.id).then((result) => {
                if (result.ok) toasts.success('Project deleted', `“${target.title}” was removed.`);
                else toasts.error('Could not delete project', result.error.message);
              });
            }}
          />
        ))}
      </div>
      {projects.length > limit ? (
        <p className="text-fg-subtle text-xs">
          {projects.length - limit} more in{' '}
          <Link
            href="/projects"
            className="hover:text-fg-muted underline decoration-1 underline-offset-2"
          >
            your library
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
