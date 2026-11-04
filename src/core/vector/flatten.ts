/**
 * Curve flattening and point sampling.
 *
 * Two consumers need polylines: hit-testing wants cheap inside/outside tests, and the boolean kernel
 * wants polygons. Both go through this module so the approximation is made once, with a tolerance
 * the caller can see — and so the tolerance appears in the boolean result rather than nowhere.
 *
 * The algorithm is the classic recursive de Casteljau subdivision with a flatness test: a cubic is
 * replaced by its chord when both control points lie within `tolerance` of that chord. Recursion
 * depth is bounded (documented below), so a pathologically shaped curve degrades to a coarse
 * approximation instead of exhausting the stack — and the result is always the same for the same
 * input, because the subdivision is driven only by the geometry.
 */

import {
  createContour,
  createPath,
  type Contour,
  type PathNode,
  type PathSegment,
  type VectorPath,
  type VectorPoint,
} from './types';
import { segmentsOf } from './path';
import { TOLERANCE } from './tolerance';

/** Maximum subdivision depth. 2^-18 of a segment is far below any tolerance this kernel uses. */
export const MAX_SUBDIVISION_DEPTH = 18;

/** A polyline with the same endpoints as the contour it came from. */
export type FlatContour = {
  readonly points: readonly VectorPoint[];
  readonly closed: boolean;
};

export type FlattenOptions = {
  readonly tolerance?: number;
};

export function flattenTolerance(options: FlattenOptions = {}): number {
  return options.tolerance ?? TOLERANCE.flatten;
}

function distanceToLine(candidate: VectorPoint, start: VectorPoint, end: VectorPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(candidate.x - start.x, candidate.y - start.y);
  }
  const t = ((candidate.x - start.x) * dx + (candidate.y - start.y) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(candidate.x - (start.x + clamped * dx), candidate.y - (start.y + clamped * dy));
}

/** Midpoint of a cubic by de Casteljau — also the split point for the two halves. */
export function splitCubic(
  from: VectorPoint,
  control1: VectorPoint,
  control2: VectorPoint,
  to: VectorPoint,
): {
  readonly left: readonly [VectorPoint, VectorPoint, VectorPoint, VectorPoint];
  readonly right: readonly [VectorPoint, VectorPoint, VectorPoint, VectorPoint];
  readonly mid: VectorPoint;
} {
  const mid = (a: VectorPoint, b: VectorPoint): VectorPoint => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const p01 = mid(from, control1);
  const p12 = mid(control1, control2);
  const p23 = mid(control2, to);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const p0123 = mid(p012, p123);
  return {
    left: [from, p01, p012, p0123],
    right: [p0123, p123, p23, to],
    mid: p0123,
  };
}

/** The point on a segment at parameter `t`. */
export function pointOnSegment(segment: PathSegment, t: number): VectorPoint {
  const { from, to, control1, control2 } = segment;
  if (segment.kind === 'line' || control1 === null || control2 === null) {
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  }
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * from.x + 3 * uu * t * control1.x + 3 * u * tt * control2.x + tt * t * to.x,
    y: uu * u * from.y + 3 * uu * t * control1.y + 3 * u * tt * control2.y + tt * t * to.y,
  };
}

/** The derivative of a segment at `t`, used by tangents and by arc-length refinement. */
export function tangentOnSegment(segment: PathSegment, t: number): VectorPoint {
  const { from, to, control1, control2 } = segment;
  if (segment.kind === 'line' || control1 === null || control2 === null) {
    return { x: to.x - from.x, y: to.y - from.y };
  }
  const u = 1 - t;
  return {
    x:
      3 * u * u * (control1.x - from.x) +
      6 * u * t * (control2.x - control1.x) +
      3 * t * t * (to.x - control2.x),
    y:
      3 * u * u * (control1.y - from.y) +
      6 * u * t * (control2.y - control1.y) +
      3 * t * t * (to.y - control2.y),
  };
}

/**
 * Points along a segment, adapted to the tolerance.
 *
 * Returns the interior points only: the caller already has `segment.from`, and including it again
 * would add duplicate points to a polyline.
 */
export function flattenSegment(
  segment: PathSegment,
  tolerance: number = TOLERANCE.flatten,
): readonly VectorPoint[] {
  const { from, to, control1, control2 } = segment;
  if (segment.kind === 'line' || control1 === null || control2 === null) return [];

  const points: VectorPoint[] = [];
  const recurse = (
    p0: VectorPoint,
    p1: VectorPoint,
    p2: VectorPoint,
    p3: VectorPoint,
    depth: number,
  ): void => {
    const flatness = Math.max(distanceToLine(p1, p0, p3), distanceToLine(p2, p0, p3));
    if (flatness <= tolerance || depth >= MAX_SUBDIVISION_DEPTH) return;
    const split = splitCubic(p0, p1, p2, p3);
    const [l0, l1, l2, l3] = split.left;
    const [r0, r1, r2, r3] = split.right;
    recurse(l0, l1, l2, l3, depth + 1);
    points.push(split.mid);
    recurse(r0, r1, r2, r3, depth + 1);
  };
  recurse(from, control1, control2, to, 0);
  return points;
}

/** A contour as a polyline. A closed contour repeats its first point at the end. */
export function flattenContour(
  contour: Contour,
  tolerance: number = TOLERANCE.flatten,
): FlatContour {
  const nodes = contour.nodes;
  const first = nodes[0];
  if (!first) return { points: [], closed: contour.closed };

  const points: VectorPoint[] = [first.point];
  for (const segment of segmentsOf(contour)) {
    for (const interior of flattenSegment(segment, tolerance)) points.push(interior);
    points.push(segment.to);
  }
  if (contour.closed) {
    // The closing segment ends where it started; keep one copy for ring-style consumers.
    const last = points[points.length - 1];
    if (!last || last.x !== first.point.x || last.y !== first.point.y) points.push(first.point);
  }
  return { points, closed: contour.closed };
}

export function flattenPath(
  path: VectorPath,
  tolerance: number = TOLERANCE.flatten,
): readonly FlatContour[] {
  return path.contours.map((contour) => flattenContour(contour, tolerance));
}

/** Rectilinear form of a path: closed contours become rings, open ones stay polylines. */
export function toPolylines(
  path: VectorPath,
  options: FlattenOptions = {},
): readonly (readonly VectorPoint[])[] {
  const tolerance = flattenTolerance(options);
  return flattenPath(path, tolerance).map((contour) => contour.points);
}

/** Number of straight segments the path flattens to — the honest cost of a boolean operation. */
export function flattenedSegmentCount(
  path: VectorPath,
  tolerance: number = TOLERANCE.flatten,
): number {
  return flattenPath(path, tolerance).reduce(
    (total, contour) => total + Math.max(0, contour.points.length - 1),
    0,
  );
}

export type ClosestPoint = {
  readonly contourIndex: number;
  /** Index of the segment within the contour, in drawing order. */
  readonly segmentIndex: number;
  readonly t: number;
  readonly point: VectorPoint;
  readonly distance: number;
  readonly closed: boolean;
};

/**
 * The nearest point on the path to `candidate`.
 *
 * Used for two things that must agree: deciding whether a click hit a stroke, and inserting a node
 * where the user clicked. Both call this, so the point the user sees highlighted is the point the
 * editor inserts.
 */
export function closestPointOnPath(path: VectorPath, candidate: VectorPoint): ClosestPoint | null {
  let best: ClosestPoint | null = null;

  path.contours.forEach((contour, contourIndex) => {
    const segments = segmentsOf(contour);
    segments.forEach((segment, segmentIndex) => {
      const samples: { readonly t: number; readonly point: VectorPoint }[] = [];
      // Coarse scan, then a local refinement: exact enough for a click target, and independent of
      // the curve's parameterisation being uniform (which it is not).
      const steps = 16;
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        samples.push({ t, point: pointOnSegment(segment, t) });
      }
      let localBest = samples[0];
      if (!localBest) return;
      for (const sample of samples) {
        if (distance(sample.point, candidate) < distance(localBest.point, candidate)) {
          localBest = sample;
        }
      }
      let low = Math.max(0, localBest.t - 1 / steps);
      let high = Math.min(1, localBest.t + 1 / steps);
      for (let iteration = 0; iteration < 24; iteration += 1) {
        const mid = (low + high) / 2;
        const left = pointOnSegment(segment, (low + mid) / 2);
        const right = pointOnSegment(segment, (mid + high) / 2);
        if (distance(left, candidate) < distance(right, candidate)) high = mid;
        else low = mid;
      }
      const t = (low + high) / 2;
      const point = pointOnSegment(segment, t);
      const found: ClosestPoint = {
        contourIndex,
        segmentIndex,
        t,
        point,
        distance: distance(point, candidate),
        closed: contour.closed,
      };
      // Strictly closer wins, so an exact tie keeps the earliest segment: the result is stable
      // across runs and across engines, which matters because a click must land on one node.
      if (!best || found.distance < best.distance) best = found;
    });
  });

  return best;
}

export function distance(a: VectorPoint, b: VectorPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Splits the segment that follows `nodeIndex` inside a contour, inserting a node at `t`.
 *
 * A cubic split is exact (de Casteljau), so inserting a node never changes the shape — which is the
 * property that lets "add a node" be a lossless edit.
 */
export function insertNodeBetween(
  nodes: readonly PathNode[],
  startIndex: number,
  t: number,
  closed: boolean,
): readonly PathNode[] | null {
  const from = nodes[startIndex];
  const to = nodes[(startIndex + 1) % nodes.length];
  if (!from || !to) return null;

  const segment = segmentBetweenNodes(from, to);
  const next: PathNode[] = [...nodes];

  if (segment.kind === 'line' || segment.control1 === null || segment.control2 === null) {
    const at = pointOnSegment(segment, t);
    next.splice(startIndex + 1, 0, { point: at, handleIn: null, handleOut: null });
    return next;
  }

  const split = splitCubic(from.point, segment.control1, segment.control2, to.point);
  const [l0, l1, l2, l3] = split.left;
  const [, r1, r2, r3] = split.right;
  const startNode: PathNode = { point: l0, handleIn: from.handleIn, handleOut: l1 };
  const middleNode: PathNode = { point: l3, handleIn: l2, handleOut: r1 };
  const endNode: PathNode = { point: r3, handleIn: r2, handleOut: to.handleOut };

  next[startIndex] = startNode;
  const endIndex = (startIndex + 1) % nodes.length;
  next[endIndex] = endNode;
  if (closed && endIndex === 0) {
    // Closing segment: the new node belongs at the end of the list so the loop keeps its order.
    next.splice(nodes.length, 0, middleNode);
  } else {
    next.splice(startIndex + 1, 0, middleNode);
  }
  return next;
}

function segmentBetweenNodes(from: PathNode, to: PathNode): PathSegment {
  if (from.handleOut === null && to.handleIn === null) {
    return { kind: 'line', from: from.point, to: to.point, control1: null, control2: null };
  }
  return {
    kind: 'cubic',
    from: from.point,
    to: to.point,
    control1: from.handleOut ?? from.point,
    control2: to.handleIn ?? to.point,
  };
}

/** Rebuilds a path from flat contours (used when a caller has only polylines). */
export function pathFromPolylines(contours: readonly FlatContour[]): VectorPath {
  return createPath(
    contours.map((contour) =>
      createContour(
        contour.points.map((point) => ({ point, handleIn: null, handleOut: null })),
        contour.closed,
      ),
    ),
  );
}

export function isClosed(path: VectorPath): boolean {
  return path.contours.some((contour) => contour.closed);
}
