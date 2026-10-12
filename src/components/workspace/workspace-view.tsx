'use client';

import { ArrowLeft, CircleAlert, Redo2, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { getStudio } from '../../core/studios';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/dialog';
import { IconButton } from '../ui/icon-button';
import { PageHeader } from '../ui/section';
import { EmptyState, ErrorState, InlineNote, SkeletonCard } from '../ui/states';
import { useForgeServices } from '../../state/forge-provider';
import { useDocumentSession } from '../../state/hooks';
import { storageBadge } from '../../state/storage-status';
import type { DocumentPatch } from '../../state/document-session';
import { ContextHelp } from './context-help';
import { DocumentAside } from './document-aside';
import { DocumentStage } from './document-stage';
import { SaveState } from './history-panel';
import type { WorkspaceApi } from './workspace-api';

/**
 * Document workspace.
 *
 * Composition root for a single open document: stage on the left, inspector rail on the right, and
 * the learning panel underneath. All edits flow through the session so undo, persistence and the
 * save indicator stay in agreement.
 */
export function WorkspaceView({ documentId }: { readonly documentId: string }) {
  const router = useRouter();
  const { documents, toasts, storageStatus } = useForgeServices();
  const badge = storageBadge(storageStatus);
  const { session, state, library } = useDocumentSession(documentId);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const commit = useCallback(
    async (label: string, patch: DocumentPatch): Promise<boolean> => {
      if (!session) return false;
      const result = await session.commit(label, patch);
      if (!result.ok) {
        toasts.warning('Change not saved', result.error.message);
        return false;
      }
      return true;
    },
    [session, toasts],
  );

  const undo = useCallback(() => {
    if (!session) return;
    void session.undo().then((result) => {
      if (!result.ok) toasts.info(result.error.message);
    });
  }, [session, toasts]);

  const redo = useCallback(() => {
    if (!session) return;
    void session.redo().then((result) => {
      if (!result.ok) toasts.info(result.error.message);
    });
  }, [session, toasts]);

  // Undo/redo shortcuts. Text fields keep native undo while they have focus.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      if (isTyping) return;
      const isUndo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z';
      if (!isUndo) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [redo, undo]);

  if (library.status === 'loading' || library.status === 'idle') {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={6} />
      </div>
    );
  }

  if (library.status === 'error') {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <ErrorState
          title="The project library could not be read"
          description={library.error?.message ?? 'Local storage is unavailable in this browser.'}
          detail={library.error?.detail}
          action={
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
      </div>
    );
  }

  if (!session || !state) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <EmptyState
          icon={<ArrowLeft aria-hidden />}
          title="Project not found"
          description="This project is not in this browser's storage. It may have been deleted, or it may live in a different browser profile on another device."
          actions={
            <>
              <Button asChild variant="primary">
                <Link href="/projects">Browse projects</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/create">Create a new project</Link>
              </Button>
            </>
          }
        />
      </div>
    );
  }

  const doc = state.document;
  const studio = getStudio(doc.studioId);
  const api: WorkspaceApi = { doc, commit, undo, redo };

  return (
    <div className="mx-auto max-w-[100rem] space-y-5 p-4 sm:p-6">
      <PageHeader
        title={doc.title}
        lead={studio ? `${studio.name} · ${studio.tagline}` : undefined}
        meta={
          <>
            <SaveState
              dirty={state.dirty}
              saving={state.saving}
              savedAt={state.lastSavedAt}
              error={state.lastError ? state.lastError.message : null}
              storage={storageStatus}
            />
            <span aria-hidden>·</span>
            <span className="forge-numeric">revision {doc.revision}</span>
            <span aria-hidden>·</span>
            {/* Three states, three labels: see `storageBadge()` in the state layer. */}
            <Badge tone={badge.warning ? 'warning' : 'neutral'}>{badge.label}</Badge>
          </>
        }
        actions={
          <>
            <Button asChild variant="quiet" size="md" iconLeft={<ArrowLeft aria-hidden />}>
              <Link href="/projects">Projects</Link>
            </Button>
            <IconButton label="Undo (Cmd/Ctrl + Z)" disabled={!state.canUndo} onClick={undo}>
              <Undo2 aria-hidden />
            </IconButton>
            <IconButton
              label="Redo (Cmd/Ctrl + Shift + Z)"
              disabled={!state.canRedo}
              onClick={redo}
            >
              <Redo2 aria-hidden />
            </IconButton>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteOpen(true);
              }}
            >
              Delete
            </Button>
          </>
        }
      />

      {state.lastError ? (
        <InlineNote
          tone="danger"
          icon={<CircleAlert aria-hidden />}
          title="The last change was not saved"
        >
          <p>{state.lastError.message}</p>
          {state.lastError.detail ? (
            <p className="forge-numeric text-2xs">{state.lastError.detail}</p>
          ) : null}
          <p className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // `session` is already narrowed by the not-found guard above.
                void session.retrySave().then((result) => {
                  if (result.ok) toasts.success('Saved', 'The pending change was written.');
                });
              }}
            >
              Try saving again
            </Button>
            {state.lastError.code === 'storage-quota-exceeded' ? (
              <Link href="/projects" className="text-fg underline decoration-1 underline-offset-2">
                Delete a project to free space
              </Link>
            ) : null}
            {storageStatus.durability === 'volatile' && storageStatus.determined ? (
              <Link href="/settings" className="text-fg underline decoration-1 underline-offset-2">
                Check storage settings
              </Link>
            ) : null}
          </p>
        </InlineNote>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-5">
          <DocumentStage doc={doc} />
          <ContextHelp studioId={doc.studioId} />
        </div>

        <DocumentAside
          api={api}
          history={state.history}
          canUndo={state.canUndo}
          canRedo={state.canRedo}
          onUndo={undo}
          onRedo={redo}
        />
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete “${doc.title}”?`}
        description="The project is removed from this browser immediately and cannot be restored."
        confirmLabel="Delete project"
        onConfirm={() => {
          void documents.remove(doc.id).then((result) => {
            if (!result.ok) {
              toasts.error('The project could not be deleted', result.error.message);
              return;
            }
            toasts.success('Project deleted', 'The local record was removed.');
            router.push('/projects');
          });
        }}
      >
        <p className="text-fg-muted text-sm">
          Export the project file first if you want to keep the document definition.
        </p>
      </ConfirmDialog>
    </div>
  );
}
