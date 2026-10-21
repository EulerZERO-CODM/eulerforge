/**
 * Hit-testing: is this point on the artwork?
 *
 * Everything works on the flattened form of the path, at a tolerance the caller can inspect, which
 * is the same approximation the boolean kernel uses. A pixel-accurate curve test would need a
 * different (and much larger) piece of mathematics for no user-visible gain: the pointer has a
 * resolution of one pixel and a click target of several.
 *
 * The fill rules follow SVG: `nonzero` counts signed crossings, `evenodd` counts crossings.
 */

import { flattenPath, type FlatContour } from './flatten';
import { TOLERANCE } from './tolerance';
import { type FillRule, type VectorBox, type VectorPath, type VectorPoint } from './types';

export type HitOptions = {
  readonly tolerance?: number;
  readonly fillRule?: FillRule;
  /** Test the filled interior. Defaults to true. */
  readonly fill?: boolean;
  /** Test the stroke. Defaults to true. */
  readonly stroke?: boolean;
  /** Stroke width in the path's own units, used to widen the stroke target. */
  readonly strokeWidth?: number;
};

function ringIntersections(ring: readonly VectorPoint[], candidate: VectorPoint): number {
  let crossings = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const a = ring[index];
    const b = ring[index + 1];
    if (!a || !b) continue;
    // Half-open rule: a vertex exactly on the ray is counted once, which is what keeps the
    // crossing count stable for points that line up with a vertex.
    const straddles = a.y > candidate.y !== b.y > candidate.y;
    if (!straddles) continue;
    const x = a.x + ((candidate.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (x > candidate.x) crossings += 1;
  }
  return crossings;
}

function ringWinding(ring: readonly VectorPoint[], candidate: VectorPoint): number {
  let winding = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const a = ring[index];
    const b = ring[index + 1];
    if (!a || !b) continue;
    if (a.y <= candidate.y) {
      if (b.y > candidate.y && isLeft(a, b, candidate) > 0) winding += 1;
    } else if (b.y <= candidate.y && isLeft(a, b, candidate) < 0) {
      winding -= 1;
    }
  }
  return winding;
}

function isLeft(a: VectorPoint, b: VectorPoint, candidate: VectorPoint): number {
  return (b.x - a.x) * (candidate.y - a.y) - (candidate.x - a.x) * (b.y - a.y);
}

/**
 * Whether a point is inside a flattened contour, honouring the fill rule.
 *
 * An open contour is closed implicitly, exactly as SVG fills one: the fill of an open path is the
 * region between its endpoints and the straight line joining them.
 */
export function flatContourContains(
  contour: FlatContour,
  candidate: VectorPoint,
  fillRule: FillRule = 'nonzero',
): boolean {
  const ring = contour.points;
  if (ring.length < 3) return false;
  return fillRule === 'evenodd'
    ? ringIntersections(ring, candidate) % 2 === 1
    : ringWinding(ring, candidate) !== 0;
}

/**
 * Whether a point is inside the filled region of a path.
 *
 * The fill rule is evaluated across the *whole* path, not per contour: a point inside both rings of a
 * donut crosses the boundary twice, which is what makes it a hole under the even-odd rule and what a
 * renderer does. Testing each contour separately and OR-ing the results would fill every hole.
 */
export function pathContainsPoint(
  path: VectorPath,
  candidate: VectorPoint,
  options: HitOptions = {},
): boolean {
  const tolerance = options.tolerance ?? TOLERANCE.flatten;
  const fillRule = options.fillRule ?? 'nonzero';
  const contours = flattenPath(path, tolerance);

  if (fillRule === 'evenodd') {
    const crossings = contours.reduce(
      (total, contour) => total + ringIntersections(contour.points, candidate),
      0,
    );
    return crossings % 2 === 1;
  }

  const winding = contours.reduce(
    (total, contour) => total + ringWinding(contour.points, candidate),
    0,
  );
  return winding !== 0;
}
function pointToSegmentDistance(candidate: VectorPoint, a: VectorPoint, b: VectorPoint): number {
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

/** Distance from a point to the nearest point on the flattened path. */
export function distanceToPath(
  path: VectorPath,
  candidate: VectorPoint,
  tolerance: number = TOLERANCE.flatten,
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const contour of flattenPath(path, tolerance)) {
    for (let index = 0; index < contour.points.length - 1; index += 1) {
      const a = contour.points[index];
      const b = contour.points[index + 1];
      if (!a || !b) continue;
      const distance = pointToSegmentDistance(candidate, a, b);
      if (distance < best) best = distance;
    }
  }
  return best;
}

export type HitResult = {
  readonly hit: boolean;
  /** Which test matched. `null` when nothing did. */
  readonly region: 'fill' | 'stroke' | null;
  readonly distanceToStroke: number;
};

/**
 * Hit test for the editor: fill and/or stroke, with an explicit pick slack.
 *
 * `slack` widens a thin stroke to something a person can actually click. It is an argument rather
 * than a constant because the value that feels right depends on the zoom, and the caller knows the
 * zoom.
 */
export function hitTestPath(
  path: VectorPath,
  candidate: VectorPoint,
  options: HitOptions & { readonly slack?: number } = {},
): HitResult {
  const tolerance = options.tolerance ?? TOLERANCE.flatten;
  const slack = options.slack ?? TOLERANCE.strokeSlack;
  const testFill = options.fill ?? true;
  const testStroke = options.stroke ?? true;
  const distanceToStroke = distanceToPath(path, candidate, tolerance);
  const strokeWidth = options.strokeWidth ?? 1;
  const reach = Math.max(strokeWidth / 2, 0) + slack;

  if (testStroke && distanceToStroke <= reach) {
    return { hit: true, region: 'stroke', distanceToStroke };
  }
  if (testFill && pathContainsPoint(path, candidate, { ...options, tolerance })) {
    return { hit: true, region: 'fill', distanceToStroke };
  }
  return { hit: false, region: null, distanceToStroke };
}

/**
 * Whether the path's *outline* enters a box.
 *
 * This answers "did the marquee touch the boundary", which is what a node-level selection wants.
 * `shapeIntersectsBox` answers the other question a marquee asks: does the box overlap the filled
 * shape at all, including when the marquee sits entirely inside one.
 */
export function pathIntersectsBox(
  path: VectorPath,
  box: VectorBox,
  tolerance: number = TOLERANCE.flatten,
): boolean {
  for (const contour of flattenPath(path, tolerance)) {
    for (let index = 0; index < contour.points.length - 1; index += 1) {
      const a = contour.points[index];
      const b = contour.points[index + 1];
      if (!a || !b) continue;
      if (segmentIntersectsBox(a, b, box)) return true;
    }
  }
  return false;
}

/** Whether a marquee overlaps the shape: the outline, or the filled area it encloses. */
export function shapeIntersectsBox(
  path: VectorPath,
  box: VectorBox,
  options: HitOptions = {},
): boolean {
  if (pathIntersectsBox(path, box, options.tolerance ?? TOLERANCE.flatten)) return true;
  const corners: readonly VectorPoint[] = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
  return corners.some((corner) => pathContainsPoint(path, corner, options));
}

/**
 * Whether a straight segment meets an axis-aligned box, including the cases where it merely touches
 * an edge or runs along one.
 *
 * The orientation test used for genuine crossings misses both of those, and both happen constantly
 * with rectangular artwork — a marquee drawn level with the top edge of a rectangle would otherwise
 * select nothing. This is a Liang–Barsky clip: the segment's parameter range is intersected with the
 * box's half-planes, and the segment meets the box when any part of [0, 1] survives.
 */
export function segmentIntersectsBox(a: VectorPoint, b: VectorPoint, box: VectorBox): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let lower = 0;
  let upper = 1;

  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0; // Parallel to this edge: inside only when it is on the right side.
    const ratio = q / p;
    if (p < 0) {
      if (ratio > upper) return false;
      if (ratio > lower) lower = ratio;
    } else {
      if (ratio < lower) return false;
      if (ratio < upper) upper = ratio;
    }
    return true;
  };

  return (
    clip(-dx, a.x - box.minX) &&
    clip(dx, box.maxX - a.x) &&
    clip(-dy, a.y - box.minY) &&
    clip(dy, box.maxY - a.y)
  );
}

/** Orientation of the triangle (a, b, c): 0 collinear, 1 clockwise, 2 counter-clockwise. */
function orientation(a: VectorPoint, b: VectorPoint, c: VectorPoint): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 1e-12) return 0;
  return value > 0 ? 1 : 2;
}

/**
 * Whether two segments cross at a single interior point.
 *
 * Touching endpoints and collinear overlaps deliberately do not count: they are the shared-vertex
 * case every closed contour is made of, and treating them as crossings would report a rectangle as
 * self-intersecting.
 */
export function segmentsProperlyCross(
  a: VectorPoint,
  b: VectorPoint,
  c: VectorPoint,
  d: VectorPoint,
): boolean {
  // Segments that share an endpoint are adjacent, not crossing. Every closed contour is built from
  // such pairs — including the wrap-around pair (last, first) — and without this guard a rectangle
  // reports itself as self-intersecting.
  const same = (left: VectorPoint, right: VectorPoint): boolean =>
    Math.abs(left.x - right.x) <= 1e-9 && Math.abs(left.y - right.y) <= 1e-9;
  if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) return false;

  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 !== o2 && o3 !== o4;
}

/**
 * Flattened segment count of a path.
 *
 * The inspector reports it as the geometry cost of a shape: a hand-drawn curve is a few thousand
 * straight segments once a boolean operation has run, and saying so is more useful than hiding it.
 */
export function flattenedSegments(path: VectorPath, tolerance: number = TOLERANCE.flatten): number {
  return flattenPath(path, tolerance).reduce(
    (total, contour) => total + Math.max(0, contour.points.length - 1),
    0,
  );
}
