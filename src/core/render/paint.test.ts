import { describe, expect, it } from 'vitest';

import { imageFitScale, imagePlacement, paintPlan, textLineOrigin } from './paint';
import type { ImageOp, PathOp, RenderPlan, TextOp } from './plan';
import { createRecordingContext, STUB_IMAGE } from '../../testing/render';
import { createRect } from '../documents/geometry';
import { defaultShapeSettings, defaultTextSettings } from '../documents/layer-defaults';
import { rectanglePath } from '../vector/shapes';
import { normaliseVectorStyle, type VectorStyle } from '../vector';

function imageOp(overrides: Partial<ImageOp> = {}): ImageOp {
  return {
    kind: 'image',
    layerId: 'lyr-image',
    layerName: 'Graphic',
    frame: createRect(0, 0, 200, 100),
    href: '/forge-assets/sample.svg',
    image: STUB_IMAGE,
    fit: 'contain',
    opacity: 1,
    tint: null,
    ...overrides,
  };
}

function planOf(ops: RenderPlan['ops']): RenderPlan {
  return {
    size: { width: 400, height: 400 },
    background: '#101010',
    ops,
    issues: [],
    blocked: false,
  };
}

describe('paintPlan', () => {
  it('paints operations in plan order, which is the stacking order', () => {
    const { context, names } = createRecordingContext();
    paintPlan(
      context,
      planOf([
        { kind: 'background', color: '#101010', frame: createRect(0, 0, 400, 400) },
        {
          kind: 'rect',
          layerId: 'lyr-a',
          layerName: 'A',
          frame: createRect(0, 0, 50, 50),
          shape: defaultShapeSettings(),
          opacity: 1,
        },
        {
          kind: 'ellipse',
          layerId: 'lyr-b',
          layerName: 'B',
          frame: createRect(10, 10, 50, 50),
          shape: defaultShapeSettings(),
          opacity: 1,
        },
      ]),
      { clear: true },
    );

    const painted = names().filter((name) => name !== 'save' && name !== 'restore');
    expect(painted[0]).toBe('clearRect');
    expect(painted).toContain('fillRect');
    expect(painted).toContain('ellipse');
    // The rectangle is painted before the ellipse: index order is z-order.
    expect(painted.indexOf('moveTo')).toBeLessThan(painted.indexOf('ellipse'));
  });

  it('draws the background across the whole canvas', () => {
    const { context, calls } = createRecordingContext();
    paintPlan(
      context,
      planOf([{ kind: 'background', color: '#abcdef', frame: createRect(0, 0, 300, 200) }]),
      {
        clear: false,
      },
    );
    expect(calls.find((call) => call.op === 'fillRect')?.args).toEqual([0, 0, 300, 200]);
  });

  it('uses a rounded path when a rectangle declares a corner radius', () => {
    const { context, names } = createRecordingContext();
    paintPlan(
      context,
      planOf([
        {
          kind: 'rect',
          layerId: 'lyr-a',
          layerName: 'A',
          frame: createRect(0, 0, 100, 60),
          shape: defaultShapeSettings({ cornerRadius: 24, stroke: '#ffffff', strokeWidth: 4 }),
          opacity: 1,
        },
      ]),
      { clear: false },
    );
    expect(names()).toContain('roundRect');
    // Radius is clamped to half the shorter side, so a rounded rect can never self-intersect.
    expect(names().filter((name) => name === 'roundRect')).toHaveLength(2);
  });

  it('skips a shape that has neither fill nor stroke', () => {
    const { context, names } = createRecordingContext();
    paintPlan(
      context,
      planOf([
        {
          kind: 'rect',
          layerId: 'lyr-a',
          layerName: 'A',
          frame: createRect(0, 0, 10, 10),
          shape: defaultShapeSettings({ fill: null, stroke: null }),
          opacity: 1,
        },
      ]),
      { clear: false },
    );
    expect(names()).toEqual([]);
  });

  it('applies layer opacity and restores the context afterwards', () => {
    const { context, calls, depth } = createRecordingContext();
    paintPlan(
      context,
      planOf([
        {
          kind: 'rect',
          layerId: 'lyr-a',
          layerName: 'A',
          frame: createRect(0, 0, 10, 10),
          shape: defaultShapeSettings(),
          opacity: 0.4,
        },
      ]),
      { clear: false },
    );
    expect(calls.some((call) => call.op === 'save')).toBe(true);
    expect(depth()).toBe(0);
    expect(context.globalAlpha).toBe(1);
    expect(context.globalCompositeOperation).toBe('source-over');
  });

  it('draws a text layer once per non-empty line', () => {
    const { context, calls } = createRecordingContext();
    paintPlan(
      context,
      planOf([
        {
          kind: 'text',
          layerId: 'lyr-text',
          layerName: 'Title',
          frame: createRect(20, 40, 200, 100),
          settings: defaultTextSettings(),
          lines: [
            { text: 'Hello', width: 50 },
            { text: 'world', width: 50 },
          ],
          lineHeightPx: 24,
          overflows: false,
          opacity: 1,
        },
      ]),
      { clear: false },
    );
    const drawn = calls.filter((call) => call.op === 'fillText');
    expect(drawn).toHaveLength(2);
    expect(drawn[0]?.args).toEqual(['Hello', 20, 52]);
    expect(drawn[1]?.args).toEqual(['world', 20, 76]);
    // Nothing was clipped: this text fits, so no glyph is shaved off.
    expect(calls.map((call) => call.op)).not.toContain('clip');
  });

  it('clips a text layer that is taller than its box, which the export report promises', () => {
    const { context, calls } = createRecordingContext();
    paintPlan(
      context,
      planOf([
        {
          kind: 'text',
          layerId: 'lyr-text',
          layerName: 'Body',
          frame: createRect(20, 40, 200, 48),
          settings: defaultTextSettings(),
          lines: [
            { text: 'Hello', width: 50 },
            { text: 'world', width: 50 },
            { text: 'again', width: 50 },
          ],
          lineHeightPx: 24,
          overflows: true,
          opacity: 1,
        },
      ]),
      { clear: false },
    );

    // The clip is the layer's own box, and every line is drawn inside it.
    const clipIndex = calls.findIndex((call) => call.op === 'clip');
    expect(clipIndex).toBeGreaterThan(-1);
    const clipRect = calls.find((call) => call.op === 'rect');
    expect(clipRect?.args).toEqual([20, 40, 200, 48]);
    expect(calls.findIndex((call) => call.op === 'rect')).toBeLessThan(clipIndex);
    for (const call of calls.filter((entry) => entry.op === 'fillText')) {
      expect(calls.indexOf(call)).toBeGreaterThan(clipIndex);
    }
    // The clip is undone with the rest of the layer's state rather than leaking into the next layer.
    const restore = calls.filter((call) => call.op === 'restore');
    expect(restore).toHaveLength(1);
    expect(calls.indexOf(restore[0]!)).toBeGreaterThan(clipIndex);
  });
});

describe('image placement', () => {
  it('contains a square graphic inside a wide frame without squashing it', () => {
    const op = imageOp({
      frame: createRect(0, 0, 200, 100),
      image: { width: 200, height: 200 },
      fit: 'contain',
    });
    expect(imageFitScale('contain', op.image, op.frame)).toBeCloseTo(0.5, 5);
    expect(imagePlacement(op)).toEqual({
      source: { x: 0, y: 0, width: 200, height: 200 },
      // 100 x 100, centred: the whole graphic is visible and the aspect ratio survives.
      destination: { x: 50, y: 0, width: 100, height: 100 },
    });
  });

  it('covers a wide frame, cropping the top and bottom of the graphic', () => {
    const op = imageOp({
      frame: createRect(0, 0, 200, 100),
      image: { width: 200, height: 200 },
      fit: 'cover',
    });
    expect(imageFitScale('cover', op.image, op.frame)).toBeCloseTo(1, 5);
    expect(imagePlacement(op)).toEqual({
      source: { x: 0, y: 50, width: 200, height: 100 },
      destination: { x: 0, y: 0, width: 200, height: 100 },
    });
  });

  it('stretches when asked, taking the whole source into the whole frame', () => {
    const op = imageOp({
      frame: createRect(0, 0, 300, 100),
      image: { width: 100, height: 100 },
      fit: 'stretch',
    });
    expect(imagePlacement(op)).toEqual({
      source: { x: 0, y: 0, width: 100, height: 100 },
      destination: { x: 0, y: 0, width: 300, height: 100 },
    });
  });

  it('offsets a contained graphic inside its frame', () => {
    const op = imageOp({
      frame: createRect(100, 50, 200, 200),
      image: { width: 400, height: 200 },
      fit: 'contain',
    });
    expect(imagePlacement(op).destination).toEqual({ x: 100, y: 100, width: 200, height: 100 });
  });

  it('never divides by an unknown intrinsic size', () => {
    const op = imageOp({ image: { width: 0, height: 0 } });
    expect(imageFitScale('contain', op.image, op.frame)).toBe(1);
    expect(imagePlacement(op)).toEqual({
      source: { x: 0, y: 0, width: 0, height: 0 },
      destination: { x: 0, y: 0, width: 200, height: 100 },
    });
  });

  it('tints with source-atop so transparent graphics stay transparent', () => {
    const { context, calls, depth } = createRecordingContext();
    let modeWhenTinting = '';
    const tracked = {
      ...context,
      get globalCompositeOperation() {
        return context.globalCompositeOperation;
      },
      set globalCompositeOperation(value: string) {
        context.globalCompositeOperation = value;
        if (value === 'source-atop') modeWhenTinting = value;
      },
    };
    paintPlan(tracked, planOf([imageOp({ tint: '#ff8800' })]), { clear: false });

    const drawIndex = calls.findIndex((call) => call.op === 'drawImage');
    const tintIndex = calls.findIndex((call) => call.op === 'fillRect');
    expect(drawIndex).toBeGreaterThanOrEqual(0);
    expect(tintIndex).toBeGreaterThan(drawIndex);
    expect(modeWhenTinting).toBe('source-atop');
    expect(depth()).toBe(0);
  });

  it('forwards the source rectangle in the nine-argument form', () => {
    const { context, calls } = createRecordingContext();
    paintPlan(context, planOf([imageOp()]), { clear: false });
    const call = calls.find((entry) => entry.op === 'drawImage');
    expect(call?.args).toHaveLength(9);
  });
});

describe('textLineOrigin', () => {
  it('mirrors the painter positioning for the selection overlay', () => {
    const op: TextOp = {
      kind: 'text',
      layerId: 'lyr-text',
      layerName: 'Title',
      frame: createRect(100, 200, 400, 60),
      settings: defaultTextSettings({ align: 'center' }),
      lines: [{ text: 'Hello', width: 100 }],
      lineHeightPx: 40,
      overflows: false,
      opacity: 1,
    };
    expect(textLineOrigin(op, 0)).toEqual({ x: 250, y: 220 });
  });
});

describe('paintPath with gradients and patterns', () => {
  const box = { minX: 20, minY: 40, maxX: 120, maxY: 90 } as const; // 100 × 50

  function pathOp(style: Partial<VectorStyle>): PathOp {
    return {
      kind: 'path',
      layerId: 'lyr-path',
      layerName: 'Path',
      frame: createRect(20, 40, 100, 50),
      path: rectanglePath(box),
      style: normaliseVectorStyle({ fill: null, ...style }),
      opacity: 1,
    };
  }

  it('builds a real linear gradient over the shape’s bounds and adds every stop in order', () => {
    const { context, calls, gradients } = createRecordingContext();
    paintPlan(
      context,
      planOf([
        pathOp({
          fillPaint: {
            kind: 'linear-gradient',
            from: { x: 0, y: 0 },
            to: { x: 1, y: 0 },
            stops: [
              { offset: 0, color: '#ff0000' },
              { offset: 1, color: '#0000ff' },
            ],
          },
        }),
      ]),
      { clear: false },
    );

    const created = calls.find((call) => call.op === 'createLinearGradient');
    expect(created?.args).toEqual([20, 40, 120, 40]);
    expect(gradients).toHaveLength(1);
    expect(gradients[0]?.stops).toEqual([
      { offset: 0, color: '#ff0000' },
      { offset: 1, color: '#0000ff' },
    ]);
    expect(calls.some((call) => call.op === 'fill')).toBe(true);
  });

  it('builds a radial gradient with a zero inner radius at the resolved centre', () => {
    const { context, calls, gradients } = createRecordingContext();
    paintPlan(
      context,
      planOf([
        pathOp({
          fillPaint: {
            kind: 'radial-gradient',
            centre: { x: 0.5, y: 0.5 },
            radius: 0.5,
            stops: [
              { offset: 0, color: '#ffffff' },
              { offset: 1, color: '#000000' },
            ],
          },
        }),
      ]),
      { clear: false },
    );

    const created = calls.find((call) => call.op === 'createRadialGradient');
    expect(created?.args).toEqual([70, 65, 0, 70, 65, 25]);
    expect(gradients[0]?.kind).toBe('radial');
    expect(gradients[0]?.stops).toHaveLength(2);
  });

  it('clips to the path and tiles the motif for a pattern fill', () => {
    const { context, calls, names } = createRecordingContext();
    paintPlan(
      context,
      planOf([
        pathOp({
          fillPaint: {
            kind: 'pattern',
            motif: 'stripes',
            foreground: '#112233',
            background: '#ffffff',
            scale: 0.2,
            rotation: 0,
          },
        }),
      ]),
      { clear: false },
    );

    expect(names()).toContain('clip');
    const fillRects = calls.filter((call) => call.op === 'fillRect');
    // One background rectangle plus at least one stripe per tile.
    expect(fillRects.length).toBeGreaterThan(1);
    // The background covers the shape's bounds.
    expect(fillRects[0]?.args).toEqual([20, 40, 100, 50]);
  });

  it('rotates about the bounds centre when the pattern is rotated', () => {
    const { context, calls } = createRecordingContext();
    paintPlan(
      context,
      planOf([
        pathOp({
          fillPaint: {
            kind: 'pattern',
            motif: 'dots',
            foreground: '#112233',
            background: null,
            scale: 0.2,
            rotation: 30,
          },
        }),
      ]),
      { clear: false },
    );

    const translate = calls.filter((call) => call.op === 'translate').map((call) => call.args);
    expect(translate).toContainEqual([70, 65]);
    const rotate = calls.find((call) => call.op === 'rotate');
    expect(rotate?.args[0]).toBeCloseTo((30 * Math.PI) / 180, 9);
  });

  it('draws a solid paint through the same path as a paint, not a separate branch', () => {
    const { context, calls, gradients } = createRecordingContext();
    paintPlan(context, planOf([pathOp({ fillPaint: { kind: 'solid', color: '#123456' } })]), {
      clear: false,
    });
    expect(gradients).toHaveLength(0);
    expect(calls.some((call) => call.op === 'fill')).toBe(true);
  });

  it('paints nothing when the style has neither ink nor an enabled stroke', () => {
    const { context, names } = createRecordingContext();
    paintPlan(context, planOf([pathOp({ fill: null, fillPaint: null, stroke: null })]), {
      clear: false,
    });
    expect(names()).not.toContain('fill');
    expect(names()).not.toContain('stroke');
  });

  it('uses a stroke paint for the outline and restores the dash afterwards', () => {
    const { context, calls, gradients } = createRecordingContext();
    paintPlan(
      context,
      planOf([
        pathOp({
          fill: null,
          fillPaint: null,
          strokeWidth: 4,
          dashArray: [6, 2],
          strokePaint: {
            kind: 'linear-gradient',
            from: { x: 0, y: 0 },
            to: { x: 1, y: 1 },
            stops: [
              { offset: 0, color: '#00ff00' },
              { offset: 1, color: '#ff00ff' },
            ],
          },
        }),
      ]),
      { clear: false },
    );
    expect(gradients).toHaveLength(1);
    expect(calls.some((call) => call.op === 'stroke')).toBe(true);
    const dashCalls = calls.filter((call) => call.op === 'setLineDash');
    expect(dashCalls.at(-1)?.args).toEqual([[]]);
  });

  it('leaves the recording context balanced after gradient and pattern fills', () => {
    const { context, depth } = createRecordingContext();
    paintPlan(
      context,
      planOf([
        pathOp({
          fillPaint: {
            kind: 'pattern',
            motif: 'grid',
            foreground: '#112233',
            background: null,
            scale: 0.2,
            rotation: 0,
          },
        }),
      ]),
      { clear: false },
    );
    expect(depth()).toBe(0);
  });
});
