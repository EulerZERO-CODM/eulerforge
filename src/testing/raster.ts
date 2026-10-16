/**
 * Test support: a real rasteriser for the export pipeline.
 *
 * `@napi-rs/canvas` implements the same Canvas 2D API as the browser, so tests can run the *real*
 * export pipeline and inspect real pixels. It is a development dependency only: the shipped app
 * always uses the browser's own canvas (see docs/DECISIONS.md -> ADR-0016).
 */

import { createCanvas, loadImage, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';

import type { CanvasFactory, RasterCanvas } from '../core/export/raster';
import type { ImageResolver, RenderImage } from '../core/render/plan';

export type PixelCanvas = {
  readonly canvas: Canvas;
  readonly context: SKRSContext2D;
};

/** A canvas plus its context, for asserting on pixels after an export. */
export function pixelCanvas(width: number, height: number): PixelCanvas {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  return { canvas, context };
}

export function rgbaAt(target: PixelCanvas, x: number, y: number): readonly number[] {
  return [...target.context.getImageData(x, y, 1, 1).data];
}

/** `CanvasFactory` backed by the native rasteriser. */
export function nodeCanvasFactory(): CanvasFactory {
  return (width, height) => {
    const canvas = createCanvas(width, height);
    const adapter: RasterCanvas = {
      get width() {
        return canvas.width;
      },
      set width(value: number) {
        canvas.width = value;
      },
      get height() {
        return canvas.height;
      },
      set height(value: number) {
        canvas.height = value;
      },
      getContext: (contextId) => canvas.getContext(contextId),
      toBlob: (callback, type, quality) => {
        try {
          const mime = type ?? 'image/png';
          const buffer =
            mime === 'image/jpeg'
              ? canvas.toBuffer('image/jpeg', Math.round((quality ?? 0.92) * 100))
              : canvas.toBuffer('image/png');
          callback(new Blob([new Uint8Array(buffer)], { type: mime }));
        } catch {
          callback(null);
        }
      },
    };
    return adapter;
  };
}

/**
 * Loads fixtures up front. Async loading is part of the real pipeline, but the pipeline itself
 * expects a synchronous resolver, so tests resolve everything before exporting.
 */
export async function loadImageFixtures(
  sources: Readonly<Record<string, Buffer | string>>,
): Promise<ImageResolver> {
  const loaded = new Map<string, RenderImage>();
  for (const [href, source] of Object.entries(sources)) {
    const image = await loadImage(source);
    loaded.set(href, image);
  }
  return (href) => {
    const image = loaded.get(href);
    return image ? { image } : { error: 'no fixture registered for this source' };
  };
}
