/**
 * Timeline arithmetic for Video Studio.
 *
 * These are the questions the editor asks constantly — what is on screen at time t, where does a
 * clip end, which part of a source file is a clip showing — and they are pure functions so the
 * preview, the export and the tests all get the same answer.
 *
 * The model is tracks of clips. A clip is a window `[start, start + duration)` onto a media file
 * starting at `inPoint`, or a title with its own text. Overlaps are prevented by the commands (an
 * edit overwrites what it covers), so "what is playing" has exactly one answer per track.
 */

import type {
  TitleClip,
  TitlePosition,
  VideoClip,
  VideoMedia,
  VideoPayload,
  VideoTrack,
} from '../documents/payload';

export type TimelineClip = VideoClip | TitleClip;

export function clipEnd(clip: TimelineClip): number {
  return clip.start + clip.duration;
}

export function isTitleClip(clip: TimelineClip): clip is TitleClip {
  return clip.kind === 'title';
}

export function isVideoClip(clip: TimelineClip): clip is VideoClip {
  return clip.kind === 'video' || clip.kind === 'audio';
}

/** The clip playing on a track at a time, or null. Clips are non-overlapping by construction. */
export function clipAt(track: VideoTrack, time: number): TimelineClip | null {
  for (const clip of track.clips) {
    if (time >= clip.start - 1e-9 && time < clipEnd(clip) - 1e-9) return clip;
  }
  return null;
}

/** Every video clip visible at a time, in track order (later tracks paint on top). */
export function videoClipsAt(
  payload: VideoPayload,
  time: number,
): readonly (readonly [VideoTrack, VideoClip])[] {
  const found: (readonly [VideoTrack, VideoClip])[] = [];
  for (const track of payload.tracks) {
    if (track.kind !== 'video') continue;
    const clip = clipAt(track, time);
    if (clip && isVideoClip(clip) && clip.kind === 'video') found.push([track, clip]);
  }
  return found;
}

/** Every title visible at a time, in track order. */
export function titleClipsAt(
  payload: VideoPayload,
  time: number,
): readonly (readonly [VideoTrack, TitleClip])[] {
  const found: (readonly [VideoTrack, TitleClip])[] = [];
  for (const track of payload.tracks) {
    if (track.kind !== 'title') continue;
    const clip = clipAt(track, time);
    if (clip && isTitleClip(clip)) found.push([track, clip]);
  }
  return found;
}

/** The media record for a clip, or undefined when the file is no longer linked. */
export function mediaForClip(payload: VideoPayload, clip: VideoClip): VideoMedia | undefined {
  return payload.media.find((media) => media.id === clip.mediaId);
}

/**
 * Seconds into the source file that a clip shows at a timeline time.
 *
 * Outside the clip the answer is its in-point rather than an extrapolation: asking what a clip shows
 * before it starts has no sensible answer, and a negative time would seek the decoder backwards.
 */
export function sourceTimeFor(clip: VideoClip, time: number): number {
  return Math.max(0, clip.inPoint + Math.max(0, time - clip.start));
}

/** Clips on a track, sorted by start time. */
export function sortedClips(track: VideoTrack): readonly TimelineClip[] {
  return [...track.clips].sort((left, right) => left.start - right.start);
}

/** The end of the last clip in the composition, or 0 when it is empty. */
export function contentEnd(payload: VideoPayload): number {
  let end = 0;
  for (const track of payload.tracks) {
    for (const clip of track.clips) end = Math.max(end, clipEnd(clip));
  }
  return end;
}

/** True when any clip needs a media file that is not in the payload. */
export function missingMedia(payload: VideoPayload): readonly VideoClip[] {
  return payload.tracks.flatMap((track) =>
    track.clips.filter(
      (clip): clip is VideoClip =>
        isVideoClip(clip) && !payload.media.some((media) => media.id === clip.mediaId),
    ),
  );
}

export const TITLE_POSITION_LABELS: Readonly<Record<TitlePosition, string>> = {
  top: 'Top',
  center: 'Centre',
  lower: 'Lower third',
};

/** Where a title sits vertically, as a fraction of the frame height. */
export function titleAnchorY(position: TitlePosition): number {
  switch (position) {
    case 'top':
      return 0.18;
    case 'center':
      return 0.5;
    case 'lower':
      return 0.82;
  }
}

/**
 * The rectangle a source of one aspect ratio occupies inside a frame of another.
 *
 * Videos are letterboxed rather than stretched: a 16:9 clip in a 9:16 frame keeps its proportions
 * and gets bars, which is what every editor does and what the preview must show to be believed.
 */
export function fitRect(
  source: { readonly width: number; readonly height: number },
  target: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  if (source.width <= 0 || source.height <= 0) {
    return { x: 0, y: 0, width: target.width, height: target.height };
  }
  const scale = Math.min(target.width / source.width, target.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  return { x: (target.width - width) / 2, y: (target.height - height) / 2, width, height };
}

/** A sentence for each thing that would make an export or a playback dishonest. */
export function timelineIssues(payload: VideoPayload): readonly string[] {
  const issues: string[] = [];
  const missing = missingMedia(payload);
  if (missing.length > 0) {
    issues.push(
      `${String(missing.length)} clip${missing.length === 1 ? '' : 's'} reference media that is no longer in this browser: ${missing
        .map((clip) => `“${clip.name}”`)
        .join(', ')}. Re-import the file or remove the clip.`,
    );
  }
  if (contentEnd(payload) > payload.duration + 1e-6) {
    issues.push(
      `A clip ends at ${contentEnd(payload).toFixed(2)} s but the composition is ${payload.duration.toFixed(2)} s long; the end is cut off in the preview and the export.`,
    );
  }
  if (payload.tracks.every((track) => track.clips.length === 0)) {
    issues.push('The timeline is empty: add a clip before exporting.');
  }
  return issues;
}
