/**
 * Where imported media bytes live.
 *
 * The document model holds *metadata* about a file — a name, a duration, a size — and never the
 * bytes: a saved timeline then stays small enough to travel through the normal document repository,
 * and the same file can be referenced by several clips without being copied. The bytes live in a
 * store with a deliberately small interface, implemented against IndexedDB in the browser and in
 * memory for tests and for environments where persistent storage is refused.
 *
 * The interface is promise-based and returns `Result` rather than throwing, for the same reason the
 * rest of the domain does: a storage failure is a sentence the UI shows, not an unhandled rejection.
 */

import { err, forgeError, ok, type Result } from '../result';

/** Cap on everything stored, so a user cannot fill a browser quota by accident in one session. */
export const MAX_MEDIA_STORE_BYTES = 400 * 1024 * 1024;

export type StoredMediaRecord = {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly createdAt: string;
};

export type MediaUsage = {
  readonly count: number;
  readonly bytes: number;
  readonly limitBytes: number;
};

export type MediaStore = {
  readonly kind: 'indexeddb' | 'memory';
  put(record: StoredMediaRecord, blob: Blob): Promise<Result<StoredMediaRecord>>;
  get(id: string): Promise<Result<Blob | null>>;
  list(): Promise<Result<readonly StoredMediaRecord[]>>;
  remove(id: string): Promise<Result<boolean>>;
  usage(): Promise<Result<MediaUsage>>;
  clear(): Promise<Result<void>>;
};

function limitError(message: string): Result<never> {
  return err(
    forgeError('storage-quota-exceeded', message, {
      detail: `This browser build keeps at most ${String(Math.round(MAX_MEDIA_STORE_BYTES / (1024 * 1024)))} MB of media. Remove a file to make room.`,
      retryable: false,
    }),
  );
}

/**
 * An in-memory store.
 *
 * Used by tests, by server-side rendering (where there is no IndexedDB) and as the session fallback
 * when a browser refuses persistent storage — in which case the UI says so, because "your media will
 * be gone after a reload" is something a user has to know before spending an hour editing.
 */
export function createMemoryMediaStore(): MediaStore {
  const records = new Map<string, StoredMediaRecord>();
  const blobs = new Map<string, Blob>();

  return {
    kind: 'memory',
    put(record, blob) {
      const existing = records.get(record.id);
      const used = [...blobs.values()].reduce((total, entry) => total + entry.size, 0);
      const delta = blob.size - (existing ? (blobs.get(record.id)?.size ?? 0) : 0);
      if (used + delta > MAX_MEDIA_STORE_BYTES) {
        return Promise.resolve(limitError('There is no room left for that file.'));
      }
      records.set(record.id, Object.freeze({ ...record }));
      blobs.set(record.id, blob);
      return Promise.resolve(ok(Object.freeze({ ...record })));
    },
    get(id) {
      return Promise.resolve(ok(blobs.get(id) ?? null));
    },
    list() {
      return Promise.resolve(
        ok(
          Object.freeze(
            [...records.values()].sort((left, right) =>
              left.createdAt.localeCompare(right.createdAt),
            ),
          ),
        ),
      );
    },
    remove(id) {
      const existed = records.delete(id);
      blobs.delete(id);
      return Promise.resolve(ok(existed));
    },
    usage() {
      const bytes = [...blobs.values()].reduce((total, entry) => total + entry.size, 0);
      return Promise.resolve(ok({ count: records.size, bytes, limitBytes: MAX_MEDIA_STORE_BYTES }));
    },
    clear() {
      records.clear();
      blobs.clear();
      return Promise.resolve(ok(undefined));
    },
  };
}

/** True when the store can survive a reload, which the media panel states plainly. */
export function isPersistentStore(store: MediaStore): boolean {
  return store.kind === 'indexeddb';
}
