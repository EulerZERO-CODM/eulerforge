'use client';

import { FolderOpen, Search, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { DOCUMENT_STATUS_LABELS, type DocumentStatus } from '../../core/documents/types';
import { getStudio } from '../../core/studios';
import { truncate } from '../../lib/format';
import { useForgeServices } from '../../state/forge-provider';
import { useDocuments, useStorageStatus } from '../../state/hooks';
import { isVolatile } from '../../state/storage-status';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { SegmentedControl } from '../ui/controls';
import { Field, Select } from '../ui/field';
import { EmptyState, ErrorState, InlineNote, SkeletonCard } from '../ui/states';
import { ProjectCard } from './project-card';

type SortKey = 'updated' | 'name' | 'size';

/**
 * Project library.
 *
 * The full local project list with search, status filter and sorting. Everything shown comes from
 * this browser's storage — including the count, which is why the header never implies cloud backup.
 */
export function ProjectLibrary() {
  const { documents, toasts } = useForgeServices();
  const storageStatus = useStorageStatus();
  const volatile = isVolatile(storageStatus);
  const state = useDocuments();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<DocumentStatus | 'all'>('all');
  const [studioId, setStudioId] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('updated');

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <SkeletonCard key={index} lines={5} />
        ))}
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <ErrorState
        title="The project library could not be read"
        description={state.error?.message ?? 'Local storage is unavailable in this browser.'}
        detail={state.error?.detail}
        action={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                void documents.load();
              }}
            >
              Try again
            </Button>
            {/* The damaged value is never deleted implicitly, so recovery is a deliberate step. */}
            <Button asChild variant="quiet">
              <Link href="/settings">Open storage settings</Link>
            </Button>
          </>
        }
      />
    );
  }

  const studioOptions = [
    { value: 'all', label: 'All studios' },
    ...Array.from(new Set(state.documents.map((document) => document.studioId))).map((id) => ({
      value: id,
      label: getStudio(id)?.name ?? id,
    })),
  ];

  const filtered = state.documents
    .filter((document) => {
      if (status !== 'all' && document.status !== status) return false;
      if (studioId !== 'all' && document.studioId !== studioId) return false;
      if (!query.trim()) return true;
      const needle = query.trim().toLowerCase();
      return [document.title, document.summary, document.metadata.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    })
    .sort((a, b) => {
      if (sort === 'name') return a.title.localeCompare(b.title);
      if (sort === 'size')
        return b.canvas.width * b.canvas.height - a.canvas.width * a.canvas.height;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  return (
    <div className="space-y-5">
      {volatile ? (
        <InlineNote
          tone="danger"
          icon={<ShieldAlert aria-hidden />}
          title="This list is not stored on this device"
        >
          <p>
            Storage is unavailable, so these projects are held in memory for this tab only. They
            disappear when the tab reloads or closes. Export project files for anything you want to
            keep.
          </p>
        </InlineNote>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search" className="min-w-56 flex-1">
          <div className="relative">
            <Search
              aria-hidden
              className="text-fg-subtle pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search by name, summary or tag"
              aria-label="Search projects"
              className="border-line-strong bg-ink-950 text-fg placeholder:text-fg-subtle focus:border-arc-500 h-9 w-full rounded-sm border pr-2.5 pl-8 text-base focus:outline-none"
            />
          </div>
        </Field>

        <div className="space-y-1.5">
          <p className="text-2xs text-fg-muted font-medium tracking-wide uppercase">Status</p>
          <SegmentedControl
            label="Filter projects by status"
            size="sm"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'All', count: state.documents.length },
              ...(['draft', 'in-review', 'ready', 'archived'] as const).map((value) => ({
                value,
                label: DOCUMENT_STATUS_LABELS[value],
                count: state.documents.filter((document) => document.status === value).length,
              })),
            ]}
          />
        </div>

        <Field label="Sort">
          <Select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as SortKey);
            }}
            options={[
              { value: 'updated', label: 'Recently updated' },
              { value: 'name', label: 'Name' },
              { value: 'size', label: 'Canvas size' },
            ]}
          />
        </Field>

        {studioOptions.length > 1 ? (
          <Field label="Studio">
            <Select
              value={studioId}
              onChange={(event) => setStudioId(event.target.value)}
              options={studioOptions}
            />
          </Field>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-fg-subtle text-xs">
          Showing {filtered.length} of {state.documents.length} stored project
          {state.documents.length === 1 ? '' : 's'}
          {state.migratedCount > 0
            ? ` · ${state.migratedCount} migrated from an older schema version`
            : ''}
        </p>
        <span className="text-2xs text-fg-subtle inline-flex items-center gap-1.5">
          <SlidersHorizontal aria-hidden className="size-3.5" />
          Filters apply instantly in this browser
        </span>
      </div>

      {state.documents.length === 0 ? (
        <EmptyState
          icon={<FolderOpen aria-hidden />}
          title="Your library is empty"
          description={
            volatile
              ? 'Storage is unavailable, so nothing is written to this device and this list starts empty every time. Export project files to keep your work.'
              : 'Projects are created and stored in this browser on this device. There is no account and no sync, so a new browser starts from nothing.'
          }
          actions={
            <>
              <Button asChild variant="primary">
                <Link href="/create">Create a project</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/learn/your-first-project">Follow the beginner tutorial</Link>
              </Button>
            </>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search aria-hidden />}
          title="No projects match those filters"
          description={truncate(
            `Nothing matches “${query}” with the current status and studio filters. Clear a filter to see more.`,
            160,
          )}
          actions={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery('');
                setStatus('all');
                setStudioId('all');
              }}
            >
              Clear filters
            </Button>
          }
          size="sm"
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((document) => (
            <li key={document.id} className="relative">
              <ProjectCard
                document={document}
                className="h-full"
                onDelete={(target) => {
                  void documents.remove(target.id).then((result) => {
                    if (result.ok) {
                      toasts.success(
                        'Project deleted',
                        `“${target.title}” was removed from this browser.`,
                      );
                    } else {
                      toasts.error('Could not delete project', result.error.message);
                    }
                  });
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {state.skipped.length > 0 ? (
        <div className="rounded-md border border-amber-600/40 bg-amber-600/8 px-4 py-3">
          <p className="text-fg inline-flex items-center gap-2 text-sm">
            <Badge tone="warning">{state.skipped.length} skipped</Badge>
            Some stored records could not be read and were left untouched.
          </p>
          <ul className="text-fg-muted mt-2 space-y-1 text-xs">
            {state.skipped.map((skipped, index) => (
              <li key={`${skipped.reason}-${String(index)}`}>{skipped.reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
