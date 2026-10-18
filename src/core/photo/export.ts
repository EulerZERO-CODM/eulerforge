/**
 * Photo export planning.
 *
 * Framework-free and browser-free: this decides *what* the file is (format, size, name, quality)
 * and validates the request. Producing the bytes is the browser renderer's job
 * (`src/lib/browser/photo-engine.ts`), and handing them to the user is the download adapter's.
 *
 * The exported pixels are re-rendered from the document at its full working size — never a copy of
 * the on-screen preview, which is capped for performance. That is what makes "export" mean the
 * photograph at its stored resolution rather than a screenshot of a 1280 px preview.
 */

import { MAX_PHOTO_WORKING_EDGE, type PhotoPayload } from '../documents/payload';
import { err, forgeError, ok, type Result } from '../result';

export const PHOTO_EXPORT_FORMATS = ['png', 'jpeg', 'webp'] as const;
export type PhotoExportFormat = (typeof PHOTO_EXPORT_FORMATS)[number];

/** The encoders the export panel can ask the browser for. */
export type PhotoExportMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export type PhotoExportInfo = {
  readonly label: string;
  readonly mimeType: PhotoExportMimeType;
  readonly extension: string;
  /** Whether a quality setting changes the output. */
  readonly quality: boolean;
  readonly description: string;
};

export const PHOTO_EXPORT_INFO: Readonly<Record<PhotoExportFormat, PhotoExportInfo>> = {
  png: {
    label: 'PNG',
    mimeType: 'image/png',
    extension: 'png',
    quality: false,
    description: 'Lossless, largest file. The exported bytes are the rendered pixels.',
  },
  jpeg: {
    label: 'JPEG',
    mimeType: 'image/jpeg',
    extension: 'jpg',
    quality: true,
    description:
      'Lossy, smallest at high quality. No transparency is involved: the photo is opaque.',
  },
  webp: {
    label: 'WebP',
    mimeType: 'image/webp',
    extension: 'webp',
    quality: true,
    description:
      'Lossy with a good size/quality ratio; support is checked before the button is used.',
  },
};

export const DEFAULT_PHOTO_EXPORT_FORMAT: PhotoExportFormat = 'png';
export const DEFAULT_PHOTO_EXPORT_QUALITY = 0.92;
export const MIN_PHOTO_EXPORT_QUALITY = 0.5;
export const MAX_PHOTO_EXPORT_QUALITY = 1;

/** Same slug rules as the raster exporter, so two exports of one project sort together. */
export function photoExportSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'photo'
  );
}

export function photoExportFileName(
  title: string,
  format: PhotoExportFormat,
  dimensions: { readonly width: number; readonly height: number },
): string {
  return `${photoExportSlug(title)}-${String(dimensions.width)}x${String(dimensions.height)}.${PHOTO_EXPORT_INFO[format].extension}`;
}

export type PhotoExportPlan = {
  readonly format: PhotoExportFormat;
  readonly mimeType: PhotoExportMimeType;
  readonly fileName: string;
  readonly width: number;
  readonly height: number;
  readonly quality: number;
  readonly mimeTypeSupported: boolean;
};

export type PhotoExportRequest = {
  readonly documentTitle: string;
  readonly payload: PhotoPayload;
  /** Output size. The Photo Studio always passes the document's own canvas. */
  readonly width: number;
  readonly height: number;
  readonly format: PhotoExportFormat;
  readonly quality?: number;
};

/**
 * Validates an export before any pixels are produced.
 *
 * The checks exist because each of them would otherwise fail after a multi-second render: no image,
 * a zero-sized canvas, or an output larger than the working copy the studio promises.
 */
export function planPhotoExport(
  request: PhotoExportRequest,
  options: { readonly mimeTypeSupported?: boolean } = {},
): Result<PhotoExportPlan> {
  if (!request.payload.source) {
    return err(
      forgeError('validation-failed', 'There is no imported photo to export.', {
        detail: 'Import a photograph first; an empty project has no pixels to write.',
        retryable: false,
      }),
    );
  }
  if (!Number.isInteger(request.width) || !Number.isInteger(request.height)) {
    return err(forgeError('validation-failed', 'The export size must be whole pixels.'));
  }
  if (request.width < 1 || request.height < 1) {
    return err(forgeError('validation-failed', 'The export size must be at least 1 × 1 pixel.'));
  }
  if (
    Math.max(request.width, request.height) > MAX_PHOTO_WORKING_EDGE ||
    Math.min(request.width, request.height) > MAX_PHOTO_WORKING_EDGE
  ) {
    return err(
      forgeError('validation-failed', 'The export is larger than the stored working copy.', {
        detail: `Photo Studio stores at most ${String(MAX_PHOTO_WORKING_EDGE)} px on the long edge; the document asks for ${String(request.width)} × ${String(request.height)}.`,
        retryable: false,
      }),
    );
  }
  const info = PHOTO_EXPORT_INFO[request.format];
  const quality = info.quality
    ? Math.min(
        MAX_PHOTO_EXPORT_QUALITY,
        Math.max(MIN_PHOTO_EXPORT_QUALITY, request.quality ?? DEFAULT_PHOTO_EXPORT_QUALITY),
      )
    : 1;
  return ok({
    format: request.format,
    mimeType: info.mimeType,
    fileName: photoExportFileName(request.documentTitle, request.format, request),
    width: request.width,
    height: request.height,
    quality,
    mimeTypeSupported: options.mimeTypeSupported ?? true,
  });
}

/** Human-readable size, used in the export report so the number is checkable. */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
