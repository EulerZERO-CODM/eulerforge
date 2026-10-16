/**
 * Document editing session.
 *
 * Wraps a single open document with:
 *   - a bounded undo/redo history (Forge Core),
 *   - validation before a change is accepted,
 *   - persistence through the store when a change is committed,
 *   - explicit dirty / saving / error state for the UI.
 *
 * Every document edit in the workspace goes through `commit`, which is why undo, the history panel
 * and the save indicator can never disagree about what happened.
 */

import { applyDocumentPatch } from '../core/documents/factories';
import type { DocumentPatch } from '../core/documents/patch';
import type { ForgeDocument } from '../core/documents/types';
import { isDocumentStructurallySound } from '../core/documents/validation';
import { HistoryStack, type HistorySnapshot } from '../core/history/history';
import { err, forgeError, ok, toErrorMessage, type ForgeError, type Result } from '../core/result';
import { createStore, type Store } from '../lib/create-store';

export type { DocumentPatch };

export type DocumentSessionState = {
  readonly document: ForgeDocument;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly history: readonly { readonly id: number; readonly label: string }[];
  /** True when the in-memory document differs from the last persisted revision. */
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly lastError: ForgeError | null;
  readonly lastSavedAt: string | null;
};

export type DocumentSessionOptions = {
  readonly document: ForgeDocument;
  readonly persist: (document: ForgeDocument) => Promise<Result<ForgeDocument>>;
  readonly now?: () => Date;
  readonly historyLimit?: number;
};

export class DocumentSession {
  private readonly history: HistoryStack<ForgeDocument>;
  private readonly store: Store<DocumentSessionState>;
  private readonly persist: (document: ForgeDocument) => Promise<Result<ForgeDocument>>;
  private readonly now: () => Date;

  public constructor(options: DocumentSessionOptions) {
    this.persist = options.persist;
    this.now = options.now ?? (() => new Date());
    this.history = new HistoryStack<ForgeDocument>({
      initial: options.document,
      ...(options.historyLimit === undefined ? {} : { limit: options.historyLimit }),
      now: this.now,
    });
    this.store = createStore<DocumentSessionState>(this.buildState(false));
  }

  private buildState(dirty: boolean): DocumentSessionState {
    const snapshot: HistorySnapshot<ForgeDocument> = this.history.snapshot();
    return {
      document: snapshot.state,
      canUndo: snapshot.canUndo,
      canRedo: snapshot.canRedo,
      history: snapshot.labels,
      dirty,
      saving: false,
      lastError: null,
      lastSavedAt: null,
    };
  }

  public subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener);
  }

  public getState(): DocumentSessionState {
    return this.store.getState();
  }

  /**
   * The state a server render saw: the store is created with this value and may load afterwards, and
   * React needs the first of the two to hydrate against the markup the server sent (see `useStore`).
   */
  public get initialState(): DocumentSessionState {
    return this.store.initialState;
  }

  /**
   * Applies a labelled change: validate → record in history → persist.
   * @returns the persisted document, or an error explaining why nothing changed.
   */
  public async commit(label: string, patch: DocumentPatch): Promise<Result<ForgeDocument>> {
    const current = this.store.getState().document;
    const next = applyDocumentPatch(current, patch, this.now());

    // Editing a field and leaving it unchanged must not create an undo step or bump the revision.
    if (contentSignature(next) === contentSignature(current)) {
      return ok(current);
    }

    if (!isDocumentStructurallySound(next)) {
      return err(
        forgeError(
          'validation-failed',
          'That change would leave the document in an invalid state.',
          {
            detail: `Change rejected: ${label}`,
          },
        ),
      );
    }

    const entry = this.history.commit(label, next);
    if (!entry) {
      // No-op change: report success with the current document so callers stay simple.
      return ok(current);
    }

    return this.persistToStore(true);
  }

  public async undo(): Promise<Result<ForgeDocument>> {
    if (!this.history.canUndo()) {
      return err(forgeError('validation-failed', 'There is nothing to undo.'));
    }
    this.history.undo();
    return this.persistToStore(false);
  }

  public async redo(): Promise<Result<ForgeDocument>> {
    if (!this.history.canRedo()) {
      return err(forgeError('validation-failed', 'There is nothing to redo.'));
    }
    this.history.redo();
    return this.persistToStore(false);
  }

  private async persistToStore(dirty: boolean): Promise<Result<ForgeDocument>> {
    // The history stack holds the present: `commit`, `undo` and `redo` all move it before calling
    // here, so reading the stored state instead would persist the *previous* revision.
    const document = this.history.getState();
    this.store.setState(() => ({ ...this.buildState(dirty), saving: true }));

    const saved = await this.persist(document);
    if (!saved.ok) {
      this.store.setState((previous) => ({
        ...previous,
        saving: false,
        dirty: true,
        lastError: saved.error,
      }));
      return err(saved.error);
    }

    // The persisted value is authoritative (it may carry a normalised field).
    if (saved.value !== document) this.history.reset(saved.value);

    const state: DocumentSessionState = {
      ...this.buildState(false),
      saving: false,
      lastError: null,
      lastSavedAt: this.now().toISOString(),
      document: saved.value,
    };
    this.store.setState(state);
    return ok(saved.value);
  }

  /**
   * Re-attempts persistence for the current document.
   *
   * Used by the workspace's "Try saving again" action after a failed write (quota, or a browser that
   * refused the write). It persists whatever the history currently holds, so a retry can never save
   * a different revision than the one the user sees.
   */
  public async retrySave(): Promise<Result<ForgeDocument>> {
    return this.persistToStore(true);
  }

  /** Replaces the session's document (e.g. after an external reload). */
  public replace(document: ForgeDocument): void {
    this.history.reset(document);
    this.store.setState(this.buildState(false));
  }

  /** Human-readable description of the most recent failure, for a toast. */
  public errorMessage(): string | null {
    const error = this.store.getState().lastError;
    return error ? error.message : null;
  }
}

/**
 * Signature of everything a patch may change, ignoring `revision` and `updatedAt`.
 * Two documents with the same signature are the same content, so committing is a no-op.
 */
function contentSignature(document: ForgeDocument): string {
  return JSON.stringify({
    studioId: document.studioId,
    documentTypeId: document.documentTypeId,
    title: document.title,
    summary: document.summary,
    canvas: document.canvas,
    guides: document.guides,
    palette: document.palette,
    scene: document.scene,
    attribution: document.attribution,
    metadata: document.metadata,
    status: document.status,
  });
}

export function describeSessionFailure(error: unknown): string {
  return toErrorMessage(error);
}
