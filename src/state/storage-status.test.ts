import { describe, expect, it } from 'vitest';

import { MemoryStorage, type StorageBackend } from '../core/persistence/storage';
import {
  describeStorageBackend,
  isVolatile,
  persistentStorageStatus,
  volatileStorageStatus,
  VOLATILE_STORAGE_LABEL,
  VOLATILE_STORAGE_NOTICE,
  PERSISTENT_STORAGE_LABEL,
  UNDETERMINED_STORAGE_LABEL,
} from './storage-status';

function backend(overrides: Partial<StorageBackend>): StorageBackend {
  return {
    storage: new MemoryStorage(),
    durability: 'persistent',
    cause: null,
    detail: null,
    ...overrides,
  };
}

describe('storage status', () => {
  it('describes persistent storage without a warning', () => {
    const status = describeStorageBackend(backend({ durability: 'persistent' }));

    expect(status.durability).toBe('persistent');
    expect(status.determined).toBe(true);
    expect(status.label).toBe(PERSISTENT_STORAGE_LABEL);
    expect(status.notice).toBeNull();
    expect(isVolatile(status)).toBe(false);
  });

  it('reports a refused browser as determined and volatile, with an explanation', () => {
    const status = describeStorageBackend(
      backend({ durability: 'volatile', cause: 'restricted', detail: 'Access denied.' }),
    );

    expect(status.durability).toBe('volatile');
    expect(status.determined).toBe(true);
    expect(status.cause).toBe('restricted');
    expect(status.detail).toBe('Access denied.');
    expect(status.label).toBe(VOLATILE_STORAGE_LABEL);
    expect(status.notice).toBe(VOLATILE_STORAGE_NOTICE);
    expect(isVolatile(status)).toBe(true);
  });

  it('treats a server render as undetermined instead of warning about something it cannot know', () => {
    const status = describeStorageBackend(
      backend({ durability: 'volatile', cause: 'server-render' }),
    );

    expect(status.durability).toBe('volatile');
    expect(status.determined).toBe(false);
    expect(status.label).toBe(UNDETERMINED_STORAGE_LABEL);
    // No notice, and the banner helper refuses to fire: the browser has not been asked yet.
    expect(status.notice).toBeNull();
    expect(isVolatile(status)).toBe(false);
  });

  it('writes a notice that says what is lost, when, and what to do instead', () => {
    const status = volatileStorageStatus('blocked');

    expect(status.notice).toMatch(/memory/i);
    expect(status.notice).toMatch(/lost/i);
    expect(status.notice).toMatch(/reload|closes/i);
    expect(status.notice).toMatch(/export/i);
    expect(status.detail).toBe('blocked');
  });

  it('describes persistent storage for adapters that know they are durable', () => {
    expect(persistentStorageStatus().durability).toBe('persistent');
    expect(isVolatile(persistentStorageStatus())).toBe(false);
  });
});
