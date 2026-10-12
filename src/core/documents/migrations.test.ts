import { describe, expect, it } from 'vitest';

import {
  CURRENT_SCHEMA_VERSION,
  isSupportedSchemaVersion,
  migrateDocument,
  pendingMigrations,
  readSchemaVersion,
} from './migrations';
import { createDocument, DEFAULT_CANVAS } from './factories';
import { brand } from '../types/brand';

const documentTypeId = brand<'DocumentTypeId'>('design.canvas');

/** A record in the pre-versioning flat shape: `{ title, width, height, background }`. */
const legacyRecord = {
  id: 'doc-legacy',
  title: 'Legacy flyer',
  width: 1240,
  height: 1754,
  background: '#101418',
  createdAt: '2025-11-02T09:00:00.000Z',
};

describe('readSchemaVersion', () => {
  it('reads a declared version', () => {
    expect(readSchemaVersion({ schemaVersion: 1 })).toBe(1);
  });

  it('treats records without a version as version 0', () => {
    expect(readSchemaVersion(legacyRecord)).toBe(0);
  });

  it('returns undefined for values that are not objects', () => {
    expect(readSchemaVersion('not a document')).toBeUndefined();
    expect(readSchemaVersion(null)).toBeUndefined();
    expect(readSchemaVersion([1, 2, 3])).toBeUndefined();
  });
});

describe('isSupportedSchemaVersion', () => {
  it('accepts versions up to the current one and rejects newer ones', () => {
    expect(isSupportedSchemaVersion(0)).toBe(true);
    expect(isSupportedSchemaVersion(CURRENT_SCHEMA_VERSION)).toBe(true);
    expect(isSupportedSchemaVersion(CURRENT_SCHEMA_VERSION + 1)).toBe(false);
  });
});

describe('migrateDocument', () => {
  it('migrates a pre-versioning record into the current schema', () => {
    const result = migrateDocument(legacyRecord);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const document = result.value;
    expect(document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(document.canvas).toMatchObject({ width: 1240, height: 1754, unit: 'px' });
    expect(document.guides).toBeDefined();
    expect(document.metadata).toEqual({ authorLabel: '', tags: [], notes: '' });
    expect(document.revision).toBe(1);
    expect(Object.isFrozen(document)).toBe(true);
  });

  it('round-trips a document that is already current', () => {
    const created = createDocument(
      { title: 'Poster', studioId: 'design', documentTypeId, canvas: DEFAULT_CANVAS },
      { generateId: () => 'doc-current' },
    );
    if (!created.ok) throw new Error('fixture should be valid');

    const result = migrateDocument(JSON.parse(JSON.stringify(created.value)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe('doc-current');
  });

  it('refuses a document written by a newer app version instead of guessing', () => {
    const result = migrateDocument({ ...legacyRecord, schemaVersion: CURRENT_SCHEMA_VERSION + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unsupported');
      expect(result.error.message).toMatch(/newer version/i);
    }
  });

  it('fills in sensible values for a version-less record with missing fields', () => {
    // A pre-versioning record only had a title; the v0 → v1 step supplies the rest.
    const result = migrateDocument({ title: 'no canvas at all' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.canvas.width).toBe(1080);
      expect(result.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    }
  });

  it('reports corrupt records rather than crashing the loader', () => {
    expect(migrateDocument('nope').ok).toBe(false);
    expect(migrateDocument([1, 2, 3]).ok).toBe(false);
    const malformed = migrateDocument({
      ...legacyRecord,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      canvas: { width: 0, height: 0 },
    });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.code).toBe('storage-corrupt');
  });
});

describe('pendingMigrations', () => {
  it('lists the steps a version still has to pass through', () => {
    expect(pendingMigrations(0)).toHaveLength(1);
    expect(pendingMigrations(CURRENT_SCHEMA_VERSION)).toHaveLength(0);
  });
});
