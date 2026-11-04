import { describe, expect, it } from 'vitest';

import {
  createMemoryMediaStore,
  isPersistentStore,
  MAX_MEDIA_STORE_BYTES,
  type StoredMediaRecord,
} from './media-store';

function record(overrides: Partial<StoredMediaRecord> = {}): StoredMediaRecord {
  return {
    id: 'media-1',
    name: 'take.webm',
    mimeType: 'video/webm',
    size: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('the in-memory media store', () => {
  it('round-trips bytes and lists records in creation order', async () => {
    const store = createMemoryMediaStore();
    const first = new Blob(['abcd'], { type: 'video/webm' });
    const second = new Blob(['ef'], { type: 'audio/webm' });

    expect((await store.put(record(), first)).ok).toBe(true);
    expect(
      (
        await store.put(
          record({ id: 'media-2', name: 'voice.webm', createdAt: '2026-01-02T00:00:00.000Z' }),
          second,
        )
      ).ok,
    ).toBe(true);

    const loaded = await store.get('media-1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value?.size).toBe(4);

    const listed = await store.list();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.map((entry) => entry.id)).toEqual(['media-1', 'media-2']);
  });

  it('reports usage in bytes and counts, and forgets a removed file', async () => {
    const store = createMemoryMediaStore();
    await store.put(record(), new Blob(['abcd']));
    await store.put(record({ id: 'media-2' }), new Blob(['ef']));

    const used = await store.usage();
    expect(used.ok && used.value).toEqual({
      count: 2,
      bytes: 6,
      limitBytes: MAX_MEDIA_STORE_BYTES,
    });

    const removed = await store.remove('media-1');
    expect(removed.ok && removed.value).toBe(true);
    expect(await store.get('media-1')).toMatchObject({ ok: true, value: null });

    const after = await store.usage();
    expect(after.ok && after.value).toEqual({
      count: 1,
      bytes: 2,
      limitBytes: MAX_MEDIA_STORE_BYTES,
    });

    // Removing something that is already gone is reported, not thrown.
    const again = await store.remove('media-1');
    expect(again.ok && again.value).toBe(false);
  });

  it('clears everything in one operation', async () => {
    const store = createMemoryMediaStore();
    await store.put(record(), new Blob(['abcd']));
    await store.clear();

    const listed = await store.list();
    expect(listed.ok && listed.value).toHaveLength(0);
    const used = await store.usage();
    expect(used.ok && used.value.count).toBe(0);
  });

  it('replacing a record counts the byte difference, not the whole file twice', async () => {
    const store = createMemoryMediaStore();
    await store.put(record(), new Blob(['abcdefgh']));
    await store.put(record({ name: 'take-2.webm' }), new Blob(['abc']));

    const used = await store.usage();
    expect(used.ok && used.value).toEqual({
      count: 1,
      bytes: 3,
      limitBytes: MAX_MEDIA_STORE_BYTES,
    });
    const loaded = await store.get('media-1');
    expect(loaded.ok && loaded.value?.size).toBe(3);
  });

  it('refuses a file that would exceed the store limit, and keeps what is already there', async () => {
    const store = createMemoryMediaStore();
    const almostFull = new Blob([new Uint8Array(MAX_MEDIA_STORE_BYTES - 1)]);
    expect((await store.put(record({ size: almostFull.size }), almostFull)).ok).toBe(true);

    const refused = await store.put(
      record({ id: 'media-2', size: 2 }),
      new Blob([new Uint8Array(2)]),
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    // A failed write is a sentence the panel can show, with the actual cap named in it.
    expect(refused.error.code).toBe('storage-quota-exceeded');
    expect(refused.error.detail).toContain('400 MB');
    expect(refused.error.retryable).toBe(false);

    const used = await store.usage();
    expect(used.ok && used.value.count).toBe(1);
    expect(await store.get('media-2')).toMatchObject({ ok: true, value: null });
  });

  it('freeing space makes room for a file that was refused before', async () => {
    const store = createMemoryMediaStore();
    const first = new Blob([new Uint8Array(MAX_MEDIA_STORE_BYTES - 8)]);
    await store.put(record({ size: first.size }), first);
    expect(
      (await store.put(record({ id: 'media-2', size: 16 }), new Blob([new Uint8Array(16)]))).ok,
    ).toBe(false);

    await store.remove('media-1');
    const retried = await store.put(
      record({ id: 'media-2', size: 16 }),
      new Blob([new Uint8Array(16)]),
    );
    expect(retried.ok).toBe(true);
  });

  it('returns frozen records so a caller cannot mutate stored metadata', async () => {
    const store = createMemoryMediaStore();
    await store.put(record(), new Blob(['abcd']));
    const listed = await store.list();
    if (!listed.ok || !listed.value[0]) throw new Error('expected one record');
    expect(Object.isFrozen(listed.value[0])).toBe(true);
  });

  it('knows whether it survives a reload', () => {
    expect(isPersistentStore(createMemoryMediaStore())).toBe(false);
  });
});
