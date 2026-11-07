/**
 * Affine transforms.
 *
 * The matrix is stored the way SVG stores it — `x' = a·x + c·y + e`, `y' = b·x + d·y + f` — because
 * SVG is the interchange format, and a transform that means something different in the editor than
 * in the exported file is a class of bug this codebase does not need.
 */

import {
  createContour,
  createPath,
  type VectorBox,
  type VectorPath,
  type VectorPoint,
} from './types';
import { boundsOfPath, boxHeight, boxWidth } from './bounds';
import { TOLERANCE } from './tolerance';

export type Matrix = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};

export const IDENTITY: Matrix = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export function matrix(a: number, b: number, c: number, d: number, e: number, f: number): Matrix {
  return { a, b, c, d, e, f };
}

export function translation(dx: number, dy: number): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

export function scaling(sx: number, sy: number = sx): Matrix {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/** Rotation in radians; positive angles turn clockwise on screen because y grows downwards. */
export function rotation(angle: number): Matrix {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/** `apply(left, right)` is the transform that first applies `right`, then `left`. */
export function apply(left: Matrix, right: Matrix): Matrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

export function applyToPoint(matrixValue: Matrix, candidate: VectorPoint): VectorPoint {
  return {
    x: matrixValue.a * candidate.x + matrixValue.c * candidate.y + matrixValue.e,
    y: matrixValue.b * candidate.x + matrixValue.d * candidate.y + matrixValue.f,
  };
}

export function determinant(matrixValue: Matrix): number {
  return matrixValue.a * matrixValue.d - matrixValue.b * matrixValue.c;
}

export function isIdentity(matrixValue: Matrix, tolerance = TOLERANCE.point): boolean {
  return (
    Math.abs(matrixValue.a - 1) <= tolerance &&
    Math.abs(matrixValue.b) <= tolerance &&
    Math.abs(matrixValue.c) <= tolerance &&
    Math.abs(matrixValue.d - 1) <= tolerance &&
    Math.abs(matrixValue.e) <= tolerance &&
    Math.abs(matrixValue.f) <= tolerance
  );
}

/**
 * The inverse matrix, or `null` for a singular one.
 *
 * A singular matrix (a zero scale, say) has no inverse; the editor must report that rather than
 * divide by zero and produce `Infinity` coordinates that later fail validation.
 */
export function invert(matrixValue: Matrix): Matrix | null {
  const det = determinant(matrixValue);
  if (Math.abs(det) < 1e-12) return null;
  return {
    a: matrixValue.d / det,
    b: -matrixValue.b / det,
    c: -matrixValue.c / det,
    d: matrixValue.a / det,
    e: (matrixValue.c * matrixValue.f - matrixValue.d * matrixValue.e) / det,
    f: (matrixValue.b * matrixValue.e - matrixValue.a * matrixValue.f) / det,
  };
}

/** Transforms a path. Handles are points too, so they transform with their node. */
export function transformPath(path: VectorPath, matrixValue: Matrix): VectorPath {
  if (isIdentity(matrixValue)) return path;
  return createPath(
    path.contours.map((contour) =>
      createContour(
        contour.nodes.map((node) => ({
          point: applyToPoint(matrixValue, node.point),
          handleIn: node.handleIn === null ? null : applyToPoint(matrixValue, node.handleIn),
          handleOut: node.handleOut === null ? null : applyToPoint(matrixValue, node.handleOut),
        })),
        contour.closed,
      ),
    ),
  );
}

/** Transforms a box by transforming its corners (the result is the axis-aligned hull). */
export function transformBox(box: VectorBox, matrixValue: Matrix): VectorBox {
  const corners: readonly VectorPoint[] = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
  const points = corners.map((corner) => applyToPoint(matrixValue, corner));
  const first = points[0];
  if (!first) return box;
  return {
    minX: Math.min(...points.map((entry) => entry.x)),
    minY: Math.min(...points.map((entry) => entry.y)),
    maxX: Math.max(...points.map((entry) => entry.x)),
    maxY: Math.max(...points.map((entry) => entry.y)),
  };
}

/**
 * The matrix that maps `from` onto `to` without preserving the aspect ratio.
 *
 * This is the transform a layer frame applies to its local geometry: a path is authored in its own
 * coordinate space and placed on the canvas by a box-to-box mapping. Scales are guarded so a
 * zero-width box yields `null` instead of an infinite scale.
 */
export function matrixBetweenBoxes(from: VectorBox, to: VectorBox): Matrix | null {
  const fromWidth = boxWidth(from);
  const fromHeight = boxHeight(from);
  const toWidth = boxWidth(to);
  const toHeight = boxHeight(to);
  if (fromWidth <= TOLERANCE.point || fromHeight <= TOLERANCE.point) return null;
  if (toWidth <= TOLERANCE.point || toHeight <= TOLERANCE.point) return null;
  const sx = toWidth / fromWidth;
  const sy = toHeight / fromHeight;
  return {
    a: sx,
    b: 0,
    c: 0,
    d: sy,
    e: to.minX - from.minX * sx,
    f: to.minY - from.minY * sy,
  };
}

/** The transform that places a path's geometry into a target box, following the path's own bounds. */
export function frameMatrixFor(path: VectorPath, frame: VectorBox): Matrix | null {
  const bounds = boundsOfPath(path);
  if (!bounds) return null;
  return matrixBetweenBoxes(bounds, frame);
}
