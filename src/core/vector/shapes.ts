/**
 * Primitive shapes as paths.
 *
 * Every shape the Illustration Studio offers produces a real `VectorPath` — never a special "shape
 * node" that the renderer, the exporter and the node editor each have to understand separately. A
 * rectangle drawn with the rectangle tool is four nodes joined by lines; an ellipse is four cubic
 * segments. From the moment it is created it can be node-edited, have a boolean operation applied to
 * it, and be exported, because it is the same kind of thing as a hand-drawn path.
 *
 * The ellipse uses the standard `k = 4/3 · (√2 − 1)` circle approximation per quadrant, whose
 * maximum radial error is about 0.027 % of the radius — 0.14 px on a 512 px circle, and well inside
 * the flattening tolerance used elsewhere in the kernel. SVG importers use the same constant for
 * `circle`/`ellipse`, so a shape drawn here and one imported from an SVG agree to within the same
 * error.
 */

import { type VectorBox, type VectorPath, type VectorPoint } from './types';
import { createContour, createPath } from './types';

/** Standard cubic approximation constant for a quarter circle: 4/3·(√2 − 1). */
export const CIRCLE_KAPPA = (4 / 3) * (Math.SQRT2 - 1);

function corner(x: number, y: number) {
  return { point: { x, y }, handleIn: null, handleOut: null };
}

/**
 * A rectangle, optionally with rounded corners.
 *
 * Rounded corners are cubic arcs made with the same constant as the ellipse, so a rounded rectangle
 * is a single contour with the corner radius as real geometry rather than a property the exporter
 * would have to reproduce.
 */
export function rectanglePath(box: VectorBox, cornerRadius = 0): VectorPath {
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const radius = Math.max(0, Math.min(cornerRadius, Math.min(width, height) / 2));

  if (width <= 0 || height <= 0) {
    return createPath([createContour([corner(box.minX, box.minY)], false)]);
  }

  if (radius === 0) {
    return createPath([
      createContour(
        [
          corner(box.minX, box.minY),
          corner(box.maxX, box.minY),
          corner(box.maxX, box.maxY),
          corner(box.minX, box.maxY),
        ],
        true,
      ),
    ]);
  }

  const k = radius * CIRCLE_KAPPA;
  const { minX, minY, maxX, maxY } = box;
  const nodes = [
    // Top edge, left to right, then clockwise around the rectangle.
    { point: { x: minX + radius, y: minY }, handleIn: null, handleOut: null },
    {
      point: { x: maxX - radius, y: minY },
      handleIn: null,
      handleOut: { x: maxX - radius + k, y: minY },
    },
    {
      point: { x: maxX, y: minY + radius },
      handleIn: { x: maxX, y: minY + radius - k },
      handleOut: null,
    },
    {
      point: { x: maxX, y: maxY - radius },
      handleIn: null,
      handleOut: { x: maxX, y: maxY - radius + k },
    },
    {
      point: { x: maxX - radius, y: maxY },
      handleIn: { x: maxX - radius + k, y: maxY },
      handleOut: null,
    },
    {
      point: { x: minX + radius, y: maxY },
      handleIn: null,
      handleOut: { x: minX + radius - k, y: maxY },
    },
    {
      point: { x: minX, y: maxY - radius },
      handleIn: { x: minX, y: maxY - radius + k },
      handleOut: null,
    },
    {
      point: { x: minX, y: minY + radius },
      handleIn: null,
      handleOut: { x: minX, y: minY + radius - k },
    },
  ];
  return createPath([createContour(nodes, true)]);
}

/** An ellipse inscribed in a box, as four cubic segments. */
export function ellipsePath(box: VectorBox): VectorPath {
  const rx = (box.maxX - box.minX) / 2;
  const ry = (box.maxY - box.minY) / 2;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;

  if (rx <= 0 || ry <= 0) {
    return createPath([createContour([corner(cx, cy)], false)]);
  }

  const ox = rx * CIRCLE_KAPPA;
  const oy = ry * CIRCLE_KAPPA;
  return createPath([
    createContour(
      [
        {
          point: { x: cx, y: box.minY },
          handleIn: { x: cx - ox, y: box.minY },
          handleOut: { x: cx + ox, y: box.minY },
        },
        {
          point: { x: box.maxX, y: cy },
          handleIn: { x: box.maxX, y: cy - oy },
          handleOut: { x: box.maxX, y: cy + oy },
        },
        {
          point: { x: cx, y: box.maxY },
          handleIn: { x: cx + ox, y: box.maxY },
          handleOut: { x: cx - ox, y: box.maxY },
        },
        {
          point: { x: box.minX, y: cy },
          handleIn: { x: box.minX, y: cy + oy },
          handleOut: { x: box.minX, y: cy - oy },
        },
      ],
      true,
    ),
  ]);
}

/** A regular polygon inscribed in a box. `sides` is clamped to the range the tool offers. */
export function regularPolygonPath(box: VectorBox, sides: number): VectorPath {
  const count = Math.max(3, Math.min(24, Math.round(sides)));
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const rx = (box.maxX - box.minX) / 2;
  const ry = (box.maxY - box.minY) / 2;
  if (rx <= 0 || ry <= 0) return createPath([createContour([corner(cx, cy)], false)]);

  const nodes = [];
  for (let index = 0; index < count; index += 1) {
    // Start at the top so a polygon looks upright, and turn clockwise on screen.
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    nodes.push(corner(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)));
  }
  return createPath([createContour(nodes, true)]);
}

/** A straight line between two points: an open, two-node contour. */
export function linePath(from: VectorPoint, to: VectorPoint): VectorPath {
  return createPath([createContour([corner(from.x, from.y), corner(to.x, to.y)], false)]);
}

/** An n-pointed star, alternating between the outer and inner radius. */
export function starPath(box: VectorBox, points: number, innerRatio = 0.45): VectorPath {
  const count = Math.max(3, Math.min(24, Math.round(points)));
  const ratio = Math.max(0.05, Math.min(0.95, innerRatio));
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const rx = (box.maxX - box.minX) / 2;
  const ry = (box.maxY - box.minY) / 2;
  if (rx <= 0 || ry <= 0) return createPath([createContour([corner(cx, cy)], false)]);

  const nodes = [];
  for (let index = 0; index < count * 2; index += 1) {
    const radius = index % 2 === 0 ? 1 : ratio;
    const angle = -Math.PI / 2 + (index / (count * 2)) * Math.PI * 2;
    nodes.push(corner(cx + rx * radius * Math.cos(angle), cy + ry * radius * Math.sin(angle)));
  }
  return createPath([createContour(nodes, true)]);
}
