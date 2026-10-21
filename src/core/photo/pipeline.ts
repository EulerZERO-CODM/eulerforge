/**
 * The photo pixel pipeline.
 *
 * One deterministic, framework-free implementation of every adjustment in the stack. The WebGL2
 * renderer applies the same formulas in a fragment shader; the Canvas2D renderer calls this module.
 * Keeping the maths here means the fallback is not a second-class preview: it is the reference the
 * shader is checked against.
 *
 * Inputs are sRGB bytes. Every operation works in that same space (no hidden linearisation), clamps
 * to 0–255 and rounds once at the end, so two runs on the same bytes are identical and the exported
 * file cannot drift from the preview.
 */

import type { PhotoAdjustment } from '../documents/payload';

export type PhotoPixels = {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
};

export type PhotoPipelineInput = {
  /** The stack, in order. Disabled entries and zero-valued entries are skipped. */
  readonly adjustments: readonly PhotoAdjustment[];
  /**
   * Per-pixel mask strength, one byte per pixel (0 = untouched, 255 = fully adjusted).
   *
   * `null` means "the whole image". Inversion and feathering are resolved by the mask rasteriser,
   * so the pipeline only ever sees a strength map.
   */
  readonly mask?: Uint8ClampedArray | null;
};

const clamp255 = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : value);

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const luminance = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** A 3×3 box blur, used by clarity. Edges are clamped rather than wrapped. */
export function boxBlur(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const output = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const sampleY = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx += 1) {
          const sampleX = Math.min(width - 1, Math.max(0, x + dx));
          const index = (sampleY * width + sampleX) * 4;
          r += data[index] ?? 0;
          g += data[index + 1] ?? 0;
          b += data[index + 2] ?? 0;
          a += data[index + 3] ?? 0;
          count += 1;
        }
      }
      const target = (y * width + x) * 4;
      output[target] = Math.round(r / count);
      output[target + 1] = Math.round(g / count);
      output[target + 2] = Math.round(b / count);
      output[target + 3] = Math.round(a / count);
    }
  }
  return output;
}

/** True when an adjustment would leave every pixel unchanged. */
export function adjustmentIsIdentity(adjustment: PhotoAdjustment): boolean {
  return !adjustment.enabled || adjustment.value === 0;
}

/** Mutable RGB triple the pipeline writes into, so the hot loop allocates nothing per pixel. */
export type MutableRgb = [number, number, number];

/**
 * Applies one adjustment to a single sRGB pixel.
 *
 * Writes into `out` and returns it. The signature is deliberately allocation-free: a 1-megapixel
 * preview runs this once per pixel per adjustment, and returning a fresh tuple per pixel was the
 * difference between a responsive slider and a visible lag (see docs/PERFORMANCE.md).
 */
export function applyAdjustmentPixel(
  adjustment: PhotoAdjustment,
  red: number,
  green: number,
  blue: number,
  context: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  out: MutableRgb = [red, green, blue],
): MutableRgb {
  let r = red;
  let g = green;
  let b = blue;
  const value = adjustment.value;

  switch (adjustment.kind) {
    case 'exposure': {
      const factor = 2 ** (value / 50);
      r *= factor;
      g *= factor;
      b *= factor;
      break;
    }
    case 'contrast': {
      const factor = 1 + value / 100;
      r = (r - 127.5) * factor + 127.5;
      g = (g - 127.5) * factor + 127.5;
      b = (b - 127.5) * factor + 127.5;
      break;
    }
    case 'saturation': {
      const l = luminance(r, g, b);
      const factor = 1 + value / 100;
      r = l + (r - l) * factor;
      g = l + (g - l) * factor;
      b = l + (b - l) * factor;
      break;
    }
    case 'temperature': {
      const warm = value * 0.0025;
      r *= 1 + warm;
      b *= 1 - warm;
      break;
    }
    case 'tint': {
      const magenta = value * 0.0025;
      g *= 1 - magenta * 0.6;
      r *= 1 + magenta * 0.25;
      b *= 1 + magenta * 0.25;
      break;
    }
    case 'highlights':
    case 'shadows': {
      const l = luminance(r, g, b) / 255;
      const weight =
        adjustment.kind === 'highlights' ? smoothstep(0.45, 1, l) : 1 - smoothstep(0, 0.55, l);
      const amount = (value / 100) * weight * 0.75;
      // Positive lifts towards white, negative pushes towards black; the weight localises it to the
      // tonal range the adjustment names.
      r += amount * (value >= 0 ? 255 - r : r);
      g += amount * (value >= 0 ? 255 - g : g);
      b += amount * (value >= 0 ? 255 - b : b);
      break;
    }
    case 'vibrance': {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const current = (max - min) / 255;
      const l = luminance(r, g, b);
      const factor = 1 + (value / 100) * (1 - current) * 0.9;
      r = l + (r - l) * factor;
      g = l + (g - l) * factor;
      b = l + (b - l) * factor;
      break;
    }
    case 'clarity':
      // Handled by the stack loop, which owns the blurred copy.
      break;
    case 'grayscale': {
      const amount = value / 100;
      const l = luminance(r, g, b);
      r += (l - r) * amount;
      g += (l - g) * amount;
      b += (l - b) * amount;
      break;
    }
    case 'sepia': {
      const amount = value / 100;
      const sr = 0.393 * r + 0.769 * g + 0.189 * b;
      const sg = 0.349 * r + 0.686 * g + 0.168 * b;
      const sb = 0.272 * r + 0.534 * g + 0.131 * b;
      r += (sr - r) * amount;
      g += (sg - g) * amount;
      b += (sb - b) * amount;
      break;
    }
    case 'vignette': {
      const cx = (context.x + 0.5) / Math.max(1, context.width) - 0.5;
      const cy = (context.y + 0.5) / Math.max(1, context.height) - 0.5;
      const distance = Math.sqrt(cx * cx + cy * cy) / Math.SQRT1_2;
      const factor = 1 - (value / 100) * smoothstep(0.55, 1.15, distance) * 0.85;
      r *= factor;
      g *= factor;
      b *= factor;
      break;
    }
  }

  out[0] = r;
  out[1] = g;
  out[2] = b;
  return out;
}

/**
 * Runs the stack over a copy of the pixels.
 *
 * Returns a new buffer; the input is never mutated, so the caller can keep the original for a
 * before/after view without a pixel copy.
 */
export function applyPhotoPipeline(
  pixels: PhotoPixels,
  input: PhotoPipelineInput,
): Uint8ClampedArray {
  const { width, height } = pixels;
  const source = pixels.data;
  const output = new Uint8ClampedArray(source.length);
  output.set(source);

  const active = input.adjustments.filter((adjustment) => !adjustmentIsIdentity(adjustment));
  if (active.length === 0) return output;

  const mask = input.mask ?? null;
  // The mask mixes the fully adjusted pixel with the original, which is what "local adjustments"
  // means: the stack still runs, its result is simply limited to the painted area.
  const original = mask ? new Uint8ClampedArray(source) : null;

  const working = output;
  for (const adjustment of active) {
    if (adjustment.kind === 'clarity') {
      const blurred = boxBlur(working, width, height);
      const amount = (adjustment.value / 100) * 1.2;
      for (let index = 0; index < working.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          const current = working[index + channel] ?? 0;
          const soft = blurred[index + channel] ?? 0;
          working[index + channel] = clamp255(Math.round(current + (current - soft) * amount));
        }
      }
      continue;
    }

    const pixel: MutableRgb = [0, 0, 0];
    // One position object for the whole pass: allocating `{x, y, …}` per pixel was measurable.
    const position = { x: 0, y: 0, width, height };
    for (let y = 0; y < height; y += 1) {
      position.y = y;
      for (let x = 0; x < width; x += 1) {
        position.x = x;
        const index = (y * width + x) * 4;
        applyAdjustmentPixel(
          adjustment,
          working[index] ?? 0,
          working[index + 1] ?? 0,
          working[index + 2] ?? 0,
          position,
          pixel,
        );
        working[index] = clamp255(Math.round(pixel[0]));
        working[index + 1] = clamp255(Math.round(pixel[1]));
        working[index + 2] = clamp255(Math.round(pixel[2]));
      }
    }
  }

  if (mask && original) {
    for (let index = 0; index < working.length; index += 4) {
      // The mask is one byte per pixel, not RGBA: `index` walks RGBA, `index / 4` walks the mask.
      const strength = (mask[index >> 2] ?? 0) / 255;
      if (strength === 0) {
        working[index] = original[index] ?? 0;
        working[index + 1] = original[index + 1] ?? 0;
        working[index + 2] = original[index + 2] ?? 0;
        continue;
      }
      if (strength === 1) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        const before = original[index + channel] ?? 0;
        const after = working[index + channel] ?? 0;
        working[index + channel] = clamp255(Math.round(before + (after - before) * strength));
      }
    }
  }

  return working;
}

/** The pipeline's documented shader contract: the GLSL uses these same constants. */
export const PHOTO_PIPELINE_CONSTANTS = {
  exposureStopsPer100: 2,
  contrastPivot: 127.5,
  luminance: { r: 0.2126, g: 0.7152, b: 0.0722 },
  clarityRadius: 1,
  clarityGain: 1.2,
  vignetteStart: 0.55,
  vignetteEnd: 1.15,
  vignetteStrength: 0.85,
} as const;
