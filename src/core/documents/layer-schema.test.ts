import { describe, expect, it } from 'vitest';

import {
  attributionRecordSchema,
  attributionSchema,
  imageLayerSchema,
  layerSchema,
  sceneSchema,
  textLayerSchema,
} from './schema';
import { MAX_LAYERS, MAX_LAYER_SIZE, MAX_TEXT_LENGTH, PATH_TEXT_LIMITS } from './layer-types';
import { attributionRecord, imageLayer, rectLayer, sceneOf, textLayer } from '../../testing/layers';

describe('layerSchema', () => {
  it('accepts each supported layer type', () => {
    expect(layerSchema.safeParse(textLayer('lyr-text')).success).toBe(true);
    expect(layerSchema.safeParse(rectLayer('lyr-rect')).success).toBe(true);
    expect(layerSchema.safeParse(imageLayer('lyr-image')).success).toBe(true);
  });

  it('rejects an unsupported layer type instead of ignoring it', () => {
    const result = layerSchema.safeParse({ ...rectLayer('lyr-rect'), type: 'video' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing required property', () => {
    const { visible: _visible, ...withoutVisibility } = rectLayer('lyr-rect');
    const result = layerSchema.safeParse(withoutVisibility);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'visible')).toBe(true);
    }
  });

  it('rejects a non-finite frame that JSON could not round-trip', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = layerSchema.safeParse({
        ...rectLayer('lyr-rect'),
        frame: { x: value, y: 0, width: 10, height: 10 },
      });
      expect(result.success).toBe(false);
    }
  });

  it('rejects degenerate and oversized frames', () => {
    const base = rectLayer('lyr-rect');
    expect(
      layerSchema.safeParse({ ...base, frame: { x: 0, y: 0, width: 0, height: 10 } }).success,
    ).toBe(false);
    expect(
      layerSchema.safeParse({
        ...base,
        frame: { x: 0, y: 0, width: MAX_LAYER_SIZE + 1, height: 10 },
      }).success,
    ).toBe(false);
  });

  it('rejects opacity outside 0–1', () => {
    const base = rectLayer('lyr-rect');
    expect(layerSchema.safeParse({ ...base, opacity: 1.4 }).success).toBe(false);
    expect(layerSchema.safeParse({ ...base, opacity: -0.1 }).success).toBe(false);
  });

  it('rejects an empty or overlong layer name', () => {
    const base = rectLayer('lyr-rect');
    expect(layerSchema.safeParse({ ...base, name: '   ' }).success).toBe(false);
    expect(layerSchema.safeParse({ ...base, name: 'x'.repeat(81) }).success).toBe(false);
  });

  it('rejects a layer id that is not an id', () => {
    expect(layerSchema.safeParse({ ...rectLayer('lyr-rect'), id: 'not a valid id!' }).success).toBe(
      false,
    );
  });
});

describe('textLayerSchema', () => {
  it('rejects a font size outside the supported range', () => {
    const layer = textLayer('lyr-text');
    if (layer.type !== 'text') throw new Error('fixture must be text');
    const result = textLayerSchema.safeParse({
      ...layer,
      text: { ...layer.text, fontSize: 2 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects text longer than the documented limit', () => {
    const layer = textLayer('lyr-text');
    if (layer.type !== 'text') throw new Error('fixture must be text');
    const result = textLayerSchema.safeParse({
      ...layer,
      text: { ...layer.text, content: 'x'.repeat(MAX_TEXT_LENGTH + 1) },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown font stack, alignment or weight', () => {
    const layer = textLayer('lyr-text');
    if (layer.type !== 'text') throw new Error('fixture must be text');
    expect(
      textLayerSchema.safeParse({ ...layer, text: { ...layer.text, fontStackId: 'comic' } })
        .success,
    ).toBe(false);
    expect(
      textLayerSchema.safeParse({ ...layer, text: { ...layer.text, align: 'justify' } }).success,
    ).toBe(false);
    expect(
      textLayerSchema.safeParse({ ...layer, text: { ...layer.text, fontWeight: 950 } }).success,
    ).toBe(false);
  });

  it('rejects a colour that is not six-digit hex', () => {
    const layer = textLayer('lyr-text');
    if (layer.type !== 'text') throw new Error('fixture must be text');
    expect(
      textLayerSchema.safeParse({ ...layer, text: { ...layer.text, color: '#fff' } }).success,
    ).toBe(false);
  });
});

describe('path text schema', () => {
  const square = {
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
  };
  const style = {
    fill: '#22cc88',
    fillRule: 'nonzero',
    fillOpacity: 1,
    stroke: null,
    strokeWidth: 1,
    strokeOpacity: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    dashArray: [],
  };
  const run = {
    content: 'Stored run',
    fontSize: 24,
    letterSpacing: 1,
    startOffset: 0.25,
    baseline: 'below',
    colour: '#112233',
    fontStackId: 'mono',
  };

  function pathLayerWith(text: unknown) {
    return {
      id: 'lyr-path-text',
      name: 'Arc',
      type: 'path',
      visible: true,
      locked: false,
      opacity: 1,
      frame: { x: 0, y: 0, width: 10, height: 10 },
      vector: { path: square, style, text },
    };
  }

  it('accepts a run and accepts its absence', () => {
    expect(layerSchema.safeParse(pathLayerWith(run)).success).toBe(true);
    expect(layerSchema.safeParse(pathLayerWith(null)).success).toBe(true);
    expect(layerSchema.safeParse(pathLayerWith(undefined)).success).toBe(true);
  });

  it('rejects settings outside the documented ranges', () => {
    expect(layerSchema.safeParse(pathLayerWith({ ...run, fontSize: 2 })).success).toBe(false);
    expect(layerSchema.safeParse(pathLayerWith({ ...run, letterSpacing: 500 })).success).toBe(
      false,
    );
    expect(layerSchema.safeParse(pathLayerWith({ ...run, startOffset: 2 })).success).toBe(false);
    expect(
      layerSchema.safeParse(
        pathLayerWith({ ...run, content: 'x'.repeat(PATH_TEXT_LIMITS.maxContentLength + 1) }),
      ).success,
    ).toBe(false);
  });

  it('rejects an unknown baseline, font stack or colour', () => {
    expect(layerSchema.safeParse(pathLayerWith({ ...run, baseline: 'sideways' })).success).toBe(
      false,
    );
    expect(layerSchema.safeParse(pathLayerWith({ ...run, fontStackId: 'comic' })).success).toBe(
      false,
    );
    expect(layerSchema.safeParse(pathLayerWith({ ...run, colour: '#fff' })).success).toBe(false);
  });
});

describe('imageLayerSchema', () => {
  it('allows a layer with no catalogue asset but rejects a script source', () => {
    const layer = imageLayer('lyr-image');
    expect(imageLayerSchema.safeParse(layer).success).toBe(true);
    if (layer.type !== 'image') throw new Error('fixture must be an image');
    expect(
      imageLayerSchema.safeParse({
        ...layer,
        image: { ...layer.image, href: 'javascript:alert(1)' },
      }).success,
    ).toBe(false);
  });

  it('accepts repository-relative, http(s) and data URLs', () => {
    const layer = imageLayer('lyr-image');
    if (layer.type !== 'image') throw new Error('fixture must be an image');
    for (const href of [
      '/forge-assets/thumb-overlap.svg',
      './assets/graphic.svg',
      'https://example.com/graphic.svg',
      'data:image/svg+xml;base64,PHN2Zy8+',
    ]) {
      expect(
        imageLayerSchema.safeParse({ ...layer, image: { ...layer.image, href } }).success,
      ).toBe(true);
    }
  });
});

describe('sceneSchema', () => {
  it('accepts an empty scene and an ordered scene', () => {
    expect(sceneSchema.safeParse({ layers: [] }).success).toBe(true);
    expect(sceneSchema.safeParse(sceneOf(rectLayer('lyr-a'), textLayer('lyr-b'))).success).toBe(
      true,
    );
  });

  it('rejects duplicate layer ids, which would make selection ambiguous', () => {
    const duplicate = { layers: [rectLayer('lyr-same'), rectLayer('lyr-same')] };
    const result = sceneSchema.safeParse(duplicate);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => /duplicate layer id/.test(issue.message))).toBe(
        true,
      );
    }
  });

  it('rejects more layers than the resource limit allows', () => {
    const layers = Array.from({ length: MAX_LAYERS + 1 }, (_, index) => rectLayer(`lyr-${index}`));
    expect(sceneSchema.safeParse({ layers }).success).toBe(false);
  });
});

describe('attributionSchema', () => {
  it('accepts a complete attribution record', () => {
    expect(attributionRecordSchema.safeParse(attributionRecord()).success).toBe(true);
  });

  it('requires the licence and provenance fields attribution depends on', () => {
    const record = attributionRecord();
    const { licenseName: _name, ...withoutLicence } = record;
    expect(attributionRecordSchema.safeParse(withoutLicence).success).toBe(false);
    expect(attributionRecordSchema.safeParse({ ...record, placedAt: 'sometime' }).success).toBe(
      false,
    );
  });

  it('caps the number of records a document may carry', () => {
    const records = Array.from({ length: 101 }, (_, index) =>
      attributionRecord({ id: `attr-${index}`, assetId: `asset-${index}` }),
    );
    expect(attributionSchema.safeParse(records).success).toBe(false);
  });
});
