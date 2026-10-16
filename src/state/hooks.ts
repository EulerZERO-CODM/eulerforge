'use client';

/**
 * Application-level hooks.
 *
 * Thin adapters over the services in `ForgeProvider` plus the generic `useStore`. Keeping them in
 * one module means a component that needs the project library writes `useDocuments()` rather than
 * knowing how the store is wired.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import type { CanvasPreset } from '../core/documents/types';
import { getExportFormat, PROJECT_FILE_FORMAT_ID } from '../core/export/formats';
import { listLessons, type LessonFilter } from '../core/learning/query';
import type { Lesson } from '../core/learning/types';
import { useStore } from '../lib/use-store';
import type { DocumentSession, DocumentSessionState } from './document-session';
import type { DocumentsState } from './documents-store';
import { useForgeServices } from './forge-provider';
import { undeterminedStorageStatus, type ForgeStorageStatus } from './storage-status';
import type { LessonProgress, LearningProgressState } from './learning-progress-store';
import type { PreferencesState } from './preferences-store';
import type { ToastState } from './toast-store';

export function useDocuments(): DocumentsState {
  const { documents } = useForgeServices();
  return useStore(documents);
}

export function usePreferences(): PreferencesState {
  const { preferences } = useForgeServices();
  return useStore(preferences);
}

export function useToasts(): ToastState {
  const { toasts } = useForgeServices();
  return useStore(toasts);
}

/**
 * The storage status the interface may show.
 *
 * Whether this browser will store anything can only be asked *after* the page has loaded, so a server
 * render cannot know the answer. Reading the browser's answer during hydration would tear the
 * server's markup down and re-render the page in the browser (React's hydration error), and that is
 * exactly what happened on every screen: the server rendered "Checking storage…" and the first client
 * render replaced it with a real claim or a warning. `useSyncExternalStore` resolves it without
 * pretending: the hydration render uses the *server* snapshot, and React re-renders with the
 * inspected status as soon as hydration commits, so the session-only warning appears the moment it is
 * known rather than before the browser has been asked.
 */
export function useStorageStatus(): ForgeStorageStatus {
  const { storageStatus } = useForgeServices();
  return useSyncExternalStore(
    subscribeToNothing,
    () => storageStatus,
    () => UNDETERMINED_STORAGE_STATUS,
  );
}

/**
 * One immutable "not determined yet" status.
 *
 * A fresh object per call would make the server snapshot change identity between renders, which
 * React treats as a store that never settles.
 */
const UNDETERMINED_STORAGE_STATUS = undeterminedStorageStatus();

/** The status is fixed for the tab, so there is nothing to subscribe to. */
function subscribeToNothing(): () => void {
  return () => undefined;
}

export function useLearningProgress(): LearningProgressState {
  const { learning } = useForgeServices();
  return useStore(learning);
}

export function useLessonProgress(slug: string): LessonProgress {
  useLearningProgress();
  const { learning } = useForgeServices();
  return learning.getLesson(slug);
}

/** Loads the project library once when the shell mounts. */
export function useDocumentLibrary(): DocumentsState {
  const { documents } = useForgeServices();
  const state = useStore(documents);
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    if (state.status === 'idle') {
      void documents.load();
    }
  }, [documents, state.status]);

  return state;
}

/**
 * Defaults used by the creation flow and the workspace export panel, derived from preferences so
 * both surfaces agree on what the user last chose.
 */
export function useCreationDefaults(): {
  readonly defaultExportFormatId: string;
  readonly preferredStudioId: string;
} {
  const { preferences } = usePreferences();
  const format = getExportFormat(preferences.defaultExportFormatId);
  return {
    defaultExportFormatId: format ? format.id : PROJECT_FILE_FORMAT_ID,
    preferredStudioId: preferences.preferredStudioId,
  };
}

export type DocumentSessionHandle = {
  readonly session: DocumentSession | null;
  readonly state: DocumentSessionState | null;
  /** Library state, so a screen can distinguish "loading" from "not found". */
  readonly library: DocumentsState;
  /** Presets suggested for this document's studio, if any. */
  readonly preset: CanvasPreset | undefined;
};

/**
 * Binds a `DocumentSession` to React for the lifetime of an open document id.
 *
 * The session is created once per document id and re-created when documents are reloaded.
 * Persistence goes through the documents store, so the library and the open document cannot drift
 * apart.
 */
export function useDocumentSession(documentId: string | null): DocumentSessionHandle {
  const { documents } = useForgeServices();
  const library = useStore(documents);

  // The store owns sessions and returns the same instance for the same id, so asking for it during
  // render is safe and no effect is needed to keep the two in sync.
  const session = documentId ? documents.session(documentId) : null;

  const subscribe = useCallback(
    (listener: () => void) => (session ? session.subscribe(listener) : () => undefined),
    [session],
  );
  const getSnapshot = useCallback(() => (session ? session.getState() : null), [session]);
  // The server render had no session at all: it cannot read this device's storage. Hydration
  // therefore has to start from the same "no session yet" answer and let the live state follow, or a
  // direct load of `/workspace/<id>` would hydrate an editor against "Project not found".
  const getServerSnapshot = useCallback(() => (session ? session.initialState : null), [session]);

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return { session, state, library, preset: undefined };
}

/**
 * Lessons for a filter. Content is a small, static, in-memory set, so filtering happens inline
 * rather than behind memoisation that would need a synthetic dependency key.
 */
export function useLessons(filter: LessonFilter): readonly Lesson[] {
  return listLessons(filter);
}
