import { describe, expect, it } from 'vitest';

import { buildRenderPlan, paintableLayers } from './plan';
import { createContextMeasureStub } from '../../testing/render';
import { documentFixture, imageLayer, rectLayer, sceneOf, textLayer } from '../../testing/layers';

const measureFont = createContextMeasureStub();

describe('buildRenderPlan', () => {
  it('keeps layer order as paint order, bottom-most first', () => {
    const document = documentFixture({
      scene: sceneOf(
        rectLayer('lyr-bottom', { name: 'Bottom' }),
        textLayer('lyr-middle', { name: 'Middle' }),
        imageLayer('lyr-top', { name: 'Top' }),
      ),
    });
    const plan = buildRenderPlan(document, {
      measureFont,
      resolveImage: () => ({ image: { width: 100, height: 100 } }),
    });
    expect(plan.ops.map((op) => op.kind)).toEqual(['background', 'rect', 'text', 'image']);
    expect(plan.ops.map((op) => ('layerName' in op ? op.layerName : 'background'))).toEqual([
      'background',
      'Bottom',
      'Middle',
      'Top',
    ]);
  });

  it('takes its size from the document canvas, not from any viewport', () => {
    const document = documentFixture({
      canvas: {
        width: 1920,
        height: 1080,
        unit: 'px',
        dpi: 96,
        background: '#101010',
        transparent: false,
      },
    });
    const plan = buildRenderPlan(document, { measureFont });
    expect(plan.size).toEqual({ width: 1920, height: 1080 });
    expect(plan.ops[0]).toMatchObject({
      kind: 'background',
      color: '#101010',
      frame: { x: 0, y: 0, width: 1920, height: 1080 },
    });
  });

  it('leaves a transparent document without a background operation', () => {
    const document = documentFixture({
      canvas: {
        width: 512,
        height: 512,
        unit: 'px',
        dpi: 96,
        background: '#ffffff',
        transparent: true,
      },
    });
    const plan = buildRenderPlan(document, { measureFont });
    expect(plan.background).toBeNull();
    expect(plan.ops).toHaveLength(0);
  });

  it('honours a background override, as JPEG export needs', () => {
    const transparent = documentFixture({
      canvas: {
        width: 100,
        height: 100,
        unit: 'px',
        dpi: 96,
        background: '#ffffff',
        transparent: true,
      },
    });
    const plan = buildRenderPlan(transparent, { measureFont, backgroundOverride: '#ffffff' });
    expect(plan.background).toBe('#ffffff');
    expect(plan.ops[0]).toMatchObject({ kind: 'background', color: '#ffffff' });
  });

  it('skips hidden layers and fully transparent layers', () => {
    const hidden = rectLayer('lyr-hidden', { visible: false });
    const invisible = { ...rectLayer('lyr-invisible'), opacity: 0 };
    const visible = rectLayer('lyr-visible');
    const plan = buildRenderPlan(documentFixture({ scene: sceneOf(hidden, invisible, visible) }), {
      measureFont,
    });
    expect(plan.ops.filter((op) => op.kind !== 'background').map((op) => op.layerId)).toEqual([
      'lyr-visible',
    ]);
  });

  it('carries shape settings into the plan unchanged', () => {
    const document = documentFixture({
      scene: sceneOf(
        rectLayer('lyr-rect', {
          fill: '#123456',
          stroke: '#ffffff',
          strokeWidth: 6,
          cornerRadius: 12,
        }),
      ),
    });
    const plan = buildRenderPlan(document, { measureFont });
    const op = plan.ops[1];
    expect(op).toMatchObject({
      kind: 'rect',
      shape: { fill: '#123456', stroke: '#ffffff', strokeWidth: 6, cornerRadius: 12 },
      opacity: 1,
    });
  });

  it('lays text out once, so both renderers draw identical lines', () => {
    const document = documentFixture({
      scene: sceneOf(textLayer('lyr-text', { content: 'Hello world', width: 60, height: 200 })),
    });
    const plan = buildRenderPlan(document, { measureFont });
    const op = plan.ops[1];
    expect(op?.kind).toBe('text');
    if (op?.kind !== 'text') throw new Error('expected a text op');
    expect(op.lines.length).toBeGreaterThan(1);
    expect(op.lineHeightPx).toBeGreaterThan(0);
  });

  it('treats an unloaded graphic as a blocking issue and draws nothing for it', () => {
    const document = documentFixture({
      scene: sceneOf(rectLayer('lyr-rect'), imageLayer('lyr-image', { href: '/missing.svg' })),
    });
    const plan = buildRenderPlan(document, {
      measureFont,
      resolveImage: () => undefined,
    });
    expect(plan.blocked).toBe(true);
    expect(plan.ops.some((op) => op.kind === 'image')).toBe(false);
    expect(plan.issues[0]).toMatchObject({ kind: 'image-unavailable', blocking: true });
    expect(plan.issues[0]?.message).toMatch(/could not be drawn/i);
  });

  it('reports the reason a graphic could not be resolved', () => {
    const document = documentFixture({
      scene: sceneOf(imageLayer('lyr-image', { href: '/broken.png' })),
    });
    const plan = buildRenderPlan(document, {
      measureFont,
      resolveImage: () => ({ error: 'the file returned 404' }),
    });
    expect(plan.issues[0]?.message).toContain('the file returned 404');
  });

  it('draws a graphic that resolves and remembers its source', () => {
    const document = documentFixture({
      scene: sceneOf(imageLayer('lyr-image', { href: '/forge-assets/thumb-overlap.svg' })),
    });
    const plan = buildRenderPlan(document, {
      measureFont,
      resolveImage: () => ({ image: { width: 400, height: 300 } }),
    });
    expect(plan.blocked).toBe(false);
    expect(plan.ops[1]).toMatchObject({
      kind: 'image',
      href: '/forge-assets/thumb-overlap.svg',
      image: { width: 400, height: 300 },
    });
  });

  it('flags text overflow as a warning, not as a blockage', () => {
    const document = documentFixture({
      scene: sceneOf(
        textLayer('lyr-text', { content: 'one two three four five six', width: 20, height: 20 }),
      ),
    });
    const plan = buildRenderPlan(document, { measureFont });
    expect(plan.blocked).toBe(false);
    expect(plan.issues.map((issue) => issue.kind)).toContain('text-overflow');
  });

  it('flags a shape that cannot draw anything', () => {
    const document = documentFixture({
      scene: sceneOf(rectLayer('lyr-empty', { fill: null, stroke: null })),
    });
    const plan = buildRenderPlan(document, { measureFont });
    expect(plan.issues.map((issue) => issue.kind)).toEqual(['empty-layer']);
    expect(plan.blocked).toBe(false);
  });
});

describe('paintableLayers', () => {
  it('lists the layers that actually contribute output', () => {
    const scene = sceneOf(rectLayer('lyr-a'), rectLayer('lyr-b', { visible: false }), {
      ...rectLayer('lyr-c'),
      opacity: 0,
    });
    expect(paintableLayers(scene).map((layer) => layer.id)).toEqual(['lyr-a']);
  });
});
