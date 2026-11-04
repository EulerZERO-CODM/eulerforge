import { describe, expect, it } from 'vitest';

import { canvasSchema, createDocumentInputSchema, forgeDocumentSchema } from './schema';
import { DEFAULT_CANVAS, DEFAULT_GUIDES } from './factories';
import { CURRENT_SCHEMA_VERSION } from './migrations';
import { brand } from '../types/brand';

const documentTypeId = brand<'DocumentTypeId'>('design.canvas');

const validInput = {
  title: 'Launch poster',
  studioId: 'design',
  documentTypeId,
  canvas: DEFAULT_CANVAS,
};

describe('canvasSchema', () => {
  it('accepts the default canvas', () => {
    expect(canvasSchema.safeParse(DEFAULT_CANVAS).success).toBe(true);
  });

  it('rejects fractional pixel dimensions', () => {
    const result = canvasSchema.safeParse({ ...DEFAULT_CANVAS, width: 1080.5 });
    expect(result.success).toBe(false);
  });

  it('rejects canvases below the minimum and above the maximum size', () => {
    expect(canvasSchema.safeParse({ ...DEFAULT_CANVAS, width: 8 }).success).toBe(false);
    expect(canvasSchema.safeParse({ ...DEFAULT_CANVAS, height: 20_001 }).success).toBe(false);
  });

  it('rejects a DPI outside the supported range', () => {
    expect(canvasSchema.safeParse({ ...DEFAULT_CANVAS, dpi: 12 }).success).toBe(false);
    expect(canvasSchema.safeParse({ ...DEFAULT_CANVAS, dpi: 2400 }).success).toBe(false);
  });

  it('rejects colour values that are not six-digit hex', () => {
    expect(canvasSchema.safeParse({ ...DEFAULT_CANVAS, background: 'rebeccapurple' }).success).toBe(
      false,
    );
    expect(canvasSchema.safeParse({ ...DEFAULT_CANVAS, background: '#abc' }).success).toBe(false);
  });
});

describe('createDocumentInputSchema', () => {
  it('accepts a minimal input and trims the title', () => {
    const parsed = createDocumentInputSchema.parse({ ...validInput, title: '  Poster  ' });
    expect(parsed.title).toBe('Poster');
  });

  it('rejects an empty title so every document has a name', () => {
    const result = createDocumentInputSchema.safeParse({ ...validInput, title: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects more than twelve tags', () => {
    const result = createDocumentInputSchema.safeParse({
      ...validInput,
      tags: Array.from({ length: 13 }, (_, index) => `tag-${index}`),
    });
    expect(result.success).toBe(false);
  });

  it('accepts partial guide overrides', () => {
    const parsed = createDocumentInputSchema.parse({ ...validInput, guides: { showGrid: true } });
    expect(parsed.guides).toEqual({ showGrid: true });
  });
});

describe('forgeDocumentSchema', () => {
  const document = {
    id: brand<'DocumentId'>('doc-test'),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    studioId: 'design',
    documentTypeId,
    title: 'Launch poster',
    summary: '',
    canvas: DEFAULT_CANVAS,
    guides: DEFAULT_GUIDES,
    palette: ['#ff8a3d'],
    scene: { layers: [] },
    attribution: [],
    metadata: { authorLabel: '', tags: [], notes: '' },
    status: 'draft',
    revision: 1,
    studioPayload: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as const;

  it('accepts a complete document', () => {
    expect(forgeDocumentSchema.safeParse(document).success).toBe(true);
  });

  it('rejects a studio payload on a document type that does not use one', () => {
    const result = forgeDocumentSchema.safeParse({
      ...document,
      studioPayload: {
        kind: 'motion',
        version: 1,
        duration: 5,
        fps: 30,
        tracks: [],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects timestamps that are not ISO datetimes', () => {
    expect(forgeDocumentSchema.safeParse({ ...document, createdAt: 'yesterday' }).success).toBe(
      false,
    );
  });

  it('rejects a revision below one', () => {
    expect(forgeDocumentSchema.safeParse({ ...document, revision: 0 }).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(forgeDocumentSchema.safeParse({ ...document, status: 'shipped' }).success).toBe(false);
  });
});
