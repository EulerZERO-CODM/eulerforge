/**
 * Browser canvas adapter.
 *
 * The one place in the application that names a real `HTMLCanvasElement`. `src/core/**` stays
 * free of DOM globals (ESLint enforces it), so the raster pipeline takes a *canvas factory* it is
 * handed instead: the live export passes this one, the tests pass a recording or a `@napi-rs/canvas`
 * implementation. That is what keeps the pipeline portable and testable without a browser.
 */

import type { RasterCanvas } from '../../core/export/raster';
import type { PaintSurface } from '../../core/render/paint';

export function createBrowserCanvas(width: number, height: number): RasterCanvas {
  if (typeof document === 'undefined') {
    throw new Error('A canvas cannot be created outside a browser document.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  if (typeof canvas.toBlob !== 'function') {
    throw new Error('This browser cannot encode canvas images to a file.');
  }
  return browserCanvas(canvas);
}

/**
 * An isolated surface, for the operations that need their own alpha mask.
 *
 * Tinting a graphic means colouring only the pixels the graphic covers. That cannot be done on the
 * shared canvas, where the document background already sits underneath the graphic, so the graphic
 * is drawn here first, tinted here, and composited back.
 */
export function createBrowserSurface(width: number, height: number): PaintSurface | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d');
  if (!context) return null;
  return {
    context,
    width: canvas.width,
    height: canvas.height,
    draw: (target, x, y, drawWidth, drawHeight) => {
      target.drawImage(canvas, x, y, drawWidth, drawHeight);
    },
  };
}

/** The browser canvas as the core's `RasterCanvas`, including its ability to make surfaces. */
function browserCanvas(canvas: HTMLCanvasElement): RasterCanvas {
  return {
    get width(): number {
      return canvas.width;
    },
    set width(value: number) {
      canvas.width = value;
    },
    get height(): number {
      return canvas.height;
    },
    set height(value: number) {
      canvas.height = value;
    },
    getContext: (contextId) => canvas.getContext(contextId),
    toBlob: (callback, type, quality) => {
      canvas.toBlob(callback, type, quality);
    },
    createSurface: (surfaceWidth, surfaceHeight) =>
      createBrowserSurface(surfaceWidth, surfaceHeight),
  };
}

/**
 * True when the current environment can rasterise at all.
 *
 * The interface uses this to explain *before* the user presses export that this environment has no
 * canvas support, instead of failing afterwards with a generic message.
 */
export function canRasteriseHere(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    return typeof probe.getContext === 'function' && probe.getContext('2d') !== null;
  } catch {
    return false;
  }
}
