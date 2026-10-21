/**
 * Video export planning.
 *
 * Two exports are real in this browser build, and neither claims a codec it cannot deliver:
 *
 * 1. **A PNG frame sequence** — deterministic, frame by frame, rendered through the same evaluator
 *    the preview uses, zipped with a manifest of exact times. This is the export a test can hold to
 *    account pixel by pixel, and the one to use when the result must be frame-accurate.
 * 2. **A real-time WebM recording** — the browser's own `MediaRecorder` over the preview canvas and
 *    audio graph. It produces a genuine video file, but it is a *capture*: it runs in real time, so a
 *    30-second timeline takes 30 seconds, and a slow machine can drop frames. The panel says exactly
 *    that, and the engine reports the codec it actually negotiated instead of pretending to know.
 *
 * Everything below is planning: no canvas, no recorder, no DOM. A plan either exists and is valid,
 * or it carries the sentence explaining why it does not.
 */

import type { VideoPayload } from '../documents/payload';
import type { ForgeDocument } from '../documents/types';
import { err, forgeError, ok, type Result } from '../result';
import { contentEnd, isTitleClip, missingMedia } from './timeline';

/** Frames one export may contain. A typo in the range must not lock the tab up. */
export const MAX_VIDEO_EXPORT_FRAMES = 1800;

/** A real-time capture cannot be paused and resumed cheaply, so cap it at two minutes. */
export const MAX_VIDEO_CAPTURE_SECONDS = 120;

export type VideoExportRequest = {
  readonly document: ForgeDocument;
  readonly payload: VideoPayload;
  /** Inclusive start time in seconds. */
  readonly from?: number;
  /** Exclusive end time in seconds; defaults to the composition length. */
  readonly to?: number;
  readonly scale?: number;
  readonly frameStep?: number;
};

export type VideoExportPlan = {
  readonly times: readonly number[];
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly frameCount: number;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function videoExportSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'video'
  );
}

/**
 * Frame times for a range.
 *
 * `to` is exclusive: 0–2 s at 30 fps is 60 frames, and the frame at exactly 2 s belongs to whatever
 * comes next. Times are rounded to microseconds so a float accumulation cannot make two exports of
 * the same range differ in the last digit.
 */
export function videoFrameTimes(
  payload: VideoPayload,
  from: number,
  to: number,
  frameStep = 1,
): readonly number[] {
  const step = Math.max(1, Math.floor(frameStep));
  const start = clamp(from, 0, payload.duration);
  const end = clamp(to, 0, payload.duration);
  if (end <= start) return [];
  const frameInterval = 1 / payload.fps;
  const times: number[] = [];
  for (let frame = 0; ; frame += step) {
    const time = start + frame * frameInterval;
    if (time >= end - 1e-9) break;
    times.push(Math.round(time * 1e6) / 1e6);
    if (times.length > MAX_VIDEO_EXPORT_FRAMES) break;
  }
  return times;
}

/** Why an export would be dishonest, or an empty list. */
export function videoExportBlockers(payload: VideoPayload): readonly string[] {
  const blockers: string[] = [];
  const missing = missingMedia(payload);
  if (missing.length > 0) {
    blockers.push(
      `${String(missing.length)} clip${missing.length === 1 ? '' : 's'} ${missing.length === 1 ? 'references' : 'reference'} media that is no longer in this browser (${missing
        .map((clip) => `“${clip.name}”`)
        .join(', ')}). Re-import the file or remove the clip.`,
    );
  }
  const hasVisual = payload.tracks.some((track) =>
    track.clips.some((clip) => clip.kind === 'video' || clip.kind === 'title'),
  );
  if (!hasVisual) {
    blockers.push('There is nothing to render: add a clip or a title first.');
  }
  if (contentEnd(payload) > payload.duration + 1e-6) {
    blockers.push(
      `A clip ends at ${contentEnd(payload).toFixed(2)} s but the composition ends at ${payload.duration.toFixed(2)} s. Lengthen the composition so the whole edit is exported.`,
    );
  }
  return blockers;
}

/** Validates a frame-sequence export before a canvas exists. */
export function planVideoExport(request: VideoExportRequest): Result<VideoExportPlan> {
  const blockers = videoExportBlockers(request.payload);
  if (blockers.length > 0) {
    return err(
      forgeError('validation-failed', blockers[0] ?? 'This timeline cannot be exported yet.', {
        detail: blockers.join(' '),
        retryable: false,
      }),
    );
  }

  const from = request.from ?? 0;
  const to = request.to ?? request.payload.duration;
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

  const times = videoFrameTimes(request.payload, from, to, request.frameStep ?? 1);
  if (times.length === 0) {
    return err(
      forgeError('validation-failed', 'The export range is empty.', {
        detail: 'Choose an end time later than the start time.',
        retryable: false,
      }),
    );
  }
  if (times.length >= MAX_VIDEO_EXPORT_FRAMES) {
    return err(
      forgeError(
        'validation-failed',
        `That range is longer than the ${String(MAX_VIDEO_EXPORT_FRAMES)}-frame export limit.`,
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

  return ok({
    times,
    fps: request.payload.fps,
    width: Math.max(1, Math.round(request.document.canvas.width * scale)),
    height: Math.max(1, Math.round(request.document.canvas.height * scale)),
    scale,
    frameCount: times.length,
  });
}

/** Zero-padded frame name, so a zip listing sorts in playback order. */
export function videoFrameFileName(index: number, total: number): string {
  const digits = Math.max(4, String(total).length);
  return `frames/frame-${String(index + 1).padStart(digits, '0')}.png`;
}

export function videoArchiveName(title: string): string {
  return `${videoExportSlug(title)}-video-frames.zip`;
}

export function videoCaptureFileName(title: string, extension = 'webm'): string {
  return `${videoExportSlug(title)}-capture.${extension}`;
}

export type VideoCapturePlan = {
  readonly from: number;
  readonly to: number;
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
};

/**
 * Plans a real-time capture.
 *
 * The capture is bounded because it runs in wall-clock time: two minutes of composition means two
 * minutes of recording, and a user who asked for an hour deserves a sentence rather than a browser
 * tab that appears to hang.
 */
export function planVideoCapture(
  request: Pick<VideoExportRequest, 'document' | 'payload' | 'from' | 'to'>,
): Result<VideoCapturePlan> {
  const blockers = videoExportBlockers(request.payload);
  if (blockers.length > 0) {
    return err(
      forgeError('validation-failed', blockers[0] ?? 'This timeline cannot be recorded yet.', {
        detail: blockers.join(' '),
        retryable: false,
      }),
    );
  }
  const from = request.from ?? 0;
  const to = request.to ?? request.payload.duration;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return err(
      forgeError('validation-failed', 'The recording range is empty.', {
        detail: 'Choose an end time later than the start time.',
        retryable: false,
      }),
    );
  }
  const duration = to - from;
  if (duration > MAX_VIDEO_CAPTURE_SECONDS) {
    return err(
      forgeError('validation-failed', 'That is too long to record in real time.', {
        detail: `A browser capture is limited to ${String(MAX_VIDEO_CAPTURE_SECONDS)} seconds; export a frame sequence for a longer range.`,
        retryable: false,
      }),
    );
  }
  return ok({
    from,
    to,
    duration,
    width: request.document.canvas.width,
    height: request.document.canvas.height,
    fps: request.payload.fps,
  });
}

/** The manifest written beside the frames. */
export function buildVideoManifest(input: {
  readonly document: ForgeDocument;
  readonly payload: VideoPayload;
  readonly plan: VideoExportPlan;
  readonly createdAt: string;
}): string {
  return `${JSON.stringify(
    {
      format: 'eulerforge-video-frames/1',
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
      frames: input.plan.times.map((_, index) => videoFrameFileName(index, input.plan.frameCount)),
      media: input.payload.media.map((media) => ({
        id: media.id,
        name: media.name,
        kind: media.kind,
        mimeType: media.mimeType,
        duration: media.duration,
      })),
      // Titles are part of the composition's text, so the manifest carries them as data as well as
      // pixels: a frame sequence is not much use for re-editing if the words only exist in PNGs.
      titles: input.payload.tracks
        .flatMap((track) => track.clips)
        .filter(isTitleClip)
        .map((clip) => ({
          text: clip.text,
          start: clip.start,
          duration: clip.duration,
          position: clip.position,
          color: clip.color,
          fontSize: clip.fontSize,
        })),
      note: 'PNG frames rendered from the saved timeline by the same evaluator the preview uses. This is a frame sequence, not a video file.',
    },
    null,
    2,
  )}\n`;
}
