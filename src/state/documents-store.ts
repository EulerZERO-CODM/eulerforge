/**
 * Documents store.
 *
 * Owns the project library: loading, creating, updating and deleting documents through the
 * `DocumentRepository` boundary. Deliberately a plain class (no React) so the whole lifecycle is
 * unit-testable with an in-memory repository.
 */

import type { EventBus, PlatformEventMap } from '../core/events/event-bus';
import { createDocument, type CreateDocumentOptions } from '../core/documents/factories';
import type { CreateDocumentInput, DocumentId, ForgeDocument } from '../core/documents/types';
import { isDocumentStructurallySound } from '../core/documents/validation';
import type { DocumentRepository, SkippedDocument } from '../core/persistence/document-repository';
import { err, forgeError, ok, toErrorMessage, type ForgeError, type Result } from '../core/result';
import { createStore, type Store } from '../lib/create-store';
import { DocumentSession } from './document-session';

export type DocumentsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type DocumentsState = {
  readonly status: DocumentsStatus;
  readonly documents: readonly ForgeDocument[];
  /** Records that could not be read; shown to the user instead of being hidden. */
  readonly skipped: readonly SkippedDocument[];
  readonly error: ForgeError | null;
  /** Set after a load that had to migrate records, for an honest one-line notice. */
  readonly migratedCount: number;
};

const INITIAL_STATE: DocumentsState = {
  status: 'idle',
  documents: [],
  skipped: [],
  error: null,
  migratedCount: 0,
};

export type DocumentsStoreOptions = {
  readonly repository: DocumentRepository;
  readonly bus: EventBus<PlatformEventMap>;
  readonly now?: () => Date;
  readonly generateId?: () => string;
};

export class DocumentsStore {
  private readonly store: Store<DocumentsState>;
  /**
   * Open editing sessions, one per document id. The store owns them (rather than a component) so a
   * session survives re-renders and navigation, and so deleting a document also closes its session.
   */
  private readonly sessions = new Map<string, DocumentSession>();

  public constructor(private readonly options: DocumentsStoreOptions) {
    this.store = createStore<DocumentsState>(INITIAL_STATE);
  }

  /**
   * Returns the editing session for a document, creating it on first use.
   * The call is idempotent, which is what lets a React component ask for it during render.
   */
  public session(id: string): DocumentSession | null {
    const document = this.getById(id);
    if (!document) {
      this.sessions.delete(id);
      return null;
    }
    const existing = this.sessions.get(id);
    if (existing) return existing;

    const created = new DocumentSession({
      document,
      persist: (next) => this.update(next),
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    });
    this.sessions.set(id, created);
    return created;
  }

  /** Ends the session for a document (called before deletion). */
  public closeSession(id: string): void {
    this.sessions.delete(id);
  }

  public subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener);
  }

  public getState(): DocumentsState {
    return this.store.getState();
  }

  /**
   * The state a server render saw: the store is created with this value and may load afterwards, and
   * React needs the first of the two to hydrate against the markup the server sent (see `useStore`).
   */
  public get initialState(): DocumentsState {
    return this.store.initialState;
  }

  /** Loads the library. Safe to call repeatedly; the second call re-reads storage. */
  public async load(): Promise<Result<readonly ForgeDocument[]>> {
    this.store.setState((previous) => ({ ...previous, status: 'loading', error: null }));

    const result = await this.options.repository.list();
    if (!result.ok) {
      this.store.setState((previous) => ({ ...previous, status: 'error', error: result.error }));
      this.options.bus.emit('storage:error', {
        code: result.error.code,
        message: result.error.message,
      });
      return err(result.error);
    }

    const { documents, skipped, migrated } = result.value;
    this.store.setState({
      status: 'ready',
      documents,
      skipped,
      error: null,
      migratedCount: migrated,
    });
    this.options.bus.emit('documents:loaded', {
      count: documents.length,
      skipped: skipped.length,
      migrated,
    });

    return ok(documents);
  }

  public getById(id: DocumentId | string): ForgeDocument | undefined {
    return this.store.getState().documents.find((document) => document.id === String(id));
  }

  public async create(
    input: CreateDocumentInput,
    options: CreateDocumentOptions = {},
  ): Promise<Result<ForgeDocument>> {
    const created = createDocument(input, {
      ...((options.now ?? this.options.now) ? { now: options.now ?? this.options.now } : {}),
      ...((options.generateId ?? this.options.generateId)
        ? { generateId: options.generateId ?? this.options.generateId }
        : {}),
    });
    if (!created.ok) return err(created.error);

    const saved = await this.options.repository.save(created.value);
    if (!saved.ok) {
      this.options.bus.emit('storage:error', {
        code: saved.error.code,
        message: saved.error.message,
      });
      return err(saved.error);
    }

    this.store.setState((previous) => ({
      ...previous,
      status: 'ready',
      documents: [saved.value, ...previous.documents],
    }));
    this.options.bus.emit('document:created', {
      id: saved.value.id,
      title: saved.value.title,
      studioId: saved.value.studioId,
    });
    return ok(saved.value);
  }

  /**
   * Persists a changed document.
   * Structural validation happens here so an invalid document cannot reach storage.
   */
  public async update(document: ForgeDocument): Promise<Result<ForgeDocument>> {
    if (!isDocumentStructurallySound(document)) {
      return err(
        forgeError('validation-failed', 'The document is not in a valid state and was not saved.'),
      );
    }

    const saved = await this.options.repository.save(document);
    if (!saved.ok) {
      this.options.bus.emit('storage:error', {
        code: saved.error.code,
        message: saved.error.message,
      });
      return err(saved.error);
    }

    this.store.setState((previous) => ({
      ...previous,
      documents: [
        saved.value,
        ...previous.documents.filter((existing) => existing.id !== saved.value.id),
      ],
    }));
    this.options.bus.emit('document:saved', {
      id: saved.value.id,
      title: saved.value.title,
      revision: saved.value.revision,
    });
    return ok(saved.value);
  }

  public async remove(id: DocumentId | string): Promise<Result<void>> {
    const existing = this.getById(id);
    const removed = await this.options.repository.remove(String(id) as DocumentId);
    if (!removed.ok) {
      this.options.bus.emit('storage:error', {
        code: removed.error.code,
        message: removed.error.message,
      });
      return err(removed.error);
    }

    this.sessions.delete(String(id));
    this.store.setState((previous) => ({
      ...previous,
      documents: previous.documents.filter((document) => document.id !== String(id)),
    }));
    if (existing) {
      this.options.bus.emit('document:deleted', { id: existing.id, title: existing.title });
    }
    return ok(undefined);
  }

  public async clearAll(): Promise<Result<number>> {
    const count = this.store.getState().documents.length;
    const cleared = await this.options.repository.clearAll();
    if (!cleared.ok) return err(cleared.error);

    this.sessions.clear();
    this.store.setState((previous) => ({ ...previous, documents: [] }));
    this.options.bus.emit('documents:cleared', { removed: count });
    return ok(count);
  }

  /** Re-reads storage and returns a human-readable diagnostic for the settings panel. */
  public async health(): Promise<Result<{ count: number; skipped: number; bytes: number }>> {
    const result = await this.options.repository.list();
    if (!result.ok) return err(result.error);
    const serialised = JSON.stringify(result.value.documents);
    return ok({
      count: result.value.documents.length,
      skipped: result.value.skipped.length,
      bytes: serialised.length,
    });
  }

  /** Error text for the last failed operation, if any. */
  public lastErrorMessage(): string | null {
    const error = this.store.getState().error;
    return error ? error.message : null;
  }
}

export function describeStoreError(error: unknown): string {
  return toErrorMessage(error);
}
