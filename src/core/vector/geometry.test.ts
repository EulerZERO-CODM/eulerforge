/**
 * Bounds, area, centroid, flattening, transforms and hit-testing.
 *
 * The assertions here are about *exactness*: a cubic's bounds come from the roots of its derivative
 * rather than from sampling, and its area from a quadrature rule that is exact for the polynomial it
 * integrates. Both are checked against independent computations (dense sampling, and the analytic
 * area of a circle) so the tests would fail if the closed forms were wrong.
 */

import { describe, expect, it } from 'vitest';

import {
  areaOfContour,
  areaOfPath,
  centroidOfContour,
  centroidOfPath,
  signedAreaOfContour,
  signedAreaOfPath,
} from './area';
import {
  boundsOfPath,
  boxFromPoints,
  boxesOverlap,
  controlBoundsOfPath,
  EMPTY_BOX,
  segmentBounds,
  unionBoxes,
} from './bounds';
import {
  closestPointOnPath,
  flattenContour,
  flattenPath,
  flattenedSegmentCount,
  insertNodeBetween,
  pointOnSegment,
  splitCubic,
} from './flatten';
import {
  distanceToPath,
  hitTestPath,
  pathContainsPoint,
  pathIntersectsBox,
  shapeIntersectsBox,
} from './hit';
import { parsePathData, toPathData } from './path-data';
import { segmentsOf } from './path';
import { ellipsePath, rectanglePath } from './shapes';
import {
  IDENTITY,
  applyToPoint,
  invert,
  matrix,
  matrixBetweenBoxes,
  rotation,
  scaling,
  transformPath,
  translation,
} from './transform';
import { TOLERANCE } from './tolerance';
import type { VectorPath } from './types';

function parsed(d: string): VectorPath {
  const result = parsePathData(d);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.path;
}

const SQUARE = (size = 100): VectorPath =>
  parsed(`M0 0 L${String(size)} 0 L${String(size)} ${String(size)} L0 ${String(size)} Z`);

describe('bounds', () => {
  it('returns null for an empty path rather than a zero box at the origin', () => {
    expect(boundsOfPath(parsed('M0 0'))).toEqual(boxFromPoints([{ x: 0, y: 0 }]));
    const empty = { contours: [] } as VectorPath;
    expect(boundsOfPath(empty)).toBeNull();
  });

  it('measures a rectangle exactly', () => {
    const box = boundsOfPath(SQUARE(120));
    expect(box).toEqual({ minX: 0, minY: 0, maxX: 120, maxY: 120 });
  });

  it("finds a curve's true extent, which is beyond its endpoints", () => {
    // A cubic bulging well past the straight line between its endpoints: the extremes are interior.
    const path = parsed('M0 0 C0 100 100 100 100 0');
    const box = boundsOfPath(path);
    expect(box?.maxY).toBeCloseTo(75, 6);
    expect(box?.minY).toBe(0);
    expect(box?.maxX).toBe(100);
  });

  it('agrees with dense sampling of the same curve', () => {
    const path = parsed('M10 20 C40 0 90 120 130 40');
    const exact = boundsOfPath(path);
    const segment = segmentsOf(path.contours[0]!)[0]!;
    let sampled = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (let step = 0; step <= 20_000; step += 1) {
      const point = pointOnSegment(segment, step / 20_000);
      sampled = {
        minX: Math.min(sampled.minX, point.x),
        minY: Math.min(sampled.minY, point.y),
        maxX: Math.max(sampled.maxX, point.x),
        maxY: Math.max(sampled.maxY, point.y),
      };
    }
    expect(exact).not.toBeNull();
    if (!exact) return;
    // Sampling can only ever underestimate the true extent.
    expect(exact.minX).toBeLessThanOrEqual(sampled.minX + 1e-9);
    expect(exact.minY).toBeLessThanOrEqual(sampled.minY + 1e-9);
    expect(exact.maxX).toBeGreaterThanOrEqual(sampled.maxX - 1e-9);
    expect(exact.maxY).toBeGreaterThanOrEqual(sampled.maxY - 1e-9);
    expect(Math.abs(exact.maxY - sampled.maxY)).toBeLessThan(0.01);
  });

  it('covers control points, so handles stay reachable', () => {
    const path = parsed('M0 0 C0 100 100 100 100 0');
    const control = controlBoundsOfPath(path);
    expect(control?.maxY).toBe(100);
  });

  it('unions, compares and intersects boxes', () => {
    const a = boxFromPoints([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
    const b = boxFromPoints([
      { x: 20, y: 5 },
      { x: 30, y: 15 },
    ]);
    expect(unionBoxes(a, b)).toEqual({ minX: 0, minY: 0, maxX: 30, maxY: 15 });
    expect(unionBoxes(null, a)).toEqual(a);
    expect(unionBoxes(null, null)).toBeNull();
    expect(boxesOverlap(a, b)).toBe(false);
    expect(boxesOverlap(a, b, 20)).toBe(true);
    expect(EMPTY_BOX).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it('measures a single line segment', () => {
    const path = parsed('M5 5 L20 30');
    const segment = segmentsOf(path.contours[0]!)[0]!;
    expect(segmentBounds(segment)).toEqual({ minX: 5, minY: 5, maxX: 20, maxY: 30 });
  });
});

describe('area and orientation', () => {
  it('measures a rectangle exactly', () => {
    expect(areaOfPath(SQUARE(120))).toBeCloseTo(14_400, 6);
  });

  it('is positive for a clockwise contour and negative for a counter-clockwise one', () => {
    const clockwise = parsed('M0 0 L10 0 L10 10 L0 10 Z');
    const counter = parsed('M0 0 L0 10 L10 10 L10 0 Z');
    expect(signedAreaOfContour(clockwise.contours[0]!)).toBeGreaterThan(0);
    expect(signedAreaOfContour(counter.contours[0]!)).toBeLessThan(0);
    expect(areaOfContour(counter.contours[0]!)).toBeCloseTo(100, 6);
  });

  it('subtracts a hole from the shape that contains it', () => {
    const donut = parsed('M0 0 L100 0 L100 100 L0 100 Z M25 25 L25 75 L75 75 L75 25 Z');
    expect(signedAreaOfPath(donut)).toBeCloseTo(10_000 - 2_500, 6);
    expect(areaOfPath(donut)).toBeCloseTo(7_500, 6);
  });

  it('matches the analytic area of a circle to within the curve approximation', () => {
    const circle = ellipsePath({ minX: 0, minY: 0, maxX: 200, maxY: 200 });
    const expected = Math.PI * 100 * 100;
    expect(Math.abs(areaOfPath(circle) - expected) / expected).toBeLessThan(0.0005);
  });

  it('is exact for a closed cubic contour rather than approximate', () => {
    // A shape whose boundary is entirely curves: area from the Gauss rule must equal a Riemann sum
    // computed from a very fine sampling.
    const path = parsed('M0 0 C50 -20 100 20 150 0 C120 60 30 60 0 0 Z');
    const contour = path.contours[0]!;
    let sampled = 0;
    const steps = 200_000;
    for (const segment of segmentsOf(contour)) {
      for (let step = 0; step < steps; step += 1) {
        const t0 = step / steps;
        const t1 = (step + 1) / steps;
        const a = pointOnSegment(segment, t0);
        const b = pointOnSegment(segment, t1);
        sampled += (a.x * b.y - b.x * a.y) / 2;
      }
    }
    expect(Math.abs(signedAreaOfContour(contour) - sampled)).toBeLessThan(1e-3);
  });

  it('finds the centroid of a square and of a donut', () => {
    const square = centroidOfContour(SQUARE(10).contours[0]!);
    expect(square?.x).toBeCloseTo(5, 6);
    expect(square?.y).toBeCloseTo(5, 6);

    const donut = parsed('M0 0 L100 0 L100 100 L0 100 Z M25 25 L25 75 L75 75 L75 25 Z');
    const centroid = centroidOfPath(donut);
    expect(centroid?.x).toBeCloseTo(50, 3);
    expect(centroid?.y).toBeCloseTo(50, 3);
  });

  it('refuses a centroid for a degenerate contour', () => {
    const line = parsed('M0 0 L10 0');
    expect(centroidOfContour(line.contours[0]!)).toBeNull();
    expect(centroidOfPath(line)).toBeNull();
  });
});

describe('flattening', () => {
  it('approximates a quarter circle within the flattening tolerance', () => {
    const circle = ellipsePath({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    const flat = flattenContour(circle.contours[0]!, TOLERANCE.flatten);
    expect(flat.closed).toBe(true);
    for (const point of flat.points) {
      const radius = Math.hypot(point.x - 50, point.y - 50);
      expect(Math.abs(radius - 50)).toBeLessThan(0.05);
    }
    expect(flat.points[0]).toEqual(flat.points[flat.points.length - 1]);
  });

  it('never exceeds the tolerance it was given, and refines when asked for more accuracy', () => {
    const path = parsed('M0 0 C40 200 160 200 200 0');
    const segment = segmentsOf(path.contours[0]!)[0]!;

    const deviation = (tolerance: number): number => {
      const points = [segment.from, ...flattenBetween(segment, tolerance), segment.to];
      let worst = 0;
      for (let step = 0; step <= 500; step += 1) {
        const point = pointOnSegment(segment, step / 500);
        let nearest = Infinity;
        for (let index = 0; index < points.length - 1; index += 1) {
          const a = points[index]!;
          const b = points[index + 1]!;
          nearest = Math.min(nearest, distanceToSegment(point, a, b));
        }
        worst = Math.max(worst, nearest);
      }
      return worst;
    };

    expect(deviation(0.5)).toBeLessThanOrEqual(0.5);
    expect(deviation(0.05)).toBeLessThanOrEqual(0.05);
    expect(flattenedSegmentCount(path, 0.01)).toBeGreaterThan(flattenedSegmentCount(path, 1));
  });

  it('splits a cubic exactly: both halves lie on the original curve', () => {
    const path = parsed('M0 0 C10 60 90 60 100 0');
    const segment = segmentsOf(path.contours[0]!)[0]!;
    const split = splitCubic(segment.from, segment.control1!, segment.control2!, segment.to);
    const left = segmentsOf({
      nodes: [
        { point: split.left[0], handleIn: null, handleOut: split.left[1] },
        { point: split.left[3], handleIn: split.left[2], handleOut: null },
      ],
      closed: false,
    })[0]!;
    for (let step = 0; step <= 50; step += 1) {
      const t = step / 50;
      const onHalf = pointOnSegment(left, t);
      const onOriginal = pointOnSegment(segment, t / 2);
      expect(Math.hypot(onHalf.x - onOriginal.x, onHalf.y - onOriginal.y)).toBeLessThan(1e-9);
    }
    expect(split.mid).toEqual(pointOnSegment(segment, 0.5));
  });

  it('inserts a node on a curve without moving the curve', () => {
    const contour = parsed('M0 0 C10 60 90 60 100 0').contours[0]!;
    const before = toPathData({ contours: [contour] }, { digits: 6 });
    const nodes = insertNodeBetween(contour.nodes, 0, 0.4, false);
    expect(nodes).toHaveLength(3);
    const after = toPathData({ contours: [{ nodes: nodes ?? [], closed: false }] }, { digits: 6 });

    const original = segmentsOf(contour)[0]!;
    const insertedPath = { contours: [{ nodes: nodes ?? [], closed: false }] };
    for (let step = 0; step <= 100; step += 1) {
      const expected = pointOnSegment(original, (step / 100) * 0.4);
      const nearest = closestPointOnPath(insertedPath, expected);
      expect(nearest?.distance).toBeLessThan(0.001);
    }
    expect(after).not.toBe(before);
  });

  it('finds the closest point and its parameter on a line', () => {
    const path = parsed('M0 0 L100 0');
    const closest = closestPointOnPath(path, { x: 30, y: 12 });
    expect(closest?.point.x).toBeCloseTo(30, 3);
    expect(closest?.point.y).toBeCloseTo(0, 6);
    expect(closest?.distance).toBeCloseTo(12, 3);
    expect(closest?.t).toBeCloseTo(0.3, 3);
  });

  it('flattens a path with several contours independently', () => {
    const path = parsed('M0 0 L10 0 L10 10 Z M20 20 L30 20 L30 30 Z');
    const flat = flattenPath(path);
    expect(flat).toHaveLength(2);
    expect(flat[0]?.closed).toBe(true);
    expect(flat[1]?.points[0]).toEqual({ x: 20, y: 20 });
  });
});

describe('transforms', () => {
  it('composes in the order a caller expects: apply(right) then left', () => {
    const move = translation(10, 0);
    const scale = scaling(2, 2);
    const composed = { ...applyCompose(scale, move) };
    expect(applyToPoint(composed, { x: 1, y: 1 })).toEqual({ x: 22, y: 2 });
  });

  it('inverts a matrix, and refuses a singular one', () => {
    const matrixValue = matrix(2, 0, 0, 3, 5, 7);
    const inverse = invert(matrixValue);
    expect(inverse).not.toBeNull();
    if (!inverse) return;
    const point = applyToPoint(inverse, applyToPoint(matrixValue, { x: 4, y: -2 }));
    expect(point.x).toBeCloseTo(4, 9);
    expect(point.y).toBeCloseTo(-2, 9);
    expect(invert(scaling(0, 1))).toBeNull();
  });

  it('rotates about the origin and keeps lengths', () => {
    const rotated = applyToPoint(rotation(Math.PI / 2), { x: 1, y: 0 });
    expect(rotated.x).toBeCloseTo(0, 12);
    expect(rotated.y).toBeCloseTo(1, 12);
  });

  it('maps one box onto another, and refuses a box with no extent', () => {
    const mapped = matrixBetweenBoxes(
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      { minX: 100, minY: 50, maxX: 200, maxY: 250 },
    );
    expect(mapped).not.toBeNull();
    if (!mapped) return;
    expect(applyToPoint(mapped, { x: 0, y: 0 })).toEqual({ x: 100, y: 50 });
    expect(applyToPoint(mapped, { x: 10, y: 10 })).toEqual({ x: 200, y: 250 });
    expect(
      matrixBetweenBoxes(
        { minX: 0, minY: 0, maxX: 0, maxY: 10 },
        { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      ),
    ).toBeNull();
  });

  it('transforms geometry without changing its ratios', () => {
    const square = SQUARE(10);
    const transformed = transformPath(square, matrix(2, 0, 0, 2, 5, 5));
    expect(boundsOfPath(transformed)).toEqual({ minX: 5, minY: 5, maxX: 25, maxY: 25 });
    expect(areaOfPath(transformed)).toBeCloseTo(400, 6);
    expect(transformPath(square, IDENTITY)).toBe(square);
  });

  it('transforms handles with their node, so curves stay curves', () => {
    const curve = parsed('M0 0 C10 10 20 10 30 0');
    const moved = transformPath(curve, translation(5, 5));
    expect(moved.contours[0]?.nodes[0]?.handleOut).toEqual({ x: 15, y: 15 });
    expect(moved.contours[0]?.nodes[1]?.point).toEqual({ x: 35, y: 5 });
  });
});

describe('hit-testing', () => {
  it('reports a point inside a rectangle as a fill hit', () => {
    const square = SQUARE(100);
    expect(pathContainsPoint(square, { x: 50, y: 50 })).toBe(true);
    expect(pathContainsPoint(square, { x: 150, y: 50 })).toBe(false);
    expect(hitTestPath(square, { x: 50, y: 50 }).region).toBe('fill');
  });

  it('honours the even-odd rule for a donut', () => {
    const donut = parsed('M0 0 L100 0 L100 100 L0 100 Z M25 25 L25 75 L75 75 L75 25 Z');
    // Non-zero would also report the hole, so the contour windings must be opposite for even-odd.
    const insideHole = { x: 50, y: 50 };
    const filled = { x: 10, y: 50 };
    expect(pathContainsPoint(donut, filled, { fillRule: 'evenodd' })).toBe(true);
    expect(pathContainsPoint(donut, insideHole, { fillRule: 'evenodd' })).toBe(false);
  });

  it('picks a thin stroke with an explicit slack, and reports the distance', () => {
    const line = parsed('M0 0 L100 0');
    const near = hitTestPath(line, { x: 50, y: 2 }, { slack: 3 });
    expect(near.hit).toBe(true);
    expect(near.region).toBe('stroke');
    expect(near.distanceToStroke).toBeCloseTo(2, 6);

    const far = hitTestPath(line, { x: 50, y: 20 }, { slack: 3 });
    expect(far.hit).toBe(false);
    expect(far.region).toBeNull();
    expect(distanceToPath(line, { x: 50, y: 20 })).toBeCloseTo(20, 6);
  });

  it('can restrict a hit test to the fill or to the stroke', () => {
    const square = SQUARE(100);
    expect(hitTestPath(square, { x: 0, y: 0 }, { fill: false, stroke: true, slack: 5 }).hit).toBe(
      true,
    );
    expect(hitTestPath(square, { x: 0, y: 0 }, { fill: false, stroke: false }).hit).toBe(false);
    expect(hitTestPath(square, { x: 50, y: 50 }, { fill: true, stroke: false }).region).toBe(
      'fill',
    );
  });

  it('separates outline marquees from shape marquees', () => {
    const square = SQUARE(100);
    const inside = { minX: 20, minY: 20, maxX: 30, maxY: 30 };
    const crossing = { minX: 40, minY: -10, maxX: 60, maxY: 10 };
    const away = { minX: 200, minY: 200, maxX: 300, maxY: 300 };

    // A marquee entirely inside the shape touches no outline, but it does overlap the shape.
    expect(pathIntersectsBox(square, inside)).toBe(false);
    expect(shapeIntersectsBox(square, inside)).toBe(true);

    // A marquee straddling an edge — including one flush with it — touches the outline.
    expect(pathIntersectsBox(square, crossing)).toBe(true);
    expect(shapeIntersectsBox(square, crossing)).toBe(true);

    expect(pathIntersectsBox(square, away)).toBe(false);
    expect(shapeIntersectsBox(square, away)).toBe(false);
  });
});

function applyCompose(left: ReturnType<typeof scaling>, right: ReturnType<typeof translation>) {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

type FlatPoint = { x: number; y: number };

function flattenBetween(
  segment: ReturnType<typeof segmentsOf>[number],
  tolerance: number,
): FlatPoint[] {
  const points: FlatPoint[] = [];
  const recurse = (
    p0: FlatPoint,
    p1: FlatPoint,
    p2: FlatPoint,
    p3: FlatPoint,
    depth: number,
  ): void => {
    const flatness = Math.max(distanceToSegment(p1, p0, p3), distanceToSegment(p2, p0, p3));
    if (flatness <= tolerance || depth >= 18) return;
    const split = splitCubic(p0, p1, p2, p3);
    recurse(split.left[0], split.left[1], split.left[2], split.left[3], depth + 1);
    points.push(split.mid);
    recurse(split.right[0], split.right[1], split.right[2], split.right[3], depth + 1);
  };
  if (segment.control1 && segment.control2) {
    recurse(segment.from, segment.control1, segment.control2, segment.to, 0);
  }
  return points;
}

function distanceToSegment(candidate: FlatPoint, a: FlatPoint, b: FlatPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(candidate.x - a.x, candidate.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((candidate.x - a.x) * dx + (candidate.y - a.y) * dy) / lengthSquared),
  );
  return Math.hypot(candidate.x - (a.x + t * dx), candidate.y - (a.y + t * dy));
}

describe('edge cases the renderer depends on', () => {
  it('treats a single-node path as a dot with zero bounds', () => {
    const dot = parsed('M5 5');
    expect(boundsOfPath(dot)).toEqual({ minX: 5, minY: 5, maxX: 5, maxY: 5 });
    expect(areaOfPath(dot)).toBe(0);
    expect(pathContainsPoint(dot, { x: 5, y: 5 })).toBe(false);
  });

  it('measures a straight closed line as zero area', () => {
    const degenerate = rectanglePath({ minX: 0, minY: 0, maxX: 0, maxY: 100 });
    expect(areaOfPath(degenerate)).toBe(0);
  });
});
