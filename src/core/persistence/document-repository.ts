/**
 * Document persistence boundary.
 *
 * Phase 1 ships a device-local implementation. The interface is promise-based on purpose: a remote
 * adapter must not force a rewrite of every caller (ADR-0006). Nothing here claims cloud storage —
 * see docs/PRODUCT_VISION.md → boundaries.
 */

import { err, forgeError, ok, type Result } from '../result';
import {
  CURRENT_SCHEMA_VERSION,
  migrateDocument,
  readSchemaVersion,
} from '../documents/migrations';
import type { DocumentId, ForgeDocument } from '../documents/types';
import { storageKey, type KeyValueStorage } from './storage';

export const DOCUMENTS_KEY = storageKey('documents');

/** Envelope written to storage. Keeping documents in one record makes atomic-ish writes simple. */
type DocumentsEnvelope = {
  readonly schemaVersion: number;
  readonly savedAt: string;
  /** Untrusted on read: each entry passes through `migrateDocument`. */
  readonly documents: readonly unknown[];
};

export type SkippedDocument = {
  readonly reason: string;
  readonly detail?: string;
};

export type DocumentLoadReport = {
  readonly documents: readonly ForgeDocument[];
  readonly skipped: readonly SkippedDocument[];
  /** Number of documents that had to be migrated from an older schema version. */
  readonly migrated: number;
};

export interface DocumentRepository {
  list(): Promise<Result<DocumentLoadReport>>;
  get(id: DocumentId): Promise<Result<ForgeDocument | null>>;
  save(document: ForgeDocument): Promise<Result<ForgeDocument>>;
  remove(id: DocumentId): Promise<Result<void>>;
  /** Removes every document for this origin. Used by the settings "clear local data" action. */
  clearAll(): Promise<Result<void>>;
}

function parseEnvelope(raw: string | null): Result<readonly unknown[]> {
  if (raw === null) return ok([]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return err(
      forgeError('storage-corrupt', 'The saved project index could not be read and was ignored.', {
        detail: error instanceof Error ? error.message : undefined,
      }),
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err(forgeError('storage-corrupt', 'The saved project index had an unexpected shape.'));
  }
  const candidate = (parsed as { documents?: unknown }).documents;
  return ok(Array.isArray(candidate) ? candidate : []);
}

/** Device-local repository backed by `window.localStorage` (or the in-memory fallback). */
export class LocalDocumentRepository implements DocumentRepository {
  public constructor(private readonly storage: KeyValueStorage) {}

  /** The stored entries exactly as written, before any validation. */
  private entries(): Result<readonly unknown[]> {
    const raw = this.storage.get(DOCUMENTS_KEY);
    if (!raw.ok) return err(raw.error);
    return parseEnvelope(raw.value);
  }

  /**
   * Entries that do not migrate, so a later write can keep them.
   *
   * A record this build cannot read is not garbage: it may have been written by a newer deployment.
   * Rewriting storage from the successfully loaded documents alone would delete it the next time
   * anything at all was saved — a silent loss with no error and no undo.
   */
  private unreadableEntries(excludeId?: string): readonly unknown[] {
    const entries = this.entries();
    if (!entries.ok) return [];
    return entries.value.filter((entry) => {
      if (migrateDocument(entry).ok) return false;
      if (excludeId === undefined) return true;
      const id = (entry as { readonly id?: unknown }).id;
      return typeof id !== 'string' || id !== excludeId;
    });
  }

  public async list(): Promise<Result<DocumentLoadReport>> {
    const parsed = this.entries();
    if (!parsed.ok) return err(parsed.error);

    const documents: ForgeDocument[] = [];
    const skipped: SkippedDocument[] = [];
    let migrated = 0;

    for (const entry of parsed.value) {
      // The version is read *before* migrating: afterwards every record claims the current version,
      // so the stored version is the only honest source for the migration report shown to users.
      const storedVersion = readSchemaVersion(entry);
      const migratedEntry = migrateDocument(entry);
      if (!migratedEntry.ok) {
        skipped.push({
          reason: migratedEntry.error.message,
          ...(migratedEntry.error.detail === undefined
            ? {}
            : { detail: migratedEntry.error.detail }),
        });
        continue;
      }
      if (storedVersion !== undefined && storedVersion < CURRENT_SCHEMA_VERSION) migrated += 1;
      documents.push(migratedEntry.value);
    }

    documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return ok({ documents, skipped, migrated });
  }

  public async get(id: DocumentId): Promise<Result<ForgeDocument | null>> {
    const list = await this.list();
    if (!list.ok) return err(list.error);
    return ok(list.value.documents.find((document) => document.id === id) ?? null);
  }

  public async save(document: ForgeDocument): Promise<Result<ForgeDocument>> {
    const list = await this.list();
    if (!list.ok) return err(list.error);

    const others = list.value.documents.filter((existing) => existing.id !== document.id);
    // Keep the records this build cannot read; only this document's old copy is replaced.
    const next = [document, ...others, ...this.unreadableEntries(document.id)];
    const write = this.write(next);
    if (!write.ok) return err(write.error);
    return ok(document);
  }

  public async remove(id: DocumentId): Promise<Result<void>> {
    const list = await this.list();
    if (!list.ok) return err(list.error);
    return this.write([
      ...list.value.documents.filter((document) => document.id !== id),
      ...this.unreadableEntries(id),
    ]);
  }

  public async clearAll(): Promise<Result<void>> {
    const removed = this.storage.remove(DOCUMENTS_KEY);
    return removed.ok ? ok(undefined) : err(removed.error);
  }

  private write(documents: readonly unknown[]): Result<void> {
    const envelope: DocumentsEnvelope = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      documents,
    };
    return this.storage.set(DOCUMENTS_KEY, JSON.stringify(envelope));
  }
}
