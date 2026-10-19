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

/**
 * A version-1 record as Phase 1 wrote it: canvas, guides, palette and metadata, with no scene and
 * no attribution. It is the shape a real saved project has in `localStorage` today.
 */
const versionOneRecord = {
  id: 'doc-v1',
  schemaVersion: 1,
  studioId: 'design',
  documentTypeId: 'design.canvas',
  title: 'Saved in Phase 1',
  summary: '',
  canvas: {
    width: 1080,
    height: 1080,
    unit: 'px',
    dpi: 96,
    background: '#0f1115',
    transparent: false,
  },
  guides: { safeMarginMm: 8, bleedMm: 0, showGrid: false, gridMm: 10, showCentreLines: true },
  palette: ['#ff8a3d'],
  metadata: { authorLabel: 'Studio', tags: ['launch'], notes: 'keep me' },
  status: 'draft',
  revision: 4,
  createdAt: '2025-12-01T10:00:00.000Z',
  updatedAt: '2025-12-02T10:00:00.000Z',
};

describe('migrateDocument — legacy records to the current schema', () => {
  it('opens an existing saved project with an empty scene instead of inventing artwork', () => {
    const result = migrateDocument(versionOneRecord);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.value.scene).toEqual({ layers: [] });
    expect(result.value.attribution).toEqual([]);
  });

  it('preserves every field a v1 document already had', () => {
    const result = migrateDocument(versionOneRecord);
    if (!result.ok) throw new Error('v1 record should migrate');

    expect(result.value).toMatchObject({
      id: 'doc-v1',
      title: 'Saved in Phase 1',
      palette: ['#ff8a3d'],
      status: 'draft',
      revision: 4,
      createdAt: '2025-12-01T10:00:00.000Z',
      updatedAt: '2025-12-02T10:00:00.000Z',
    });
    expect(result.value.metadata).toEqual({
      authorLabel: 'Studio',
      tags: ['launch'],
      notes: 'keep me',
    });
    expect(result.value.canvas.width).toBe(1080);
  });

  it('runs v0 records through every step in order', () => {
    const result = migrateDocument(legacyRecord);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.value.scene.layers).toEqual([]);
    expect(result.value.canvas.width).toBe(1240);
  });

  it('keeps layer data that is already present rather than discarding it', () => {
    const withLayers = {
      ...versionOneRecord,
      scene: { layers: [{ id: 'lyr-1', type: 'rect' }] },
    };
    const result = migrateDocument(withLayers);
    // The partial layer fails schema validation: migrating must not paper over broken layer data.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('storage-corrupt');
  });

  it('rejects a document from a newer schema instead of dropping its scene', () => {
    const result = migrateDocument({
      ...versionOneRecord,
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unsupported');
  });
});

describe('older documents reach the current schema without rewriting their content', () => {
  function v4PathDocument() {
    const created = createDocument(
      {
        title: 'Saved before paint',
        studioId: 'illustration',
        documentTypeId: brand<'DocumentTypeId'>('illustration.artboard'),
        canvas: DEFAULT_CANVAS,
        scene: {
          layers: [
            {
              id: brand<'LayerId'>('lyr-flat'),
              name: 'Flat card',
              visible: true,
              locked: false,
              opacity: 1,
              frame: { x: 0, y: 0, width: 10, height: 10 },
              type: 'path',
              vector: {
                path: {
                  contours: [
                    {
                      closed: true,
                      nodes: [
                        { point: { x: 0, y: 0 }, handleIn: null, handleOut: null },
                        { point: { x: 10, y: 0 }, handleIn: null, handleOut: null },
                        { point: { x: 10, y: 10 }, handleIn: null, handleOut: null },
                      ],
                    },
                  ],
                },
                style: {
                  fill: '#22cc88',
                  fillRule: 'nonzero',
                  fillOpacity: 1,
                  stroke: null,
                  strokeWidth: 1,
                  strokeOpacity: 1,
                  lineCap: 'butt',
                  lineJoin: 'miter',
                  dashArray: [],
                },
              },
            },
          ],
        },
      },
      { generateId: () => 'doc-v4-paint', now: () => new Date('2026-06-01T00:00:00.000Z') },
    );
    if (!created.ok) throw new Error(created.error.message);
    return JSON.parse(JSON.stringify(created.value)) as Record<string, unknown>;
  }

  it('stamps the current version and leaves the flat fill meaning the same thing', () => {
    const v4 = { ...v4PathDocument(), schemaVersion: 4 };
    const migrated = migrateDocument(v4);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const layer = migrated.value.scene.layers[0];
    if (layer?.type !== 'path') throw new Error('expected a path layer');
    expect(layer.vector.style.fill).toBe('#22cc88');
    expect(layer.vector.style.fillPaint).toBeUndefined();
  });

  it('does not invent paint for a document that had none', () => {
    const v4 = { ...v4PathDocument(), schemaVersion: 4 };
    const migrated = migrateDocument(v4);
    if (!migrated.ok) throw new Error(migrated.error.message);
    const layer = migrated.value.scene.layers[0];
    if (layer?.type !== 'path') throw new Error('expected a path layer');
    expect(layer.vector.style.strokePaint).toBeUndefined();
  });
});

describe('v6 → v7: a path that carried no text keeps meaning the same', () => {
  /**
   * A record exactly as the previous version wrote it: the same path and paint, with no `text` key
   * at all. v7 only *adds* an optional field, so the migration must not invent one or rewrite the
   * geometry — the old file has to load looking identical.
   */
  function v6PathDocument(): Record<string, unknown> {
    const created = createDocument(
      {
        title: 'Saved before text on a path',
        studioId: 'illustration',
        documentTypeId: brand<'DocumentTypeId'>('illustration.artboard'),
        canvas: DEFAULT_CANVAS,
        scene: {
          layers: [
            {
              id: brand<'LayerId'>('lyr-plain'),
              name: 'Plain arc',
              visible: true,
              locked: false,
              opacity: 1,
              frame: { x: 0, y: 0, width: 10, height: 5 },
              type: 'path',
              vector: {
                path: {
                  contours: [
                    {
                      closed: false,
                      nodes: [
                        { point: { x: 0, y: 5 }, handleIn: null, handleOut: null },
                        { point: { x: 5, y: 0 }, handleIn: null, handleOut: null },
                        { point: { x: 10, y: 5 }, handleIn: null, handleOut: null },
                      ],
                    },
                  ],
                },
                style: {
                  fill: null,
                  fillRule: 'nonzero',
                  fillOpacity: 1,
                  stroke: '#112233',
                  strokeWidth: 2,
                  strokeOpacity: 1,
                  lineCap: 'round',
                  lineJoin: 'round',
                  dashArray: [],
                },
              },
            },
          ],
        },
      },
      { generateId: () => 'doc-v6-text', now: () => new Date('2026-07-01T00:00:00.000Z') },
    );
    if (!created.ok) throw new Error(created.error.message);
    const record = JSON.parse(JSON.stringify(created.value)) as {
      schemaVersion: number;
      scene: { layers: { vector: { text?: unknown } }[] };
    };
    record.schemaVersion = 6;
    for (const layer of record.scene.layers) delete layer.vector.text;
    return record as unknown as Record<string, unknown>;
  }

  it('stamps v7 without adding a run or moving the geometry', () => {
    const migrated = migrateDocument(v6PathDocument());
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const layer = migrated.value.scene.layers[0];
    if (layer?.type !== 'path') throw new Error('expected a path layer');
    // Absent and `null` both mean "this path carries no text"; the loader materialises the optional
    // field, which is the only change v7 makes to an older record.
    expect(layer.vector.text ?? null).toBeNull();
    expect(layer.vector.style.stroke).toBe('#112233');
    expect(layer.vector.path.contours[0]?.nodes).toHaveLength(3);
  });

  it('migrates a v0 record through the new step too', () => {
    const result = migrateDocument(legacyRecord);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schemaVersion).toBe(7);
  });
});

describe('pendingMigrations', () => {
  it('lists the steps a version still has to pass through', () => {
    // One step per published version, so a version-0 record walks the whole documented chain.
    expect(pendingMigrations(0)).toHaveLength(CURRENT_SCHEMA_VERSION);
    expect(pendingMigrations(1)).toHaveLength(CURRENT_SCHEMA_VERSION - 1);
    expect(pendingMigrations(CURRENT_SCHEMA_VERSION - 1)).toHaveLength(1);
    expect(pendingMigrations(CURRENT_SCHEMA_VERSION)).toHaveLength(0);
  });

  it('appends one step per published version and never rewrites an older one', () => {
    const steps = pendingMigrations(2);
    expect(steps.map((step) => `${String(step.from)}->${String(step.to)}`)).toEqual([
      '2->3',
      '3->4',
      '4->5',
      '5->6',
      '6->7',
    ]);
    expect(steps[0]?.description).toMatch(/vector path layers/i);
    expect(steps[1]?.description).toMatch(/studio payload/i);
    expect(steps[2]?.description).toMatch(/gradient or pattern paint/i);
    expect(steps[3]?.description).toMatch(/range selections/i);
    expect(steps[4]?.description).toMatch(/text on their contour/i);
  });
});
