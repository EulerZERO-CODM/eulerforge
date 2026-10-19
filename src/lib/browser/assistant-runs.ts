/**
 * Where interrupted assistant runs are remembered.
 *
 * A run checkpoint is not document state: it describes a task in progress, it belongs to this
 * browser, and it must never be written into a project or a history entry. It lives in
 * `localStorage` under its own key, one record per document, and a record that cannot be read is
 * dropped rather than allowed to block every future run.
 */

import { parseCheckpoint, type AssistantCheckpoint } from '../../core/assistant/checkpoint';
import { storageKey } from '../../core/persistence/storage';

export const ASSISTANT_RUNS_KEY = storageKey('assistant-runs');

function readAll(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ASSISTANT_RUNS_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ASSISTANT_RUNS_KEY, JSON.stringify(all));
  } catch {
    // A full or disabled store must not break an edit; the run simply cannot be resumed later.
  }
}

/** The saved run for a document, or null when there is none (or it cannot be read). */
export function readAssistantRun(documentId: string): AssistantCheckpoint | null {
  const all = readAll();
  const record = all[documentId];
  if (record === undefined) return null;
  const parsed = parseCheckpoint(record);
  if (!parsed.ok) {
    delete all[documentId];
    writeAll(all);
    return null;
  }
  return parsed.value;
}

export function writeAssistantRun(documentId: string, checkpoint: AssistantCheckpoint): void {
  const all = readAll();
  all[documentId] = checkpoint;
  writeAll(all);
}

export function forgetAssistantRun(documentId: string): void {
  const all = readAll();
  if (!(documentId in all)) return;
  delete all[documentId];
  writeAll(all);
}
