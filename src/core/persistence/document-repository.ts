/**
 * Document persistence boundary.
 *
 * Phase 1 ships a device-local implementation. The interface is promise-based on purpose: a remote
 * adapter must not force a rewrite of every caller (ADR-0006). Nothing here claims cloud storage —
 * see docs/PRODUCT_VISION.md → boundaries.
 */

import { err, ok, type Result } from '../result';
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
  /** How much the stored project index takes up, in characters. */
  readonly storedBytes: number;
};

export interface DocumentRepository {
  list(): Promise<Result<DocumentLoadReport>>;
  get(id: DocumentId): Promise<Result<ForgeDocument | null>>;
  save(document: ForgeDocument): Promise<Result<ForgeDocument>>;
  remove(id: DocumentId): Promise<Result<void>>;
  /** Removes every document for this origin. Used by the settings "clear local data" action. */
  clearAll(): Promise<Result<void>>;
}

/**
 * What the storage holds.
 *
 * `entries` are the records this build can try to read. `preserved` are raw values that must
 * survive a write untouched: an index that cannot be read at all is *kept*, not discarded. An
 * unreadable index must not take the whole application with it — the reader can go on working, and
 * the bytes it holds are not destroyed by the next save.
 */
type StoredIndex = {
  readonly entries: readonly unknown[];
  readonly preserved: readonly unknown[];
  /** How much the stored value takes up, so the diagnostics can report a real footprint. */
  readonly bytes: number;
};

/** Shown when the index itself could not be read, and what was done about it. */
export const UNREADABLE_INDEX_REASON =
  'The saved project index could not be read. It was left exactly as it was, so nothing it held was destroyed.';

/**
 * Reads the stored index.
 *
 * A value that cannot be parsed is preserved verbatim rather than reported as a hard failure: the
 * library carries on, and the raw bytes are written back untouched by the next save. The record
 * boundary is what protects the data — a *record* that cannot be read is skipped and reported, and
 * the index that holds it is likewise kept.
 */
function parseIndex(raw: string | null): Result<StoredIndex> {
  if (raw === null) return ok({ entries: [], preserved: [], bytes: 0 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return ok({ entries: [], preserved: [raw], bytes: raw.length });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return ok({ entries: [], preserved: [parsed], bytes: raw.length });
  }

  const candidate = (parsed as { documents?: unknown }).documents;
  if (!Array.isArray(candidate)) {
    return ok({ entries: [], preserved: [parsed], bytes: raw.length });
  }
  return ok({ entries: candidate, preserved: [], bytes: raw.length });
}

/**
 * Splits the stored entries into the documents this build can read and the raw entries it cannot.
 *
 * A record that fails validation or migration is *not* thrown away: it is kept exactly as it was
 * stored, so that a later write cannot destroy data the application merely failed to understand.
 *
 * This matters for two cases that the schema deliberately refuses to handle silently (ADR-0005):
 * a record written by a *newer* app version, and a record that fails validation. Both are reported
 * to the user as "skipped" rather than downgraded or repaired, and a refusal is only recoverable if
 * the bytes survive the next save. Writing the readable subset alone would turn every refusal into
 * a deletion the moment an unrelated project was saved.
 */
function partitionEntries(entries: readonly unknown[]): {
  readonly kept: readonly ForgeDocument[];
  readonly preserved: readonly unknown[];
} {
  const kept: ForgeDocument[] = [];
  const preserved: unknown[] = [];

  for (const entry of entries) {
    const migrated = migrateDocument(entry);
    if (!migrated.ok) {
      preserved.push(entry);
      continue;
    }
    kept.push(migrated.value);
  }

  return { kept, preserved };
}

/** Device-local repository backed by `window.localStorage` (or the in-memory fallback). */
export class LocalDocumentRepository implements DocumentRepository {
  public constructor(private readonly storage: KeyValueStorage) {}

  public async list(): Promise<Result<DocumentLoadReport>> {
    const stored = this.readIndex();
    if (!stored.ok) return err(stored.error);

    const documents: ForgeDocument[] = [];
    const skipped: SkippedDocument[] = [];
    let migrated = 0;

    for (const entry of stored.value.entries) {
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

    // An index that could not be read is reported the same way a record that could not be read is:
    // it is still here, and it was not thrown away.
    for (const _preserved of stored.value.preserved) {
      skipped.push({ reason: UNREADABLE_INDEX_REASON });
    }

    documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return ok({
      documents,
      skipped,
      migrated,
      storedBytes: stored.value.bytes,
    });
  }

  public async get(id: DocumentId): Promise<Result<ForgeDocument | null>> {
    const list = await this.list();
    if (!list.ok) return err(list.error);
    return ok(list.value.documents.find((document) => document.id === id) ?? null);
  }

  public async save(document: ForgeDocument): Promise<Result<ForgeDocument>> {
    // The read and the write happen with no `await` between them, so two saves issued in the same
    // tick cannot both read the same snapshot and then overwrite one another: the second write is
    // built from the first one's result rather than from a stale copy.
    const stored = this.readIndex();
    if (!stored.ok) return err(stored.error);

    const { kept, preserved } = partitionEntries(stored.value.entries);
    const others = kept
      .filter((existing) => existing.id !== document.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    // `preserved` is written back verbatim: the readable documents change, the unreadable ones do
    // not. Skipping them would delete records the user was told were merely "skipped".
    const write = this.write([document, ...others, ...preserved, ...stored.value.preserved]);
    if (!write.ok) return err(write.error);
    return ok(document);
  }

  public async remove(id: DocumentId): Promise<Result<void>> {
    const stored = this.readIndex();
    if (!stored.ok) return err(stored.error);

    const { kept, preserved } = partitionEntries(stored.value.entries);
    const others = kept
      .filter((existing) => existing.id !== id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    // Deleting one project must not delete the records this build cannot read either: they cannot
    // be identified, so they are not the project the user asked to remove.
    return this.write([...others, ...preserved, ...stored.value.preserved]);
  }

  public async clearAll(): Promise<Result<void>> {
    const removed = this.storage.remove(DOCUMENTS_KEY);
    return removed.ok ? ok(undefined) : err(removed.error);
  }

  /** The stored index, split into what can be read and what has to be kept as it is. */
  private readIndex(): Result<StoredIndex> {
    const raw = this.storage.get(DOCUMENTS_KEY);
    if (!raw.ok) return err(raw.error);
    return parseIndex(raw.value);
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
