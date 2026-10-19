/**
 * Tracing a chosen image inside the browser.
 *
 * This module owns the only DOM work the tracer needs: accepting a file, decoding it, drawing it to
 * a scratch canvas and reading the pixels back. The tracing itself is `src/core/vector/trace.ts`,
 * which knows nothing about files or canvases and is tested in Node against synthetic buffers.
 *
 * Two decisions are deliberate:
 *
 *  - **It does not reuse the Photo Studio engine.** Decoding is twenty lines; importing the photo
 *    engine would pull its WebGL pipeline into the Illustration Studio's bundle for no benefit, and
 *    would couple two studios that are otherwise independent.
 *  - **The scratch copy is capped.** A 12 MP photograph is drawn at most 1024 px on its long edge
 *    before its pixels are read: the tracer works at 512 px anyway, and allocating a 48 MB pixel
 *    buffer for a detail that is then discarded is how a tab runs out of memory.
 */

import { err, forgeError, ok, type Result } from '../../core/result';
import { traceImage, type TraceOptions, type TraceReport } from '../../core/vector/trace';

export const TRACE_ACCEPTED_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

/** The `accept` attribute that matches `TRACE_ACCEPTED_TYPES`, so the two cannot drift. */
export const TRACE_ACCEPT_ATTRIBUTE = TRACE_ACCEPTED_TYPES.join(',');

export const TRACE_FILE_LIMITS = Object.freeze({
  maxBytes: 25 * 1024 * 1024,
  /** Long edge of the scratch copy whose pixels are traced. */
  maxSourceEdge: 1024,
});

export type TracedFile = {
  readonly report: TraceReport;
  readonly fileName: string;
  /** Size of the image as decoded, before the scratch copy is capped. */
  readonly source: { readonly width: number; readonly height: number };
};

type DecodedImage = {
  readonly image: CanvasImageSource;
  readonly width: number;
  readonly height: number;
};

async function decode(href: string): Promise<Result<DecodedImage>> {
  if (typeof createImageBitmap === 'function') {
    try {
      const response = await fetch(href);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      return ok({ image: bitmap, width: bitmap.width, height: bitmap.height });
    } catch {
      // Some browsers refuse a blob fetch for a data URL; the <img> path below still works.
    }
  }
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      resolve(ok({ image, width: image.naturalWidth, height: image.naturalHeight }));
    };
    image.onerror = () => {
      resolve(
        err(
          forgeError('unsupported', 'That image could not be decoded by this browser.', {
            detail: 'The file may be corrupt, or in a format this browser cannot open.',
            retryable: false,
          }),
        ),
      );
    };
    image.src = href;
  });
}

/**
 * Reads an image's pixels through a scratch canvas.
 *
 * Exported because it is the seam a test can replace: jsdom has no rasteriser, so the tests for the
 * tracer drive `tracePixelBuffer` and the component tests stand in for this function.
 */
export function pixelsOf(
  image: CanvasImageSource,
  width: number,
  height: number,
): Result<{ readonly pixels: Uint8ClampedArray; readonly width: number; readonly height: number }> {
  const edge = Math.max(width, height);
  const scale = edge > TRACE_FILE_LIMITS.maxSourceEdge ? TRACE_FILE_LIMITS.maxSourceEdge / edge : 1;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return err(
      forgeError('unsupported', 'This browser refused a canvas for the image.', {
        detail: 'Tracing needs a 2D canvas context, which is unavailable here.',
        retryable: false,
      }),
    );
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  let imageData: ImageData;
  try {
    imageData = context.getImageData(0, 0, targetWidth, targetHeight);
  } catch {
    return err(
      forgeError('unsupported', 'The image could not be read back from the canvas.', {
        detail: 'The canvas was probably tainted by a cross-origin image.',
        retryable: false,
      }),
    );
  }
  return ok({ pixels: imageData.data, width: targetWidth, height: targetHeight });
}

/** Traces pixels already in memory; the pure, testable half of `traceFile`. */
export function tracePixelBuffer(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: TraceOptions = {},
): Result<TraceReport> {
  return traceImage(pixels, width, height, options);
}

/** Decodes a user-chosen file and traces it. */
export async function traceFile(
  file: File,
  options: TraceOptions = {},
): Promise<Result<TracedFile>> {
  if (!TRACE_ACCEPTED_TYPES.includes(file.type)) {
    return err(
      forgeError('unsupported', 'That file type cannot be traced.', {
        detail:
          file.type === 'image/svg+xml'
            ? 'The file is already vector artwork; open it with the SVG importer instead.'
            : `Choose a PNG, JPEG or WebP image. This one is “${file.type || 'unknown'}”.`,
        retryable: false,
      }),
    );
  }
  if (file.size > TRACE_FILE_LIMITS.maxBytes) {
    return err(
      forgeError('validation-failed', 'That image is too large to open.', {
        detail: `The file is ${String(Math.round(file.size / 1024 / 1024))} MB; the limit is ${String(TRACE_FILE_LIMITS.maxBytes / 1024 / 1024)} MB.`,
        retryable: false,
      }),
    );
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const decoded = await decode(objectUrl);
    if (!decoded.ok) return err(decoded.error);
    const { image, width, height } = decoded.value;
    if (width < 1 || height < 1) {
      return err(
        forgeError('unsupported', 'That image could not be decoded by this browser.', {
          detail: 'The file may be corrupt, or in a format this browser cannot open.',
          retryable: false,
        }),
      );
    }
    const pixels = pixelsOf(image, width, height);
    if (!pixels.ok) return err(pixels.error);
    const report = tracePixelBuffer(
      pixels.value.pixels,
      pixels.value.width,
      pixels.value.height,
      options,
    );
    if (!report.ok) return err(report.error);

    if (typeof image === 'object' && 'close' in image && typeof image.close === 'function') {
      image.close();
    }
    return ok({
      report: report.value,
      fileName: file.name || 'Image',
      source: { width, height },
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
