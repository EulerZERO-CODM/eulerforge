// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { MemoryStorage, createBrowserStorage } from './storage';

/**
 * Server-rendering path.
 *
 * Runs in a Node environment on purpose: `createBrowserStorage()` branches on `typeof window`, and
 * that branch is exactly what this test must exercise. Removing the fallback here would break server
 * rendering, so the guarantee under test is that it stays safe *and* reports an honest cause.
 */
describe('createBrowserStorage without a window', () => {
  it('reports `server-render` rather than pretending storage is fine or has failed', () => {
    const backend = createBrowserStorage();

    expect(backend.storage).toBeInstanceOf(MemoryStorage);
    expect(backend.durability).toBe('volatile');
    expect(backend.cause).toBe('server-render');
    expect(backend.detail).toBeNull();
  });

  it('still satisfies the storage contract, so a server render can build the app graph', () => {
    const backend = createBrowserStorage();

    expect(backend.storage.get('anything')).toEqual({ ok: true, value: null });
    expect(backend.storage.set('anything', 'value').ok).toBe(true);
    expect(backend.storage.keys('any')).toEqual({ ok: true, value: ['anything'] });
    expect(backend.storage.remove('anything').ok).toBe(true);
  });
});
