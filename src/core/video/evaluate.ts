/**
 * What the timeline looks like at a moment.
 *
 * The preview and the frame export both call `evaluateVideoAt`, for the same reason Motion Studio
 * shares its evaluator: two implementations of "what is playing now" would drift, and the drift
 * would only be visible as a wrong export. The result is plain data — no DOM, no clock — so a test
 * can assert the frame boundary behaviour and the source times exactly.
 */

import type { ForgeDocument } from '../documents/types';
import type { TitleClip, VideoClip, VideoMedia, VideoPayload } from '../documents/payload';
import { err, forgeError, ok, type Result } from '../result';
import { fitRect, sourceTimeFor, titleClipsAt, videoClipsAt } from './timeline';

export function videoPayloadOf(document: ForgeDocument): Result<VideoPayload> {
  const payload = document.studioPayload;
  if (!payload || payload.kind !== 'video') {
    return err(
      forgeError('validation-failed', 'This document is not a video timeline.', {
        detail:
          'Video evaluation only applies to documents whose studio payload is a video timeline.',
        retryable: false,
      }),
    );
  }
  return ok(payload);
}

export type EvaluatedVideoClip = {
  readonly clip: VideoClip;
  readonly media: VideoMedia;
  /** Seconds into the media file this frame shows. */
  readonly sourceTime: number;
  /** Where the source is drawn inside the frame, letterboxed. */
  readonly box: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** 0–1 after the clip's own volume. */
  readonly volume: number;
};

export type EvaluatedTitle = {
  readonly clip: TitleClip;
  /** 0–1 progress through the clip, for the future entrance/exit work; also useful in tests. */
  readonly progress: number;
};

export type VideoFrameState = {
  readonly time: number;
  readonly width: number;
  readonly height: number;
  readonly background: string;
  readonly videos: readonly EvaluatedVideoClip[];
  readonly titles: readonly EvaluatedTitle[];
  /** Audio clips that are playing, with their resolved source times. */
  readonly audio: readonly EvaluatedVideoClip[];
  /** Media ids this frame needs a decoded element for, in paint order. */
  readonly mediaIds: readonly string[];
};

/** Clamps a time into the composition. Times outside it are shown at the nearest edge. */
export function clampTime(payload: VideoPayload, time: number): number {
  if (!Number.isFinite(time)) return 0;
  return Math.min(payload.duration, Math.max(0, time));
}

/**
 * The frame at a time.
 *
 * The frame size comes from the document, not from the media: a timeline mixes sources of different
 * aspect ratios and resolutions, and letterboxing them into the document's canvas is the only way
 * the preview and the export can agree.
 */
export function evaluateVideoAt(document: ForgeDocument, time: number): Result<VideoFrameState> {
  const payloadResult = videoPayloadOf(document);
  if (!payloadResult.ok) return payloadResult;
  const payload = payloadResult.value;
  const at = clampTime(payload, time);
  const size = { width: document.canvas.width, height: document.canvas.height };

  const videos: EvaluatedVideoClip[] = [];
  for (const [, clip] of videoClipsAt(payload, at)) {
    const media = payload.media.find((entry) => entry.id === clip.mediaId);
    if (!media) continue; // A missing file is reported by `timelineIssues`, not painted as black.
    videos.push({
      clip,
      media,
      sourceTime: sourceTimeFor(clip, at),
      box: fitRect({ width: media.width, height: media.height }, size),
      volume: clip.muted ? 0 : clip.volume,
    });
  }

  const audio: EvaluatedVideoClip[] = [];
  for (const track of payload.tracks) {
    if (track.kind !== 'audio') continue;
    for (const clip of track.clips) {
      if (clip.kind !== 'audio') continue;
      if (at < clip.start || at >= clip.start + clip.duration) continue;
      const media = payload.media.find((entry) => entry.id === clip.mediaId);
      if (!media) continue;
      audio.push({
        clip,
        media,
        sourceTime: sourceTimeFor(clip, at),
        box: { x: 0, y: 0, width: size.width, height: size.height },
        volume: clip.muted ? 0 : clip.volume,
      });
    }
  }

  const titles = titleClipsAt(payload, at).map(([, clip]) => ({
    clip,
    progress: Math.min(1, Math.max(0, (at - clip.start) / Math.max(clip.duration, 1e-6))),
  }));

  const mediaIds = [...new Set([...videos, ...audio].map((entry) => entry.media.id))];

  return ok({
    time: at,
    width: size.width,
    height: size.height,
    background: document.canvas.background,
    videos,
    titles,
    audio,
    mediaIds,
  });
}

/** Timeline positions worth visiting: every clip edge, in order, de-duplicated. */
export function clipBoundaries(payload: VideoPayload): readonly number[] {
  const times = new Set<number>();
  for (const track of payload.tracks) {
    for (const clip of track.clips) {
      times.add(clip.start);
      times.add(clip.start + clip.duration);
    }
  }
  return [...times].sort((left, right) => left - right);
}
