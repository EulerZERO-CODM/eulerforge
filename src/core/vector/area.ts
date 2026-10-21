/**
 * Area, orientation and centroid.
 *
 * Signed area is how this kernel tells an outer contour from a hole, so the value is computed
 * *exactly* rather than by sampling: for a cubic segment the integrand `x·y' − y·x'` is a polynomial
 * of degree five, and a three-point Gauss–Legendre rule integrates polynomials of degree five
 * exactly. Sampling would make an orientation flip possible on a small shape, which would turn a
 * hole into a filled island.
 *
 * The sign convention follows the SVG coordinate system (y grows downwards): a contour whose signed
 * area is **positive** is clockwise on screen and is treated as an outer contour; a negative area is
 * counter-clockwise on screen and is treated as a hole.
 */

import { segmentsOf } from './path';
import { TOLERANCE, type Tolerance } from './tolerance';
import type { Contour, PathSegment, VectorPath, VectorPoint } from './types';

/**
 * Gauss–Legendre rules on [0, 1].
 *
 * Three points integrate the area integrand exactly (degree five); the centroid integrand reaches
 * degree eight, so five points are used where the centroid is computed. The distinction is why the
 * two rules exist side by side instead of one being picked for both.
 */
const GAUSS3_NODES: readonly number[] = [
  (1 - Math.sqrt(3 / 5)) / 2,
  0.5,
  (1 + Math.sqrt(3 / 5)) / 2,
];
const GAUSS3_WEIGHTS: readonly number[] = [5 / 18, 4 / 9, 5 / 18];

const GAUSS5_OFFSET = Math.sqrt(5 - 2 * Math.sqrt(10 / 7)) / 3;
const GAUSS5_WIDE = Math.sqrt(5 + 2 * Math.sqrt(10 / 7)) / 3;
const GAUSS5_NODES: readonly number[] = [
  (1 - GAUSS5_WIDE) / 2,
  (1 - GAUSS5_OFFSET) / 2,
  0.5,
  (1 + GAUSS5_OFFSET) / 2,
  (1 + GAUSS5_WIDE) / 2,
];
const GAUSS5_WEIGHTS: readonly number[] = [
  (322 - 13 * Math.sqrt(70)) / 1800,
  (322 + 13 * Math.sqrt(70)) / 1800,
  128 / 450,
  (322 + 13 * Math.sqrt(70)) / 1800,
  (322 - 13 * Math.sqrt(70)) / 1800,
];

function cubicAt(
  p0: VectorPoint,
  p1: VectorPoint,
  p2: VectorPoint,
  p3: VectorPoint,
  t: number,
): VectorPoint {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
    y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y,
  };
}

function cubicDerivativeAt(
  p0: VectorPoint,
  p1: VectorPoint,
  p2: VectorPoint,
  p3: VectorPoint,
  t: number,
): VectorPoint {
  const u = 1 - t;
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
}

type CurveSample = {
  /** Position on the segment. */
  readonly at: VectorPoint;
  /** Derivative with respect to `t`. */
  readonly derivative: VectorPoint;
};

function sampleSegment(segment: PathSegment, t: number): CurveSample {
  const { from, to, control1, control2 } = segment;
  if (segment.kind === 'line' || control1 === null || control2 === null) {
    return {
      at: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
      derivative: { x: to.x - from.x, y: to.y - from.y },
    };
  }
  return {
    at: cubicAt(from, control1, control2, to, t),
    derivative: cubicDerivativeAt(from, control1, control2, to, t),
  };
}

/** The signed contribution of one segment to `2 · area` (the shoelace integrand). */
export function segmentSignedAreaTimesTwo(segment: PathSegment): number {
  let total = 0;
  for (let index = 0; index < GAUSS3_NODES.length; index += 1) {
    const t = GAUSS3_NODES[index];
    const weight = GAUSS3_WEIGHTS[index];
    if (t === undefined || weight === undefined) continue;
    const sample = sampleSegment(segment, t);
    total += weight * (sample.at.x * sample.derivative.y - sample.at.y * sample.derivative.x);
  }
  return total;
}

/** Signed area of a contour. Positive is clockwise on screen; see the module comment. */
export function signedAreaOfContour(contour: Contour): number {
  let doubled = 0;
  for (const segment of segmentsOf(contour)) {
    doubled += segmentSignedAreaTimesTwo(segment);
  }
  return doubled / 2;
}

export function areaOfContour(contour: Contour): number {
  return Math.abs(signedAreaOfContour(contour));
}

/**
 * Signed area of a whole path, contours summed.
 *
 * The sum — rather than the sum of absolute values — is the right total for a compound path: holes
 * subtract from the shape that contains them, which is what a user means by "the area of this
 * icon".
 *
 * An *open* contour contributes the area of its implicit closure — the region a renderer fills,
 * which is the shape plus the straight line from its last point back to its first. That is SVG
 * fill semantics rather than an intuition about lines, and it is deliberate: the value has to
 * agree with what a person sees when the shape is filled. `isAreaContour` is the predicate to use
 * when the question is "is this a region at all".
 */
export function signedAreaOfPath(path: VectorPath): number {
  return path.contours.reduce((total, contour) => total + signedAreaOfContour(contour), 0);
}

/** Absolute area of a compound path: outer contours minus the holes they enclose. */
export function areaOfPath(path: VectorPath): number {
  return Math.abs(signedAreaOfPath(path));
}

/** True when a contour encloses enough area to be two-dimensional. */
export function isAreaContour(contour: Contour, tolerance: Tolerance = TOLERANCE): boolean {
  return areaOfContour(contour) > tolerance.area;
}

/**
 * The centroid of a contour, or `null` for a degenerate one.
 *
 * `C = (1 / 3A) ∫ (x·(x·y' − y·x'), y·(x·y' − y·x')) dt` over the closed contour, integrated with
 * the five-point rule because the integrand reaches degree eight. (The 1/3A factor is the familiar
 * `(1 / 6A) Σ (x_i + x_{i+1})·cross_i` for polygons, rewritten in integral form.)
 */
export function centroidOfContour(contour: Contour): VectorPoint | null {
  const area = signedAreaOfContour(contour);
  if (Math.abs(area) < TOLERANCE.area) return null;

  let cx = 0;
  let cy = 0;
  for (const segment of segmentsOf(contour)) {
    for (let index = 0; index < GAUSS5_NODES.length; index += 1) {
      const t = GAUSS5_NODES[index];
      const weight = GAUSS5_WEIGHTS[index];
      if (t === undefined || weight === undefined) continue;
      const sample = sampleSegment(segment, t);
      const cross = sample.at.x * sample.derivative.y - sample.at.y * sample.derivative.x;
      cx += weight * sample.at.x * cross;
      cy += weight * sample.at.y * cross;
    }
  }
  return { x: cx / (3 * area), y: cy / (3 * area) };
}

/** Centroid of a compound path, weighted by contour area. `null` when nothing encloses area. */
export function centroidOfPath(path: VectorPath): VectorPoint | null {
  const totalArea = signedAreaOfPath(path);
  if (Math.abs(totalArea) < TOLERANCE.area) return null;
  let x = 0;
  let y = 0;
  for (const contour of path.contours) {
    const centroid = centroidOfContour(contour);
    if (!centroid) continue;
    const weight = signedAreaOfContour(contour);
    x += centroid.x * weight;
    y += centroid.y * weight;
  }
  return { x: x / totalArea, y: y / totalArea };
}
