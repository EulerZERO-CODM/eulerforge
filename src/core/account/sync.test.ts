import { describe, expect, it } from 'vitest';

import type { RemoteDocumentSummary } from './session';
import {
  describePlan,
  markAfterUpload,
  planSync,
  resolveConflict,
  type LocalDocumentState,
  type SyncAction,
} from './sync';

const LOCAL: LocalDocumentState = {
  id: 'doc-1',
  title: 'Launch poster',
  updatedAt: '2026-10-18T10:00:00.000Z',
  revision: 3,
};

const REMOTE: RemoteDocumentSummary = {
  id: 'doc-1',
  title: 'Launch poster',
  documentTypeId: 'design.canvas',
  revision: 4,
  createdAt: '2026-10-17T09:00:00.000Z',
  updatedAt: '2026-10-18T10:00:00.000Z',
  bytes: 2048,
};

function conflictOf(plan: ReturnType<typeof planSync>): Extract<SyncAction, { kind: 'conflict' }> {
  const conflict = plan.actions.find(
    (action): action is Extract<SyncAction, { kind: 'conflict' }> => action.kind === 'conflict',
  );
  if (!conflict) throw new Error('expected a conflict');
  return conflict;
}

describe('planning a sync', () => {
  it('uploads a document that exists only here', () => {
    const plan = planSync({ local: [LOCAL], remote: [] });
    expect(plan.actions).toEqual([
      { kind: 'upload', id: 'doc-1', title: 'Launch poster', reason: 'Only in this browser.' },
    ]);
    expect(plan.counts).toEqual({ upload: 1, download: 0, inSync: 0, conflict: 0 });
    expect(plan.idle).toBe(false);
  });

  it('downloads a document that exists only on the server', () => {
    const plan = planSync({ local: [], remote: [REMOTE] });
    expect(plan.counts.download).toBe(1);
    expect(plan.actions[0]).toMatchObject({ kind: 'download', reason: 'Only on the server.' });
  });

  it('calls a document present on both sides with no history a conflict', () => {
    const plan = planSync({ local: [LOCAL], remote: [REMOTE] });
    expect(plan.counts.conflict).toBe(1);
    const conflict = conflictOf(plan);
    expect(conflict.localUpdatedAt).toBe(LOCAL.updatedAt);
    expect(conflict.remoteUpdatedAt).toBe(REMOTE.updatedAt);
    expect(conflict.remoteRevision).toBe(4);
    expect(conflict.reason).toMatch(/no record of them agreeing/);
  });

  it('says nothing is to be done when both sides agree and nothing moved', () => {
    const plan = planSync({
      local: [LOCAL],
      remote: [REMOTE],
      marks: {
        'doc-1': {
          localUpdatedAt: LOCAL.updatedAt,
          remoteRevision: 4,
          remoteUpdatedAt: REMOTE.updatedAt,
        },
      },
    });
    expect(plan.counts.inSync).toBe(1);
    expect(plan.idle).toBe(true);
    expect(describePlan(plan)).toBe('Everything here already matches the server.');
  });

  it('uploads when only the local copy changed since the last agreement', () => {
    const plan = planSync({
      local: [{ ...LOCAL, updatedAt: '2026-10-19T08:00:00.000Z' }],
      remote: [REMOTE],
      marks: {
        'doc-1': {
          localUpdatedAt: LOCAL.updatedAt,
          remoteRevision: 4,
          remoteUpdatedAt: REMOTE.updatedAt,
        },
      },
    });
    expect(plan.actions[0]).toMatchObject({
      kind: 'upload',
      reason: 'Changed here since the last sync.',
    });
  });

  it('downloads when only the server copy changed since the last agreement', () => {
    const plan = planSync({
      local: [LOCAL],
      remote: [{ ...REMOTE, revision: 5, updatedAt: '2026-10-19T08:00:00.000Z' }],
      marks: {
        'doc-1': {
          localUpdatedAt: LOCAL.updatedAt,
          remoteRevision: 4,
          remoteUpdatedAt: REMOTE.updatedAt,
        },
      },
    });
    expect(plan.actions[0]).toMatchObject({
      kind: 'download',
      reason: 'Changed on the server since the last sync.',
    });
  });

  it('reports a conflict when both copies changed, and keeps both timestamps for the UI', () => {
    const plan = planSync({
      local: [{ ...LOCAL, updatedAt: '2026-10-19T08:00:00.000Z' }],
      remote: [{ ...REMOTE, revision: 5, updatedAt: '2026-10-19T09:00:00.000Z' }],
      marks: {
        'doc-1': {
          localUpdatedAt: LOCAL.updatedAt,
          remoteRevision: 4,
          remoteUpdatedAt: REMOTE.updatedAt,
        },
      },
    });
    expect(plan.counts.conflict).toBe(1);
    const conflict = conflictOf(plan);
    expect(conflict.reason).toBe('Changed here and on the server since the last sync.');
    expect(conflict.localUpdatedAt).toBe('2026-10-19T08:00:00.000Z');
    expect(conflict.remoteUpdatedAt).toBe('2026-10-19T09:00:00.000Z');
  });

  it('treats a corrupt local clock as a local change, not as a winner', () => {
    const plan = planSync({
      local: [{ ...LOCAL, updatedAt: 'whenever' }],
      remote: [REMOTE],
      marks: {
        'doc-1': {
          localUpdatedAt: LOCAL.updatedAt,
          remoteRevision: 4,
          remoteUpdatedAt: REMOTE.updatedAt,
        },
      },
    });
    // The server copy has not moved since the agreement, so nothing remote can be lost: the plan
    // uploads the local copy. What must never happen is the reverse — a corrupt timestamp beating a
    // server copy that *has* changed — and that is a conflict below.
    expect(plan.actions[0]).toMatchObject({ kind: 'upload' });

    const bothMoved = planSync({
      local: [{ ...LOCAL, updatedAt: '2026-10-19T07:00:00.000Z' }],
      remote: [{ ...REMOTE, revision: 9, updatedAt: '2026-10-19T09:00:00.000Z' }],
      marks: {
        'doc-1': {
          localUpdatedAt: LOCAL.updatedAt,
          remoteRevision: 4,
          remoteUpdatedAt: REMOTE.updatedAt,
        },
      },
    });
    expect(bothMoved.counts).toMatchObject({ conflict: 1, download: 0, upload: 0 });
  });

  it('plans every document once, in a stable order, and counts each kind', () => {
    const plan = planSync({
      local: [
        { ...LOCAL, id: 'b', title: 'Beta' },
        { ...LOCAL, id: 'a', title: 'Alpha' },
      ],
      remote: [{ ...REMOTE, id: 'c', title: 'Gamma', documentTypeId: 'photo.image' }],
    });
    expect(plan.actions.map((action) => action.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(plan.counts).toEqual({ upload: 2, download: 1, inSync: 0, conflict: 0 });
    expect(describePlan(plan)).toBe('2 to upload · 1 to download');
  });

  it('never plans two actions for one id', () => {
    const plan = planSync({ local: [LOCAL], remote: [REMOTE] });
    const ids = plan.actions.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('resolving and remembering', () => {
  it('turns a conflict into the chosen direction, and says what it replaced', () => {
    const conflict = conflictOf(planSync({ local: [LOCAL], remote: [REMOTE] }));
    const keepLocal = resolveConflict(conflict, 'local');
    expect(keepLocal).toMatchObject({ kind: 'upload', id: 'doc-1' });
    expect(keepLocal.kind === 'upload' && keepLocal.reason).toContain(REMOTE.updatedAt);

    const keepRemote = resolveConflict(conflict, 'remote');
    expect(keepRemote).toMatchObject({ kind: 'download', id: 'doc-1' });
    expect(keepRemote.kind === 'download' && keepRemote.reason).toContain(LOCAL.updatedAt);
  });

  it('marks what was agreed after an upload', () => {
    expect(
      markAfterUpload({
        localUpdatedAt: '2026-10-19T08:00:00.000Z',
        revision: 5,
        remoteUpdatedAt: '2026-10-19T08:00:01.000Z',
      }),
    ).toEqual({
      localUpdatedAt: '2026-10-19T08:00:00.000Z',
      remoteRevision: 5,
      remoteUpdatedAt: '2026-10-19T08:00:01.000Z',
    });
  });
});
