/**
 * SVG export payload.
 *
 * Sits between the document and the browser: it decides *what the file is* (name, contents, size, and
 * what it could not carry), while handing it to the user stays in the browser adapter. That split is
 * what lets the export be tested byte for byte without a browser, and what makes the browser test a
 * test of the download rather than of the serializer.
 */

import type { ForgeDocument } from '../documents/types';
import { artworkFromDocument, type UnsupportedLayer } from '../svg/from-scene';
import { serializeSvg, type SerializeOptions } from '../svg/serialize';
import { err, forgeError, ok, type Result } from '../result';

export type SvgExportPayload = {
  readonly contents: string;
  readonly fileName: string;
  readonly mimeType: string;
  /** UTF-8 byte length, which is what the download weighs. */
  readonly bytes: number;
  /** Layers the file could not represent, named. Empty means the export is complete. */
  readonly unsupported: readonly UnsupportedLayer[];
};

/**
 * A file name derived from the document title.
 *
 * The same rules as the raster exports, so a project exported as both a PNG and an SVG lands next to
 * each other with recognisably related names.
 */
export function svgFileName(document: ForgeDocument): string {
  const stem =
    document.title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'artwork';
  return `${stem}.svg`;
}

/**
 * Builds the SVG for a document.
 *
 * Refuses when the document contains layers that have no vector representation, unless the caller
 * passes `allowPartial`: an SVG that silently omits a text layer is worse than one that explains
 * itself, and only a caller who has told the user what is missing should be able to produce it.
 */
export function svgExportPayload(
  document: ForgeDocument,
  options: SerializeOptions & { readonly allowPartial?: boolean } = {},
): Result<SvgExportPayload> {
  const { artwork, unsupported, empty } = artworkFromDocument(document);

  if (empty) {
    return err(
      forgeError('unsupported', 'This document has no vector artwork to export.', {
        detail:
          unsupported.length > 0
            ? `${String(unsupported.length)} layer(s) cannot be written as SVG: ${unsupported
                .map((layer) => layer.layerName)
                .join(', ')}.`
            : 'Add a path, rectangle or ellipse, or convert a layer to vectors first.',
        retryable: false,
      }),
    );
  }

  if (unsupported.length > 0 && options.allowPartial !== true) {
    return err(
      forgeError(
        'unsupported',
        `SVG export cannot represent ${String(unsupported.length)} layer(s).`,
        {
          detail: unsupported.map((layer) => `${layer.layerName}: ${layer.reason}`).join(' '),
          retryable: false,
        },
      ),
    );
  }

  const serialized = serializeSvg(artwork, options);
  if (!serialized.ok) return err(serialized.error);

  return ok({
    contents: serialized.value,
    fileName: svgFileName(document),
    mimeType: 'image/svg+xml',
    bytes: new TextEncoder().encode(serialized.value).length,
    unsupported,
  });
}
