import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { DocumentSession } from './document-session';
import { DocumentsStore } from './documents-store';
import { createDocument } from '../core/documents/factories';
import { createPlatformEventBus, type PlatformEventMap } from '../core/events/event-bus';
import { DOCUMENTS_KEY, LocalDocumentRepository } from '../core/persistence/document-repository';
import type { DocumentRepository } from '../core/persistence/document-repository';
import { MemoryStorage } from '../core/persistence/storage';
import { err, forgeError } from '../core/result';
import { brand } from '../core/types/brand';
import type { CreateDocumentInput } from '../core/documents/types';

const documentTypeId = brand<'DocumentTypeId'>('design.canvas');

const baseInput: CreateDocumentInput = {
  title: 'Launch poster',
  studioId: 'design',
  documentTypeId,
  canvas: {
    width: 1080,
    height: 1080,
    unit: 'px',
    dpi: 96,
    background: '#0f1115',
    transparent: false,
  },
};

type Harness = {
  readonly store: DocumentsStore;
  readonly storage: MemoryStorage;
  readonly bus: ReturnType<typeof createPlatformEventBus>;
  readonly repository: DocumentRepository;
  readonly save: MockInstance<DocumentRepository['save']>;
};

function createHarness(): Harness {
  const storage = new MemoryStorage();
  const repository = new LocalDocumentRepository(storage);
  const bus = createPlatformEventBus();
  // A spy keeps the real storage behaviour while letting assertions count writes.
  const save = vi.spyOn(repository, 'save');
  const store = new DocumentsStore({
    repository,
    bus,
    now: () => new Date('2026-04-01T00:00:00.000Z'),
  });
  return { store, storage, bus, repository, save };
}

describe('DocumentsStore lifecycle', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('starts idle and loads into a ready state', async () => {
    expect(harness.store.getState().status).toBe('idle');

    await harness.store.load();
    const state = harness.store.getState();
    expect(state.status).toBe('ready');
    expect(state.documents).toEqual([]);
    expect(state.skipped).toEqual([]);
  });

  it('creates a real document, persists it and reports it through the library', async () => {
    const result = await harness.store.create(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(harness.save).toHaveBeenCalledTimes(1);
    expect(harness.store.getState().documents.map((document) => document.id)).toEqual([
      result.value.id,
    ]);
    expect(harness.store.getById(result.value.id)?.title).toBe('Launch poster');
  });

  it('rejects invalid input without touching storage', async () => {
    const result = await harness.store.create({ ...baseInput, title: '' });
    expect(result.ok).toBe(false);
    expect(harness.save).not.toHaveBeenCalled();
    expect(harness.store.getState().documents).toEqual([]);
  });

  it('emits document:created and document:saved events', async () => {
    const created: PlatformEventMap['document:created'][] = [];
    const saved: PlatformEventMap['document:saved'][] = [];
    harness.bus.on('document:created', (payload) => created.push(payload));
    harness.bus.on('document:saved', (payload) => saved.push(payload));

    const result = await harness.store.create(baseInput);
    if (!result.ok) throw new Error('creation should succeed');
    await harness.store.update({ ...result.value, title: 'Renamed' });

    expect(created).toHaveLength(1);
    expect(created[0]?.title).toBe('Launch poster');
    expect(saved).toHaveLength(1);
    expect(saved[0]?.title).toBe('Renamed');
  });

  it('updates a document in place in the library order', async () => {
    const first = await harness.store.create(baseInput);
    const second = await harness.store.create({ ...baseInput, title: 'Second' });
    if (!first.ok || !second.ok) throw new Error('creation should succeed');

    await harness.store.update({ ...first.value, title: 'First, renamed' });
    const titles = harness.store.getState().documents.map((document) => document.title);
    expect(titles).toEqual(['First, renamed', 'Second']);
    expect(harness.store.getState().documents).toHaveLength(2);
  });

  it('refuses to persist a structurally invalid document', async () => {
    const result = await harness.store.create(baseInput);
    if (!result.ok) throw new Error('creation should succeed');

    const broken = { ...result.value, canvas: { ...result.value.canvas, width: 1 } };
    const updated = await harness.store.update(broken);

    expect(updated.ok).toBe(false);
    if (!updated.ok) expect(updated.error.code).toBe('validation-failed');
    expect(harness.store.getById(result.value.id)?.canvas.width).toBe(1080);
  });

  it('removes a document and closes its editing session', async () => {
    const result = await harness.store.create(baseInput);
    if (!result.ok) throw new Error('creation should succeed');

    const session = harness.store.session(result.value.id);
    expect(session).toBeInstanceOf(DocumentSession);

    const removed = await harness.store.remove(result.value.id);
    expect(removed.ok).toBe(true);
    expect(harness.store.getState().documents).toEqual([]);
    expect(harness.store.session(result.value.id)).toBeNull();
    expect(harness.store.getById(result.value.id)).toBeUndefined();
  });

  it('clears the library and reports how many records were removed', async () => {
    await harness.store.create({ ...baseInput, title: 'One' });
    await harness.store.create({ ...baseInput, title: 'Two' });

    const cleared = await harness.store.clearAll();
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.value).toBe(2);
    expect(harness.store.getState().documents).toEqual([]);
  });

  it('reloads documents written by a previous session', async () => {
    await harness.store.create(baseInput);

    const reopened = new DocumentsStore({
      repository: new LocalDocumentRepository(harness.storage),
      bus: harness.bus,
    });
    await reopened.load();

    expect(reopened.getState().documents.map((document) => document.title)).toEqual([
      'Launch poster',
    ]);
  });
});

describe('DocumentsStore.sessions', () => {
  it('returns the same session instance for the same document', async () => {
    const harness = createHarness();
    const result = await harness.store.create(baseInput);
    if (!result.ok) throw new Error('creation should succeed');

    expect(harness.store.session(result.value.id)).toBe(harness.store.session(result.value.id));
  });

  it('returns null for a document that is not in the library', () => {
    const harness = createHarness();
    expect(harness.store.session('doc-missing')).toBeNull();
  });
});

describe('DocumentSession', () => {
  async function createSession() {
    const harness = createHarness();
    const created = await harness.store.create(baseInput);
    if (!created.ok) throw new Error('creation should succeed');
    const session = harness.store.session(created.value.id);
    if (!session) throw new Error('session should exist');
    return { harness, session, document: created.value };
  }

  it('commits a labelled change, persists it and clears the dirty flag', async () => {
    const { harness, session } = await createSession();
    const result = await session.commit('Rename project', { title: 'Renamed poster' });

    expect(result.ok).toBe(true);
    const state = session.getState();
    expect(state.document.title).toBe('Renamed poster');
    expect(state.dirty).toBe(false);
    expect(state.canUndo).toBe(true);
    expect(state.history.map((entry) => entry.label)).toEqual(['Rename project']);
    expect(harness.store.getById(state.document.id)?.title).toBe('Renamed poster');
  });

  it('increments the revision on every committed change', async () => {
    const { session, document } = await createSession();
    await session.commit('Rename project', { title: 'Renamed poster' });
    await session.commit('Add a tag', { metadata: { ...document.metadata, tags: ['launch'] } });

    expect(session.getState().document.revision).toBe(document.revision + 2);
    expect(session.getState().history).toHaveLength(2);
  });

  it('undoes and redoes through the same persistence path', async () => {
    const { harness, session } = await createSession();
    await session.commit('Rename project', { title: 'Renamed poster' });

    await session.undo();
    expect(session.getState().document.title).toBe('Launch poster');
    expect(session.getState().canRedo).toBe(true);
    expect(harness.store.getById(session.getState().document.id)?.title).toBe('Launch poster');

    await session.redo();
    expect(session.getState().document.title).toBe('Renamed poster');
  });

  it('reports an error when there is nothing to undo', async () => {
    const { session } = await createSession();
    const result = await session.undo();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/nothing to undo/i);
  });

  it('rejects a change that would leave the document invalid', async () => {
    const { session, document } = await createSession();
    const result = await session.commit('Break the canvas', {
      canvas: { ...document.canvas, width: 4 },
    });

    expect(result.ok).toBe(false);
    expect(session.getState().document.canvas.width).toBe(1080);
    expect(session.getState().history).toEqual([]);
  });

  it('treats an identical value as a no-op rather than a history entry', async () => {
    const { session, document } = await createSession();
    await session.commit('Rename project', { title: 'Renamed poster' });
    const result = await session.commit('Rename again', {
      title: session.getState().document.title,
    });

    expect(result.ok).toBe(true);
    expect(session.getState().history).toHaveLength(1);
    expect(session.getState().document.id).toBe(document.id);
  });

  it('notifies subscribers on every state transition', async () => {
    const { session } = await createSession();
    const listener = vi.fn();
    session.subscribe(listener);

    await session.commit('Rename project', { title: 'Renamed poster' });
    expect(listener).toHaveBeenCalled();
  });

  it('surfaces a persistence failure instead of pretending the change was saved', async () => {
    const harness = createHarness();
    const created = await harness.store.create(baseInput);
    if (!created.ok) throw new Error('creation should succeed');

    const failing = new DocumentSession({
      document: created.value,
      persist: async () => ({
        ok: false as const,
        error: {
          code: 'storage-quota-exceeded' as const,
          message: 'Local storage is full.',
          retryable: false,
        },
      }),
    });

    const result = await failing.commit('Rename project', { title: 'Renamed poster' });
    expect(result.ok).toBe(false);
    expect(failing.getState().lastError?.message).toBe('Local storage is full.');
    // A failed write leaves the document dirty and keeps the message, so the workspace can offer a
    // retry rather than quietly dropping the change.
    expect(failing.getState().dirty).toBe(true);
    expect(failing.getState().saving).toBe(false);
  });

  it('re-saves the pending revision when a failed write is retried', async () => {
    const harness = createHarness();
    const created = await harness.store.create(baseInput);
    if (!created.ok) throw new Error('creation should succeed');
    const session = harness.store.session(created.value.id as string);
    if (!session) throw new Error('a session should exist for the created document');

    // The device refuses this write, which is what a full quota looks like from the store's side.
    const refusal = vi
      .spyOn(harness.storage, 'set')
      .mockReturnValueOnce(err(forgeError('storage-quota-exceeded', 'Local storage is full.')));

    const failed = await session.commit('Rename project', { title: 'Renamed poster' });
    expect(failed.ok).toBe(false);
    expect(session.getState().dirty).toBe(true);
    expect(session.getState().lastSavedAt).toBeNull();

    // The user frees space (or the browser allows it again) and retries.
    refusal.mockRestore();
    const retried = await session.retrySave();

    expect(retried.ok).toBe(true);
    expect(session.getState().lastError).toBeNull();
    expect(session.getState().dirty).toBe(false);
    expect(session.getState().lastSavedAt).not.toBeNull();
    expect(session.getState().document.title).toBe('Renamed poster');
    // The retried revision is the one the user was looking at, and it reached storage.
    const stored = harness.storage.get(DOCUMENTS_KEY);
    expect(stored.ok).toBe(true);
    if (stored.ok) expect(stored.value).toContain('Renamed poster');
  });
});

describe('document factory integration', () => {
  it('creates documents with the injected clock and id generator', async () => {
    const storage = new MemoryStorage();
    const bus = createPlatformEventBus();
    const store = new DocumentsStore({
      repository: new LocalDocumentRepository(storage),
      bus,
      now: () => new Date('2026-04-01T00:00:00.000Z'),
      generateId: () => 'doc-fixed',
    });

    const result = await store.create(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('doc-fixed');
      expect(result.value.createdAt).toBe('2026-04-01T00:00:00.000Z');
    }
  });

  it('validates input the same way the factory does', () => {
    const invalid = createDocument({ ...baseInput, canvas: { ...baseInput.canvas, width: 0 } });
    expect(invalid.ok).toBe(false);
  });
});
