/**
 * Path data: parsing, serialisation and the round trip between them.
 *
 * The parser is the front door for untrusted input (an imported SVG, a document read back from
 * storage), so the error cases matter as much as the success cases: a command that cannot be
 * understood must produce a message, never a silent hop over part of a shape.
 */

import { describe, expect, it } from 'vitest';

import { parsePathData, toPathData, toVerbosePathData } from './path-data';
import { boundsOfPath } from './bounds';
import { areaOfPath } from './area';
import { nodeCount, type VectorPath } from './types';
import { allSegments } from './path';
import { TOLERANCE } from './tolerance';

function path(prefix: string): VectorPath {
  const parsed = parsePathData(prefix);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value.path;
}

function roundTrip(value: VectorPath, digits = 3): VectorPath {
  return path(toPathData(value, { digits }));
}

function expectClose(a: number, b: number, tolerance = 1e-3): void {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tolerance);
}

describe('SVG path data parsing', () => {
  it('reads the absolute commands of a closed triangle', () => {
    const parsed = parsePathData('M 0 0 L 10 0 L 10 10 Z');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.path.contours).toHaveLength(1);
    expect(parsed.value.path.contours[0]?.nodes).toHaveLength(3);
    expect(parsed.value.path.contours[0]?.closed).toBe(true);
    expect(parsed.value.commands).toEqual(['M', 'L', 'L', 'Z']);
  });

  it('treats a second coordinate pair after M as an implicit line, as the grammar does', () => {
    const parsed = path('M0 0 10 0 10 10Z');
    expect(parsed.contours[0]?.nodes.map((node) => node.point)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('applies relative commands from the current point, including across a subpath', () => {
    const parsed = path('m5 5 l10 0 l0 10 z m20 0 l5 0');
    expect(parsed.contours).toHaveLength(2);
    expect(parsed.contours[0]?.nodes[0]?.point).toEqual({ x: 5, y: 5 });
    expect(parsed.contours[0]?.nodes[2]?.point).toEqual({ x: 15, y: 15 });
    // After `z` the current point is the subpath's start (5, 5), so `m20 0` starts at (25, 5).
    expect(parsed.contours[1]?.nodes[0]?.point).toEqual({ x: 25, y: 5 });
  });

  it('reads horizontal and vertical shorthands', () => {
    const parsed = path('M0 0 H20 V20 H0 Z');
    expect(parsed.contours[0]?.nodes.map((node) => node.point)).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ]);
  });

  it('keeps cubic control points as absolute handles', () => {
    const parsed = path('M0 0 C 10 0 20 10 20 20');
    const contour = parsed.contours[0];
    expect(contour?.nodes[0]?.handleOut).toEqual({ x: 10, y: 0 });
    expect(contour?.nodes[1]?.handleIn).toEqual({ x: 20, y: 10 });
    expect(contour?.nodes[1]?.point).toEqual({ x: 20, y: 20 });
  });

  it('continues a smooth curve by reflecting the previous control point', () => {
    const parsed = path('M0 0 C10 0 20 10 20 20 S30 30 40 20');
    const contour = parsed.contours[0];
    // Reflected control point of the second cubic: 2 * (20,20) - (20,10) = (20,30).
    expect(contour?.nodes[1]?.handleOut).toEqual({ x: 20, y: 30 });
    expect(contour?.nodes[2]?.point).toEqual({ x: 40, y: 20 });
  });

  it('converts a quadratic to the exactly equivalent cubic', () => {
    const parsed = path('M0 0 Q 10 20 20 0');
    const contour = parsed.contours[0];
    // Two thirds of the way from each endpoint towards the quadratic control point.
    expect(contour?.nodes[0]?.handleOut?.x).toBeCloseTo(20 / 3, 6);
    expect(contour?.nodes[0]?.handleOut?.y).toBeCloseTo(40 / 3, 6);
    expect(contour?.nodes[1]?.handleIn?.x).toBeCloseTo(20 - 20 / 3, 6);
    expect(contour?.nodes[1]?.handleIn?.y).toBeCloseTo(40 / 3, 6);
  });

  it('approximates a circular arc within a tenth of a percent of the radius', () => {
    const parsed = parsePathData('M100 0 A100 100 0 0 1 0 100');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.approximatedArcs).toBe(1);

    // Every point of the arc must lie on the circle x² + y² = 100² to within tolerance.
    const segments = allSegments(parsed.value.path);
    expect(segments.length).toBeGreaterThanOrEqual(1);
    for (const segment of segments) {
      for (let step = 0; step <= 10; step += 1) {
        const t = step / 10;
        const u = 1 - t;
        const control1 = segment.control1;
        const control2 = segment.control2;
        if (!control1 || !control2) continue;
        const x =
          u * u * u * segment.from.x +
          3 * u * u * t * control1.x +
          3 * u * t * t * control2.x +
          t * t * t * segment.to.x;
        const y =
          u * u * u * segment.from.y +
          3 * u * u * t * control1.y +
          3 * u * t * t * control2.y +
          t * t * t * segment.to.y;
        expect(Math.abs(Math.hypot(x, y) - 100)).toBeLessThan(0.1);
      }
    }
  });

  it('draws a straight line for a degenerate arc, as the specification requires', () => {
    const parsed = path('M0 0 A0 0 0 0 1 10 10');
    expect(parsed.contours[0]?.nodes[1]?.point).toEqual({ x: 10, y: 10 });
    expect(parsed.contours[0]?.nodes[1]?.handleIn).toBeNull();
  });

  it('rejects an empty, malformed or unsupported path with a position', () => {
    const cases = ['', '   ', 'L 10 10', 'M 0 0 L', 'M 0 0 L 10', 'M 0 0 X 5 5', 'M 1e999 0'];
    for (const source of cases) {
      const parsed = parsePathData(source);
      expect(parsed.ok, `expected "${source}" to be refused`).toBe(false);
      if (!parsed.ok) expect(parsed.error.message.length).toBeGreaterThan(10);
    }
  });

  it('reports the character position of a malformed command', () => {
    const parsed = parsePathData('M 0 0 L 10 10 K 5 5');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.message).toContain('character 14');
    expect(parsed.error.message).toContain('unexpected "K"');
  });

  it('refuses a coordinate beyond the supported range', () => {
    const parsed = parsePathData('M 0 0 L 2000000 0');
    expect(parsed.ok).toBe(false);
  });

  it('accepts a realistic icon outline with exponent notation and no separators', () => {
    const parsed = parsePathData('M1e1 1e1L20-5.5.5 30z');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.path.contours[0]?.closed).toBe(true);
  });
});

describe('SVG path data serialisation', () => {
  it('writes a closed rectangle compactly', () => {
    const value = path('M0 0 L10 0 L10 20 L0 20 Z');
    expect(toPathData(value)).toBe('M0 0L10 0 10 20 0 20Z');
  });

  it('omits the repeated command letter between consecutive lines', () => {
    const value = path('M0 0 L1 0 L2 0 L3 0 L4 0');
    const data = toPathData(value);
    expect(data).toBe('M0 0L1 0 2 0 3 0 4 0');
    expect(data.match(/L/g)).toHaveLength(1);
  });

  it('writes curves with a single command each and no redundant precision', () => {
    const value = path('M0 0 C10.123456 0 20 10.000001 20 20 Z');
    expect(toPathData(value)).toBe('M0 0C10.123 0 20 10 20 20Z');
    expect(toPathData(value, { digits: 1 })).toBe('M0 0C10.1 0 20 10 20 20Z');
  });

  it('never emits "-0", so identical geometry is byte-identical', () => {
    const value = path('M0 0 L-0.0001 0 L-0.0004 5 Z');
    expect(toPathData(value)).not.toContain('-0 ');
    expect(toPathData(value)).toBe(toPathData(value));
  });

  it('closes every closed contour and leaves open ones open', () => {
    expect(toPathData(path('M0 0 L5 5 Z'))).toBe('M0 0L5 5Z');
    expect(toPathData(path('M0 0 L5 5'))).toBe('M0 0L5 5');
  });

  it('is smaller than the verbose form of the same geometry', () => {
    const value = path('M0 0 L10 0 L10 10 L0 10 Z M20 0 L30 0 L30 10 L20 10 Z');
    expect(toPathData(value).length).toBeLessThan(toVerbosePathData(value).length);
  });
});

describe('path data round trip', () => {
  const fixtures: readonly { readonly name: string; readonly d: string }[] = [
    { name: 'triangle', d: 'M0 0 L40 0 L40 30 Z' },
    { name: 'curve', d: 'M0 0 C12 4 24 20 40 30' },
    {
      name: 'two contours with a hole',
      d: 'M0 0 L40 0 L40 40 L0 40 Z M10 10 L30 10 L30 30 L10 30 Z',
    },
    { name: 'arc', d: 'M60 0 A60 60 0 0 1 0 60' },
    { name: 'quadratic', d: 'M0 0 Q30 40 60 0' },
    { name: 'open polyline', d: 'M0 0 L10 10 L20 5 L30 15' },
  ];

  for (const fixture of fixtures) {
    it(`restores geometry and node structure for the ${fixture.name}`, () => {
      const original = path(fixture.d);
      const restored = roundTrip(original);

      expect(nodeCount(restored)).toBe(nodeCount(original));
      expect(restored.contours.map((contour) => contour.closed)).toEqual(
        original.contours.map((contour) => contour.closed),
      );

      const originalBounds = boundsOfPath(original);
      const restoredBounds = boundsOfPath(restored);
      expect(originalBounds).not.toBeNull();
      expect(restoredBounds).not.toBeNull();
      if (!originalBounds || !restoredBounds) return;
      expectClose(originalBounds.minX, restoredBounds.minX, 1e-3);
      expectClose(originalBounds.minY, restoredBounds.minY, 1e-3);
      expectClose(originalBounds.maxX, restoredBounds.maxX, 1e-3);
      expectClose(originalBounds.maxY, restoredBounds.maxY, 1e-3);
      expect(Math.abs(areaOfPath(original) - areaOfPath(restored))).toBeLessThan(
        Math.max(0.01, areaOfPath(original) * 0.001),
      );
    });
  }

  it('is stable: serialising twice produces the same bytes', () => {
    const original = path('M0 0 C1 2 3 4 5 6 Z M10 10 L12 12');
    const first = toPathData(original);
    const second = toPathData(roundTrip(original));
    expect(second).toBe(first);
  });

  it('keeps a closed contour closed across two round trips', () => {
    const original = path('M0 0 L25 0 L25 25 L0 25 Z');
    const once = roundTrip(original);
    const twice = roundTrip(once);
    expect(twice.contours[0]?.closed).toBe(true);
    expect(nodeCount(twice)).toBe(4);
  });

  it('round-trips a curve without exceeding the flattening tolerance', () => {
    const original = path('M0 0 C20 40 60 40 80 0');
    const restored = roundTrip(original, 4);
    const originalFlat = allSegments(original);
    const restoredFlat = allSegments(restored);
    expect(restoredFlat).toHaveLength(originalFlat.length);

    // Sample both curves at 64 parameters and compare positions.
    for (let step = 0; step <= 64; step += 1) {
      const t = step / 64;
      const sample = (segments: typeof originalFlat): { x: number; y: number } | null => {
        const segment = segments[0];
        if (!segment) return null;
        const control1 = segment.control1;
        const control2 = segment.control2;
        if (!control1 || !control2) return null;
        const u = 1 - t;
        return {
          x:
            u * u * u * segment.from.x +
            3 * u * u * t * control1.x +
            3 * u * t * t * control2.x +
            t * t * t * segment.to.x,
          y:
            u * u * u * segment.from.y +
            3 * u * u * t * control1.y +
            3 * u * t * t * control2.y +
            t * t * t * segment.to.y,
        };
      };
      const a = sample(originalFlat);
      const b = sample(restoredFlat);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      if (!a || !b) continue;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(TOLERANCE.flatten);
    }
  });
});
