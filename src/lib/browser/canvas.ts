/**
 * Browser canvas adapter.
 *
 * The one place in the application that names a real `HTMLCanvasElement`. `src/core/**` stays
 * free of DOM globals (ESLint enforces it), so the raster pipeline takes a *canvas factory* it is
 * handed instead: the live export passes this one, the tests pass a recording or a `@napi-rs/canvas`
 * implementation. That is what keeps the pipeline portable and testable without a browser.
 */

import type { RasterCanvas } from '../../core/export/raster';

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
  return canvas;
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
