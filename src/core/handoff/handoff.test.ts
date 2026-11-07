/**
 * Carrying work between studios, tested at the boundary that matters: a handoff has to produce a
 * document that the real factory accepts, or the interface would offer a control that fails.
 *
 * Every assertion below is about what survives the move. A handoff that quietly dropped a layer, a
 * licence or the palette would still "work" in the sense of creating a document, which is exactly
 * why the carrying and the losing are both spelled out as data and checked here.
 */

import { describe, expect, it } from 'vitest';

import {
  carriedTitle,
  derivedWorks,
  handoffRasterScale,
  handoffRasterSize,
  handoffTargets,
  toMotionDocument,
  toPhotoDocument,
} from './handoff';
import { createDocument, DEFAULT_CANVAS, DEFAULT_GUIDES } from '../documents/factories';
import type { AttributionRecord, Layer } from '../documents/layer-types';
import { MAX_PHOTO_WORKING_EDGE } from '../documents/payload';
import type { ForgeDocument } from '../documents/types';
import { brand } from '../types/brand';

const AT = '2026-11-07T10:00:00.000Z';

function textLayer(id: string, text: string, x: number): Layer {
  return {
    id: brand<'LayerId'>(id),
    name: text,
    visible: true,
    locked: false,
    opacity: 1,
    frame: { x, y: 0, width: 200, height: 60 },
    type: 'text',
    text: {
      content: text,
      fontStackId: 'sans',
      fontSize: 32,
      fontWeight: 600,
      lineHeight: 1.2,
      letterSpacing: 0,
      align: 'left',
      color: '#ffffff',
    },
  } as Layer;
}

const ATTRIBUTION: AttributionRecord = {
  id: 'attr-1',
  assetId: 'asset-grid-01',
  assetName: 'Studio grid',
  assetKind: 'graphic',
  licenseId: 'cc0',
  licenseName: 'CC0 1.0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  attributionRequired: false,
  commercialUse: true,
  author: 'Repository authors',
  source: 'Repository-authored sample',
  verified: true,
  notes: '',
  placedAt: AT,
};

function design(overrides: Partial<Parameters<typeof createDocument>[0]> = {}): ForgeDocument {
  const created = createDocument(
    {
      title: 'Field audit',
      studioId: 'design',
      documentTypeId: brand<'DocumentTypeId'>('design.canvas'),
      canvas: { ...DEFAULT_CANVAS, width: 1080, height: 1350 },
      guides: { ...DEFAULT_GUIDES, safeMarginMm: 8 },
      palette: ['#ff8a3d', '#101418'],
      tags: ['poster', 'audit'],
      scene: { layers: [textLayer('lyr-a', 'Field audit', 40), textLayer('lyr-b', '2026', 40)] },
      attribution: [ATTRIBUTION],
      ...overrides,
    },
    { generateId: () => 'doc-source', now: () => new Date(AT) },
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

describe('which studios a design can be carried to', () => {
  it('offers Motion and Photo for a design canvas', () => {
    expect(handoffTargets(design()).map((target) => target.id)).toEqual(['motion', 'photo']);
  });

  it('offers nothing from a studio whose work the others cannot take', () => {
    const photo = createDocument(
      {
        title: 'Portrait',
        studioId: 'photo',
        documentTypeId: brand<'DocumentTypeId'>('photo.image'),
        canvas: DEFAULT_CANVAS,
      },
      { generateId: () => 'doc-photo' },
    );
    if (!photo.ok) throw new Error(photo.error.message);
    expect(handoffTargets(photo.value)).toEqual([]);
  });

  it('states what each target loses before the work is carried', () => {
    for (const target of handoffTargets(design())) {
      expect(target.carries.length, target.id).toBeGreaterThan(0);
      expect(target.loses.length, target.id).toBeGreaterThan(0);
      for (const line of [...target.carries, ...target.loses]) {
        expect(line.length, `${target.id}: ${line}`).toBeGreaterThan(10);
      }
    }
    // The flattening is the one loss a user could be surprised by, so it has to be named.
    expect(handoffTargets(design())[1]?.loses.join(' ')).toMatch(/layers cannot be recovered/i);
  });
});

describe('rasterising for Photo Studio', () => {
  it('renders at 1x when the artboard is already inside the working-copy cap', () => {
    const source = design();
    expect(handoffRasterScale(source)).toBe(1);
    expect(handoffRasterSize(source)).toEqual({ width: 1080, height: 1350 });
  });

  it('scales a large artboard down to the cap rather than rendering pixels Photo would discard', () => {
    const source = design({ canvas: { ...DEFAULT_CANVAS, width: 4000, height: 2000 } });
    expect(handoffRasterScale(source)).toBeCloseTo(MAX_PHOTO_WORKING_EDGE / 4000, 10);
    expect(handoffRasterSize(source)).toEqual({ width: 2048, height: 1024 });
  });

  it('never upscales a small artboard', () => {
    const source = design({ canvas: { ...DEFAULT_CANVAS, width: 320, height: 240 } });
    expect(handoffRasterSize(source)).toEqual({ width: 320, height: 240 });
  });
});

describe('carrying a design into Motion Studio', () => {
  const source = design();
  const input = toMotionDocument(source, { at: AT });

  it('produces a document the factory accepts', () => {
    const created = createDocument(input, { generateId: () => 'doc-motion' });
    expect(created.ok).toBe(true);
  });

  it('keeps every layer, in order, still editable', () => {
    const created = createDocument(input, { generateId: () => 'doc-motion' });
    if (!created.ok) throw new Error(created.error.message);
    expect(created.value.scene.layers.map((layer) => layer.id)).toEqual(['lyr-a', 'lyr-b']);
    expect(created.value.documentTypeId).toBe('motion.scene');
    expect(created.value.studioPayload?.kind).toBe('motion');
    if (created.value.studioPayload?.kind !== 'motion') return;
    expect(created.value.studioPayload.tracks).toEqual([]);
  });

  it('keeps the canvas, guides, palette, tags and placement licences', () => {
    const created = createDocument(input, { generateId: () => 'doc-motion' });
    if (!created.ok) throw new Error(created.error.message);
    expect(created.value.canvas).toEqual(source.canvas);
    expect(created.value.guides).toEqual(source.guides);
    expect(created.value.palette).toEqual(source.palette);
    expect(created.value.metadata.tags).toEqual(['poster', 'audit']);
    expect(created.value.attribution).toEqual([ATTRIBUTION]);
  });

  it('records where the work came from, and what was carried', () => {
    const created = createDocument(input, { generateId: () => 'doc-motion' });
    if (!created.ok) throw new Error(created.error.message);
    expect(created.value.lineage).toEqual({
      sourceDocumentId: 'doc-source',
      sourceTitle: 'Field audit',
      sourceStudioId: 'design',
      sourceDocumentTypeId: 'design.canvas',
      operation: 'scene-copy',
      at: AT,
    });
  });

  it('copies the layers instead of sharing them with the source', () => {
    const created = createDocument(input, { generateId: () => 'doc-motion' });
    if (!created.ok) throw new Error(created.error.message);
    expect(created.value.scene.layers[0]).not.toBe(source.scene.layers[0]);
    expect(created.value.scene).not.toBe(source.scene);
  });
});

describe('carrying a design into Photo Studio', () => {
  const source = design();
  const PHOTO_SOURCE = {
    name: 'Field audit.png',
    href: 'data:image/png;base64,AAAA',
    width: 1080,
    height: 1350,
    mimeType: 'image/png' as const,
    originalWidth: 1080,
    originalHeight: 1350,
  };
  const input = toPhotoDocument(source, PHOTO_SOURCE, { at: AT });

  it('produces a document the factory accepts', () => {
    const created = createDocument(input, { generateId: () => 'doc-photo' });
    expect(created.ok).toBe(true);
  });

  it('stores the raster as the photo source and sizes the canvas to it', () => {
    const created = createDocument(input, { generateId: () => 'doc-photo' });
    if (!created.ok) throw new Error(created.error.message);
    const payload = created.value.studioPayload;
    expect(payload?.kind).toBe('photo');
    if (payload?.kind !== 'photo') return;
    expect(payload.source?.href).toBe('data:image/png;base64,AAAA');
    expect(payload.source?.width).toBe(1080);
    expect(payload.source?.height).toBe(1350);
    expect(payload.source?.mimeType).toBe('image/png');
    // The flattening is real: the carried document has no layers at all.
    expect(created.value.scene.layers).toEqual([]);
    expect(created.value.canvas.width).toBe(1080);
    expect(created.value.canvas.height).toBe(1350);
  });

  it('records the flattening as the operation, not as a scene copy', () => {
    const created = createDocument(input, { generateId: () => 'doc-photo' });
    if (!created.ok) throw new Error(created.error.message);
    expect(created.value.lineage?.operation).toBe('raster');
    expect(created.value.lineage?.sourceDocumentId).toBe('doc-source');
  });

  it('keeps the palette as a record of the colours the artboard used', () => {
    const created = createDocument(input, { generateId: () => 'doc-photo' });
    if (!created.ok) throw new Error(created.error.message);
    expect(created.value.palette).toEqual(source.palette);
  });
});

describe('titles for carried work', () => {
  it('marks the new project so the library can tell the two apart', () => {
    expect(carriedTitle(design(), 'motion')).toBe('Field audit — motion');
    expect(carriedTitle(design(), 'retouch')).toBe('Field audit — retouch');
  });

  it('keeps the suffix when the source title is long enough to overflow the limit', () => {
    const long = design({ title: 'A'.repeat(120) });
    const title = carriedTitle(long, 'retouch');
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith('— retouch')).toBe(true);
  });

  it('survives a title that is already at the limit', () => {
    const title = carriedTitle(design({ title: 'Short' }), 'motion');
    expect(title).toBe('Short — motion');
  });
});

describe('the projects a document has been carried into', () => {
  function carriedChild(
    suffix: 'motion' | 'retouch',
    id: string,
    at: string,
    overrides: Partial<Parameters<typeof createDocument>[0]> = {},
  ): ForgeDocument {
    const source = design();
    const input =
      suffix === 'motion'
        ? toMotionDocument(source, { at })
        : toPhotoDocument(
            source,
            {
              name: 'Field audit.png',
              href: 'data:image/png;base64,AAAA',
              width: 1080,
              height: 1350,
              mimeType: 'image/png',
              originalWidth: 1080,
              originalHeight: 1350,
            },
            { at },
          );
    const created = createDocument(
      { ...input, ...overrides },
      { generateId: () => id, now: () => new Date(at) },
    );
    if (!created.ok) throw new Error(created.error.message);
    return created.value;
  }

  it('finds the copies, newest first, and ignores unrelated projects', () => {
    const source = design();
    const older = carriedChild('motion', 'doc-older', '2026-11-07T10:00:00.000Z');
    const newer = carriedChild('retouch', 'doc-newer', '2026-11-07T11:00:00.000Z');
    const unrelated = design({ title: 'Field audit' });
    expect(
      derivedWorks(source, [source, older, newer, unrelated]).map((entry) => entry.id),
    ).toEqual(['doc-newer', 'doc-older']);
  });

  it('is empty for a project nothing has been carried from', () => {
    const source = design();
    expect(derivedWorks(source, [source])).toEqual([]);
    // A copy is not its own descendant, and its lineage points the other way.
    const child = carriedChild('motion', 'doc-child', AT);
    expect(derivedWorks(child, [source, child])).toEqual([]);
  });

  it('orders copies made in the same millisecond by title, not by library order', () => {
    const source = design();
    const first = carriedChild('motion', 'doc-a', AT);
    const second = carriedChild('retouch', 'doc-b', AT);
    expect(derivedWorks(source, [second, first]).map((entry) => entry.title)).toEqual([
      'Field audit — motion',
      'Field audit — retouch',
    ]);
  });
});
