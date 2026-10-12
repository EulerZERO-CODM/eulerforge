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

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { session, state, library, preset: undefined };
}

/**
 * Lessons for a filter. Content is a small, static, in-memory set, so filtering happens inline
 * rather than behind memoisation that would need a synthetic dependency key.
 */
export function useLessons(filter: LessonFilter): readonly Lesson[] {
  return listLessons(filter);
}
