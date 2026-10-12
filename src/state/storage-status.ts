/**
 * Storage durability as the interface is allowed to see it.
 *
 * `src/core/persistence/storage.ts` reports what kind of backend was built; this module turns that
 * into the wording the UI uses. The split matters: components may import from `src/state/**` (the
 * store layer) but not from `src/core/persistence/**` (ADR-0006 / docs/ARCHITECTURE.md), so the
 * durability vocabulary lives here rather than in the persistence module.
 *
 * Two rules follow from the fallback being real but not durable:
 *   1. A volatile backend must never be presented as a saved project.
 *   2. Server rendering must not show a warning the browser is about to contradict — hence
 *      `determined`.
 */

import type {
  StorageBackend,
  StorageDurability,
  StorageVolatileCause,
} from '../core/persistence/storage';

export type ForgeStorageStatus = {
  readonly durability: StorageDurability;
  /**
   * False while server rendering, where the browser has not been inspected yet. The client re-runs
   * `createBrowserStorage()` on hydration and the value is then always determined.
   */
  readonly determined: boolean;
  /** Non-null exactly when `durability` is `volatile`. */
  readonly cause: StorageVolatileCause | null;
  /** Underlying error text, when the browser gave one. Diagnostics only. */
  readonly detail: string | null;
  /** Short label for badges and key/value rows. */
  readonly label: string;
  /** Long explanation for banners. Null when storage is persistent or still undetermined. */
  readonly notice: string | null;
};

export const PERSISTENT_STORAGE_LABEL = 'This browser';

export const VOLATILE_STORAGE_LABEL = 'Memory only (this tab)';

export const UNDETERMINED_STORAGE_LABEL = 'Not determined yet';

export const PERSISTENT_STORAGE_NOTICE =
  'Projects are stored in this browser on this device. There is no cloud copy, so export anything you need to keep.';

export const VOLATILE_STORAGE_NOTICE =
  'This browser is not allowing local storage for the site — usually private browsing, blocked site data, or cookies turned off. Projects and learning progress are held in memory for this tab only and are lost when it reloads or closes. Export project files for work you want to keep.';

function persistentStatus(): ForgeStorageStatus {
  return {
    durability: 'persistent',
    determined: true,
    cause: null,
    detail: null,
    label: PERSISTENT_STORAGE_LABEL,
    notice: null,
  };
}

function undeterminedStatus(): ForgeStorageStatus {
  return {
    durability: 'volatile',
    determined: false,
    cause: 'server-render',
    detail: null,
    label: UNDETERMINED_STORAGE_LABEL,
    notice: null,
  };
}

function restrictedStatus(detail: string | null): ForgeStorageStatus {
  return {
    durability: 'volatile',
    determined: true,
    cause: 'restricted',
    detail,
    label: VOLATILE_STORAGE_LABEL,
    notice: VOLATILE_STORAGE_NOTICE,
  };
}

/**
 * Describes a backend for the interface.
 *
 * A `server-render` backend is reported as *undetermined* rather than volatile: nothing is wrong,
 * the browser simply has not been asked yet, and the client resolves it on hydration.
 */
export function describeStorageBackend(backend: StorageBackend): ForgeStorageStatus {
  if (backend.durability === 'persistent') return persistentStatus();
  if (backend.cause === 'server-render') return undeterminedStatus();
  return restrictedStatus(backend.detail);
}

/** A determined, persistent status. Used by the test service graph and by future adapters. */
export function persistentStorageStatus(): ForgeStorageStatus {
  return persistentStatus();
}

/** A determined, volatile status, for tests and for adapters that know storage was refused. */
export function volatileStorageStatus(detail: string | null = null): ForgeStorageStatus {
  return restrictedStatus(detail);
}

/** True when the interface must tell the user that nothing is written to the device. */
export function isVolatile(status: ForgeStorageStatus): boolean {
  return status.durability === 'volatile' && status.determined;
}
