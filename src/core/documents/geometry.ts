/**
 * Pure canvas geometry helpers.
 *
 * These functions back the document stage renderer (guides, safe areas, zoom-to-fit labels) and are
 * unit-tested independently of React. Nothing here mutates its inputs.
 */

import type { Size } from './types';

export function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y > 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x === 0 ? 1 : x;
}

/** Reduced aspect-ratio pair, e.g. 1920×1080 → `{ x: 16, y: 9 }`. */
export function aspectRatio(size: Size): { x: number; y: number } {
  const divisor = greatestCommonDivisor(size.width, size.height);
  return { x: Math.round(size.width / divisor), y: Math.round(size.height / divisor) };
}

/** Human label: "16:9", or a ratio string when the reduced pair gets unwieldy ("210:297"). */
export function aspectRatioLabel(size: Size): string {
  const ratio = aspectRatio(size);
  return `${ratio.x}:${ratio.y}`;
}

export function orientationOf(size: Size): 'portrait' | 'landscape' | 'square' {
  if (size.width === size.height) return 'square';
  return size.width > size.height ? 'landscape' : 'portrait';
}

export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type Point = {
  readonly x: number;
  readonly y: number;
};

export function createRect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

/** True when the point lies inside the rectangle; edges count as inside. */
export function rectContainsPoint(rect: Rect, point: Point, toleranceInset = 0): boolean {
  const inset = Math.max(0, toleranceInset);
  return (
    point.x >= rect.x + inset &&
    point.x <= rect.x + rect.width - inset &&
    point.y >= rect.y + inset &&
    point.y <= rect.y + rect.height - inset
  );
}

/** True when two rectangles overlap. Touching edges count as an overlap so adjacent layers snap. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

/** Smallest rectangle covering every input; `undefined` for an empty list. */
export function unionRects(rects: readonly Rect[]): Rect | undefined {
  const first = rects[0];
  if (!first) return undefined;
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x + first.width;
  let maxY = first.y + first.height;
  for (const rect of rects.slice(1)) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return createRect(minX, minY, maxX - minX, maxY - minY);
}

/** Moves a rectangle without resizing it. */
export function translateRect(rect: Rect, deltaX: number, deltaY: number): Rect {
  return createRect(rect.x + deltaX, rect.y + deltaY, rect.width, rect.height);
}

/** Rounds every edge, keeping the rectangle non-degenerate. */
export function roundRect(rect: Rect, minimumSize = 1): Rect {
  const width = Math.max(minimumSize, Math.round(rect.width));
  const height = Math.max(minimumSize, Math.round(rect.height));
  return createRect(Math.round(rect.x), Math.round(rect.y), width, height);
}

/** The four corners plus edge midpoints, in a fixed order used by the resize handles. */
export function rectCorners(rect: Rect): readonly Point[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

/** Horizontal and vertical centre lines of a rectangle, used by centre-alignment snapping. */
export function rectCentre(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Inset rectangle described by a uniform margin. */
export function insetRect(size: Size, marginPx: number): Rect {
  const margin = Math.max(0, Math.min(marginPx, Math.min(size.width, size.height) / 2));
  return {
    x: margin,
    y: margin,
    width: Math.max(0, size.width - margin * 2),
    height: Math.max(0, size.height - margin * 2),
  };
}

/** Band of `bleedPx` around the canvas, used for print bleed previews. */
export function bleedBand(size: Size, bleedPx: number): Rect {
  const bleed = Math.max(0, bleedPx);
  return {
    x: -bleed,
    y: -bleed,
    width: size.width + bleed * 2,
    height: size.height + bleed * 2,
  };
}

/**
 * Positions of evenly spaced grid lines strictly inside one axis of the canvas.
 *
 * The extent is per axis on purpose: a single list for both axes stopped at the *smaller* side, so
 * a 1920 x 1080 canvas had no grid across its right-hand 840 pixels — a region where nothing could
 * be aligned against the grid at all.
 */
export function gridLinePositions(extentPx: number, stepPx: number): readonly number[] {
  if (!Number.isFinite(stepPx) || stepPx <= 0) return [];
  if (!Number.isFinite(extentPx) || extentPx <= 0) return [];
  const positions: number[] = [];
  for (let position = stepPx; position < extentPx; position += stepPx) {
    positions.push(Math.round(position * 100) / 100);
    if (positions.length > 200) break; // guard against absurdly small steps
  }
  return positions;
}

/** Scale factor that fits `size` inside `bounds` without exceeding it. */
export function fitScale(size: Size, bounds: Size): number {
  if (size.width <= 0 || size.height <= 0) return 1;
  return Math.min(bounds.width / size.width, bounds.height / size.height);
}

/** Rounds a size to whole pixels with a documented minimum. */
export function normaliseSize(size: Size, minimum = 1): Size {
  return {
    width: Math.max(minimum, Math.round(size.width)),
    height: Math.max(minimum, Math.round(size.height)),
  };
}

/** Total pixel count, used for density labels in the workspace inspector. */
export function pixelCount(size: Size): number {
  return Math.round(size.width) * Math.round(size.height);
}

/** Compact megapixel label, e.g. 2.07 MP. */
export function megapixelLabel(size: Size): string {
  const megapixels = pixelCount(size) / 1_000_000;
  return `${megapixels.toFixed(megapixels < 10 ? 2 : 1)} MP`;
}
