/**
 * The browser side of tracing.
 *
 * jsdom has no rasteriser, which is exactly why these tests concentrate on the decisions this module
 * makes *before* and *around* rasterisation: which files it accepts, how it caps the scratch copy,
 * and what it says when a canvas or a pixel read is unavailable. Decoding itself is exercised in
 * Chromium by `e2e/illustration.spec.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  TRACE_ACCEPT_ATTRIBUTE,
  TRACE_ACCEPTED_TYPES,
  TRACE_FILE_LIMITS,
  pixelsOf,
  traceFile,
  tracePixelBuffer,
} from './image-trace';

function fileOf(type: string, size = 8): File {
  return new File([new Uint8Array(size)], 'image', { type });
}

describe('traceFile', () => {
  it('accepts only raster formats and says why SVG is not one of them', async () => {
    for (const type of TRACE_ACCEPTED_TYPES) {
      expect(TRACE_ACCEPT_ATTRIBUTE).toContain(type);
    }
    const svg = await traceFile(fileOf('image/svg+xml'));
    expect(svg.ok).toBe(false);
    if (svg.ok) return;
    expect(svg.error.message).toMatch(/cannot be traced/i);
    expect(svg.error.detail).toMatch(/svg importer/i);

    const gif = await traceFile(fileOf('image/gif'));
    expect(gif.ok).toBe(false);
    if (gif.ok) return;
    expect(gif.error.detail).toMatch(/PNG, JPEG or WebP/);
  });

  it('refuses a file over the size limit before touching the DOM', async () => {
    const huge = await traceFile(fileOf('image/png', TRACE_FILE_LIMITS.maxBytes + 1));
    expect(huge.ok).toBe(false);
    if (huge.ok) return;
    expect(huge.error.message).toMatch(/too large/i);
    expect(huge.error.detail).toMatch(/25 MB/);
  });
});

describe('pixelsOf', () => {
  it('refuses when the browser will not give a 2D context', () => {
    const image = document.createElement('canvas');
    const result = pixelsOf(image, 100, 100);
    // jsdom returns null from getContext('2d') without the optional `canvas` package, which is the
    // same shape as a hardened browser refusing a readback. Either way it must be a refusal, not a
    // crash and not a silent empty buffer.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/canvas/i);
  });
});

describe('tracePixelBuffer', () => {
  it('traces an in-memory buffer and refuses nonsense dimensions', () => {
    const width = 8;
    const height = 8;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      const at = index * 4;
      const left = index % width < width / 2;
      pixels[at] = left ? 255 : 0;
      pixels[at + 1] = 0;
      pixels[at + 2] = left ? 0 : 255;
      pixels[at + 3] = 255;
    }
    const traced = tracePixelBuffer(pixels, width, height, { colours: 2, minArea: 1 });
    expect(traced.ok).toBe(true);
    if (!traced.ok) return;
    expect(traced.value.regions.length).toBe(2);

    expect(tracePixelBuffer(new Uint8ClampedArray(0), 0, 0).ok).toBe(false);
  });
});
