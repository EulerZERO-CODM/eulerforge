/**
 * Where the last agreement between this browser and the server is remembered.
 *
 * This is *not* document state and does not belong in a document: it describes a relationship
 * between two copies, and it is specific to this browser. It lives in `localStorage` under its own
 * key, it is written only after a transfer succeeds, and a corrupt record is dropped rather than
 * allowed to make every future sync look like a conflict.
 */

import { storageKey } from '../../core/persistence/storage';
import type { SyncMarks } from '../../core/account/sync';

export const SYNC_MARKS_KEY = storageKey('sync-marks');

type StoredMark = {
  readonly localUpdatedAt: string;
  readonly remoteRevision: number;
  readonly remoteUpdatedAt: string;
};

function readRaw(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SYNC_MARKS_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function readSyncMarks(): SyncMarks {
  const marks: Record<string, StoredMark> = {};
  for (const [id, value] of Object.entries(readRaw())) {
    if (typeof value !== 'object' || value === null) continue;
    const record = value as Record<string, unknown>;
    const localUpdatedAt = record.localUpdatedAt;
    const remoteRevision = record.remoteRevision;
    const remoteUpdatedAt = record.remoteUpdatedAt;
    if (
      typeof localUpdatedAt === 'string' &&
      typeof remoteRevision === 'number' &&
      Number.isInteger(remoteRevision) &&
      typeof remoteUpdatedAt === 'string'
    ) {
      marks[id] = { localUpdatedAt, remoteRevision, remoteUpdatedAt };
    }
  }
  return marks;
}

/** Records one agreement. A storage failure is silent: the next sync asks instead of guessing. */
export function writeSyncMark(id: string, mark: StoredMark): void {
  if (typeof window === 'undefined') return;
  try {
    const all = readRaw();
    all[id] = mark;
    window.localStorage.setItem(SYNC_MARKS_KEY, JSON.stringify(all));
  } catch {
    // Full or disabled storage must not break syncing; the conservative plan handles a missing mark.
  }
}

export function forgetSyncMark(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const all = readRaw();
    delete all[id];
    window.localStorage.setItem(SYNC_MARKS_KEY, JSON.stringify(all));
  } catch {
    // As above.
  }
}
