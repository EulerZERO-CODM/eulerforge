/**
 * Studio payloads in the document model.
 *
 * These tests pin the rules every payload studio depends on: one payload kind per document type,
 * a bounded and validated shape, and a migration that keeps older projects loading.
 */

import { describe, expect, it } from 'vitest';

import { brand } from '../types/brand';
import { createDocument, DEFAULT_CANVAS, DEFAULT_GUIDES } from './factories';
import { migrateDocument, CURRENT_SCHEMA_VERSION } from './migrations';
import {
  defaultMotionPayload,
  defaultPhotoPayload,
  defaultStudioPayload,
  defaultVideoPayload,
  payloadKindForDocumentType,
} from './payload';
import { forgeDocumentSchema } from './schema';

const typeId = (value: string) => brand<'DocumentTypeId'>(value);

describe('defaultStudioPayload', () => {
  it('gives each payload studio an empty, valid starting payload', () => {
    expect(defaultStudioPayload('photo.image')).toEqual(defaultPhotoPayload());
    expect(defaultStudioPayload('motion.scene')).toEqual(defaultMotionPayload());
    expect(defaultStudioPayload('video.timeline')).toEqual(defaultVideoPayload());
  });

  it('leaves the design canvas and the vector artboard without one', () => {
    expect(defaultStudioPayload('design.canvas')).toBeNull();
    expect(defaultStudioPayload('illustration.artboard')).toBeNull();
    expect(payloadKindForDocumentType('video.timeline')).toBe('video');
    expect(payloadKindForDocumentType('design.canvas')).toBeNull();
  });
});

describe('createDocument', () => {
  const base = {
    title: 'Timeline',
    studioId: 'video',
    documentTypeId: typeId('video.timeline'),
    canvas: DEFAULT_CANVAS,
    guides: DEFAULT_GUIDES,
  };

  it('attaches the payload the document type requires', () => {
    const created = createDocument(base, { generateId: () => 'doc-video' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.studioPayload?.kind).toBe('video');
    expect(created.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('refuses an explicit payload of the wrong kind', () => {
    const created = createDocument(
      { ...base, studioPayload: defaultMotionPayload() },
      { generateId: () => 'doc-wrong' },
    );
    expect(created.ok).toBe(false);
  });

  it('keeps a payload supplied by the caller', () => {
    const payload = defaultPhotoPayload();
    const created = createDocument(
      { ...base, documentTypeId: typeId('photo.image'), studioId: 'photo', studioPayload: payload },
      { generateId: () => 'doc-photo' },
    );
    expect(created.ok && created.value.studioPayload).toEqual(payload);
  });
});

describe('migration from v3', () => {
  const v3 = {
    id: 'doc-old',
    schemaVersion: 3,
    studioId: 'design',
    documentTypeId: 'design.canvas',
    title: 'Old poster',
    summary: '',
    canvas: DEFAULT_CANVAS,
    guides: DEFAULT_GUIDES,
    palette: [],
    scene: { layers: [] },
    attribution: [],
    metadata: { authorLabel: '', tags: [], notes: '' },
    status: 'draft',
    revision: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('loads an older design project with no payload, changing nothing else', () => {
    const migrated = migrateDocument(v3);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    // The chain keeps walking: this record predates paint too, so it lands on the current version.
    expect(migrated.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.value.studioPayload).toBeNull();
    expect(migrated.value.scene.layers).toEqual([]);
    expect(migrated.value.revision).toBe(3);
  });

  it('gives a v3 file that already names a payload type a valid empty payload', () => {
    const migrated = migrateDocument({ ...v3, studioId: 'motion', documentTypeId: 'motion.scene' });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.studioPayload?.kind).toBe('motion');
  });

  it('still refuses a document written by a newer build', () => {
    const migrated = migrateDocument({ ...v3, schemaVersion: 99 });
    expect(migrated.ok).toBe(false);
    if (!migrated.ok) expect(migrated.error.code).toBe('unsupported');
  });
});

describe('payload validation', () => {
  const document = {
    id: brand<'DocumentId'>('doc-photo'),
    schemaVersion: 4,
    studioId: 'photo',
    documentTypeId: typeId('photo.image'),
    title: 'Photo',
    summary: '',
    canvas: DEFAULT_CANVAS,
    guides: DEFAULT_GUIDES,
    palette: [],
    scene: { layers: [] },
    attribution: [],
    metadata: { authorLabel: '', tags: [], notes: '' },
    status: 'draft',
    revision: 1,
    studioPayload: defaultPhotoPayload(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('accepts a photo document with its payload', () => {
    expect(forgeDocumentSchema.safeParse(document).success).toBe(true);
  });

  it('rejects a payload whose values are outside the documented range', () => {
    const payload = defaultPhotoPayload();
    const invalid = {
      ...document,
      studioPayload: {
        ...payload,
        adjustments: [{ id: 'a1', kind: 'exposure', value: 900, enabled: true }],
      },
    };
    expect(forgeDocumentSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts a mask whose selections are source-pixel ranges', () => {
    const payload = defaultPhotoPayload();
    const withRanges = {
      ...document,
      studioPayload: {
        ...payload,
        mask: {
          strokes: [],
          inverted: false,
          ranges: [
            { id: 'range-1', kind: 'luminance', min: 0.5, max: 1, feather: 0.2 },
            { id: 'range-2', kind: 'colour', colour: '#aabbcc', tolerance: 0.15, feather: 0 },
          ],
        },
      },
    };
    const parsed = forgeDocumentSchema.safeParse(withRanges);
    expect(parsed.success).toBe(true);
  });

  it('accepts a mask written before ranges existed and reads it as painted-only', () => {
    const payload = defaultPhotoPayload();
    const legacy = {
      ...document,
      studioPayload: {
        ...payload,
        mask: { strokes: [], inverted: true },
      },
    };
    const parsed = forgeDocumentSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const mask = parsed.data.studioPayload;
    if (mask?.kind !== 'photo') throw new Error('expected a photo payload');
    expect(mask.mask?.ranges).toBeUndefined();
  });

  it('rejects range selections that cannot describe a region', () => {
    const payload = defaultPhotoPayload();
    const invalidColour = {
      ...document,
      studioPayload: {
        ...payload,
        mask: {
          strokes: [],
          inverted: false,
          ranges: [
            { id: 'range-1', kind: 'colour', colour: 'hsl(1,2,3)', tolerance: 0.1, feather: 0 },
          ],
        },
      },
    };
    expect(forgeDocumentSchema.safeParse(invalidColour).success).toBe(false);

    const backwards = {
      ...document,
      studioPayload: {
        ...payload,
        mask: {
          strokes: [],
          inverted: false,
          ranges: [{ id: 'range-1', kind: 'luminance', min: 0.9, max: 0.1, feather: 0 }],
        },
      },
    };
    expect(forgeDocumentSchema.safeParse(backwards).success).toBe(false);

    const tooFeathered = {
      ...document,
      studioPayload: {
        ...payload,
        mask: {
          strokes: [],
          inverted: false,
          ranges: [{ id: 'range-1', kind: 'luminance', min: 0, max: 1, feather: 2 }],
        },
      },
    };
    expect(forgeDocumentSchema.safeParse(tooFeathered).success).toBe(false);
  });

  it('rejects a video clip that points at a source shorter than its in-point', () => {
    const invalid = {
      ...document,
      documentTypeId: typeId('video.timeline'),
      studioId: 'video',
      studioPayload: {
        ...defaultVideoPayload(),
        duration: 4000,
      },
    };
    expect(forgeDocumentSchema.safeParse(invalid).success).toBe(false);
  });
});
