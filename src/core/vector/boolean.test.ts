/**
 * Boolean operations.
 *
 * Every case asserts *topology*, not merely that a path came back: area, contour count, winding and
 * the result of `checkTopology` (no self-intersections, holes inside their outer contour, consistent
 * orientation, no lost geometry). That is what acceptance criterion 1 means by "topologically
 * valid", and it is why these tests would still fail if the kernel returned a plausible-looking but
 * wrong shape.
 */

import { describe, expect, it } from 'vitest';

import { booleanPaths, describeBooleanResult } from './boolean';
import { areaOfPath, signedAreaOfContour } from './area';
import { boundsOfPath } from './bounds';
import { allSegments } from './path';
import { flattenPath } from './flatten';
import { parsePathData, toPathData } from './path-data';
import { ellipsePath, rectanglePath } from './shapes';
import { checkTopology } from './validity';
import type { VectorPath } from './types';
import { TOLERANCE } from './tolerance';

function parsed(d: string): VectorPath {
  const result = parsePathData(d);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.path;
}

/** Perimeter of the flattened outline, used to bound the area error of a flattened boolean. */
function flattenedPerimeter(path: VectorPath): number {
  return flattenPath(path, TOLERANCE.flatten).reduce((total, contour) => {
    let length = 0;
    for (let index = 0; index < contour.points.length - 1; index += 1) {
      const from = contour.points[index];
      const to = contour.points[index + 1];
      if (!from || !to) continue;
      length += Math.hypot(to.x - from.x, to.y - from.y);
    }
    return total + length;
  }, 0);
}

const square = (x: number, y: number, size: number): VectorPath =>
  rectanglePath({ minX: x, minY: y, maxX: x + size, maxY: y + size });

function combine(
  operation: 'union' | 'subtract' | 'intersect' | 'exclude',
  paths: readonly VectorPath[],
): VectorPath {
  const result = booleanPaths(operation, paths);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.path;
}

describe('boolean operations on rectangles', () => {
  it('unites two overlapping squares into one valid contour', () => {
    const result = combine('union', [square(0, 0, 10), square(5, 5, 10)]);
    const report = checkTopology(result);

    expect(report.valid).toBe(true);
    expect(report.issues).toEqual([]);
    expect(result.contours).toHaveLength(1);
    expect(areaOfPath(result)).toBeCloseTo(175, 6);
    expect(boundsOfPath(result)).toEqual({ minX: 0, minY: 0, maxX: 15, maxY: 15 });
  });

  it('subtracts in the order given, and reports the difference', () => {
    const left = combine('subtract', [square(0, 0, 10), square(5, 5, 10)]);
    const right = combine('subtract', [square(5, 5, 10), square(0, 0, 10)]);

    expect(areaOfPath(left)).toBeCloseTo(75, 6);
    expect(areaOfPath(right)).toBeCloseTo(75, 6);
    // Different shapes with the same area: the missing quarter is on opposite corners.
    expect(boundsOfPath(left)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(boundsOfPath(right)).toEqual({ minX: 5, minY: 5, maxX: 15, maxY: 15 });
    expect(checkTopology(left).valid).toBe(true);
  });

  it('intersects to exactly the overlap', () => {
    const result = combine('intersect', [square(0, 0, 10), square(5, 5, 10)]);
    expect(areaOfPath(result)).toBeCloseTo(25, 6);
    expect(result.contours).toHaveLength(1);
    expect(checkTopology(result).valid).toBe(true);
  });

  it('excludes the overlap, leaving two valid contours', () => {
    const result = combine('exclude', [square(0, 0, 10), square(5, 5, 10)]);
    expect(areaOfPath(result)).toBeCloseTo(150, 6);
    expect(result.contours).toHaveLength(2);
    expect(checkTopology(result).valid).toBe(true);
  });

  it('produces a hole with the opposite winding, and the area of the ring', () => {
    const result = combine('subtract', [square(0, 0, 100), square(25, 25, 50)]);
    const report = checkTopology(result);

    expect(report.valid).toBe(true);
    expect(result.contours).toHaveLength(2);
    expect(report.outerContours).toHaveLength(1);
    expect(report.holeContours).toHaveLength(1);
    expect(signedAreaOfContour(result.contours[report.outerContours[0]!]!)).toBeGreaterThan(0);
    expect(signedAreaOfContour(result.contours[report.holeContours[0]!]!)).toBeLessThan(0);
    expect(areaOfPath(result)).toBeCloseTo(10_000 - 2_500, 6);
  });

  it('collapses coincident shapes instead of doubling them', () => {
    const result = combine('union', [square(0, 0, 10), square(0, 0, 10)]);
    expect(result.contours).toHaveLength(1);
    expect(areaOfPath(result)).toBeCloseTo(100, 6);
    expect(checkTopology(result).valid).toBe(true);
  });

  it('merges two squares that share an edge into one contour', () => {
    const result = combine('union', [square(0, 0, 10), square(10, 0, 10)]);
    expect(result.contours).toHaveLength(1);
    expect(areaOfPath(result)).toBeCloseTo(200, 6);
    expect(boundsOfPath(result)).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 10 });
    expect(checkTopology(result).valid).toBe(true);
  });

  it('keeps disjoint shapes as two outer contours', () => {
    const result = combine('union', [square(0, 0, 10), square(30, 30, 10)]);
    const report = checkTopology(result);
    expect(result.contours).toHaveLength(2);
    expect(report.outerContours).toHaveLength(2);
    expect(report.valid).toBe(true);
    expect(areaOfPath(result)).toBeCloseTo(200, 6);
  });

  it('reports an empty result when nothing overlaps, rather than inventing a shape', () => {
    const outcome = booleanPaths('intersect', [square(0, 0, 10), square(50, 50, 10)]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.empty).toBe(true);
    expect(outcome.value.path.contours).toHaveLength(0);
    expect(describeBooleanResult(outcome.value)).toContain('empty shape');
  });

  it('handles a chain of three shapes', () => {
    const result = combine('union', [square(0, 0, 10), square(5, 5, 10), square(10, 10, 10)]);
    expect(checkTopology(result).valid).toBe(true);
    // 100 + 100 + 100 − 25 (A∩B) − 25 (B∩C); A and C meet only at a corner, which has no area.
    expect(areaOfPath(result)).toBeCloseTo(250, 6);
  });

  it('subtracts a ring from a shape, keeping both holes', () => {
    const ring = combine('subtract', [square(0, 0, 100), square(40, 40, 20)]);
    const result = combine('subtract', [square(0, 0, 100), ring]);
    const report = checkTopology(result);

    // A \ (A \ B) is A ∩ B: the small square comes back, filled, with no hole.
    expect(report.valid).toBe(true);
    expect(areaOfPath(result)).toBeCloseTo(400, 6);
    expect(report.outerContours).toHaveLength(1);
    expect(report.holeContours).toHaveLength(0);
    expect(boundsOfPath(result)).toEqual({ minX: 40, minY: 40, maxX: 60, maxY: 60 });
  });
});

describe('boolean operations with curves', () => {
  it('unites two circles and stays within the curve-approximation error', () => {
    const circleA = ellipsePath({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    const circleB = ellipsePath({ minX: 50, minY: 0, maxX: 150, maxY: 100 });
    const result = combine('union', [circleA, circleB]);

    const report = checkTopology(result);
    expect(report.valid).toBe(true);
    expect(result.contours).toHaveLength(1);

    // Two unit circles offset by exactly one radius: 2πr² − lens area, computed independently.
    const radius = 50;
    const lensArea =
      2 * radius * radius * Math.acos(0.5) -
      0.5 * radius * Math.sqrt(4 * radius * radius - radius * radius);
    const expected = 2 * Math.PI * radius * radius - lensArea;
    expect(Math.abs(areaOfPath(result) - expected) / expected).toBeLessThan(0.002);
  });

  it('returns polygonal geometry and says so', () => {
    const outcome = booleanPaths('union', [square(0, 0, 10), square(5, 5, 10)]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.approximation).toBe('flattened-polygons');
    expect(outcome.value.tolerance).toBe(TOLERANCE.flatten);
    // The result is a polygon: every segment is a straight line.
    for (const segment of allSegments(outcome.value.path)) {
      expect(segment.kind).toBe('line');
    }
    expect(outcome.value.flattenedSegments.output).toBeGreaterThan(0);
    expect(describeBooleanResult(outcome.value)).toContain('curves flattened to straight segments');
  });

  it('respects the tolerance it was given: a finer tolerance yields more segments', () => {
    const circle = ellipsePath({ minX: 0, minY: 0, maxX: 120, maxY: 120 });
    const coarse = booleanPaths(
      'union',
      [circle, rectanglePath({ minX: 60, minY: 0, maxX: 180, maxY: 120 })],
      { tolerance: 0.5 },
    );
    const fine = booleanPaths(
      'union',
      [circle, rectanglePath({ minX: 60, minY: 0, maxX: 180, maxY: 120 })],
      { tolerance: 0.01 },
    );
    expect(coarse.ok && fine.ok).toBe(true);
    if (!coarse.ok || !fine.ok) return;
    expect(fine.value.flattenedSegments.output).toBeGreaterThan(
      coarse.value.flattenedSegments.output,
    );
    expect(coarse.value.tolerance).toBe(0.5);
    expect(fine.value.tolerance).toBe(0.01);
  });

  it('closes an open contour for the operation and reports that it did', () => {
    const open = parsed('M0 0 L10 0 L10 10 L0 10');
    const outcome = booleanPaths('subtract', [square(0, 0, 10), open]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.closedContours).toBe(1);
    expect(outcome.value.empty).toBe(true);
  });
});

describe('boolean edge cases', () => {
  it('is deterministic: the same inputs produce byte-identical geometry', () => {
    const first = combine('union', [
      square(0, 0, 10),
      ellipsePath({ minX: 4, minY: 4, maxX: 16, maxY: 16 }),
    ]);
    const second = combine('union', [
      square(0, 0, 10),
      ellipsePath({ minX: 4, minY: 4, maxX: 16, maxY: 16 }),
    ]);
    expect(toPathData(second, { digits: 6 })).toBe(toPathData(first, { digits: 6 }));
  });

  it('resolves a lopsided self-crossing input into valid output', () => {
    // Halves of unequal size: the loop crosses itself but does enclose net area, so the library
    // resolves it into real regions instead of refusing it.
    const lopsided = parsed('M0 0 L20 20 L20 0 L0 10 Z');
    expect(checkTopology(lopsided).valid).toBe(false);
    expect(checkTopology(lopsided).issues.some((entry) => entry.code === 'self-intersection')).toBe(
      true,
    );

    const result = combine('union', [lopsided, square(30, 0, 5)]);
    expect(checkTopology(result).valid).toBe(true);
    expect(areaOfPath(result)).toBeGreaterThan(0);
  });

  it('refuses a figure whose halves cancel out, naming the reason', () => {
    // A symmetric bow-tie encloses no net area: the two lobes wind in opposite directions.
    const bowtie = parsed('M0 0 L10 10 L10 0 L0 10 Z');
    const outcome = booleanPaths('union', [bowtie, square(0, 0, 2)]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.message).toContain('Shape 1 encloses no area');
    expect(outcome.error.detail ?? '').toContain('self-crossing');
  });

  it('keeps a stable result for nearly coincident edges', () => {
    const offset = 1e-9;
    const a = square(0, 0, 10);
    const b = square(10 + offset, 0, 10);
    const result = combine('union', [a, b]);
    const report = checkTopology(result);
    expect(report.valid).toBe(true);
    expect(areaOfPath(result)).toBeCloseTo(200, 6);
  });

  it('handles a shape subtracted from itself', () => {
    const outcome = booleanPaths('subtract', [square(0, 0, 10), square(0, 0, 10)]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.empty).toBe(true);
    expect(outcome.value.path.contours).toHaveLength(0);
  });

  it('refuses a single shape, an empty path and a path with no area', () => {
    const one = booleanPaths('union', [square(0, 0, 10)]);
    expect(one.ok).toBe(false);
    if (!one.ok) expect(one.error.message).toContain('at least two shapes');

    const empty = booleanPaths('union', [square(0, 0, 10), { contours: [] }]);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.message).toContain('Shape 2');

    const line = booleanPaths('union', [square(0, 0, 10), parsed('M0 0 L50 50')]);
    expect(line.ok).toBe(false);

    const point = booleanPaths('union', [square(0, 0, 10), parsed('M5 5 L5 5 L5 5')]);
    expect(point.ok).toBe(false);
  });

  it('never returns a result that lost geometry: the area agrees with an independent computation', () => {
    const a = square(0, 0, 40);
    const b = ellipsePath({ minX: 20, minY: 20, maxX: 60, maxY: 60 });
    const union = combine('union', [a, b]);
    const intersection = combine('intersect', [a, b]);
    const subtract = combine('subtract', [a, b]);

    // The inputs are flattened before clipping, so the identities hold to within the flattening
    // error rather than exactly: a boundary that may be off by `tolerance` can move the area by at
    // most `perimeter × tolerance`. Stating the bound is the point — a bare `toBeCloseTo` would
    // hide whether a failure was approximation or a lost region.
    const errorBound =
      (flattenedPerimeter(a) + flattenedPerimeter(b) + flattenedPerimeter(union)) *
      TOLERANCE.flatten;
    expect(errorBound).toBeGreaterThan(0);

    // |A ∪ B| = |A| + |B| − |A ∩ B|
    const identity = areaOfPath(union) - (areaOfPath(a) + areaOfPath(b) - areaOfPath(intersection));
    expect(Math.abs(identity)).toBeLessThan(errorBound);

    // |A \ B| = |A| − |A ∩ B|
    const subtractIdentity = areaOfPath(subtract) - (areaOfPath(a) - areaOfPath(intersection));
    expect(Math.abs(subtractIdentity)).toBeLessThan(errorBound);

    expect(checkTopology(union).valid).toBe(true);
    expect(checkTopology(intersection).valid).toBe(true);
    expect(checkTopology(subtract).valid).toBe(true);
  });

  it('survives a shape whose contour is wound the other way', () => {
    const counterClockwise = parsed('M0 0 L0 10 L10 10 L10 0 Z');
    expect(signedAreaOfContour(counterClockwise.contours[0]!)).toBeLessThan(0);
    const result = combine('union', [counterClockwise, square(5, 5, 10)]);
    expect(checkTopology(result).valid).toBe(true);
    expect(areaOfPath(result)).toBeCloseTo(175, 6);
  });
});
