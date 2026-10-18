'use client';

import { ArrowLeft, CircleAlert, Redo2, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { EMPTY_SELECTION, type Selection } from '../../core/editor/selection';
import type { Scene } from '../../core/documents/layer-types';
import { getStudio } from '../../core/studios';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/dialog';
import { IconButton } from '../ui/icon-button';
import { PageHeader } from '../ui/section';
import { EmptyState, ErrorState, InlineNote, SkeletonCard } from '../ui/states';
import { useForgeServices } from '../../state/forge-provider';
import { useDocumentSession, useStorageStatus } from '../../state/hooks';
import { storageBadge } from '../../state/storage-status';
import type { Result } from '../../core/result';
import type { CommitOptions, DocumentPatch } from '../../state/document-session';
import type { SceneCommand } from '../../core/editor/commands';
import { IllustrationWorkspace, isVectorDocument } from '../illustration/illustration-workspace';
import { MotionWorkspace, isMotionDocument } from '../motion/motion-workspace';
import { PhotoWorkspace, isPhotoDocument } from '../photo/photo-workspace';
import { VideoWorkspace, isVideoDocument } from '../video/video-workspace';
import { ContextHelp } from './context-help';
import { DocumentAside } from './document-aside';
import { DocumentStage } from './document-stage';
import { SaveState } from './history-panel';
import { useSceneImages } from './use-scene-images';
import type { WorkspaceApi } from './workspace-api';

/** Stable identity for "no document yet", so the image cache is not invalidated every render. */
const EMPTY_SCENE: Scene = { layers: [] };

/**
 * Document workspace.
 *
 * Composition root for a single open document: stage on the left, inspector rail on the right, and
 * the learning panel underneath. All edits flow through the session so undo, persistence and the
 * save indicator stay in agreement.
 */
export function WorkspaceView({ documentId }: { readonly documentId: string }) {
  const router = useRouter();
  const { documents, toasts } = useForgeServices();
  const storageStatus = useStorageStatus();
  const badge = storageBadge(storageStatus);
  const { session, state, library } = useDocumentSession(documentId);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Selection is transient interaction state: it is never persisted and never enters history.
  // Transient interaction state, deliberately scoped to this screen (ADR-0017): it is not written
  // into the document, not persisted and not a history entry. Selection and the two view toggles
  // are the whole of it — anything that changes the document goes through the session below.
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [snapping, setSnapping] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  // One image cache for the whole workspace, so the artboard and the export renderer resolve the
  // same decoded bitmaps and cannot disagree about what a graphic looks like.
  const scene = state?.document.scene;
  const images = useSceneImages(scene ?? EMPTY_SCENE);

  const commit = useCallback(
    async (label: string, patch: DocumentPatch, options?: CommitOptions): Promise<boolean> => {
      if (!session) return false;
      const result = await session.commit(label, patch, options);
      if (!result.ok) {
        toasts.warning('Change not saved', result.error.message);
        return false;
      }
      return true;
    },
    [session, toasts],
  );

  /**
   * Runs an editor command. A command that cannot be built (a layer that vanished, an invalid value)
   * reports why instead of failing silently.
   */
  const run = useCallback(
    async (command: Result<SceneCommand>, options?: CommitOptions): Promise<boolean> => {
      if (!command.ok) {
        toasts.warning('That edit was not applied', command.error.message);
        return false;
      }
      return commit(command.value.label, command.value.patch, options);
    },
    [commit, toasts],
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
  const api: WorkspaceApi = { doc, commit, run, undo, redo };
  // The document type decides the editing surface: a vector artboard gets the Illustration Studio,
  // an image gets Photo Studio, everything else keeps the design workspace. The shell, the session,
  // undo and persistence are shared, so no surface has its own private editing path.
  const vectorDocument = isVectorDocument(String(doc.documentTypeId));
  const photoDocument = isPhotoDocument(String(doc.documentTypeId));
  const photoPayload = doc.studioPayload?.kind === 'photo' ? doc.studioPayload : null;
  const motionDocument = isMotionDocument(String(doc.documentTypeId));
  const motionPayload = doc.studioPayload?.kind === 'motion' ? doc.studioPayload : null;
  const videoDocument = isVideoDocument(String(doc.documentTypeId));
  const videoPayload = doc.studioPayload?.kind === 'video' ? doc.studioPayload : null;

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

      {motionDocument ? (
        motionPayload ? (
          <MotionWorkspace
            api={api}
            payload={motionPayload}
            history={state.history}
            canUndo={state.canUndo}
            canRedo={state.canRedo}
            onUndo={undo}
            onRedo={redo}
          />
        ) : (
          <InlineNote
            tone="danger"
            icon={<CircleAlert aria-hidden />}
            title="This motion project is missing its animation data"
          >
            <p>
              The document has no motion payload, so there is nothing to play. Export the project
              file and reopen it, or create a new motion project.
            </p>
          </InlineNote>
        )
      ) : photoDocument ? (
        photoPayload ? (
          <PhotoWorkspace
            api={api}
            payload={photoPayload}
            history={state.history}
            canUndo={state.canUndo}
            canRedo={state.canRedo}
            onUndo={undo}
            onRedo={redo}
          />
        ) : (
          <InlineNote
            tone="danger"
            icon={<CircleAlert aria-hidden />}
            title="This photo project is missing its image data"
          >
            <p>
              The document has no photo payload, so there is nothing to edit. Export the project
              file and reopen it, or create a new photo project.
            </p>
          </InlineNote>
        )
      ) : videoDocument ? (
        videoPayload ? (
          <VideoWorkspace
            api={api}
            payload={videoPayload}
            history={state.history}
            canUndo={state.canUndo}
            canRedo={state.canRedo}
            onUndo={undo}
            onRedo={redo}
          />
        ) : (
          <InlineNote
            tone="danger"
            icon={<CircleAlert aria-hidden />}
            title="This video project is missing its timeline"
          >
            <p>
              The document has no video payload, so there is nothing to play. Export the project
              file and reopen it, or create a new video project.
            </p>
          </InlineNote>
        )
      ) : vectorDocument ? (
        <IllustrationWorkspace
          api={api}
          scene={doc.scene}
          images={images}
          selection={selection}
          onSelectionChange={setSelection}
          history={state.history}
          canUndo={state.canUndo}
          canRedo={state.canRedo}
          onUndo={undo}
          onRedo={redo}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="min-w-0 space-y-5">
            <DocumentStage
              api={api}
              selection={selection}
              onSelectionChange={setSelection}
              images={images}
              snapping={snapping}
              onSnappingChange={setSnapping}
              showGuides={showGuides}
              onGuidesChange={setShowGuides}
            />
            <ContextHelp studioId={doc.studioId} />
          </div>

          <DocumentAside
            api={api}
            scene={doc.scene}
            images={images}
            selection={selection}
            onSelectionChange={setSelection}
            history={state.history}
            canUndo={state.canUndo}
            canRedo={state.canRedo}
            onUndo={undo}
            onRedo={redo}
          />
        </div>
      )}

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
