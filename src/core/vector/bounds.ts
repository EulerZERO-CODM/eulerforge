/**
 * Exact bounds of a path.
 *
 * "Exact" is meant literally: a cubic's extremes are found from the roots of its derivative, not by
 * sampling. Sampling would make the bounds depend on a step size, which is exactly the kind of
 * hidden tolerance this kernel avoids — and it would under-report bounds for sharp curves, which is
 * how artwork ends up clipped.
 */

import { segmentsOf, allSegments } from './path';
import { type PathSegment, type VectorBox, type VectorPath, type VectorPoint } from './types';

export const EMPTY_BOX: VectorBox = Object.freeze({ minX: 0, minY: 0, maxX: 0, maxY: 0 });

export function isEmptyBox(box: VectorBox): boolean {
  return box.minX === box.maxX || box.minY === box.maxY;
}

export function boxWidth(box: VectorBox): number {
  return box.maxX - box.minX;
}

export function boxHeight(box: VectorBox): number {
  return box.maxY - box.minY;
}

export function boxCenter(box: VectorBox): VectorPoint {
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

export function boxFromPoints(points: readonly VectorPoint[]): VectorBox {
  const first = points[0];
  if (!first) return EMPTY_BOX;
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (const candidate of points) {
    if (candidate.x < minX) minX = candidate.x;
    if (candidate.y < minY) minY = candidate.y;
    if (candidate.x > maxX) maxX = candidate.x;
    if (candidate.y > maxY) maxY = candidate.y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionBoxes(a: VectorBox | null, b: VectorBox | null): VectorBox | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function boxContainsPoint(box: VectorBox, candidate: VectorPoint, tolerance = 0): boolean {
  return (
    candidate.x >= box.minX - tolerance &&
    candidate.x <= box.maxX + tolerance &&
    candidate.y >= box.minY - tolerance &&
    candidate.y <= box.maxY + tolerance
  );
}

export function boxesOverlap(a: VectorBox, b: VectorBox, tolerance = 0): boolean {
  return (
    a.minX - tolerance <= b.maxX &&
    b.minX - tolerance <= a.maxX &&
    a.minY - tolerance <= b.maxY &&
    b.minY - tolerance <= a.maxY
  );
}

function cubicValue(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * Parameters in (0,1) where a cubic's derivative is zero, for one coordinate.
 *
 * B'(t)/3 = (−p0 + 3p1 − 3p2 + p3)t² + 2(p0 − 2p1 + p2)t + (p1 − p0). A degenerate leading
 * coefficient means the curve is quadratic in that coordinate, so the single linear root is used.
 */
function extremaParameters(p0: number, p1: number, p2: number, p3: number): readonly number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];

  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) {
      const t = -c / b;
      if (t > 0 && t < 1) roots.push(t);
    }
    return roots;
  }

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return roots;
  const root = Math.sqrt(discriminant);
  const t1 = (-b + root) / (2 * a);
  const t2 = (-b - root) / (2 * a);
  if (t1 > 0 && t1 < 1) roots.push(t1);
  if (t2 > 0 && t2 < 1 && Math.abs(t2 - t1) > 1e-12) roots.push(t2);
  return roots;
}

/** Bounds of a single segment, exact for cubics. */
export function segmentBounds(segment: PathSegment): VectorBox {
  const { from, to, control1, control2 } = segment;
  if (segment.kind === 'line' || control1 === null || control2 === null) {
    return boxFromPoints([from, to]);
  }

  const candidates: VectorPoint[] = [from, to];
  for (const t of extremaParameters(from.x, control1.x, control2.x, to.x)) {
    candidates.push({
      x: cubicValue(from.x, control1.x, control2.x, to.x, t),
      y: cubicValue(from.y, control1.y, control2.y, to.y, t),
    });
  }
  for (const t of extremaParameters(from.y, control1.y, control2.y, to.y)) {
    candidates.push({
      x: cubicValue(from.x, control1.x, control2.x, to.x, t),
      y: cubicValue(from.y, control1.y, control2.y, to.y, t),
    });
  }
  return boxFromPoints(candidates);
}

/** Bounds of one contour. Empty contours produce `null` rather than a zero box at the origin. */
export function contourBounds(contour: VectorPath['contours'][number]): VectorBox | null {
  const nodes = contour.nodes;
  if (nodes.length === 0) return null;
  const first = nodes[0];
  if (!first) return null;
  if (nodes.length === 1) {
    // A lone node draws nothing unless it carries handles — a single-node contour is a dot, and its
    // bounds are that dot. Handles are ignored because they are not painted.
    return boxFromPoints([first.point]);
  }
  let box: VectorBox | null = boxFromPoints([first.point]);
  for (const segment of segmentsOf(contour)) {
    box = unionBoxes(box, segmentBounds(segment));
  }
  return box;
}

/** Bounds of the whole path, or `null` for a path with no geometry. */
export function boundsOfPath(path: VectorPath): VectorBox | null {
  let box: VectorBox | null = null;
  for (const contour of path.contours) {
    box = unionBoxes(box, contourBounds(contour));
  }
  return box;
}

/**
 * Bounds including Bezier control points.
 *
 * Control-point bounds are the *convex hull* of a curve, so they are never smaller than the true
 * bounds. Used by the editor when a node's handles must stay reachable on screen.
 */
export function controlBoundsOfPath(path: VectorPath): VectorBox | null {
  let box: VectorBox | null = null;
  const absorb = (candidate: VectorPoint | undefined | null): void => {
    if (candidate) box = unionBoxes(box, boxFromPoints([candidate]));
  };
  for (const contour of path.contours) {
    for (const node of contour.nodes) {
      absorb(node.point);
      absorb(node.handleIn);
      absorb(node.handleOut);
    }
  }
  return box;
}

/** Bounds of every segment of a path, in drawing order. Used by the hit tests and by tests. */
export function segmentBoxesOf(path: VectorPath): readonly VectorBox[] {
  return allSegments(path).map((segment) => segmentBounds(segment));
}
