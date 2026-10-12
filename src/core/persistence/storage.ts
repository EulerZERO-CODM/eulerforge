/**
 * Storage boundary.
 *
 * The rest of the application depends on `KeyValueStorage`, never on `window.localStorage`
 * directly. A cloud adapter (`RemoteDocumentRepository`) will implement the same shapes in a later
 * phase; keeping the interface narrow now is what makes that swap a contained change.
 */

import { err, forgeError, ok, type Result } from '../result';

export interface KeyValueStorage {
  get(key: string): Result<string | null>;
  set(key: string, value: string): Result<void>;
  remove(key: string): Result<void>;
  /** Existing keys carrying `prefix`, used by the diagnostics panel. */
  keys(prefix: string): Result<readonly string[]>;
}

/**
 * Durability of a storage backend, as reported to the user.
 *
 * `persistent` — writes survive a reload (browser storage).
 * `volatile`   — writes live in memory only and are lost when the tab closes or reloads.
 *
 * The distinction exists because the fallback below is *real* but not durable: presenting an
 * in-memory write as a saved project would be a lie (ADR-0006 → durability reporting).
 */
export type StorageDurability = 'persistent' | 'volatile';

/** Why a volatile backend was used. */
export type StorageVolatileCause =
  /** Server rendering: there is no `window`, so nothing can be inspected yet. */
  | 'server-render'
  /** The browser refused access: private mode, blocked cookies, or a disabled API. */
  | 'restricted';

export type StorageBackend = {
  readonly storage: KeyValueStorage;
  readonly durability: StorageDurability;
  /** Non-null exactly when `durability` is `volatile`. */
  readonly cause: StorageVolatileCause | null;
  /** The underlying error message, when one is available, for diagnostics. */
  readonly detail: string | null;
};

export const STORAGE_NAMESPACE = 'eulerforge';

/** Versioned key helper: `eulerforge.v1.documents`. */
export function storageKey(...segments: readonly string[]): string {
  return [STORAGE_NAMESPACE, 'v1', ...segments].join('.');
}

/**
 * In-memory implementation.
 *
 * Used by tests, and as the session-only fallback when browser storage is refused. It is a real
 * implementation of the interface — it simply does not persist, which is why every caller that
 * constructs it must also report `volatile` durability.
 */
export class MemoryStorage implements KeyValueStorage {
  private readonly entries = new Map<string, string>();

  public get(key: string): Result<string | null> {
    return ok(this.entries.get(key) ?? null);
  }

  public set(key: string, value: string): Result<void> {
    this.entries.set(key, value);
    return ok(undefined);
  }

  public remove(key: string): Result<void> {
    this.entries.delete(key);
    return ok(undefined);
  }

  public keys(prefix: string): Result<readonly string[]> {
    return ok([...this.entries.keys()].filter((key) => key.startsWith(prefix)));
  }

  /** Test helper: raw serialised size of everything held. */
  public byteSize(): number {
    let total = 0;
    for (const value of this.entries.values()) total += value.length;
    return total;
  }
}

/**
 * Builds the browser's storage backend and reports how durable it is.
 *
 * Returning the durability alongside the backend is the whole point: the caller (the composition
 * root) can tell the interface that projects are session-only, instead of letting an in-memory write
 * look like a saved project.
 *
 * Server rendering is reported as `volatile`/`server-render` rather than as an outright failure: on
 * the server there is genuinely nothing to inspect, and the client re-runs this function on
 * hydration. The state layer turns that cause into "not determined yet" so a server-rendered page
 * never shows a warning the browser would contradict.
 */
export function createBrowserStorage(): StorageBackend {
  if (typeof window === 'undefined') {
    return {
      storage: new MemoryStorage(),
      durability: 'volatile',
      cause: 'server-render',
      detail: null,
    };
  }

  try {
    // Probe once: some browsers expose the API and then throw on write (Safari private mode), and
    // disabled-cookie configurations throw on access.
    const storage = window.localStorage;
    const probeKey = storageKey('probe');
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return {
      storage: new BrowserLocalStorage(storage),
      durability: 'persistent',
      cause: null,
      detail: null,
    };
  } catch (error) {
    return {
      storage: new MemoryStorage(),
      durability: 'volatile',
      cause: 'restricted',
      detail: error instanceof Error ? error.message : null,
    };
  }
}

function isQuotaError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

/**
 * `window.localStorage` adapter.
 *
 * Every method returns a `Result` because storage genuinely fails in the real world: Safari private
 * mode, disabled cookies, quota exhaustion, or a non-browser runtime during server rendering.
 */
export class BrowserLocalStorage implements KeyValueStorage {
  public constructor(private readonly storage: Storage) {}

  public get(key: string): Result<string | null> {
    try {
      return ok(this.storage.getItem(key));
    } catch (error) {
      return err(
        forgeError('storage-unavailable', 'Local storage could not be read on this device.', {
          detail: error instanceof Error ? error.message : undefined,
          retryable: true,
        }),
      );
    }
  }

  public set(key: string, value: string): Result<void> {
    try {
      this.storage.setItem(key, value);
      return ok(undefined);
    } catch (error) {
      if (isQuotaError(error)) {
        return err(
          forgeError(
            'storage-quota-exceeded',
            'Local storage is full. Delete a project to free space.',
            { retryable: false },
          ),
        );
      }
      return err(
        forgeError('storage-unavailable', 'This device would not save local data.', {
          detail: error instanceof Error ? error.message : undefined,
          retryable: true,
        }),
      );
    }
  }

  public remove(key: string): Result<void> {
    try {
      this.storage.removeItem(key);
      return ok(undefined);
    } catch (error) {
      return err(
        forgeError('storage-unavailable', 'Local data could not be removed on this device.', {
          detail: error instanceof Error ? error.message : undefined,
          retryable: true,
        }),
      );
    }
  }

  public keys(prefix: string): Result<readonly string[]> {
    try {
      const found: string[] = [];
      for (let index = 0; index < this.storage.length; index += 1) {
        const key: string | null = this.storage.key(index);
        if (key === null) continue;
        if (key.startsWith(prefix)) found.push(key);
      }
      return ok(found);
    } catch (error) {
      return err(
        forgeError(
          'storage-unavailable',
          'Local storage keys could not be listed on this device.',
          {
            detail: error instanceof Error ? error.message : undefined,
            retryable: true,
          },
        ),
      );
    }
  }
}
