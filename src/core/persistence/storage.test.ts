import { afterEach, describe, expect, it } from 'vitest';

import {
  BrowserLocalStorage,
  MemoryStorage,
  createBrowserStorage,
  storageKey,
  STORAGE_NAMESPACE,
} from './storage';

/**
 * Storage boundary tests.
 *
 * The important guarantee here is *honesty*: when the browser refuses local storage the app must
 * keep working through the in-memory fallback, but the caller has to be able to tell that the
 * fallback is not durable. These tests cover both halves — the fallback still works, and the
 * reported durability tells the truth.
 *
 * The server-rendering path (`typeof window === 'undefined'`) needs a Node environment and lives in
 * `storage.server-render.test.ts`.
 */

const originalLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');

afterEach(() => {
  if (originalLocalStorage) Object.defineProperty(window, 'localStorage', originalLocalStorage);
});

/** Replaces `window.localStorage` with a fake, or with a getter that throws on access. */
function stubLocalStorage(value: Storage | (() => never)): void {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get: typeof value === 'function' ? value : () => value,
  });
}

/** A minimal `Storage` stand-in; individual methods can be overridden, including `length`. */
function fakeStorage(overrides: Partial<Storage> = {}): Storage {
  const entries = new Map<string, string>();
  const fake = {
    get length() {
      return entries.size;
    },
    clear: () => {
      entries.clear();
    },
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => {
      entries.delete(key);
    },
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };

  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(fake, key, { value, writable: true, configurable: true });
  }

  return fake as Storage;
}

describe('createBrowserStorage', () => {
  it('reports persistent durability when the browser accepts a probe write', () => {
    const backend = createBrowserStorage();

    expect(backend.durability).toBe('persistent');
    expect(backend.cause).toBeNull();
    expect(backend.detail).toBeNull();
    expect(backend.storage).toBeInstanceOf(BrowserLocalStorage);

    // The probe key is cleaned up, so it never shows up in storage diagnostics.
    expect(window.localStorage.getItem(storageKey('probe'))).toBeNull();
  });

  it('falls back to memory with a `restricted` cause when accessing storage throws', () => {
    stubLocalStorage(() => {
      throw new Error('Access to storage is not allowed from this context.');
    });

    const backend = createBrowserStorage();

    expect(backend.storage).toBeInstanceOf(MemoryStorage);
    expect(backend.durability).toBe('volatile');
    expect(backend.cause).toBe('restricted');
    expect(backend.detail).toMatch(/not allowed/i);
  });

  it('falls back to memory when storage exists but refuses writes (private browsing)', () => {
    stubLocalStorage(
      fakeStorage({
        setItem: () => {
          throw new Error('The operation is insecure.');
        },
      }),
    );

    const backend = createBrowserStorage();

    expect(backend.storage).toBeInstanceOf(MemoryStorage);
    expect(backend.durability).toBe('volatile');
    expect(backend.cause).toBe('restricted');
    expect(backend.detail).toBe('The operation is insecure.');
  });

  it('keeps working through the fallback even though it is not durable', () => {
    stubLocalStorage(() => {
      throw new Error('blocked');
    });

    const backend = createBrowserStorage();
    const write = backend.storage.set(storageKey('documents'), '{"documents":[]}');

    // Writes succeed *and* the caller has been told they will not survive a reload — the two facts
    // the interface needs in order to avoid claiming a saved project.
    expect(write.ok).toBe(true);
    expect(backend.storage.get(storageKey('documents'))).toMatchObject({
      ok: true,
      value: '{"documents":[]}',
    });
    expect(backend.durability).toBe('volatile');
  });
});

describe('MemoryStorage', () => {
  it('implements the key/value contract without touching the browser', () => {
    const storage = new MemoryStorage();

    expect(storage.get('missing')).toEqual({ ok: true, value: null });
    expect(storage.set('a', '1').ok).toBe(true);
    expect(storage.set('b', '2').ok).toBe(true);
    expect(storage.get('a')).toEqual({ ok: true, value: '1' });
    expect(storage.keys('')).toEqual({ ok: true, value: ['a', 'b'] });
    expect(storage.keys('b')).toEqual({ ok: true, value: ['b'] });
    expect(storage.remove('a').ok).toBe(true);
    expect(storage.get('a')).toEqual({ ok: true, value: null });
    expect(storage.byteSize()).toBe(1);
  });
});

describe('BrowserLocalStorage', () => {
  it('reads, writes, lists and removes keys through the browser API', () => {
    const storage = new BrowserLocalStorage(fakeStorage());

    expect(storage.set(storageKey('documents'), 'x').ok).toBe(true);
    expect(storage.get(storageKey('documents'))).toEqual({ ok: true, value: 'x' });
    expect(storage.keys(`${STORAGE_NAMESPACE}.v1.`)).toEqual({
      ok: true,
      value: [storageKey('documents')],
    });
    expect(storage.remove(storageKey('documents')).ok).toBe(true);
    expect(storage.get(storageKey('documents'))).toEqual({ ok: true, value: null });
  });

  it('reports quota exhaustion as its own actionable error', () => {
    const quota = Object.assign(new Error('The quota has been exceeded.'), {
      name: 'QuotaExceededError',
    });
    const storage = new BrowserLocalStorage(
      fakeStorage({
        setItem: () => {
          throw quota;
        },
      }),
    );

    const result = storage.set(storageKey('documents'), 'x');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error.code).toBe('storage-quota-exceeded');
    expect(result.error.message).toMatch(/delete a project/i);
    expect(result.error.retryable).toBe(false);
  });

  it('reports a refused write as retryable unavailability with the browser message attached', () => {
    const storage = new BrowserLocalStorage(
      fakeStorage({
        setItem: () => {
          throw new Error('The operation is insecure.');
        },
      }),
    );

    const result = storage.set(storageKey('documents'), 'x');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error.code).toBe('storage-unavailable');
    expect(result.error.detail).toBe('The operation is insecure.');
    expect(result.error.retryable).toBe(true);
  });

  it('reports read and list failures instead of throwing', () => {
    const storage = new BrowserLocalStorage(
      fakeStorage({
        length: 1,
        getItem: () => {
          throw new Error('read refused');
        },
        key: () => {
          throw new Error('list refused');
        },
      }),
    );

    const read = storage.get('anything');
    const list = storage.keys('anything');

    expect(read.ok).toBe(false);
    expect(list.ok).toBe(false);
    if (read.ok || list.ok) throw new Error('expected failures');
    expect(read.error.code).toBe('storage-unavailable');
    expect(list.error.code).toBe('storage-unavailable');
    expect(read.error.message).toMatch(/could not be read/i);
    expect(list.error.message).toMatch(/could not be listed/i);
  });

  it('skips null keys when listing, rather than reporting a phantom entry', () => {
    const storage = new BrowserLocalStorage(
      fakeStorage({
        length: 2,
        key: (index: number) => (index === 0 ? storageKey('documents') : null),
      }),
    );

    expect(storage.keys(`${STORAGE_NAMESPACE}.v1.`)).toEqual({
      ok: true,
      value: [storageKey('documents')],
    });
  });
});
