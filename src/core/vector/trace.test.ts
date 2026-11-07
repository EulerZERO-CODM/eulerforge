/**
 * Image tracing.
 *
 * The tests are written against synthetic buffers with known geometry, because the point of the
 * tracer is *where the boundaries are* — a test that only asserts "some paths came back" would pass
 * for a tracer that returned a rectangle. Every case fixes the pixels, then checks the number of
 * regions, the contour count (outer boundary plus holes), the area and the coordinate space.
 */

import { describe, expect, it } from 'vitest';

import { boundsOfPath } from './bounds';
import { areaOfPath } from './area';
import { traceImage, TRACE_LIMITS } from './trace';
import { nodeCount } from './types';

type Paint = (x: number, y: number) => readonly [number, number, number, number];

function buffer(width: number, height: number, paint: Paint): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y);
      const at = (y * width + x) * 4;
      pixels[at] = r;
      pixels[at + 1] = g;
      pixels[at + 2] = b;
      pixels[at + 3] = a;
    }
  }
  return pixels;
}

function twoTone(width: number, height: number): Uint8ClampedArray {
  return buffer(width, height, (x) => (x < width / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
}

describe('traceImage', () => {
  it('turns a two-tone image into one editable path per colour', () => {
    const traced = traceImage(twoTone(100, 60), 100, 60, { colours: 2 });
    expect(traced.ok).toBe(true);
    if (!traced.ok) return;

    expect(traced.value.regions).toHaveLength(2);
    expect(traced.value.width).toBe(100);
    expect(traced.value.height).toBe(60);
    expect(traced.value.droppedRegions).toBe(0);

    for (const region of traced.value.regions) {
      expect(region.path.contours).toHaveLength(1);
      expect(region.contours).toBe(1);
      expect(region.path.contours[0]?.closed).toBe(true);
      expect(region.path.contours[0]?.nodes.every((node) => node.handleIn === null)).toBe(true);
      expect(region.area).toBeCloseTo(3000, -1);
    }

    // The two halves meet at x = 50, so each box is half the image and both share that edge.
    const boxes = traced.value.regions.map((region) => boundsOfPath(region.path));
    const spans = boxes.map((box) => (box ? [Math.round(box.minX), Math.round(box.maxX)] : null));
    expect(spans).toEqual(
      expect.arrayContaining([
        [0, 50],
        [50, 100],
      ]),
    );
    for (const box of boxes) {
      expect(box).not.toBeNull();
      if (!box) continue;
      expect(box.minY).toBeCloseTo(0, 3);
      expect(box.maxY).toBeCloseTo(60, 3);
    }
  });

  it('keeps a hole as an inner contour rather than filling it', () => {
    const pixels = buffer(100, 100, (x, y) =>
      x >= 40 && x < 60 && y >= 40 && y < 60 ? [255, 0, 0, 255] : [255, 255, 255, 255],
    );
    const traced = traceImage(pixels, 100, 100, { colours: 2 });
    expect(traced.ok).toBe(true);
    if (!traced.ok) return;

    const red = traced.value.regions.find((region) => region.colour === '#ff0000');
    const white = traced.value.regions.find((region) => region.colour === '#ffffff');
    expect(red?.area).toBe(400);
    expect(red?.contours).toBe(1);
    // Outer boundary plus the hole: with even-odd fill that is a square with a square cut out.
    expect(white?.contours).toBe(2);
    expect(white?.area).toBe(9600);
    expect(areaOfPath(white?.path ?? { contours: [] })).toBeGreaterThan(9000);
  });

  it('reports the source size while tracing a capped working copy', () => {
    const traced = traceImage(twoTone(2000, 1000), 2000, 1000, { colours: 2 });
    expect(traced.ok).toBe(true);
    if (!traced.ok) return;

    expect(traced.value.width).toBe(2000);
    expect(traced.value.height).toBe(1000);
    expect(traced.value.sampleWidth).toBeLessThanOrEqual(TRACE_LIMITS.workingEdge);
    expect(traced.value.sampleHeight).toBeLessThanOrEqual(TRACE_LIMITS.workingEdge);
    const box = boundsOfPath(traced.value.regions[0]?.path ?? { contours: [] });
    expect(box).not.toBeNull();
    if (!box) return;
    // Coordinates are scaled back into source space, not left in sample space.
    expect(box.maxX - box.minX).toBeGreaterThan(900);
    expect(box.maxY - box.minY).toBeGreaterThan(900);
  });

  it('drops specks below the minimum area', () => {
    const clean = buffer(80, 80, () => [255, 255, 255, 255]);
    for (let y = 10; y < 12; y += 1) {
      for (let x = 10; x < 12; x += 1) {
        const at = (y * 80 + x) * 4;
        clean[at] = 0;
        clean[at + 1] = 0;
        clean[at + 2] = 0;
      }
    }
    const traced = traceImage(clean, 80, 80, { colours: 2, minArea: 100 });
    expect(traced.ok).toBe(true);
    if (!traced.ok) return;
    expect(traced.value.regions).toHaveLength(1);
    expect(traced.value.regions[0]?.colour).toBe('#ffffff');
    expect(traced.value.droppedRegions).toBeGreaterThan(0);
  });

  it('is deterministic: the same pixels trace to the same paths', () => {
    const pixels = buffer(64, 64, (x, y) =>
      (x * y) % 3 === 0 ? [10, 200, 30, 255] : [240, 40, 90, 255],
    );
    const first = traceImage(pixels, 64, 64, { colours: 3, detail: 70 });
    const second = traceImage(pixels, 64, 64, { colours: 3, detail: 70 });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(JSON.stringify(first.value)).toBe(JSON.stringify(second.value));
  });

  it('keeps more detail at a higher setting', () => {
    const pixels = buffer(200, 200, (x, y) =>
      (x - 100) ** 2 + (y - 100) ** 2 < 80 ** 2 ? [20, 20, 20, 255] : [250, 250, 250, 255],
    );
    const coarse = traceImage(pixels, 200, 200, { colours: 2, detail: 0 });
    const fine = traceImage(pixels, 200, 200, { colours: 2, detail: 100 });
    expect(coarse.ok && fine.ok).toBe(true);
    if (!coarse.ok || !fine.ok) return;
    expect(fine.value.nodes).toBeGreaterThan(coarse.value.nodes);
    expect(fine.value.tolerance).toBeLessThan(coarse.value.tolerance);
  });

  it('refuses transparent, mismatched and oversized inputs', () => {
    const transparent = traceImage(new Uint8ClampedArray(16 * 16 * 4), 16, 16);
    expect(transparent.ok).toBe(false);
    if (!transparent.ok) expect(transparent.error.message).toMatch(/transparent/i);

    const mismatched = traceImage(new Uint8ClampedArray(16), 16, 16);
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) expect(mismatched.error.message).toMatch(/pixel buffer/i);

    const empty = traceImage(new Uint8ClampedArray(0), 0, 0);
    expect(empty.ok).toBe(false);

    const oversized = traceImage(new Uint8ClampedArray(4), 10_000, 10_000);
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) expect(oversized.error.message).toMatch(/too large/i);
  });

  it('clamps the palette size instead of trusting the caller', () => {
    const pixels = buffer(40, 40, (x) => [x * 6, 255 - x * 6, 128, 255]);
    const traced = traceImage(pixels, 40, 40, { colours: 99 });
    expect(traced.ok).toBe(true);
    if (!traced.ok) return;
    expect(traced.value.palette.length).toBeLessThanOrEqual(TRACE_LIMITS.maxColours);
    expect(traced.value.palette.length).toBeGreaterThan(1);
    expect(nodeCount(traced.value.regions[0]?.path ?? { contours: [] })).toBeGreaterThan(2);
  });
});
