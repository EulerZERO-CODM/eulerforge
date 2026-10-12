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

export const STORAGE_NAMESPACE = 'eulerforge';

/** Versioned key helper: `eulerforge.v1.documents`. */
export function storageKey(...segments: readonly string[]): string {
  return [STORAGE_NAMESPACE, 'v1', ...segments].join('.');
}

/** In-memory implementation. Used by tests and by the server-render fallback. */
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

  public static create(): KeyValueStorage {
    // Server rendering has no storage; fall back to the in-memory implementation.
    if (typeof window === 'undefined') return new MemoryStorage();
    try {
      // Probe once: some browsers expose the API and then throw on write (Safari private mode),
      // and disabled-cookie configurations throw on access.
      const storage = window.localStorage;
      const probeKey = storageKey('probe');
      storage.setItem(probeKey, '1');
      storage.removeItem(probeKey);
      return new BrowserLocalStorage(storage);
    } catch {
      return new MemoryStorage();
    }
  }

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
