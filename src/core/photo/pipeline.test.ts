/**
 * The photo pipeline: the reference implementation the GPU shader is checked against.
 *
 * Every assertion uses a tiny, hand-computable image so the expected value is arithmetic rather than
 * a snapshot of whatever the implementation happened to produce.
 */

import { describe, expect, it } from 'vitest';

import type { PhotoAdjustment, PhotoAdjustmentKind } from '../documents/payload';
import { adjustmentIsIdentity, applyPhotoPipeline, boxBlur } from './pipeline';

/** A stack entry with a stable id, so assertions read like the UI. */
function adjust(kind: PhotoAdjustmentKind, value: number, enabled = true): PhotoAdjustment {
  return { id: `${kind}-1`, kind, value, enabled };
}

/** A solid image of the given colour, so one pixel's maths is the whole image's maths. */
function solid(r: number, g: number, b: number, width = 4, height = 4) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
    data[index + 3] = 255;
  }
  return { data, width, height };
}

function pixel(data: Uint8ClampedArray, index = 0): [number, number, number, number] {
  return [
    data[index * 4] ?? 0,
    data[index * 4 + 1] ?? 0,
    data[index * 4 + 2] ?? 0,
    data[index * 4 + 3] ?? 0,
  ];
}

describe('applyPhotoPipeline', () => {
  it('returns an identical copy when the stack is empty', () => {
    const image = solid(10, 20, 30);
    const output = applyPhotoPipeline(image, { adjustments: [] });
    expect([...output]).toEqual([...image.data]);
    expect(output).not.toBe(image.data);
  });

  it('skips disabled adjustments and zero values', () => {
    const image = solid(50, 60, 70);
    const disabled: PhotoAdjustment = { id: 'a', kind: 'exposure', value: 80, enabled: false };
    const zero: PhotoAdjustment = { id: 'b', kind: 'contrast', value: 0, enabled: true };
    expect(adjustmentIsIdentity(disabled)).toBe(true);
    expect(adjustmentIsIdentity(zero)).toBe(true);
    const output = applyPhotoPipeline(image, { adjustments: [disabled, zero] });
    expect([...output]).toEqual([...image.data]);
  });

  it('quadruples at +100 exposure, which is two stops', () => {
    const image = solid(40, 50, 60);
    const output = applyPhotoPipeline(image, { adjustments: [adjust('exposure', 100)] });
    expect(pixel(output)).toEqual([160, 200, 240, 255]);
    const halved = applyPhotoPipeline(image, { adjustments: [adjust('exposure', -100)] });
    expect(pixel(halved)).toEqual([10, 13, 15, 255]);
  });

  it('clamps at the byte range instead of wrapping', () => {
    const image = solid(200, 200, 200);
    const output = applyPhotoPipeline(image, { adjustments: [adjust('exposure', 100)] });
    expect(pixel(output)).toEqual([255, 255, 255, 255]);
  });

  it('removes all colour at full monochrome', () => {
    const image = solid(200, 100, 50);
    const output = applyPhotoPipeline(image, { adjustments: [adjust('grayscale', 100)] });
    const [r, g, b] = pixel(output);
    expect(r).toBe(g);
    expect(g).toBe(b);
    // The documented luminance weights: 0.2126·200 + 0.7152·100 + 0.0722·50 ≈ 118.
    expect(r).toBe(118);
  });

  it('makes the stack order observable, because the order is the edit order', () => {
    const image = solid(120, 120, 120);
    const exposure = adjust('exposure', 20);
    const contrast = adjust('contrast', 20);
    const exposureFirst = applyPhotoPipeline(image, { adjustments: [exposure, contrast] });
    const contrastFirst = applyPhotoPipeline(image, { adjustments: [contrast, exposure] });
    expect(pixel(exposureFirst)).not.toEqual(pixel(contrastFirst));
  });

  it('treats the mask as a strength map between the original and the adjusted pixel', () => {
    const image = solid(100, 100, 100);
    const adjustments = [adjust('exposure', 50)];
    const adjusted = applyPhotoPipeline(image, { adjustments });
    expect(pixel(adjusted)).toEqual([200, 200, 200, 255]);

    const half = new Uint8ClampedArray(16);
    half.fill(128);
    const blended = applyPhotoPipeline(image, { adjustments, mask: half });
    expect(pixel(blended)).toEqual([150, 150, 150, 255]);

    const none = new Uint8ClampedArray(16);
    expect([...applyPhotoPipeline(image, { adjustments, mask: none })]).toEqual([...image.data]);
  });

  it('leaves flat colour untouched by clarity but increases local contrast at an edge', () => {
    const flat = solid(90, 90, 90);
    const flatOutput = applyPhotoPipeline(flat, { adjustments: [adjust('clarity', 100)] });
    expect([...flatOutput]).toEqual([...flat.data]);

    const width = 6;
    const height = 1;
    const edge = new Uint8ClampedArray(width * height * 4);
    for (let x = 0; x < width; x += 1) {
      const value = x < 3 ? 60 : 180;
      const index = x * 4;
      edge[index] = value;
      edge[index + 1] = value;
      edge[index + 2] = value;
      edge[index + 3] = 255;
    }
    const edged = applyPhotoPipeline(
      { data: edge, width, height },
      { adjustments: [adjust('clarity', 100)] },
    );
    // The dark side of the edge becomes darker and the bright side brighter.
    expect(pixel(edged, 2)[0]).toBeLessThan(60);
    expect(pixel(edged, 3)[0]).toBeGreaterThan(180);
  });

  it('is deterministic: the same inputs produce byte-identical output', () => {
    const image = solid(30, 90, 150);
    const adjustments = [adjust('temperature', 30), adjust('vibrance', 40), adjust('sepia', 20)];
    const first = applyPhotoPipeline(image, { adjustments });
    const second = applyPhotoPipeline(image, { adjustments });
    expect([...first]).toEqual([...second]);
  });
});

describe('boxBlur', () => {
  it('leaves a uniformly coloured image exactly as it was', () => {
    const data = new Uint8ClampedArray(9 * 4);
    data.fill(90);
    for (let index = 3; index < data.length; index += 4) data[index] = 255;
    const blurred = boxBlur(data, 3, 3);
    expect(pixel(blurred, 4)[0]).toBe(90);
    expect(pixel(blurred, 0)[0]).toBe(90);
  });

  it('spreads one bright pixel over its 3×3 neighbourhood, clamping at the edges', () => {
    const width = 5;
    const height = 5;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < data.length; index += 4) {
      data[index] = 90;
      data[index + 1] = 90;
      data[index + 2] = 90;
      data[index + 3] = 255;
    }
    // The centre of a 5×5 field is bright. Its own window averages the whole 3×3 around it;
    // a corner window clamps and never reaches it.
    const centre = 2 * 5 + 2;
    data[centre * 4] = 200;
    const blurred = boxBlur(data, width, height);
    expect(pixel(blurred, centre)[0]).toBe(102);
    expect(pixel(blurred, 0)[0]).toBe(90);
  });
});
