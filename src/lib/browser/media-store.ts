/**
 * IndexedDB implementation of the media store.
 *
 * The document repository already stores documents in local storage; media is different — files are
 * megabytes, not kilobytes, and local storage would either refuse them or make every save slow. So
 * media bytes live in IndexedDB, keyed by the id the timeline references, and the document keeps only
 * metadata. That split is also what lets the same imported file back several clips.
 *
 * Every failure path returns a `Result`: open being blocked (another tab holds an older version),
 * a quota refusal, a transaction abort. The caller falls back to the in-memory store and tells the
 * user that media will not survive a reload, rather than silently losing it later.
 */

import type { MediaStore, StoredMediaRecord } from '../../core/video/media-store';
import { MAX_MEDIA_STORE_BYTES, createMemoryMediaStore } from '../../core/video/media-store';
import { err, forgeError, ok, type Result } from '../../core/result';

const DB_NAME = 'eulerforge-media';
const DB_VERSION = 1;
const STORE = 'media';

type StoredRow = StoredMediaRecord & { blob: Blob };

function unavailable(message: string, detail?: string): Result<never> {
  return err(
    forgeError('storage-unavailable', message, {
      ...(detail === undefined ? {} : { detail }),
      retryable: false,
    }),
  );
}

function openDatabase(): Promise<Result<IDBDatabase>> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(
      unavailable(
        'This browser does not offer IndexedDB.',
        'Imported media can still be used in this session, but it cannot be stored.',
      ),
    );
  }

  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      resolve(
        unavailable(
          'The browser refused to open its media database.',
          error instanceof Error ? error.message : undefined,
        ),
      );
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onerror = () => {
      resolve(
        unavailable(
          'The browser refused to open its media database.',
          request.error?.message ?? 'Private browsing can disable IndexedDB.',
        ),
      );
    };
    request.onblocked = () => {
      resolve(
        unavailable(
          'Another tab is holding an older version of the media database.',
          'Close the other tab and reload this one.',
        ),
      );
    };
    request.onsuccess = () => {
      resolve(ok(request.result));
    };
  });
}

/**
 * IndexedDB's typings make `get`/`getAll` return `IDBRequest<any>`, so the generic is asserted at the
 * one place that knows the row shape. Everything downstream is typed.
 */
function request<TValue>(source: IDBRequest): IDBRequest<TValue> {
  return source as IDBRequest<TValue>;
}

function requestToPromise<TValue>(requestSource: IDBRequest<TValue>): Promise<Result<TValue>> {
  return new Promise((resolve) => {
    requestSource.onsuccess = () => {
      resolve(ok(requestSource.result));
    };
    requestSource.onerror = () => {
      resolve(
        err(
          forgeError('storage-corrupt', 'The media database could not be read.', {
            detail: requestSource.error?.message,
            retryable: true,
          }),
        ),
      );
    };
  });
}

/** Wraps one transaction so an abort anywhere becomes one sentence. */
async function transact<TValue>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => Promise<Result<TValue>>,
): Promise<Result<TValue>> {
  let transaction: IDBTransaction;
  try {
    transaction = database.transaction(STORE, mode);
  } catch (error) {
    return err(
      forgeError('storage-unavailable', 'The media database is not available.', {
        detail: error instanceof Error ? error.message : undefined,
        retryable: true,
      }),
    );
  }
  try {
    return await work(transaction.objectStore(STORE));
  } catch (error) {
    return err(
      forgeError('storage-corrupt', 'The media database rejected that operation.', {
        detail: error instanceof Error ? error.message : undefined,
        retryable: true,
      }),
    );
  } finally {
    transaction.oncomplete = null;
  }
}

export async function createIndexedDbMediaStore(): Promise<Result<MediaStore>> {
  const opened = await openDatabase();
  if (!opened.ok) return opened;
  const database = opened.value;

  const store: MediaStore = {
    kind: 'indexeddb',

    async put(record, blob) {
      const usage = await store.usage();
      const limit = usage.ok ? usage.value : { bytes: 0, limitBytes: MAX_MEDIA_STORE_BYTES };
      const existing = await store.get(record.id);
      const previousBytes = existing.ok ? (existing.value?.size ?? 0) : 0;
      if (limit.bytes - previousBytes + blob.size > MAX_MEDIA_STORE_BYTES) {
        return err(
          forgeError('storage-quota-exceeded', 'There is no room left for that file.', {
            detail: `This browser build keeps at most ${String(
              Math.round(MAX_MEDIA_STORE_BYTES / (1024 * 1024)),
            )} MB of media. Remove a file to make room.`,
            retryable: false,
          }),
        );
      }

      return transact(database, 'readwrite', async (objectStore) => {
        const row: StoredRow = { ...record, blob };
        const written = await requestToPromise(objectStore.put(row));
        if (!written.ok) return written;
        return ok(Object.freeze({ ...record }));
      });
    },

    async get(id) {
      return transact(database, 'readonly', async (objectStore) => {
        const result = await requestToPromise<StoredRow | undefined>(
          request<StoredRow | undefined>(objectStore.get(id)),
        );
        if (!result.ok) return result;
        return ok(result.value?.blob ?? null);
      });
    },

    async list() {
      return transact(database, 'readonly', async (objectStore) => {
        const result = await requestToPromise<StoredRow[]>(
          request<StoredRow[]>(objectStore.getAll()),
        );
        if (!result.ok) return result;
        return ok(
          Object.freeze(
            result.value
              .map((row) => ({
                id: row.id,
                name: row.name,
                mimeType: row.mimeType,
                size: row.size,
                createdAt: row.createdAt,
              }))
              .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
          ),
        );
      });
    },

    async remove(id) {
      return transact(database, 'readwrite', async (objectStore) => {
        const existing = await requestToPromise<StoredRow | undefined>(
          request<StoredRow | undefined>(objectStore.get(id)),
        );
        if (!existing.ok) return existing;
        const deleted = await requestToPromise(objectStore.delete(id));
        if (!deleted.ok) return deleted;
        return ok(existing.value !== undefined);
      });
    },

    async usage() {
      return transact(database, 'readonly', async (objectStore) => {
        const result = await requestToPromise<StoredRow[]>(
          request<StoredRow[]>(objectStore.getAll()),
        );
        if (!result.ok) return result;
        return ok({
          count: result.value.length,
          bytes: result.value.reduce((total, row) => total + row.blob.size, 0),
          limitBytes: MAX_MEDIA_STORE_BYTES,
        });
      });
    },

    async clear() {
      return transact(database, 'readwrite', async (objectStore) => {
        const cleared = await requestToPromise(objectStore.clear());
        if (!cleared.ok) return cleared;
        return ok(undefined);
      });
    },
  };

  return ok(store);
}

/**
 * The store the UI should use, plus the sentence explaining any downgrade.
 *
 * A browser that refuses IndexedDB still gets a working editor — the fallback is a real store, just
 * a session-long one — and the message travels to the panel so the state is never implied to be
 * durable when it is not.
 */
export async function openMediaStore(): Promise<{
  readonly store: MediaStore;
  readonly notice: string | null;
}> {
  const memory = createMemoryMediaStore();
  const opened = await createIndexedDbMediaStore();
  if (!opened.ok) {
    return { store: memory, notice: opened.error.message };
  }
  return { store: opened.value, notice: null };
}
