/**
 * Source-pixel range selections.
 *
 * A range selection is the "magic wand" half of masking: instead of painting where an adjustment
 * applies, the editor measures every pixel of the *source* photograph and keeps the ones inside a
 * luminance window or close to a target colour. Two properties matter and are the reason this lives
 * in the framework-free core rather than in the canvas code:
 *
 * - **Deterministic.** The same source pixels and the same selection always produce the same
 *   strength map, on the CPU renderer, the GPU renderer and in a test, because the arithmetic is
 *   plain IEEE-754 and shared by all three.
 * - **Stable under editing.** Ranges are evaluated against the unadjusted source, never against the
 *   current preview, so moving an exposure slider cannot make the selection crawl.
 *
 * Values are sRGB bytes treated as linear for the purpose of the *selection*. That is a deliberate
 * simplification: a range is a user-facing picker, not a colour-managed measurement, and pretending
 * otherwise would add a transfer function without changing what a person sees. The falloff is a
 * smoothstep, so a feathered edge has continuous first derivatives instead of a visible step.
 */

import type { PhotoRangeSelection } from '../documents/payload';

export type Rgb = { readonly r: number; readonly g: number; readonly b: number };

const HEX_COLOUR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/** Parses `#rrggbb` into 0–255 channels, or `null` when the string is not a hex colour. */
export function hexToRgb(hex: string): Rgb | null {
  const match = HEX_COLOUR.exec(hex.trim());
  if (!match) return null;
  return {
    r: Number.parseInt(match[1] as string, 16),
    g: Number.parseInt(match[2] as string, 16),
    b: Number.parseInt(match[3] as string, 16),
  };
}

/** Rec. 709 relative luminance of sRGB bytes, 0–1. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Hermite interpolation, clamped; the same curve the photo pipeline uses for its own edges. */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value <= edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Softness of a range's edge.
 *
 * The falloff is a fraction of the window (or tolerance), with a small absolute floor so a window of
 * zero width still has a usable edge when the user asks for one.
 */
function falloffWidth(span: number, feather: number): number {
  return Math.min(1, Math.max(0, feather)) * Math.max(0.02, span);
}

export function luminanceStrength(
  min: number,
  max: number,
  feather: number,
  luminance: number,
): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const width = falloffWidth(high - low, feather);
  if (luminance < low) return 1 - smoothstep(0, width, low - luminance);
  if (luminance > high) return 1 - smoothstep(0, width, luminance - high);
  return 1;
}

export function colourStrength(
  target: Rgb,
  tolerance: number,
  feather: number,
  r: number,
  g: number,
  b: number,
): number {
  const dr = (r - target.r) / 255;
  const dg = (g - target.g) / 255;
  const db = (b - target.b) / 255;
  // Root-mean-square distance in normalised RGB; 0 is an exact match and 1 is black to white.
  const distance = Math.sqrt((dr * dr + dg * dg + db * db) / 3);
  const limit = Math.min(1, Math.max(0, tolerance));
  const width = falloffWidth(Math.max(limit, 0.02), feather);
  if (distance <= limit) return 1;
  return 1 - smoothstep(limit, limit + width, distance);
}

/**
 * A range with its thresholds already computed.
 *
 * Preparing once per selection rather than once per pixel is what makes an eight-range mask over a
 * megapixel preview affordable: parsing a hex colour a million times is measurable, computing a
 * squared distance is not.
 */
export type PreparedRange =
  | {
      readonly kind: 'luminance';
      readonly min: number;
      readonly max: number;
      readonly width: number;
    }
  | {
      readonly kind: 'colour';
      readonly target: Rgb;
      readonly limit: number;
      readonly width: number;
    };

/** Prepares a stored range, or `null` when a colour cannot be parsed (it then selects nothing). */
export function prepareRange(range: PhotoRangeSelection): PreparedRange | null {
  if (range.kind === 'luminance') {
    const min = Math.min(range.min, range.max);
    const max = Math.max(range.min, range.max);
    return { kind: 'luminance', min, max, width: falloffWidth(max - min, range.feather) };
  }
  const target = hexToRgb(range.colour);
  if (!target) return null;
  const limit = Math.min(1, Math.max(0, range.tolerance));
  return {
    kind: 'colour',
    target,
    limit,
    width: falloffWidth(Math.max(limit, 0.02), range.feather),
  };
}

/** Strength of a prepared range at one pixel, 0–1. */
export function preparedStrength(range: PreparedRange, r: number, g: number, b: number): number {
  if (range.kind === 'luminance') {
    const luminance = relativeLuminance(r, g, b);
    if (luminance < range.min) return 1 - smoothstep(0, range.width, range.min - luminance);
    if (luminance > range.max) return 1 - smoothstep(0, range.width, luminance - range.max);
    return 1;
  }
  const dr = (r - range.target.r) / 255;
  const dg = (g - range.target.g) / 255;
  const db = (b - range.target.b) / 255;
  // Root-mean-square distance in normalised RGB; 0 is an exact match and 1 is black to white.
  const distance = Math.sqrt((dr * dr + dg * dg + db * db) / 3);
  if (distance <= range.limit) return 1;
  return 1 - smoothstep(range.limit, range.limit + range.width, distance);
}

/** Strength of one range at one pixel, 0–1. */
export function rangeStrength(range: PhotoRangeSelection, r: number, g: number, b: number): number {
  const prepared = prepareRange(range);
  return prepared ? preparedStrength(prepared, r, g, b) : 0;
}

/** Union of several ranges at one pixel: the strongest selection wins. */
export function strongestRangeStrength(
  ranges: readonly PhotoRangeSelection[],
  r: number,
  g: number,
  b: number,
): number {
  let strongest = 0;
  for (const range of ranges) {
    const value = rangeStrength(range, r, g, b);
    if (value > strongest) strongest = value;
    if (strongest === 1) break;
  }
  return strongest;
}

/**
 * Unions range coverage into an existing strength map.
 *
 * `painted` is one byte per pixel (already rasterised from brush/lasso strokes). Ranges and strokes
 * are combined with `max`, so painting inside a selected region does not double the strength and
 * erasing a stroke does not remove a range's coverage. Inversion is applied by the caller, once, to
 * the union — which is what "invert the mask" has to mean when the mask has two sources.
 *
 * Throws when the source buffer is the wrong size: silently returning the painted map would hide a
 * programming error behind a selection that simply never appears.
 */
export function applyRangeSelections(
  painted: Uint8ClampedArray,
  ranges: readonly PhotoRangeSelection[],
  source: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const pixels = width * height;
  if (painted.length !== pixels) {
    throw new Error(`The mask has ${String(painted.length)} bytes; expected ${String(pixels)}.`);
  }
  if (source.length !== pixels * 4) {
    throw new Error(
      `A range selection needs ${String(pixels * 4)} source bytes; received ${String(source.length)}.`,
    );
  }
  if (ranges.length === 0) return painted;

  const prepared = ranges
    .map((range) => prepareRange(range))
    .filter((range): range is PreparedRange => range !== null);
  if (prepared.length === 0) return painted;

  const output = new Uint8ClampedArray(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const alpha = painted[index] ?? 0;
    if (alpha === 255) {
      output[index] = 255;
      continue;
    }
    const offset = index * 4;
    let strongest = 0;
    for (const range of prepared) {
      const value = preparedStrength(
        range,
        source[offset] ?? 0,
        source[offset + 1] ?? 0,
        source[offset + 2] ?? 0,
      );
      if (value > strongest) strongest = value;
      if (strongest === 1) break;
    }
    output[index] = Math.max(alpha, Math.round(strongest * 255));
  }
  return output;
}
