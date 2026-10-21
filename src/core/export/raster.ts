/**
 * Raster export: document -> real PNG or JPEG bytes.
 *
 * The pipeline is deliberately framework-free and takes its canvas factory as an argument, so the
 * same code runs in the browser (through `src/lib/browser/canvas.ts`, which owns the one
 * `document.createElement('canvas')` call in the application) and in tests (with a rasteriser that
 * can actually produce pixels). Nothing here downloads anything either: it returns a `Blob` and
 * lets the caller decide what to do with it, which is what keeps this module out of the browser.
 *
 * Honesty rules this file enforces:
 *  - output size comes from the *document's* declared pixel dimensions and the chosen scale, never
 *    from the viewport or the zoom level;
 *  - an unresolved graphic layer is an error, not a silently missing element;
 *  - an encoder that returns nothing is reported as a failure;
 *  - JPEG gets an explicit, predictable background because it has no alpha channel.
 */

import type { ForgeDocument } from '../documents/types';
import { err, forgeError, ok, type Result } from '../result';
import { buildRenderPlan, type ImageResolver, type RenderIssue } from '../render/plan';
import { paintPlan, type PaintSurface, type PainterContext } from '../render/paint';
import { contextMeasureFactory } from '../render/measure';

export type RasterFormat = 'png' | 'jpeg';

export const RASTER_MIME_TYPES: Readonly<Record<RasterFormat, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
};

export const RASTER_EXTENSIONS: Readonly<Record<RasterFormat, string>> = {
  png: 'png',
  jpeg: 'jpg',
};

/** Output scales offered in the interface. 1 = the document's own pixel size. */
export const RASTER_SCALES = [0.5, 1, 2, 3] as const;

export const MIN_RASTER_SCALE = 0.25;
export const MAX_RASTER_SCALE = 4;

/** Refuse to build a bitmap larger than this: a browser would stall or fail without explaining. */
export const MAX_EXPORT_PIXELS = 40_000_000;

export const DEFAULT_JPEG_QUALITY = 0.92;
export const MIN_JPEG_QUALITY = 0.4;
export const MAX_JPEG_QUALITY = 1;

/** What fills the alpha channel JPEG cannot carry. */
export const JPEG_BACKGROUNDS = ['white', 'black', 'canvas'] as const;
export type JpegBackground = (typeof JPEG_BACKGROUNDS)[number];

export const JPEG_BACKGROUND_LABELS: Readonly<Record<JpegBackground, string>> = {
  white: 'White',
  black: 'Black',
  canvas: 'Flatten onto the canvas colour',
};

export const JPEG_BACKGROUND_COLORS: Readonly<Record<Exclude<JpegBackground, 'canvas'>, string>> = {
  white: '#ffffff',
  black: '#000000',
};

/**
 * The slice of `HTMLCanvasElement` the pipeline needs.
 *
 * Declared structurally so a test rasteriser can stand in; the browser type satisfies it as-is.
 */
export type RasterCanvas = {
  width: number;
  height: number;
  getContext(contextId: '2d'): PainterContext | null;
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
  /**
   * Creates an isolated drawing surface beside this canvas.
   *
   * Some drawing operations need their own alpha mask — tinting a graphic, for example — and a
   * shared canvas cannot provide one, because the document background is already painted underneath
   * the graphic. Returning `null` means this environment cannot make one.
   */
  createSurface: (width: number, height: number) => PaintSurface | null;
};

export type CanvasFactory = (width: number, height: number) => RasterCanvas;

export type RasterExportRequest = {
  readonly document: ForgeDocument;
  readonly format: RasterFormat;
  readonly scale: number;
  readonly createCanvas: CanvasFactory;
  readonly resolveImage: ImageResolver;
  /** JPEG only; ignored for PNG. */
  readonly quality?: number;
  /** JPEG only; ignored for PNG. Defaults to white. */
  readonly jpegBackground?: JpegBackground;
};

export type RasterExport = {
  readonly blob: Blob;
  readonly fileName: string;
  readonly format: RasterFormat;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly bytes: number;
  /** Non-blocking diagnostics the UI shows after a successful export. */
  readonly warnings: readonly string[];
  /** Issues found while planning, whether or not they blocked the export. */
  readonly issues: readonly RenderIssue[];
};

/** Output dimensions for a document at a scale, without rounding surprises for odd sizes. */
export function rasterDimensions(
  document: ForgeDocument,
  scale: number,
): { readonly width: number; readonly height: number } {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    width: Math.max(1, Math.round(document.canvas.width * safeScale)),
    height: Math.max(1, Math.round(document.canvas.height * safeScale)),
  };
}

export function rasterFileName(
  document: ForgeDocument,
  format: RasterFormat,
  dimensions: { readonly width: number; readonly height: number },
): string {
  const slug =
    document.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'forge-export';
  return `${slug}-${dimensions.width}x${dimensions.height}.${RASTER_EXTENSIONS[format]}`;
}

/**
 * The colour JPEG is flattened onto.
 *
 * A transparent canvas has no colour to flatten onto, so the user's explicit choice is used —
 * predictably white by default rather than whatever the encoder happens to do with alpha.
 */
export function jpegBackgroundColor(document: ForgeDocument, choice: JpegBackground): string {
  if (!document.canvas.transparent && choice === 'canvas') return document.canvas.background;
  if (choice === 'canvas') return JPEG_BACKGROUND_COLORS.white;
  return JPEG_BACKGROUND_COLORS[choice];
}

export function validateRasterRequest(
  request: Pick<RasterExportRequest, 'document' | 'format' | 'scale' | 'quality'>,
): Result<{ readonly width: number; readonly height: number }> {
  if (!Number.isFinite(request.scale)) {
    return err(forgeError('validation-failed', 'Choose an output scale.', { retryable: false }));
  }
  if (request.scale < MIN_RASTER_SCALE || request.scale > MAX_RASTER_SCALE) {
    return err(
      forgeError(
        'validation-failed',
        `Output scale must be between ${MIN_RASTER_SCALE}x and ${MAX_RASTER_SCALE}x.`,
        { retryable: false },
      ),
    );
  }

  const dimensions = rasterDimensions(request.document, request.scale);
  if (dimensions.width * dimensions.height > MAX_EXPORT_PIXELS) {
    return err(
      forgeError('unsupported', 'That export would be too large to build in a browser.', {
        detail: `${dimensions.width} x ${dimensions.height} px exceeds the ${(
          MAX_EXPORT_PIXELS / 1_000_000
        ).toFixed(0)} MP limit. Choose a smaller canvas or scale.`,
      }),
    );
  }

  if (request.format === 'jpeg' && request.quality !== undefined) {
    if (
      !Number.isFinite(request.quality) ||
      request.quality < MIN_JPEG_QUALITY ||
      request.quality > MAX_JPEG_QUALITY
    ) {
      return err(
        forgeError('validation-failed', 'JPEG quality must be between 40% and 100%.', {
          retryable: false,
        }),
      );
    }
  }

  return ok(dimensions);
}

/**
 * Renders a document to PNG or JPEG.
 *
 * Asynchronous because encoding is asynchronous in every browser. The returned `Result` carries a
 * human-readable reason for every failure path, so the UI never has to invent one.
 */
export async function exportRasterImage(
  request: RasterExportRequest,
): Promise<Result<RasterExport>> {
  const validated = validateRasterRequest(request);
  if (!validated.ok) return err(validated.error);

  const { width, height } = validated.value;
  const quality = request.quality ?? DEFAULT_JPEG_QUALITY;
  const jpegChoice = request.jpegBackground ?? 'white';

  let canvas: RasterCanvas;
  try {
    canvas = request.createCanvas(width, height);
  } catch (error) {
    return err(
      forgeError('unknown', 'The browser refused to create an export canvas.', {
        detail: error instanceof Error ? error.message : undefined,
      }),
    );
  }

  const context = canvas.getContext('2d');
  if (!context) {
    return err(
      forgeError('unsupported', 'This browser did not provide a 2D canvas context for export.', {
        detail: 'Canvas 2D is unavailable, so no image can be produced in this environment.',
        retryable: false,
      }),
    );
  }

  // Measured with the exporting context, so wrapping in the file matches wrapping on screen.
  const plan = buildRenderPlan(request.document, {
    measureFont: contextMeasureFactory(context),
    resolveImage: request.resolveImage,
    includeBackground: true,
    // JPEG cannot store alpha, so the background is always explicit for it.
    backgroundOverride:
      request.format === 'jpeg' ? jpegBackgroundColor(request.document, jpegChoice) : undefined,
  });

  if (plan.blocked) {
    const blocking = plan.issues.filter((issue) => issue.blocking);
    return err(
      forgeError('unsupported', 'This document cannot be exported yet.', {
        detail: blocking.map((issue) => issue.message).join(' '),
      }),
    );
  }

  // Output scale: everything below this line is drawn in document pixels.
  context.save();
  context.scale(request.scale, request.scale);
  const paintWarnings = paintPlan(context, plan, {
    clear: true,
    createSurface: canvas.createSurface,
  });
  context.restore();

  const blob = await encode(canvas, RASTER_MIME_TYPES[request.format], quality);
  if (!blob) {
    return err(
      forgeError(
        'unknown',
        `The browser could not encode the ${request.format.toUpperCase()} file.`,
        {
          retryable: true,
        },
      ),
    );
  }

  const warnings = [
    ...paintWarnings,
    ...plan.issues.filter((issue) => !issue.blocking).map((issue) => issue.message),
  ];

  return ok({
    blob,
    fileName: rasterFileName(request.document, request.format, { width, height }),
    format: request.format,
    mimeType: RASTER_MIME_TYPES[request.format],
    width,
    height,
    scale: request.scale,
    bytes: blob.size,
    warnings,
    issues: plan.issues,
  });
}

function encode(canvas: RasterCanvas, mimeType: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      if (mimeType === RASTER_MIME_TYPES.png) {
        canvas.toBlob((blob) => resolve(blob), mimeType);
        return;
      }
      canvas.toBlob((blob) => resolve(blob), mimeType, quality);
    } catch {
      resolve(null);
    }
  });
}
