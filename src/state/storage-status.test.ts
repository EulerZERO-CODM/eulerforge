import { describe, expect, it } from 'vitest';

import { MemoryStorage, type StorageBackend } from '../core/persistence/storage';
import {
  describeStorageBackend,
  isVolatile,
  persistentStorageStatus,
  storageBadge,
  storageClaim,
  storagePhase,
  undeterminedStorageStatus,
  volatileStorageStatus,
  STORAGE_PHASE_CLAIMS,
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

/**
 * Phase classification and the claims built on it.
 *
 * These exist because "is storage refusing writes?" is not the same question as "may we say projects
 * are stored?". A two-way test made an uninspected browser fall through to the persistent wording.
 */
describe('storage phase and claims', () => {
  it('classifies the three states the interface distinguishes', () => {
    expect(storagePhase(persistentStorageStatus())).toBe('persistent');
    expect(storagePhase(volatileStorageStatus())).toBe('volatile');
    expect(storagePhase(undeterminedStorageStatus())).toBe('undetermined');
  });

  it('treats an uninspected browser as undetermined even if a backend exists', () => {
    // The server-render status carries `durability: 'volatile'` because the fallback is in use, but
    // nothing has failed, so the phase must not be reported as volatile either.
    const status = undeterminedStorageStatus();

    expect(status.durability).toBe('volatile');
    expect(status.determined).toBe(false);
    expect(storagePhase(status)).toBe('undetermined');
    expect(isVolatile(status)).toBe(false);
  });

  it('gives each phase exactly one claim, and never claims durability without evidence', () => {
    expect(storageClaim(persistentStorageStatus())).toBe(STORAGE_PHASE_CLAIMS.persistent);
    expect(storageClaim(volatileStorageStatus())).toBe(STORAGE_PHASE_CLAIMS.volatile);
    expect(storageClaim(undeterminedStorageStatus())).toBe(STORAGE_PHASE_CLAIMS.undetermined);

    // The undetermined claim asserts nothing about where projects are.
    expect(STORAGE_PHASE_CLAIMS.undetermined).not.toMatch(/stored|saved|memory/i);
    expect(STORAGE_PHASE_CLAIMS.undetermined).toMatch(/checking/i);
  });

  it('labels a badge for each phase without overstating any of them', () => {
    expect(storageBadge(persistentStorageStatus())).toEqual({
      label: 'Local to this device',
      warning: false,
    });
    expect(storageBadge(volatileStorageStatus())).toEqual({
      label: 'In memory only',
      warning: true,
    });
    // Undetermined must not read as durable, and must not read as a failure either.
    expect(storageBadge(undeterminedStorageStatus())).toEqual({
      label: 'Storage not checked',
      warning: false,
    });
  });

  it('states what volatile storage loses and when', () => {
    expect(STORAGE_PHASE_CLAIMS.volatile).toMatch(/only in memory/i);
    expect(STORAGE_PHASE_CLAIMS.volatile).toMatch(/lost/i);
    expect(STORAGE_PHASE_CLAIMS.volatile).toMatch(/reload/i);
  });
});
