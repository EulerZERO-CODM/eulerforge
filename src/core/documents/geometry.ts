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

/** Positions of evenly spaced grid lines strictly inside the canvas. */
export function gridLinePositions(size: Size, stepPx: number): readonly number[] {
  if (!Number.isFinite(stepPx) || stepPx <= 0) return [];
  const positions: number[] = [];
  const limit = Math.min(size.width, size.height);
  for (let position = stepPx; position < limit; position += stepPx) {
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
