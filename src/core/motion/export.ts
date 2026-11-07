/**
 * Motion export planning.
 *
 * A frame sequence is the export this studio can honestly produce in every browser: PNG frames
 * encoded by the browser's own encoder, zipped by the project's own stored-mode writer, with a
 * manifest that records the exact times. Nothing here claims to be a video codec, and nothing is
 * written until the plan is valid.
 */

import type { ForgeDocument } from '../documents/types';
import type { MotionPayload } from '../documents/payload';
import { err, forgeError, ok, type Result } from '../result';
import { clampTime } from './evaluate';

/** Upper bound on one export, so a typo in the range cannot lock the tab up for a minute. */
export const MAX_MOTION_EXPORT_FRAMES = 1800;

export type MotionExportRequest = {
  readonly document: ForgeDocument;
  readonly payload: MotionPayload;
  /** Inclusive start time in seconds. */
  readonly from?: number;
  /** Exclusive end time in seconds; defaults to the composition length. */
  readonly to?: number;
  /** Output multiplier on the document size. 1 = document pixels. */
  readonly scale?: number;
  /** Export at most this many frames, evenly spaced. Used by the "every Nth frame" option. */
  readonly frameStep?: number;
};

export type MotionExportPlan = {
  /** Frame times in seconds, in increasing order; the last one is the final computed frame. */
  readonly times: readonly number[];
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly frameCount: number;
};

export function motionExportSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'motion'
  );
}

/**
 * Frame times for a range at a frame rate.
 *
 * `to` is exclusive, like a video edit: exporting 0–2 s at 30 fps produces 60 frames, and the frame
 * at exactly 2 s belongs to the next second. `frameStep` skips frames deliberately rather than
 * changing the composition's own fps, so a preview at 30 fps and a 10-step export still agree about
 * what the scene looks like at every exported time.
 */
export function motionFrameTimes(
  payload: MotionPayload,
  from: number,
  to: number,
  frameStep = 1,
): readonly number[] {
  const step = Math.max(1, Math.floor(frameStep));
  const start = clampTime(payload, from);
  const end = Math.min(payload.duration, clampTime(payload, to));
  if (end <= start) return [];
  const frameInterval = 1 / payload.fps;
  const times: number[] = [];
  for (let frame = 0; ; frame += step) {
    const time = start + frame * frameInterval;
    if (time >= end - 1e-9) break;
    times.push(Math.round(time * 1e6) / 1e6);
    if (times.length > MAX_MOTION_EXPORT_FRAMES) break;
  }
  return times;
}

/**
 * Validates an export before a single canvas is created.
 *
 * Every refusal is a sentence the panel can show as-is: an empty range, more frames than the cap,
 * a size the document model does not allow.
 */
export function planMotionExport(request: MotionExportRequest): Result<MotionExportPlan> {
  const payload = request.payload;
  const from = request.from ?? 0;
  const to = request.to ?? payload.duration;
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return err(
      forgeError('validation-failed', 'The export range is not a pair of times.', {
        detail: 'Enter a start and an end time in seconds.',
        retryable: false,
      }),
    );
  }
  if (to <= from) {
    return err(
      forgeError('validation-failed', 'The export range is empty.', {
        detail: 'Choose an end time later than the start time.',
        retryable: false,
      }),
    );
  }

  const times = motionFrameTimes(payload, from, to, request.frameStep ?? 1);
  if (times.length === 0) {
    return err(
      forgeError('validation-failed', 'The export range is empty.', {
        detail: 'Choose an end time later than the start time.',
        retryable: false,
      }),
    );
  }
  if (times.length >= MAX_MOTION_EXPORT_FRAMES) {
    return err(
      forgeError(
        'validation-failed',
        `That range is longer than the ${String(MAX_MOTION_EXPORT_FRAMES)}-frame export limit.`,
        {
          detail: 'Shorten the range, raise the frame step, or lower the frame rate.',
          retryable: false,
        },
      ),
    );
  }
  const scale = request.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 4) {
    return err(
      forgeError('validation-failed', 'That export scale is out of range.', {
        detail: 'Choose a scale between 0.1 and 4.',
        retryable: false,
      }),
    );
  }
  const width = Math.max(1, Math.round(request.document.canvas.width * scale));
  const height = Math.max(1, Math.round(request.document.canvas.height * scale));
  return ok({
    times,
    fps: payload.fps,
    width,
    height,
    scale,
    frameCount: times.length,
  });
}

/** Zero-padded frame name, so a zip listing sorts in playback order. */
export function motionFrameFileName(index: number, total: number): string {
  const digits = Math.max(4, String(total).length);
  return `frames/frame-${String(index + 1).padStart(digits, '0')}.png`;
}

export function motionArchiveName(title: string): string {
  return `${motionExportSlug(title)}-frames.zip`;
}

/**
 * The manifest written into the archive.
 *
 * It records the times, the frame rate and the document they came from, so the sequence can be
 * reassembled by another tool without guessing, and a mismatch between a claimed and an actual
 * export is visible in the file itself.
 */
export function buildMotionManifest(input: {
  readonly document: ForgeDocument;
  readonly payload: MotionPayload;
  readonly plan: MotionExportPlan;
  readonly createdAt: string;
}): string {
  return `${JSON.stringify(
    {
      format: 'eulerforge-motion-frames/1',
      createdAt: input.createdAt,
      documentId: input.document.id,
      title: input.document.title,
      duration: input.payload.duration,
      fps: input.plan.fps,
      width: input.plan.width,
      height: input.plan.height,
      scale: input.plan.scale,
      frameCount: input.plan.frameCount,
      times: input.plan.times,
      frames: input.plan.times.map((_, index) => motionFrameFileName(index, input.plan.frameCount)),
      note: 'PNG frames rendered from the saved document by the same evaluator the preview uses.',
    },
    null,
    2,
  )}\n`;
}
