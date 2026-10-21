import { describe, expect, it } from 'vitest';

import { DocumentSession } from './document-session';
import { createDocument } from '../core/documents/factories';
import { ok } from '../core/result';
import { brand } from '../core/types/brand';
import type { CreateDocumentInput, ForgeDocument } from '../core/documents/types';

function makeDocument(): ForgeDocument {
  const input: CreateDocumentInput = {
    title: 'Original name',
    studioId: 'design',
    documentTypeId: brand<'DocumentTypeId'>('design.canvas'),
    canvas: {
      width: 1080,
      height: 1080,
      unit: 'px',
      dpi: 96,
      background: '#0f1115',
      transparent: false,
    },
  };
  const result = createDocument(input, { generateId: () => 'doc-session' });
  if (!result.ok) throw new Error('the fixture document should be valid');
  return result.value;
}

function makeSession(document = makeDocument()): DocumentSession {
  return new DocumentSession({
    document,
    persist: async (next) => ok(next),
  });
}

describe('DocumentSession revision', () => {
  it('increases when a change is committed', async () => {
    const session = makeSession();
    const before = session.getState().document.revision;

    await session.commit('Rename', { title: 'A new name' });

    expect(session.getState().document.revision).toBeGreaterThan(before);
  });

  it('keeps increasing when a change is undone', async () => {
    const session = makeSession();
    await session.commit('Rename', { title: 'A new name' });
    const afterEdit = session.getState().document.revision;

    await session.undo();

    // The content goes back, but the document is saved again, so the revision must not go
    // backwards: it is the counter a future remote adapter would compare to spot a stale write.
    expect(session.getState().document.title).toBe('Original name');
    expect(session.getState().document.revision).toBeGreaterThan(afterEdit);
  });

  it('keeps increasing when an undone change is redone', async () => {
    const session = makeSession();
    await session.commit('Rename', { title: 'A new name' });
    await session.undo();
    const afterUndo = session.getState().document.revision;

    await session.redo();

    expect(session.getState().document.title).toBe('A new name');
    expect(session.getState().document.revision).toBeGreaterThan(afterUndo);
  });

  it('keeps the history when the repository stores a normalised copy', async () => {
    // A repository that normalises what it saves returns a different object. The session has to
    // adopt it without throwing the undo stack away: the user would otherwise lose every step
    // they could still undo, for a difference they never see.
    const document = makeDocument();
    const session = new DocumentSession({
      document,
      persist: async (next) => ok({ ...next, summary: `${next.summary} (normalised)` }),
    });

    await session.commit('Rename', { title: 'A new name' });
    expect(session.getState().canUndo).toBe(true);

    await session.undo();

    expect(session.getState().document.title).toBe('Original name');
    expect(session.getState().canUndo).toBe(false);
    expect(session.getState().canRedo).toBe(true);
  });
});
