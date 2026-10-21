/**
 * Photo export without the panel.
 *
 * The export panel and the assistant both need the same thing: a full-resolution render of the
 * saved document, encoded by the browser's own encoder. Keeping that sequence here rather than in a
 * component is what lets the assistant produce a real file with the same code path a person uses —
 * and it is why an assistant export can be checked by the same tests as a manual one.
 */

import type { PhotoPayload } from '../../core/documents/payload';
import type { ForgeDocument } from '../../core/documents/types';
import {
  PHOTO_EXPORT_INFO,
  planPhotoExport,
  type PhotoExportFormat,
} from '../../core/photo/export';
import { err, forgeError, ok, type Result } from '../../core/result';
import {
  canEncodeImage,
  canvasToBytes,
  decodePhotoSource,
  renderPhoto,
  type PhotoEngineId,
} from './photo-engine';

export type RenderedPhotoExport = {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly engine: PhotoEngineId;
  readonly fallbackReason: string | null;
};

export async function renderPhotoExport(request: {
  readonly document: ForgeDocument;
  readonly payload: PhotoPayload;
  readonly format: PhotoExportFormat;
  /** 0–1; ignored by PNG. */
  readonly quality: number;
}): Promise<Result<RenderedPhotoExport>> {
  const info = PHOTO_EXPORT_INFO[request.format];
  const plan = planPhotoExport(
    {
      documentTitle: request.document.title,
      payload: request.payload,
      width: request.document.canvas.width,
      height: request.document.canvas.height,
      format: request.format,
      quality: request.quality,
    },
    { mimeTypeSupported: canEncodeImage(info.mimeType) },
  );
  if (!plan.ok) return plan;
  if (!plan.value.mimeTypeSupported) {
    return err(
      forgeError('unsupported', `This browser cannot encode ${info.label}.`, {
        detail: 'Choose PNG or JPEG; the check is made by asking the browser’s own encoder.',
        retryable: false,
      }),
    );
  }
  if (!request.payload.source) {
    return err(
      forgeError('validation-failed', 'There is no imported photo to export.', {
        detail: 'Import a photograph first; an empty project has no pixels to write.',
        retryable: false,
      }),
    );
  }

  const decoded = await decodePhotoSource(request.payload.source.href);
  if (!decoded.ok) return decoded;
  const rendered = await renderPhoto({
    image: decoded.value.image,
    payload: request.payload,
    width: plan.value.width,
    height: plan.value.height,
  });
  if (!rendered.ok) return rendered;
  const bytes = await canvasToBytes(rendered.value.canvas, plan.value.mimeType, plan.value.quality);
  if (!bytes.ok) return bytes;
  return ok({
    fileName: plan.value.fileName,
    bytes: bytes.value,
    mimeType: plan.value.mimeType,
    width: plan.value.width,
    height: plan.value.height,
    engine: rendered.value.engine,
    fallbackReason: rendered.value.fallbackReason,
  });
}
