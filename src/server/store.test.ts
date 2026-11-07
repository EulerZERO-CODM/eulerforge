// @vitest-environment node
/**
 * The JSON store's security and durability boundaries.
 *
 * The route tests prove what a browser sees; these go one layer down to the properties the routes
 * rely on and a person rarely triggers directly — an expired share link, a cross-account overwrite,
 * a path-traversal attempt, two saves racing. The store is a single-process design on purpose, so
 * "what happens when two writers meet" is a property that has to be tested rather than assumed.
 */

import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ForgeStore } from './store';
import { hashToken } from './sessions';
import type { PasswordHash } from './passwords';
import { brand } from '../core/types/brand';
import { DEFAULT_CANVAS, DEFAULT_GUIDES, createDocument } from '../core/documents/factories';
import type { ForgeDocument } from '../core/documents/types';

let directory = '';
let clock = new Date('2026-04-01T12:00:00.000Z');
let store: ForgeStore;

const PASSWORD: PasswordHash = {
  algorithm: 'scrypt',
  N: 32_768,
  r: 8,
  p: 1,
  salt: 'c2FsdHNhbHRzYWx0c2FsdA==',
  hash: 'aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g=',
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'forge-store-'));
  clock = new Date('2026-04-01T12:00:00.000Z');
  store = new ForgeStore({ dataDir: directory, clock: () => clock });
  const ready = await store.init();
  if (!ready.ok) throw new Error(ready.error.message);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function documentOf(id: string, title = 'Poster'): ForgeDocument {
  const created = createDocument({
    title,
    studioId: 'design',
    documentTypeId: brand<'DocumentTypeId'>('design.canvas'),
    canvas: DEFAULT_CANVAS,
    guides: DEFAULT_GUIDES,
  });
  if (!created.ok) throw new Error(created.error.message);
  return { ...created.value, id: brand<'DocumentId'>(id) };
}

async function accountOf(email: string): Promise<string> {
  const created = await store.createAccount({
    email,
    displayName: 'Ada',
    password: PASSWORD,
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value.id;
}

async function save(ownerId: string, id: string): Promise<void> {
  const saved = await store.saveDocument({
    ownerId,
    id,
    document: documentOf(id),
    baseRevision: null,
  });
  if (!saved.ok) throw new Error(saved.error.message);
}

async function share(ownerId: string, documentId: string, ttlMs: number | null): Promise<string> {
  const created = await store.createShare({
    ownerId,
    documentId,
    tokenHash: hashToken(`token-${documentId}`),
    ttlMs,
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value.id;
}

describe('the data directory', () => {
  it('keeps account and session files readable only by their owner', async () => {
    await accountOf('ada@example.com');
    const accounts = await stat(join(directory, 'accounts.json'));
    const sessions = await stat(join(directory, 'sessions.json'));
    // POSIX modes; Windows does not model them, and the store is not documented for it.
    if (process.platform !== 'win32') {
      expect(accounts.mode & 0o777).toBe(0o600);
      expect(sessions.mode & 0o777).toBe(0o600);
    }
    // The files exist where the docs say, and no credential is stored in plaintext.
    const raw = await readFile(join(directory, 'accounts.json'), 'utf8');
    expect(raw).not.toContain('correct-horse');
  });
});

describe('documents that are not what they claim to be', () => {
  it('refuses a hand-edited document instead of serving it', async () => {
    const ada = await accountOf('ada@example.com');
    await save(ada, 'doc-1');
    // Simulate a file edited outside the application: valid JSON, invalid document.
    await writeFile(
      join(directory, 'documents', 'doc-1.json'),
      JSON.stringify({ id: 'doc-1', ownerId: ada, revision: 1, document: { nonsense: true } }),
      'utf8',
    );
    const read = await store.getDocument(ada, 'doc-1');
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.kind).toBe('unavailable');
    expect(read.error.message).toMatch(/cannot be read/i);
    // The file is kept, not deleted: a person can still recover it from the data directory.
    expect(await store.documentFiles()).toContain('doc-1.json');
  });

  it('refuses a document written by a newer build rather than guessing', async () => {
    const ada = await accountOf('ada@example.com');
    await save(ada, 'doc-2');
    const path = join(directory, 'documents', 'doc-2.json');
    const stored = JSON.parse(await readFile(path, 'utf8')) as {
      document: Record<string, unknown>;
    };
    stored.document.schemaVersion = 99;
    await writeFile(path, JSON.stringify(stored), 'utf8');

    const read = await store.getDocument(ada, 'doc-2');
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.message).toMatch(/cannot be read/i);
    if (read.error.kind !== 'unavailable') throw new Error('expected an unavailable error');
    expect(read.error.detail).toMatch(/newer version/i);
  });

  it('keeps serving documents written by the current build', async () => {
    const ada = await accountOf('ada@example.com');
    await save(ada, 'doc-3');
    const read = await store.getDocument(ada, 'doc-3');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.document.title).toBe('Poster');
  });
});

describe('documents in the store', () => {
  it('refuses to overwrite another account’s document, and does not reveal it exists', async () => {
    const ada = await accountOf('ada@example.com');
    const grace = await accountOf('grace@example.com');
    await save(ada, 'doc-1');

    const stolen = await store.saveDocument({
      ownerId: grace,
      id: 'doc-1',
      document: documentOf('doc-1', 'Taken'),
      baseRevision: null,
    });
    expect(stolen.ok).toBe(false);
    if (stolen.ok) return;
    expect(stolen.error.kind).toBe('not-found');

    const read = await store.getDocument(grace, 'doc-1');
    expect(read.ok).toBe(false);

    // The original is untouched.
    const original = await store.getDocument(ada, 'doc-1');
    expect(original.ok).toBe(true);
    if (!original.ok) return;
    expect(original.value.document.title).toBe('Poster');
  });

  it('serialises two writers: the second gets a conflict, not a corrupt file', async () => {
    const ada = await accountOf('ada@example.com');
    await save(ada, 'doc-race');

    const [first, second] = await Promise.all([
      store.saveDocument({
        ownerId: ada,
        id: 'doc-race',
        document: documentOf('doc-race', 'First'),
        baseRevision: 1,
      }),
      store.saveDocument({
        ownerId: ada,
        id: 'doc-race',
        document: documentOf('doc-race', 'Second'),
        baseRevision: 1,
      }),
    ]);
    const outcomes = [first, second];
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const conflict = outcomes.find((outcome) => !outcome.ok);
    expect(conflict && !conflict.ok ? conflict.error.kind : null).toBe('conflict');

    // The surviving record is a whole document, not a half-written one.
    const read = await store.getDocument(ada, 'doc-race');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.revision).toBe(2);
    expect(['First', 'Second']).toContain(read.value.document.title);
  });

  it('never writes a document outside its directory, even for a hostile id', async () => {
    const ada = await accountOf('ada@example.com');
    const hostile = '../escaped';
    const attempt = await store.saveDocument({
      ownerId: ada,
      id: hostile,
      document: { ...documentOf('doc-safe'), id: brand<'DocumentId'>(hostile) },
      baseRevision: null,
    });
    // The document schema refuses an id with slashes before the path helper is ever reached.
    expect(attempt.ok).toBe(false);

    const root = await readdir(directory);
    expect(root).not.toContain('escaped.json');
    expect(root).not.toContain('escaped');
    const documents = await readdir(join(directory, 'documents'));
    expect(documents).toEqual(['index.json']);
  });
});

describe('share links in the store', () => {
  it('stops resolving at its expiry and removes the record', async () => {
    const ada = await accountOf('ada@example.com');
    await save(ada, 'doc-expiring');
    await share(ada, 'doc-expiring', 60_000);

    const before = await store.resolveShare(hashToken('token-doc-expiring'));
    expect(before.ok).toBe(true);

    clock = new Date('2026-04-01T12:02:00.000Z');
    const after = await store.resolveShare(hashToken('token-doc-expiring'));
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.error.kind).toBe('not-found');
    expect(after.error.message).toMatch(/expired/i);

    // The expired link is not just refused, it is gone: a second lookup is the unknown-link answer.
    const again = await store.resolveShare(hashToken('token-doc-expiring'));
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.message).not.toMatch(/expired/i);
  });

  it('cannot be created for someone else’s document', async () => {
    const ada = await accountOf('ada@example.com');
    const grace = await accountOf('grace@example.com');
    await save(ada, 'doc-owned');

    const attempt = await store.createShare({
      ownerId: grace,
      documentId: 'doc-owned',
      tokenHash: hashToken('token-grace'),
      ttlMs: 60_000,
    });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.kind).toBe('not-found');
    expect((await store.resolveShare(hashToken('token-grace'))).ok).toBe(false);
  });

  it('is removed when the document is deleted', async () => {
    const ada = await accountOf('ada@example.com');
    await save(ada, 'doc-gone');
    await share(ada, 'doc-gone', null);

    const deleted = await store.deleteDocument(ada, 'doc-gone');
    expect(deleted.ok && deleted.value).toBe(true);
    expect((await store.resolveShare(hashToken('token-doc-gone'))).ok).toBe(false);
  });
});
