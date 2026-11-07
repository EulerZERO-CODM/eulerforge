/**
 * Easing.
 *
 * A segment's easing is a cubic Bézier in normalised time/value space — the same parameterisation
 * CSS uses — so the graph editor can drag the two control points and the evaluator can solve the
 * curve exactly. `hold` is the deliberate exception: the value stays put until the next keyframe.
 *
 * Everything here is pure arithmetic with no clock, no randomness and no DOM. Given the same
 * easing and the same progress it returns the same number on every machine, which is what lets the
 * preview and the exported frame agree.
 */

import type { MotionEasing } from '../documents/payload';

export type BezierPoints = {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
};

/**
 * The preset control points.
 *
 * These are the CSS `ease-*` keywords; keeping the numbers here rather than in each consumer means
 * the graph editor, the evaluator and the documentation cannot drift apart.
 */
export const EASING_POINTS: Readonly<Record<Exclude<MotionEasing['kind'], 'hold'>, BezierPoints>> =
  {
    linear: { x1: 0, y1: 0, x2: 1, y2: 1 },
    'ease-in': { x1: 0.42, y1: 0, x2: 1, y2: 1 },
    'ease-out': { x1: 0, y1: 0, x2: 0.58, y2: 1 },
    'ease-in-out': { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
    cubic: { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
  };

/** The control points a graph editor draws for an easing, or null for `hold`. */
export function easingPoints(easing: MotionEasing): BezierPoints | null {
  switch (easing.kind) {
    case 'hold':
      return null;
    case 'cubic':
      return { x1: easing.x1, y1: easing.y1, x2: easing.x2, y2: easing.y2 };
    case 'linear':
    case 'ease-in':
    case 'ease-out':
    case 'ease-in-out':
      return EASING_POINTS[easing.kind];
  }
}

function bezierCoordinate(t: number, a: number, b: number): number {
  // B(t) for control points (0, a, b, 1) on one axis.
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * a + 3 * inverse * t * t * b + t * t * t;
}

function bezierSlope(t: number, a: number, b: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * a + 6 * inverse * t * (b - a) + 3 * t * t * (1 - b);
}

/**
 * Solves x(t) = progress for t, then returns y(t).
 *
 * Newton–Raphson with a bisection fallback: monotone x is guaranteed by the schema (0 ≤ x1, x2 ≤ 1),
 * so the root is unique, and the fallback prevents a flat slope from producing a wild result.
 * Iteration counts are fixed rather than time-bounded, which keeps the result deterministic.
 */
export function cubicBezierAt(points: BezierPoints, progress: number): number {
  const x = Math.min(1, Math.max(0, progress));
  if (x === 0) return 0;
  if (x === 1) return 1;

  let t = x;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const error = bezierCoordinate(t, points.x1, points.x2) - x;
    if (Math.abs(error) < 1e-7) return bezierCoordinate(t, points.y1, points.y2);
    const slope = bezierSlope(t, points.x1, points.x2);
    if (Math.abs(slope) < 1e-6) break;
    t -= error / slope;
  }

  let low = 0;
  let high = 1;
  t = x;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const value = bezierCoordinate(t, points.x1, points.x2);
    if (Math.abs(value - x) < 1e-7) break;
    if (value < x) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return bezierCoordinate(t, points.y1, points.y2);
}

/**
 * Maps linear progress 0–1 through an easing.
 *
 * Clamped at both ends: progress outside the segment is a caller error, but returning a value from
 * outside the keyframed range would be a visible glitch rather than a caught mistake.
 */
export function applyEasing(easing: MotionEasing, progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  const clamped = Math.min(1, Math.max(0, progress));
  if (easing.kind === 'hold') return 0;
  if (easing.kind === 'linear') return clamped;
  const points = easingPoints(easing);
  if (!points) return clamped;
  return cubicBezierAt(points, clamped);
}

/** The easing a new keyframe starts with, and the one the graph editor edits from. */
export function defaultEasing(): MotionEasing {
  return { kind: 'ease-in-out' };
}

/**
 * Builds a cubic easing from graph-editor points, clamped to the schema's bounds.
 *
 * The editor drags in pixel space and converts here, so an out-of-range drag can never produce a
 * payload the document schema would refuse on save.
 */
export function cubicEasing(points: BezierPoints): MotionEasing {
  const clampX = (value: number): number => Math.min(1, Math.max(0, value));
  const clampY = (value: number): number => Math.min(3, Math.max(-2, value));
  return {
    kind: 'cubic',
    x1: clampX(points.x1),
    y1: clampY(points.y1),
    x2: clampX(points.x2),
    y2: clampY(points.y2),
  };
}
