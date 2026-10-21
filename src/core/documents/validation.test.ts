import { describe, expect, it } from 'vitest';

import { MAX_LAYERS, MAX_LAYER_NAME_LENGTH, MAX_TEXT_LENGTH } from './layer-types';
import type { FontStackId, FontWeight, TextAlignment } from './layer-types';
import {
  fitsWithinCanvasLimits,
  isDocumentStructurallySound,
  validateCanvas,
  validateGuides,
  validateImageSettings,
  validateLayer,
  validateLayerFrame,
  validateScene,
  validateShapeSettings,
  validateTextSettings,
  validateTitle,
} from './validation';
import { createRect } from './geometry';
import { DEFAULT_CANVAS, DEFAULT_GUIDES } from './factories';
import { MAX_DOCUMENT_TAGS, MAX_SUMMARY_LENGTH, MAX_TAG_LENGTH } from './types';
import {
  documentFixture,
  ellipseLayer,
  imageLayer,
  rectLayer,
  sceneOf,
  stackOf,
  textLayer,
} from '../../testing/layers';

const fields = (issues: readonly { field: string }[]) => issues.map((issue) => issue.field);

describe('canvas and document field validation', () => {
  it('accepts the default canvas and rejects impossible ones with a field each', () => {
    expect(validateCanvas(DEFAULT_CANVAS)).toEqual([]);
    expect(fitsWithinCanvasLimits(DEFAULT_CANVAS)).toBe(true);

    const tiny = validateCanvas({ ...DEFAULT_CANVAS, width: 4 });
    expect(fields(tiny)).toContain('canvas');
    expect(tiny[0]?.message).toMatch(/at least/i);

    const huge = validateCanvas({ ...DEFAULT_CANVAS, width: Number.NaN });
    expect(fields(huge)).toContain('canvas');
    expect(fields(huge)).toContain('canvas');

    const fractional = validateCanvas({ ...DEFAULT_CANVAS, height: 2000.5 });
    expect(fractional.map((issue) => issue.message).join(' ')).toMatch(/whole pixels/i);

    expect(fields(validateCanvas({ ...DEFAULT_CANVAS, dpi: 10 }))).toEqual(['dpi']);
    expect(fields(validateCanvas({ ...DEFAULT_CANVAS, background: 'navy' }))).toEqual([
      'background',
    ]);
  });

  it('validates guides, titles and non-finite numbers without throwing', () => {
    expect(validateGuides(DEFAULT_GUIDES)).toEqual([]);
    expect(fields(validateGuides({ ...DEFAULT_GUIDES, safeMarginMm: -1 }))).toEqual([
      'safeMarginMm',
    ]);
    expect(fields(validateGuides({ ...DEFAULT_GUIDES, bleedMm: 60 }))).toEqual(['bleedMm']);
    expect(fields(validateGuides({ ...DEFAULT_GUIDES, gridMm: Number.NaN }))).toEqual(['gridMm']);

    expect(validateTitle('  Poster  ')).toEqual([]);
    expect(fields(validateTitle('   '))).toEqual(['title']);
    expect(validateTitle('x'.repeat(121))[0]?.message).toMatch(/120 characters/);
  });
});

describe('layer frame validation', () => {
  it('accepts a frame that sits on the canvas and inside the coordinate limits', () => {
    expect(
      validateLayerFrame(createRect(0, 0, DEFAULT_CANVAS.width, DEFAULT_CANVAS.height)),
    ).toEqual([]);
    // A layer may be parked partly off the canvas on purpose.
    expect(validateLayerFrame(createRect(-400, -250, 120, 90))).toEqual([]);
  });

  it('reports one issue per offending field with the limit in the message', () => {
    const offCanvas = validateLayerFrame(createRect(90_000, -90_000, 10, 10));
    expect(fields(offCanvas)).toEqual(['x', 'y']);
    expect(offCanvas[0]?.message).toMatch(/between -40000 and 40000/);

    const tooSmall = validateLayerFrame(createRect(0, 0, 0, 1));
    expect(fields(tooSmall)).toEqual(['width']);
    expect(tooSmall[0]?.message).toMatch(/at least 1 px|between 1 and 20000 px/i);

    const tooLarge = validateLayerFrame(createRect(0, 0, 20_001, 30_000));
    expect(fields(tooLarge)).toEqual(['width', 'height']);

    expect(fields(validateLayerFrame(createRect(Number.NaN, 0, 10, 10)))).toEqual(['x']);
  });
});

describe('text, shape and image settings validation', () => {
  const text = textLayer('lyr-text').text;
  const shape = rectLayer('lyr-rect').shape;
  const image = imageLayer('lyr-image').image;

  it('accepts the defaults these settings are created with', () => {
    expect(validateTextSettings(text)).toEqual([]);
    expect(validateShapeSettings(shape)).toEqual([]);
    expect(validateImageSettings(image)).toEqual([]);
  });

  it('names the exact text field that is wrong', () => {
    expect(fields(validateTextSettings({ ...text, fontSize: 2 }))).toEqual(['fontSize']);
    expect(fields(validateTextSettings({ ...text, lineHeight: 9 }))).toEqual(['lineHeight']);
    expect(fields(validateTextSettings({ ...text, letterSpacing: 900 }))).toEqual([
      'letterSpacing',
    ]);
    expect(fields(validateTextSettings({ ...text, color: 'orange' }))).toEqual(['color']);
    expect(fields(validateTextSettings({ ...text, fontStackId: 'comic' as FontStackId }))).toEqual([
      'fontStackId',
    ]);
    expect(fields(validateTextSettings({ ...text, align: 'middle' as TextAlignment }))).toEqual([
      'align',
    ]);
    expect(fields(validateTextSettings({ ...text, fontWeight: 950 as FontWeight }))).toEqual([
      'fontWeight',
    ]);

    const long = validateTextSettings({ ...text, content: 'x'.repeat(MAX_TEXT_LENGTH + 1) });
    expect(fields(long)).toEqual(['content']);
    expect(long[0]?.message).toMatch(/5,000 characters/);

    const several = validateTextSettings({ ...text, fontSize: 2, color: 'orange' });
    expect(fields(several)).toEqual(['fontSize', 'color']);
  });

  it('validates shape colours, stroke width and corner radius', () => {
    expect(fields(validateShapeSettings({ ...shape, fill: 'rgba(0,0,0,0.5)' }))).toEqual(['fill']);
    expect(fields(validateShapeSettings({ ...shape, strokeWidth: -1 }))).toEqual(['strokeWidth']);
    expect(fields(validateShapeSettings({ ...shape, cornerRadius: 9_000 }))).toEqual([
      'cornerRadius',
    ]);
    // A shape with no fill and no stroke is deliberate, not an error.
    expect(validateShapeSettings({ ...shape, fill: null, stroke: null })).toEqual([]);
  });

  it('validates image sources, tints and intrinsic sizes', () => {
    expect(fields(validateImageSettings({ ...image, href: 'javascript:alert(1)' }))).toEqual([
      'href',
    ]);
    expect(fields(validateImageSettings({ ...image, href: '/forge-assets/a b.svg' }))).toEqual([
      'href',
    ]);
    expect(fields(validateImageSettings({ ...image, href: 'https://example.com/a.png' }))).toEqual(
      [],
    );
    expect(
      fields(validateImageSettings({ ...image, href: 'data:image/png;base64,iVBORw0KGgo=' })),
    ).toEqual([]);
    // Inline markup in a source is refused, so an unescaped data URL cannot smuggle a tag.
    expect(
      fields(validateImageSettings({ ...image, href: 'data:image/svg+xml;utf8,<svg/>' })),
    ).toEqual(['href']);
    expect(fields(validateImageSettings({ ...image, tint: 'red' }))).toEqual(['tint']);
    expect(validateImageSettings({ ...image, tint: null })).toEqual([]);
    expect(fields(validateImageSettings({ ...image, intrinsicWidth: -1 }))).toEqual([
      'intrinsicWidth',
    ]);
    expect(fields(validateImageSettings({ ...image, assetId: 'a'.repeat(81) }))).toEqual([
      'assetId',
    ]);
  });
});

describe('validateLayer and validateScene', () => {
  it('combines frame, name, opacity and the settings for the layer type only', () => {
    const broken = {
      ...textLayer('lyr-text'),
      frame: createRect(90_000, 0, 10, 10),
      name: '   ',
      opacity: 2,
      text: { ...textLayer('lyr-text').text, color: 'orange' },
    };
    expect(fields(validateLayer(broken))).toEqual(['x', 'name', 'opacity', 'color']);

    // A rectangle never reports text-only fields.
    expect(fields(validateLayer(rectLayer('lyr-rect')))).toEqual([]);
    expect(fields(validateLayer(ellipseLayer('lyr-ellipse')))).toEqual([]);
    expect(fields(validateLayer(imageLayer('lyr-image')))).toEqual([]);
  });

  it('rejects a layer name longer than the limit', () => {
    const layer = { ...rectLayer('lyr-rect'), name: 'n'.repeat(MAX_LAYER_NAME_LENGTH + 1) };
    expect(fields(validateLayer(layer))).toEqual(['name']);
  });

  it('keys per-layer issues by layer id so a form can highlight the right field', () => {
    const scene = sceneOf(rectLayer('lyr-good'), {
      ...rectLayer('lyr-bad'),
      frame: createRect(0, 0, 0, 10),
    });
    const issues = validateScene(scene);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe('layers.lyr-bad.width');
  });

  it('catches duplicate ids, which every selection and reorder depends on', () => {
    const scene = sceneOf(rectLayer('lyr-dup'), rectLayer('lyr-dup', { x: 20 }));
    const issues = validateScene(scene);
    expect(fields(issues)).toEqual(['id']);
    expect(issues[0]?.message).toMatch(/used more than once/);
  });

  it('enforces the layer count limit and accepts an empty scene', () => {
    expect(validateScene(sceneOf())).toEqual([]);
    expect(validateScene(stackOf(MAX_LAYERS))).toEqual([]);

    const over = validateScene(stackOf(MAX_LAYERS + 1));
    expect(fields(over)).toEqual(['layers']);
    expect(over[0]?.message).toMatch(/at most 200 layers/);
  });

  it('makes a document with an unsound scene fail the cheap structural check', () => {
    const sound = documentFixture({ scene: sceneOf(rectLayer('lyr-rect')) });
    expect(isDocumentStructurallySound(sound)).toBe(true);

    const unsound = { ...sound, scene: sceneOf({ ...rectLayer('lyr-rect'), opacity: 5 }) };
    expect(isDocumentStructurallySound(unsound)).toBe(false);
  });

  it('refuses a document the schema would not read back', () => {
    const sound = documentFixture({ scene: sceneOf(rectLayer('lyr-rect')) });
    expect(isDocumentStructurallySound(sound)).toBe(true);

    // A tag longer than the schema allows: the gate has to catch it here, or the application saves
    // a document it is then going to refuse to read, and the project disappears from the library.
    const longTag = {
      ...sound,
      metadata: { ...sound.metadata, tags: ['x'.repeat(MAX_TAG_LENGTH + 1)] },
    };
    expect(isDocumentStructurallySound(longTag)).toBe(false);

    const tooManyTags = {
      ...sound,
      metadata: {
        ...sound.metadata,
        tags: Array.from({ length: MAX_DOCUMENT_TAGS + 1 }, (_, index) => `tag-${String(index)}`),
      },
    };
    expect(isDocumentStructurallySound(tooManyTags)).toBe(false);

    const longSummary = { ...sound, summary: 'x'.repeat(MAX_SUMMARY_LENGTH + 1) };
    expect(isDocumentStructurallySound(longSummary)).toBe(false);
  });
});
