/**
 * Browser frame export for Motion Studio.
 *
 * This is the only place the frame pipeline touches a real canvas. The scene itself is evaluated in
 * `src/core/motion`, and the frame is painted by the same `exportRasterImage` the Design Studio
 * uses — so a motion frame is a document render, not a separate drawing path that could drift from
 * the preview.
 *
 * A frame sequence plus a manifest, zipped with the project's own writer, is what this module
 * produces. It is not a video file and does not pretend to be one: the panel says PNG sequence.
 */

import type { MotionExportPlan } from '../../core/motion/export';
import {
  buildMotionManifest,
  motionArchiveName,
  motionFrameFileName,
} from '../../core/motion/export';
import { evaluateDocumentAt } from '../../core/motion/evaluate';
import { exportRasterImage } from '../../core/export/raster';
import type { ImageResolver } from '../../core/render/plan';
import { createZip } from '../../core/svg/zip';
import { forgeError, type ForgeError } from '../../core/result';
import type { ForgeDocument } from '../../core/documents/types';
import type { MotionPayload } from '../../core/documents/payload';
import { createBrowserCanvas } from './canvas';

export type MotionFrameProgress = {
  readonly rendered: number;
  readonly total: number;
};

export type MotionFrameExportRequest = {
  readonly document: ForgeDocument;
  readonly payload: MotionPayload;
  readonly plan: MotionExportPlan;
  readonly resolveImage: ImageResolver;
  /** Injected so the archive's manifest is reproducible in tests. */
  readonly createdAt?: string;
  readonly onProgress?: (progress: MotionFrameProgress) => void;
  readonly signal?: AbortSignal;
};

export type MotionFrameExport =
  | {
      readonly status: 'exported';
      readonly zip: Uint8Array;
      readonly frames: number;
      readonly width: number;
      readonly height: number;
      readonly fileName: string;
    }
  | { readonly status: 'cancelled'; readonly frames: number }
  | { readonly status: 'failed'; readonly error: ForgeError; readonly frames: number };

function encodeFailure(error: ForgeError, frames: number): MotionFrameExport {
  return { status: 'failed' as const, error, frames };
}

/**
 * Renders every planned frame, then zips the PNGs with a manifest.
 *
 * Frames are rendered one at a time on purpose: a 30-frame export at 1080 px would allocate about
 * 250 MB if every canvas were held at once. Progress is reported per frame so the panel can show a
 * real count rather than an animated spinner, and an abort between frames discards the partial
 * archive instead of delivering half a sequence.
 */
export async function exportMotionFrames(
  request: MotionFrameExportRequest,
): Promise<MotionFrameExport> {
  const entries: { name: string; data: Uint8Array }[] = [];
  const total = request.plan.frameCount;

  for (let index = 0; index < total; index += 1) {
    if (request.signal?.aborted === true) return { status: 'cancelled', frames: entries.length };
    const time = request.plan.times[index] ?? 0;
    const frameDocument = evaluateDocumentAt(request.document, time);
    const rendered = await exportRasterImage({
      document: frameDocument,
      format: 'png',
      scale: request.plan.scale,
      createCanvas: createBrowserCanvas,
      resolveImage: request.resolveImage,
    });
    if (!rendered.ok) return encodeFailure(rendered.error, entries.length);
    const bytes = new Uint8Array(await rendered.value.blob.arrayBuffer());
    entries.push({ name: motionFrameFileName(index, total), data: bytes });
    request.onProgress?.({ rendered: entries.length, total });
  }

  const manifest = buildMotionManifest({
    document: request.document,
    payload: request.payload,
    plan: request.plan,
    createdAt: request.createdAt ?? new Date().toISOString(),
  });
  entries.push({ name: 'manifest.json', data: new TextEncoder().encode(manifest) });

  const zip = createZip(entries);
  if (zip.length === 0) {
    return encodeFailure(
      forgeError('unknown', 'The frame archive could not be assembled.', { retryable: true }),
      entries.length,
    );
  }
  return {
    status: 'exported',
    zip,
    frames: total,
    width: request.plan.width,
    height: request.plan.height,
    fileName: motionArchiveName(request.document.title),
  };
}
