import { describe, expect, it } from 'vitest';

import { parseProjectFile, serialiseProjectFile } from '../export/project-file';
import { createDocument } from './factories';
import { addNewLayer, createLayer } from './layer-operations';
import { CURRENT_SCHEMA_VERSION, migrateDocument } from './migrations';
import { forgeDocumentSchema, paintSchema, vectorStyleSchema } from './schema';
import { DEFAULT_CANVAS } from './factories';
import { sceneOf, TEST_DOCUMENT_TYPE } from '../../testing/layers';
import { normaliseVectorStyle } from '../vector/style';
import { parsePathData } from '../vector/path-data';
import type { ForgeDocument } from './types';
import type { PaintSpec } from '../vector/paint';

const gradient: PaintSpec = {
  kind: 'linear-gradient',
  from: { x: 0, y: 0 },
  to: { x: 1, y: 0 },
  stops: [
    { offset: 0, color: '#ff0000' },
    { offset: 1, color: '#0000ff' },
  ],
};

const pattern: PaintSpec = {
  kind: 'pattern',
  motif: 'dots',
  foreground: '#112233',
  background: null,
  scale: 0.25,
  rotation: 15,
};

describe('paintSchema', () => {
  it('accepts every paint kind the editor can store', () => {
    expect(paintSchema.safeParse({ kind: 'solid', color: '#AABBCC' }).success).toBe(true);
    expect(paintSchema.safeParse(gradient).success).toBe(true);
    expect(
      paintSchema.safeParse({
        kind: 'radial-gradient',
        centre: { x: 0.5, y: 0.5 },
        radius: 0.5,
        stops: gradient.kind === 'linear-gradient' ? gradient.stops : [],
      }).success,
    ).toBe(true);
    expect(paintSchema.safeParse(pattern).success).toBe(true);
  });

  it('rejects a gradient with fewer than two stops', () => {
    const single = {
      ...gradient,
      stops: [{ offset: 0, color: '#000000' }],
    };
    expect(paintSchema.safeParse(single).success).toBe(false);
  });

  it('rejects more stops than the limit, and out-of-range offsets', () => {
    const tooMany = {
      ...gradient,
      stops: Array.from({ length: 9 }, (_, index) => ({
        offset: index / 8,
        color: '#000000',
      })),
    };
    expect(paintSchema.safeParse(tooMany).success).toBe(false);
    const offset = {
      ...gradient,
      stops: [
        { offset: -0.1, color: '#000000' },
        { offset: 1, color: '#ffffff' },
      ],
    };
    expect(paintSchema.safeParse(offset).success).toBe(false);
  });

  it('accepts only hex colours, so no CSS expression can be stored as paint', () => {
    for (const color of ['url(#x)', 'rgb(1,2,3)', 'currentColor', '#fff', 'red']) {
      expect(paintSchema.safeParse({ kind: 'solid', color }).success).toBe(false);
    }
  });

  it('rejects an unknown motif, an out-of-range scale and an excessive rotation', () => {
    expect(paintSchema.safeParse({ ...pattern, motif: 'zigzag' }).success).toBe(false);
    expect(paintSchema.safeParse({ ...pattern, scale: 0 }).success).toBe(false);
    expect(paintSchema.safeParse({ ...pattern, scale: 2 }).success).toBe(false);
    expect(paintSchema.safeParse({ ...pattern, rotation: 361 }).success).toBe(false);
  });

  it('rejects a radial radius beyond the supported range and a gradient point that is not finite', () => {
    const base = {
      kind: 'radial-gradient',
      centre: { x: 0.5, y: 0.5 },
      stops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#ffffff' },
      ],
    };
    expect(paintSchema.safeParse({ ...base, radius: 5 }).success).toBe(false);
    expect(paintSchema.safeParse({ ...base, radius: 0.5 }).success).toBe(true);
    expect(
      paintSchema.safeParse({ ...gradient, from: { x: Number.POSITIVE_INFINITY, y: 0 } }).success,
    ).toBe(false);
  });
});

describe('vectorStyleSchema paint fields', () => {
  it('accepts a style written before paint existed', () => {
    const legacy = normaliseVectorStyle({});
    const withoutPaint = { ...legacy } as Record<string, unknown>;
    delete withoutPaint.fillPaint;
    delete withoutPaint.strokePaint;
    expect(vectorStyleSchema.safeParse(withoutPaint).success).toBe(true);
  });

  it('accepts null and a real paint in both slots', () => {
    expect(
      vectorStyleSchema.safeParse({ ...normaliseVectorStyle({}), fillPaint: null }).success,
    ).toBe(true);
    expect(
      vectorStyleSchema.safeParse({ ...normaliseVectorStyle({}), fillPaint: gradient }).success,
    ).toBe(true);
    expect(
      vectorStyleSchema.safeParse({ ...normaliseVectorStyle({}), strokePaint: pattern }).success,
    ).toBe(true);
  });

  it('rejects a malformed paint in a slot', () => {
    expect(
      vectorStyleSchema.safeParse({
        ...normaliseVectorStyle({}),
        fillPaint: { kind: 'linear-gradient', from: { x: 0, y: 0 } },
      }).success,
    ).toBe(false);
  });
});

function pathOf(data: string) {
  const parsed = parsePathData(data);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value.path;
}

function documentWithPaint(fillPaint: PaintSpec | null): ForgeDocument {
  const created = createLayer(
    {
      type: 'path',
      frame: { x: 0, y: 0, width: 10, height: 10 },
      vector: {
        path: pathOf('M10 10 L110 10 L110 60 L10 60 Z'),
        style: { fill: null, fillPaint },
      },
    },
    { name: 'Gradient card', generateId: () => 'lyr-card' },
  );
  if (!created.ok) throw new Error(created.error.message);
  const scene = addNewLayer(sceneOf(), created.value);
  if (!scene.ok) throw new Error(scene.error.message);

  const document = createDocument(
    {
      title: 'Paint project',
      studioId: 'illustration',
      documentTypeId: TEST_DOCUMENT_TYPE,
      canvas: DEFAULT_CANVAS,
      scene: scene.value.scene,
    },
    { generateId: () => 'doc-paint', now: () => new Date('2026-10-19T08:00:00.000Z') },
  );
  if (!document.ok) {
    throw new Error(`${document.error.message} ${document.error.detail ?? ''}`);
  }
  return document.value;
}

describe('paint in a saved document', () => {
  it('writes, reads and validates a path layer with gradient paint', () => {
    const document = documentWithPaint(gradient);
    expect(forgeDocumentSchema.safeParse(document).success).toBe(true);

    const parsed = parseProjectFile(serialiseProjectFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.scene).toEqual(document.scene);

    const layer = parsed.value.scene.layers[0];
    if (layer?.type !== 'path') throw new Error('expected a path layer');
    expect(layer.vector.style.fillPaint).toEqual(gradient);
  });

  it('keeps a pattern through JSON and a migration pass', () => {
    const document = documentWithPaint(pattern);
    const reloaded = JSON.parse(JSON.stringify(document)) as ForgeDocument;
    const migrated = migrateDocument(reloaded);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const layer = migrated.value.scene.layers[0];
    if (layer?.type !== 'path') throw new Error('expected a path layer');
    expect(layer.vector.style.fillPaint).toEqual(pattern);
  });

  it('still loads a document saved before paint existed, with no paint fields', () => {
    const document = documentWithPaint(null);
    const legacy = JSON.parse(JSON.stringify(document)) as Record<string, unknown> & {
      scene: { layers: { vector: { style: Record<string, unknown> } }[] };
    };
    // A v4 file written by the previous release has no `fillPaint`/`strokePaint` keys at all.
    for (const layer of legacy.scene.layers) {
      delete layer.vector.style.fillPaint;
      delete layer.vector.style.strokePaint;
    }
    const parsed = forgeDocumentSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const layer = parsed.data.scene.layers[0];
    if (layer?.type !== 'path') throw new Error('expected a path layer');
    expect(layer.vector.style.fillPaint).toBeUndefined();
    expect(layer.vector.style.fill).toBeNull();
  });
});
