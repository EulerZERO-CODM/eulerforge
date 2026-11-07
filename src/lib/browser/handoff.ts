/**
 * The browser half of a studio handoff.
 *
 * `src/core/handoff` decides what a carried document *is*; this module produces the one thing the
 * core cannot: pixels. Rasterising an artboard uses the same export pipeline as the PNG export
 * button, so what arrives in Photo Studio is what the design's own export would have produced — not
 * a screenshot of the editor with its guides, selection handles or zoom baked in.
 *
 * The result is a `PhotoSource`, which means it passes through exactly the rules an imported
 * photograph passes through: an embedded data URL (so the project does not depend on a temporary
 * file), a stated mime type, and the documented length limit enforced with a readable error rather
 * than a silently truncated document.
 */

import { MAX_PHOTO_HREF_LENGTH, type PhotoSource } from '../../core/documents/payload';
import type { ForgeDocument } from '../../core/documents/types';
import { handoffRasterScale, handoffRasterSize } from '../../core/handoff';
import { exportRasterImage } from '../../core/export/raster';
import type { ImageResolver } from '../../core/render/plan';
import { err, forgeError, ok, type Result } from '../../core/result';
import { createBrowserCanvas } from './canvas';

/** Reads an encoded blob back as a data URL; `FileReader` is the only portable way in a browser. */
function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof FileReader === 'undefined') {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : null);
    };
    reader.onerror = () => {
      resolve(null);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Renders a design's artboard to a PNG and wraps it as a photo source.
 *
 * The render happens at `handoffRasterScale`, which is capped at the photo working-copy limit, so
 * the encoded string cannot be larger than the document it is about to become. A graphic whose
 * image has not decoded yet makes the render plan blocking, and that failure is returned as-is:
 * carrying half a poster and calling it a retouch job would be worse than refusing.
 */
export async function rasteriseArtboardForPhoto(
  source: ForgeDocument,
  resolveImage: ImageResolver,
): Promise<Result<PhotoSource>> {
  const scale = handoffRasterScale(source);
  const size = handoffRasterSize(source);
  const rendered = await exportRasterImage({
    document: source,
    format: 'png',
    scale,
    createCanvas: createBrowserCanvas,
    resolveImage,
  });
  if (!rendered.ok) return rendered;

  const href = await blobToDataUrl(rendered.value.blob);
  if (href === null) {
    return err(
      forgeError('unsupported', 'The rendered artboard could not be read back as an image.', {
        detail: 'This browser refused to encode the canvas as a data URL.',
        retryable: false,
      }),
    );
  }
  if (href.length > MAX_PHOTO_HREF_LENGTH) {
    return err(
      forgeError(
        'storage-quota-exceeded',
        'The rendered artboard is too large to store inside a project.',
        {
          detail: `The encoded image is ${String(href.length)} characters; the limit is ${String(
            MAX_PHOTO_HREF_LENGTH,
          )}. Reduce the canvas size and try again.`,
          retryable: false,
        },
      ),
    );
  }

  return ok({
    name: `${source.title}.png`.slice(0, 120),
    href,
    width: size.width,
    height: size.height,
    mimeType: 'image/png',
    // What the artboard was authored at, kept so the panel can say what the working copy was
    // rendered from — the same fact an imported photograph reports.
    originalWidth: Math.max(1, Math.round(source.canvas.width)),
    originalHeight: Math.max(1, Math.round(source.canvas.height)),
  });
}
