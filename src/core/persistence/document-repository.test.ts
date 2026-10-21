import { describe, expect, it } from 'vitest';

import { DOCUMENTS_KEY, LocalDocumentRepository } from './document-repository';
import { MemoryStorage, storageKey, type KeyValueStorage } from './storage';
import { createDocument } from '../documents/factories';
import { CURRENT_SCHEMA_VERSION } from '../documents/migrations';
import { err, forgeError, ok, type Result } from '../result';
import { brand } from '../types/brand';
import type { CreateDocumentInput, DocumentId, ForgeDocument } from '../documents/types';

const documentTypeId = brand<'DocumentTypeId'>('design.canvas');

function makeDocument(id: string, title: string): ForgeDocument {
  const input: CreateDocumentInput = {
    title,
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
  const result = createDocument(input, { generateId: () => id });
  if (!result.ok) throw new Error('fixture document should be valid');
  return result.value;
}

/** Storage stub that fails writes, so quota handling can be exercised deterministically. */
class FailingStorage implements KeyValueStorage {
  public get(key: string): Result<string | null> {
    return ok(this.entries.get(key) ?? null);
  }

  private readonly entries = new Map<string, string>();

  public set(): Result<void> {
    return err(
      forgeError(
        'storage-quota-exceeded',
        'Local storage is full. Delete a project to free space.',
      ),
    );
  }

  public remove(key: string): Result<void> {
    this.entries.delete(key);
    return ok(undefined);
  }

  public keys(prefix: string): Result<readonly string[]> {
    return ok([...this.entries.keys()].filter((key) => key.startsWith(prefix)));
  }
}

describe('LocalDocumentRepository', () => {
  it('starts empty', async () => {
    const repository = new LocalDocumentRepository(new MemoryStorage());
    const report = await repository.list();
    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.value.documents).toEqual([]);
      expect(report.value.migrated).toBe(0);
    }
  });

  it('saves, lists and reads back a document', async () => {
    const repository = new LocalDocumentRepository(new MemoryStorage());
    const document = makeDocument('doc-a', 'First project');

    const saved = await repository.save(document);
    expect(saved.ok).toBe(true);

    const list = await repository.list();
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value.documents.map((entry) => entry.id)).toEqual(['doc-a']);

    const found = await repository.get(document.id);
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.value?.title).toBe('First project');
  });

  it('orders documents by most recently updated first', async () => {
    const repository = new LocalDocumentRepository(new MemoryStorage());
    const older = { ...makeDocument('doc-old', 'Older'), updatedAt: '2026-01-01T00:00:00.000Z' };
    const newer = { ...makeDocument('doc-new', 'Newer'), updatedAt: '2026-02-01T00:00:00.000Z' };

    await repository.save(older);
    await repository.save(newer);

    const list = await repository.list();
    if (!list.ok) throw new Error('list should succeed');
    expect(list.value.documents.map((entry) => entry.id)).toEqual(['doc-new', 'doc-old']);
  });

  it('replaces an existing document instead of duplicating it', async () => {
    const repository = new LocalDocumentRepository(new MemoryStorage());
    const document = makeDocument('doc-a', 'Draft title');
    await repository.save(document);
    await repository.save({ ...document, title: 'Final title', revision: 2 });

    const list = await repository.list();
    if (!list.ok) throw new Error('list should succeed');
    expect(list.value.documents).toHaveLength(1);
    expect(list.value.documents[0]?.title).toBe('Final title');
  });

  it('removes a document and clears everything on request', async () => {
    const repository = new LocalDocumentRepository(new MemoryStorage());
    await repository.save(makeDocument('doc-a', 'A'));
    await repository.save(makeDocument('doc-b', 'B'));

    const removed = await repository.remove(brand<'DocumentId'>('doc-a'));
    expect(removed.ok).toBe(true);

    const list = await repository.list();
    if (!list.ok) throw new Error('list should succeed');
    expect(list.value.documents.map((entry) => entry.id)).toEqual(['doc-b']);

    const cleared = await repository.clearAll();
    expect(cleared.ok).toBe(true);

    const after = await repository.list();
    if (!after.ok) throw new Error('list should succeed');
    expect(after.value.documents).toEqual([]);
  });

  it('migrates legacy records on load and reports how many were migrated', async () => {
    const storage = new MemoryStorage();
    storage.set(
      DOCUMENTS_KEY,
      JSON.stringify({
        schemaVersion: 1,
        savedAt: '2026-01-01T00:00:00.000Z',
        documents: [
          {
            id: 'doc-legacy',
            title: 'Legacy flyer',
            width: 1240,
            height: 1754,
            background: '#101418',
          },
        ],
      }),
    );

    const repository = new LocalDocumentRepository(storage);
    const report = await repository.list();
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.documents).toHaveLength(1);
    expect(report.value.documents[0]?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(report.value.migrated).toBe(1);
  });

  it('skips unreadable records and explains why, without failing the whole load', async () => {
    const storage = new MemoryStorage();
    storage.set(
      DOCUMENTS_KEY,
      JSON.stringify({
        schemaVersion: 1,
        savedAt: '2026-01-01T00:00:00.000Z',
        documents: [
          'not-a-document',
          { ...makeDocument('doc-good', 'Readable'), schemaVersion: CURRENT_SCHEMA_VERSION },
        ],
      }),
    );

    const repository = new LocalDocumentRepository(storage);
    const report = await repository.list();
    if (!report.ok) throw new Error('list should succeed');
    expect(report.value.documents.map((entry) => entry.id)).toEqual(['doc-good']);
    expect(report.value.skipped).toHaveLength(1);
    expect(report.value.skipped[0]?.reason).toMatch(/skipped/i);
  });

  it('keeps an index it cannot read, and carries on', async () => {
    const storage = new MemoryStorage();
    storage.set(DOCUMENTS_KEY, '{ this is not json');
    const repository = new LocalDocumentRepository(storage);

    // The index cannot be read, but that must not take the application with it: the library loads,
    // the reader is told what happened, and the bytes are kept.
    const report = await repository.list();
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.documents).toEqual([]);
    expect(report.value.skipped).toHaveLength(1);
    expect(report.value.skipped[0]?.reason).toMatch(/left exactly as it was/i);

    // Saving works, and the bytes that could not be read are still there afterwards.
    const saved = await repository.save(makeDocument('doc-a', 'Readable'));
    expect(saved.ok).toBe(true);

    const raw = storage.get(DOCUMENTS_KEY);
    expect(raw.ok).toBe(true);
    if (!raw.ok || raw.value === null) return;
    const envelope = JSON.parse(raw.value) as { readonly documents: readonly unknown[] };
    expect(envelope.documents).toContain('{ this is not json');
  });

  it('keeps an index whose shape is unexpected', async () => {
    const storage = new MemoryStorage();
    storage.set(
      DOCUMENTS_KEY,
      JSON.stringify({ schemaVersion: 2, savedAt: 'x', documents: 'oops' }),
    );
    const repository = new LocalDocumentRepository(storage);

    const report = await repository.list();
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.skipped).toHaveLength(1);

    await repository.save(makeDocument('doc-a', 'Readable'));
    const raw = storage.get(DOCUMENTS_KEY);
    expect(raw.ok).toBe(true);
    if (!raw.ok || raw.value === null) return;
    const envelope = JSON.parse(raw.value) as { readonly documents: readonly unknown[] };
    // The document that was saved is there, and so is the index that could not be read.
    expect(envelope.documents).toHaveLength(2);
  });

  it('drops the unreadable index when the reader clears local data', async () => {
    const storage = new MemoryStorage();
    storage.set(DOCUMENTS_KEY, '{ this is not json');
    const repository = new LocalDocumentRepository(storage);

    const cleared = await repository.clearAll();
    expect(cleared.ok).toBe(true);

    const raw = storage.get(DOCUMENTS_KEY);
    expect(raw.ok).toBe(true);
    if (!raw.ok) return;
    expect(raw.value).toBeNull();
  });

  it('reports how much the stored index actually takes up', async () => {
    const storage = new MemoryStorage();
    const repository = new LocalDocumentRepository(storage);
    await repository.save(makeDocument('doc-a', 'A'));

    const report = await repository.list();
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    const raw = storage.get(DOCUMENTS_KEY);
    expect(raw.ok).toBe(true);
    if (!raw.ok || raw.value === null) return;
    // The footprint is what is on the device, not the readable subset of it.
    expect(report.value.storedBytes).toBe(raw.value.length);
  });

  it('keeps a record it cannot read when another project is saved', async () => {
    const storage = new MemoryStorage();
    storage.set(
      DOCUMENTS_KEY,
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        savedAt: '2026-01-01T00:00:00.000Z',
        documents: ['not-a-document'],
      }),
    );

    const repository = new LocalDocumentRepository(storage);
    const saved = await repository.save(makeDocument('doc-a', 'Readable'));
    expect(saved.ok).toBe(true);

    // The record was reported as "skipped", not deleted: a refusal has to stay recoverable
    // (ADR-0005), and saving an unrelated project must not throw it away.
    const raw = storage.get(DOCUMENTS_KEY);
    expect(raw.ok).toBe(true);
    if (!raw.ok || raw.value === null) return;
    const envelope = JSON.parse(raw.value) as { readonly documents: readonly unknown[] };
    expect(envelope.documents).toContain('not-a-document');

    const report = await repository.list();
    if (!report.ok) throw new Error('list should succeed');
    expect(report.value.documents.map((entry) => entry.id)).toEqual(['doc-a']);
    expect(report.value.skipped).toHaveLength(1);
  });

  it('keeps a project written by a newer app version when another project is saved', async () => {
    const storage = new MemoryStorage();
    storage.set(
      DOCUMENTS_KEY,
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        savedAt: '2026-01-01T00:00:00.000Z',
        documents: [
          {
            ...makeDocument('doc-future', 'Written by a newer version'),
            schemaVersion: CURRENT_SCHEMA_VERSION + 1,
          },
        ],
      }),
    );

    const repository = new LocalDocumentRepository(storage);
    const before = await repository.list();
    if (!before.ok) throw new Error('list should succeed');
    expect(before.value.skipped).toHaveLength(1);

    await repository.save(makeDocument('doc-a', 'Readable'));

    const raw = storage.get(DOCUMENTS_KEY);
    expect(raw.ok).toBe(true);
    if (!raw.ok || raw.value === null) return;
    const envelope = JSON.parse(raw.value) as { readonly documents: readonly { id: string }[] };
    expect(envelope.documents.map((entry) => entry.id)).toContain('doc-future');
  });

  it('deleting one project leaves records it cannot read alone', async () => {
    const storage = new MemoryStorage();
    storage.set(
      DOCUMENTS_KEY,
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        savedAt: '2026-01-01T00:00:00.000Z',
        documents: ['not-a-document'],
      }),
    );

    const repository = new LocalDocumentRepository(storage);
    await repository.save(makeDocument('doc-a', 'Readable'));

    const removed = await repository.remove(brand<'DocumentId'>('doc-a'));
    expect(removed.ok).toBe(true);

    const raw = storage.get(DOCUMENTS_KEY);
    expect(raw.ok).toBe(true);
    if (!raw.ok || raw.value === null) return;
    const envelope = JSON.parse(raw.value) as { readonly documents: readonly unknown[] };
    expect(envelope.documents).toEqual(['not-a-document']);
  });

  it('does not lose a project when two saves happen at the same time', async () => {
    const repository = new LocalDocumentRepository(new MemoryStorage());
    await repository.save(makeDocument('doc-a', 'First'));

    await Promise.all([
      repository.save({
        ...makeDocument('doc-b', 'Second'),
        updatedAt: '2026-02-01T00:00:00.000Z',
      }),
      repository.save({ ...makeDocument('doc-c', 'Third'), updatedAt: '2026-03-01T00:00:00.000Z' }),
    ]);

    const list = await repository.list();
    if (!list.ok) throw new Error('list should succeed');
    expect(list.value.documents.map((entry) => entry.id).sort()).toEqual([
      'doc-a',
      'doc-b',
      'doc-c',
    ]);
  });

  it('surfaces a full-storage failure when saving', async () => {
    const repository = new LocalDocumentRepository(new FailingStorage());
    const saved = await repository.save(makeDocument('doc-a', 'A'));
    expect(saved.ok).toBe(false);
    if (!saved.ok) {
      expect(saved.error.code).toBe('storage-quota-exceeded');
      expect(saved.error.retryable).toBe(false);
    }
  });

  it('propagates a storage failure when listing', async () => {
    class UnreadableStorage extends MemoryStorage {
      public override get(): Result<string | null> {
        return err(
          forgeError('storage-unavailable', 'Local storage could not be read on this device.'),
        );
      }
    }
    const repository = new LocalDocumentRepository(new UnreadableStorage());
    const report = await repository.list();
    expect(report.ok).toBe(false);
    if (!report.ok) expect(report.error.code).toBe('storage-unavailable');
  });

  it('writes a versioned key so future schema bumps can be told apart', async () => {
    const storage = new MemoryStorage();
    const repository = new LocalDocumentRepository(storage);
    await repository.save(makeDocument('doc-a', 'A'));

    expect(DOCUMENTS_KEY).toBe(storageKey('documents'));
    expect(storage.get(DOCUMENTS_KEY).ok).toBe(true);
    const keys = storage.keys('eulerforge.v1.');
    expect(keys.ok && keys.value).toContain(DOCUMENTS_KEY);
  });

  it('treats an unknown document id as a successful empty read', async () => {
    const repository = new LocalDocumentRepository(new MemoryStorage());
    const found = await repository.get(brand<'DocumentId'>('doc-missing'));
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.value).toBeNull();
  });
});

describe('document ids', () => {
  it('are branded at compile time but plain strings at runtime', () => {
    const id: DocumentId = brand<'DocumentId'>('doc-a');
    expect(typeof id).toBe('string');
  });
});
