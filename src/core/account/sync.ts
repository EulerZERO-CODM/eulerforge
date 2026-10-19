/**
 * Deciding what a sync would do, before it does anything.
 *
 * A sync that starts by uploading is a sync that can destroy work, so the decision is a pure
 * function over three inputs — what is local, what is on the server, and what the two looked like the
 * last time they agreed — and the UI shows its answer before a single byte moves.
 *
 * The comparison is deliberately conservative. With no record of the last agreement, a document that
 * exists in both places is a **conflict**, not an automatic overwrite: the app cannot know which copy
 * the user means, so it asks. When a record exists, the two-way comparison becomes a three-way one:
 * only a document changed on *both* sides is a conflict; anything changed on one side is simply
 * newer there.
 */

import type { RemoteDocumentSummary } from './session';

export type LocalDocumentState = {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  /** The document's own revision field, which the local repository already maintains. */
  readonly revision: number;
};

export type SyncMark = {
  readonly localUpdatedAt: string;
  readonly remoteRevision: number;
  readonly remoteUpdatedAt: string;
};

export type SyncMarks = Readonly<Record<string, SyncMark>>;

export type SyncAction =
  | {
      readonly kind: 'upload';
      readonly id: string;
      readonly title: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'download';
      readonly id: string;
      readonly title: string;
      readonly reason: string;
    }
  | { readonly kind: 'in-sync'; readonly id: string; readonly title: string }
  | {
      readonly kind: 'conflict';
      readonly id: string;
      readonly title: string;
      readonly localUpdatedAt: string;
      readonly remoteUpdatedAt: string;
      readonly remoteRevision: number;
      readonly reason: string;
    };

export type SyncPlan = {
  readonly actions: readonly SyncAction[];
  readonly counts: {
    readonly upload: number;
    readonly download: number;
    readonly inSync: number;
    readonly conflict: number;
  };
  /** True when running the plan changes nothing, so the button can say "nothing to sync". */
  readonly idle: boolean;
};

export function planSync(input: {
  readonly local: readonly LocalDocumentState[];
  readonly remote: readonly RemoteDocumentSummary[];
  readonly marks?: SyncMarks;
}): SyncPlan {
  const marks = input.marks ?? {};
  const remoteById = new Map(input.remote.map((entry) => [entry.id, entry]));
  const actions: SyncAction[] = [];
  const seen = new Set<string>();

  for (const document of input.local) {
    seen.add(document.id);
    const remote = remoteById.get(document.id);
    if (!remote) {
      actions.push({
        kind: 'upload',
        id: document.id,
        title: document.title,
        reason: 'Only in this browser.',
      });
      continue;
    }
    const mark = marks[document.id];
    if (!mark) {
      actions.push({
        kind: 'conflict',
        id: document.id,
        title: document.title,
        localUpdatedAt: document.updatedAt,
        remoteUpdatedAt: remote.updatedAt,
        remoteRevision: remote.revision,
        reason:
          'Both copies exist and this browser has no record of them agreeing, so neither copy is overwritten automatically.',
      });
      continue;
    }
    const localChanged = document.updatedAt !== mark.localUpdatedAt;
    const remoteChanged =
      remote.revision !== mark.remoteRevision || remote.updatedAt !== mark.remoteUpdatedAt;
    if (localChanged && remoteChanged) {
      actions.push({
        kind: 'conflict',
        id: document.id,
        title: document.title,
        localUpdatedAt: document.updatedAt,
        remoteUpdatedAt: remote.updatedAt,
        remoteRevision: remote.revision,
        reason: 'Changed here and on the server since the last sync.',
      });
      continue;
    }
    if (localChanged) {
      actions.push({
        kind: 'upload',
        id: document.id,
        title: document.title,
        reason: 'Changed here since the last sync.',
      });
      continue;
    }
    if (remoteChanged) {
      actions.push({
        kind: 'download',
        id: document.id,
        title: document.title,
        reason: 'Changed on the server since the last sync.',
      });
      continue;
    }
    actions.push({ kind: 'in-sync', id: document.id, title: document.title });
  }

  for (const remote of input.remote) {
    if (seen.has(remote.id)) continue;
    actions.push({
      kind: 'download',
      id: remote.id,
      title: remote.title,
      reason: 'Only on the server.',
    });
  }

  actions.sort(
    (left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
  );

  const counts = {
    upload: actions.filter((action) => action.kind === 'upload').length,
    download: actions.filter((action) => action.kind === 'download').length,
    inSync: actions.filter((action) => action.kind === 'in-sync').length,
    conflict: actions.filter((action) => action.kind === 'conflict').length,
  };

  return {
    actions,
    counts,
    idle: counts.upload === 0 && counts.download === 0 && counts.conflict === 0,
  };
}

/** The mark to remember after a successful transfer in either direction. */
export function markAfterDownload(remote: RemoteDocumentSummary, localUpdatedAt: string): SyncMark {
  return {
    localUpdatedAt,
    remoteRevision: remote.revision,
    remoteUpdatedAt: remote.updatedAt,
  };
}

export function markAfterUpload(input: {
  readonly localUpdatedAt: string;
  readonly revision: number;
  readonly remoteUpdatedAt: string;
}): SyncMark {
  return {
    localUpdatedAt: input.localUpdatedAt,
    remoteRevision: input.revision,
    remoteUpdatedAt: input.remoteUpdatedAt,
  };
}

/** A one-line summary for the panel; counts only, no claims about what was transferred. */
export function describePlan(plan: SyncPlan): string {
  if (plan.idle) return 'Everything here already matches the server.';
  const parts: string[] = [];
  if (plan.counts.upload > 0) parts.push(`${String(plan.counts.upload)} to upload`);
  if (plan.counts.download > 0) parts.push(`${String(plan.counts.download)} to download`);
  if (plan.counts.conflict > 0) {
    parts.push(`${String(plan.counts.conflict)} in conflict`);
  }
  return parts.join(' · ');
}

/**
 * Resolving a conflict.
 *
 * There is no merge of two independently edited documents in this build, and pretending otherwise
 * would be worse than asking. Each choice is explicit, and "keep the copy here" still leaves the
 * server copy downloadable later because the server revision is stated in the row.
 */
export type ConflictChoice = 'local' | 'remote';

export function resolveConflict(
  action: Extract<SyncAction, { kind: 'conflict' }>,
  choice: ConflictChoice,
): SyncAction {
  return choice === 'local'
    ? {
        kind: 'upload',
        id: action.id,
        title: action.title,
        reason: `Chosen over the server copy from ${action.remoteUpdatedAt}.`,
      }
    : {
        kind: 'download',
        id: action.id,
        title: action.title,
        reason: `Chosen over the copy here from ${action.localUpdatedAt}.`,
      };
}
