/**
 * Video editing commands.
 *
 * Every edit is one labelled command with a document patch, exactly like the other studios, so undo,
 * redo and autosave need no special cases. Two policy decisions live here rather than in the UI:
 *
 * - **Placing a clip overwrites what it covers.** Dropping a clip on a busy range is a normal NLE
 *   action; refusing it would make the timeline feel broken, and silently stacking would make the
 *   preview ambiguous. Overlapped neighbours are trimmed, split or removed so each track holds at
 *   most one clip at any time — which is what makes `clipAt` a one-line lookup.
 * - **A trim cannot invent source footage.** Trimming the left edge moves `inPoint` with it, and a
 *   trim that would run past either end of the file is clamped to the file, not accepted with a
 *   black tail.
 */

import type {
  TitleClip,
  TitlePosition,
  VideoClip,
  VideoMedia,
  VideoPayload,
  VideoTrack,
  VideoTrackKind,
} from '../documents/payload';
import {
  MAX_VIDEO_CLIPS,
  MAX_VIDEO_DURATION,
  MAX_VIDEO_FPS,
  MAX_VIDEO_MEDIA,
  MAX_VIDEO_TRACKS,
  TITLE_POSITIONS,
  createPayloadItemId,
} from '../documents/payload';
import type { ForgeDocument } from '../documents/types';
import type { SceneCommand } from '../editor/commands';
import { err, forgeError, ok, type Result } from '../result';
import { clipEnd, isTitleClip, isVideoClip, type TimelineClip } from './timeline';

const MIN_CLIP_DURATION = 0.1;

function videoPayload(document: ForgeDocument): Result<VideoPayload> {
  const payload = document.studioPayload;
  if (!payload || payload.kind !== 'video') {
    return err(
      forgeError('validation-failed', 'This document is not a video timeline.', {
        detail: 'Video commands only apply to documents whose studio payload is a video timeline.',
        retryable: false,
      }),
    );
  }
  return ok(payload);
}

function withPayload(payload: VideoPayload, label: string): SceneCommand {
  return { label, patch: { studioPayload: freezePayload(payload) } };
}

function freezePayload(payload: VideoPayload): VideoPayload {
  return Object.freeze({
    ...payload,
    media: Object.freeze(payload.media.map((entry) => Object.freeze({ ...entry }))),
    tracks: Object.freeze(
      payload.tracks.map((track) =>
        Object.freeze({
          ...track,
          clips: Object.freeze(track.clips.map((clip) => Object.freeze({ ...clip }))),
        }),
      ),
    ),
  });
}

/** Rounds a time to milliseconds, the resolution every edit uses. */
export function roundTime(time: number): number {
  return Math.round(time * 1000) / 1000;
}

function seconds(value: number): string {
  return `${value.toFixed(2)} s`;
}

/** A clip's name: titles are named by their words, media clips by their file. */
function clipLabel(clip: TimelineClip): string {
  return isTitleClip(clip) ? clip.text : clip.name;
}

export type ClipLocation = {
  readonly track: VideoTrack;
  readonly clip: TimelineClip;
};

export function findClip(document: ForgeDocument, clipId: string): ClipLocation | null {
  const payload = document.studioPayload;
  if (!payload || payload.kind !== 'video') return null;
  for (const track of payload.tracks) {
    const clip = track.clips.find((entry) => entry.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

/** Trims or drops neighbours so `next` owns `[start, end)` on its track. */
function overwrite(clips: readonly TimelineClip[], next: TimelineClip): readonly TimelineClip[] {
  const start = next.start;
  const end = clipEnd(next);
  const result: TimelineClip[] = [];

  for (const clip of clips) {
    if (clip.id === next.id) continue;
    const clipStart = clip.start;
    const clipStop = clipEnd(clip);
    if (clipStop <= start + 1e-9 || clipStart >= end - 1e-9) {
      result.push(clip);
      continue;
    }
    if (clipStart < start - 1e-9) {
      const head: TimelineClip = { ...clip, duration: roundTime(start - clipStart) };
      if (head.duration >= MIN_CLIP_DURATION) result.push(head);
    }
    if (clipStop > end + 1e-9) {
      const offset = end - clipStart;
      const tail: TimelineClip = isVideoClip(clip)
        ? {
            ...clip,
            start: roundTime(end),
            duration: roundTime(clipStop - end),
            inPoint: roundTime(clip.inPoint + offset),
          }
        : { ...clip, start: roundTime(end), duration: roundTime(clipStop - end) };
      if (tail.duration >= MIN_CLIP_DURATION) result.push(tail);
    }
  }

  result.push(next);
  return result.sort((left, right) => left.start - right.start);
}

function replaceClips(
  payload: VideoPayload,
  updater: (track: VideoTrack) => readonly TimelineClip[],
): VideoPayload {
  return {
    ...payload,
    tracks: payload.tracks.map((track) => ({ ...track, clips: updater(track) })),
  };
}

function mediaById(payload: VideoPayload, mediaId: string): VideoMedia | undefined {
  return payload.media.find((media) => media.id === mediaId);
}

/** Number of clips on every track; used to enforce the per-document clip budget. */
function clipCount(payload: VideoPayload): number {
  return payload.tracks.reduce((total, track) => total + track.clips.length, 0);
}

export type PlaceClipInput = {
  readonly trackId: string;
  readonly media: VideoMedia;
  readonly start: number;
  /** Offset into the source; defaults to 0. */
  readonly inPoint?: number;
  /** Timeline length; defaults to the rest of the file, capped to the composition. */
  readonly duration?: number;
};

/** Adds a clip (and its media record) to a track, overwriting whatever it covers. */
export function placeClipCommand(
  document: ForgeDocument,
  input: PlaceClipInput,
): Result<SceneCommand> {
  const payloadResult = videoPayload(document);
  if (!payloadResult.ok) return payloadResult;
  const payload = payloadResult.value;

  const track = payload.tracks.find((entry) => entry.id === input.trackId);
  if (!track) {
    return err(
      forgeError('not-found', 'That track is not part of this timeline.', { retryable: false }),
    );
  }
  if (track.kind === 'title') {
    return err(
      forgeError('validation-failed', 'Titles live on title tracks.', {
        detail: 'Use “Add title” to place text; a video file cannot go on a title track.',
        retryable: false,
      }),
    );
  }
  if (track.kind !== input.media.kind) {
    return err(
      forgeError(
        'validation-failed',
        `A ${input.media.kind} file needs a ${input.media.kind} track.`,
        {
          retryable: false,
        },
      ),
    );
  }
  if (clipCount(payload) >= MAX_VIDEO_CLIPS) {
    return err(
      forgeError('validation-failed', 'This timeline has reached its clip limit.', {
        detail: `A timeline can hold at most ${String(MAX_VIDEO_CLIPS)} clips.`,
        retryable: false,
      }),
    );
  }
  if (payload.media.length >= MAX_VIDEO_MEDIA && !mediaById(payload, input.media.id)) {
    return err(
      forgeError('validation-failed', 'This timeline has reached its media limit.', {
        detail: `A timeline can reference at most ${String(MAX_VIDEO_MEDIA)} files.`,
        retryable: false,
      }),
    );
  }

  const inPoint = roundTime(Math.max(0, Math.min(input.inPoint ?? 0, input.media.duration)));
  const available = Math.max(0, input.media.duration - inPoint);
  const start = roundTime(Math.max(0, input.start));
  const requested = input.duration ?? available;
  const duration = roundTime(Math.min(requested, available, Math.max(0, payload.duration - start)));

  if (!Number.isFinite(duration) || duration < MIN_CLIP_DURATION) {
    return err(
      forgeError('validation-failed', 'That clip would be too short to see.', {
        detail: 'Clips must be at least 0.10 s long and must start before the composition ends.',
        retryable: false,
      }),
    );
  }

  const clip: VideoClip = {
    id: createPayloadItemId('clip'),
    kind: input.media.kind,
    mediaId: input.media.id,
    name: input.media.name,
    start,
    duration,
    inPoint,
    volume: 1,
    muted: false,
  };

  const media = mediaById(payload, input.media.id)
    ? payload.media
    : [...payload.media, input.media];

  const next = replaceClips({ ...payload, media }, (entry) =>
    entry.id === track.id ? overwrite(entry.clips, clip) : entry.clips,
  );

  return ok(withPayload(next, `Add “${input.media.name}” at ${seconds(start)}`));
}

/** Adds an imported file to the media bin without placing it. */
export function registerMediaCommand(
  document: ForgeDocument,
  media: VideoMedia,
): Result<SceneCommand> {
  const payloadResult = videoPayload(document);
  if (!payloadResult.ok) return payloadResult;
  const payload = payloadResult.value;
  if (mediaById(payload, media.id)) {
    return err(
      forgeError('validation-failed', 'That file is already in the media bin.', {
        retryable: false,
      }),
    );
  }
  if (payload.media.length >= MAX_VIDEO_MEDIA) {
    return err(
      forgeError('validation-failed', 'This timeline has reached its media limit.', {
        detail: `A timeline can reference at most ${String(MAX_VIDEO_MEDIA)} files.`,
        retryable: false,
      }),
    );
  }
  return ok(
    withPayload({ ...payload, media: [...payload.media, media] }, `Import “${media.name}”`),
  );
}

/**
 * Forgets a media file the timeline no longer needs.
 *
 * Refused while any clip still references it — a clip that points at nothing is a preview with a hole
 * in it, and removing the clips first keeps every disappearance a labelled step.
 */
export function removeMediaCommand(document: ForgeDocument, mediaId: string): Result<SceneCommand> {
  const payloadResult = videoPayload(document);
  if (!payloadResult.ok) return payloadResult;
  const payload = payloadResult.value;
  const media = mediaById(payload, mediaId);
  if (!media) {
    return err(forgeError('not-found', 'That file is not in the media bin.', { retryable: false }));
  }
  const used = payload.tracks
    .flatMap((track) => track.clips)
    .filter((clip): clip is VideoClip => isVideoClip(clip) && clip.mediaId === mediaId);
  if (used.length > 0) {
    return err(
      forgeError(
        'validation-failed',
        `“${media.name}” is still used by ${String(used.length)} clip${used.length === 1 ? '' : 's'}.`,
        {
          detail: 'Remove those clips first, so nothing disappears without a labelled step.',
          retryable: false,
        },
      ),
    );
  }
  return ok(
    withPayload(
      { ...payload, media: payload.media.filter((entry) => entry.id !== mediaId) },
      `Remove “${media.name}” from the media bin`,
    ),
  );
}

export type MoveClipInput = {
  readonly clipId: string;
  readonly toStart: number;
  readonly toTrackId?: string;
};

/** Moves a clip, overwriting whatever it lands on. */
export function moveClipCommand(
  document: ForgeDocument,
  input: MoveClipInput,
): Result<SceneCommand> {
  const payloadResult = videoPayload(document);
  if (!payloadResult.ok) return payloadResult;
  const payload = payloadResult.value;
  const located = findClip(document, input.clipId);
  if (!located) {
    return err(
      forgeError('not-found', 'That clip is no longer on the timeline.', { retryable: false }),
    );
  }

  const targetId = input.toTrackId ?? located.track.id;
  const target = payload.tracks.find((track) => track.id === targetId);
  if (!target) {
    return err(
      forgeError('not-found', 'That track is not part of this timeline.', { retryable: false }),
    );
  }
  const needsKind: VideoTrackKind = isTitleClip(located.clip) ? 'title' : located.clip.kind;
  if (target.kind !== needsKind) {
    return err(
      forgeError('validation-failed', `That clip can only live on a ${needsKind} track.`, {
        retryable: false,
      }),
    );
  }

  const maxStart = Math.max(0, payload.duration - located.clip.duration);
  const start = roundTime(Math.min(maxStart, Math.max(0, input.toStart)));
  if (start === located.clip.start && target.id === located.track.id) {
    return err(forgeError('validation-failed', 'The clip is already there.', { retryable: false }));
  }

  const moved: TimelineClip = { ...located.clip, start };
  const tracks = payload.tracks.map((track) => {
    if (track.id === located.track.id && track.id === target.id) {
      return { ...track, clips: overwrite(track.clips, moved) };
    }
    if (track.id === located.track.id) {
      return { ...track, clips: track.clips.filter((clip) => clip.id !== moved.id) };
    }
    if (track.id === target.id) {
      return { ...track, clips: overwrite(track.clips, moved) };
    }
    return track;
  });

  return ok(
    withPayload({ ...payload, tracks }, `Move “${clipLabel(located.clip)}” to ${seconds(start)}`),
  );
}

export type TrimClipInput = {
  readonly clipId: string;
  readonly edge: 'start' | 'end';
  /** New position of that edge, in seconds. */
  readonly to: number;
};

/** Trims a clip's head or tail, clamped to the source file. */
export function trimClipCommand(
  document: ForgeDocument,
  input: TrimClipInput,
): Result<SceneCommand> {
  const payloadResult = videoPayload(document);
  if (!payloadResult.ok) return payloadResult;
  const payload = payloadResult.value;
  const located = findClip(document, input.clipId);
  if (!located) {
    return err(
      forgeError('not-found', 'That clip is no longer on the timeline.', { retryable: false }),
    );
  }

  const { clip } = located;
  const media = isVideoClip(clip) ? mediaById(payload, clip.mediaId) : undefined;
  const sourceDuration = media?.duration ?? Number.POSITIVE_INFINITY;

  let next: TimelineClip;
  if (input.edge === 'start') {
    const head = isVideoClip(clip) ? clip.inPoint : 0;
    const earliest = roundTime(clip.start - head);
    const latest = roundTime(clipEnd(clip) - MIN_CLIP_DURATION);
    const start = roundTime(Math.min(latest, Math.max(earliest, input.to)));
    const delta = roundTime(start - clip.start);
    next = isVideoClip(clip)
      ? {
          ...clip,
          start,
          duration: roundTime(clip.duration - delta),
          inPoint: roundTime(clip.inPoint + delta),
        }
      : { ...clip, start, duration: roundTime(clip.duration - delta) };
  } else {
    const latest = roundTime(
      isVideoClip(clip) ? clip.start + (sourceDuration - clip.inPoint) : payload.duration,
    );
    const earliest = roundTime(clip.start + MIN_CLIP_DURATION);
    const stop = roundTime(Math.min(latest, Math.max(earliest, input.to)));
    next = { ...clip, duration: roundTime(stop - clip.start) };
  }

  if (next.duration < MIN_CLIP_DURATION) {
    return err(
      forgeError('validation-failed', 'A trim would make the clip shorter than 0.10 s.', {
        retryable: false,
      }),
    );
  }

  const tracks = payload.tracks.map((track) =>
    track.id === located.track.id
      ? {
          ...track,
          clips: track.clips
            .map((entry) => (entry.id === next.id ? next : entry))
            .sort((left, right) => left.start - right.start),
        }
      : track,
  );

  return ok(
    withPayload(
      { ...payload, tracks },
      `Trim “${clipLabel(clip)}” ${input.edge === 'start' ? 'start' : 'end'}`,
    ),
  );
}

/** Splits a clip at a time, keeping both halves in place. */
export function splitClipCommand(
  document: ForgeDocument,
  clipId: string,
  at: number,
): Result<SceneCommand> {
  const payloadResult = videoPayload(document);
  if (!payloadResult.ok) return payloadResult;
  const payload = payloadResult.value;
  const located = findClip(document, clipId);
  if (!located) {
    return err(
      forgeError('not-found', 'That clip is no longer on the timeline.', { retryable: false }),
    );
  }
  const { clip } = located;
  const time = roundTime(at);
  if (
    time <= clip.start + MIN_CLIP_DURATION - 1e-9 ||
    time >= clipEnd(clip) - MIN_CLIP_DURATION + 1e-9
  ) {
    return err(
      forgeError(
        'validation-failed',
        'A split needs at least 0.10 s on both sides of the playhead.',
        {
          detail: 'Move the playhead inside the clip, away from its edges.',
          retryable: false,
        },
      ),
    );
  }
  if (clipCount(payload) >= MAX_VIDEO_CLIPS) {
    return err(
      forgeError('validation-failed', 'This timeline has reached its clip limit.', {
        detail: `A timeline can hold at most ${String(MAX_VIDEO_CLIPS)} clips.`,
        retryable: false,
      }),
    );
  }

  const offset = roundTime(time - clip.start);
  const head: TimelineClip = { ...clip, duration: offset };
  const tail: TimelineClip = isVideoClip(clip)
    ? {
        ...clip,
        id: createPayloadItemId('clip'),
        start: time,
        duration: roundTime(clip.duration - offset),
        inPoint: roundTime(clip.inPoint + offset),
      }
    : {
        ...clip,
        id: createPayloadItemId('clip'),
        start: time,
        duration: roundTime(clip.duration - offset),
      };

  const tracks = payload.tracks.map((track) =>
    track.id === located.track.id
      ? {
          ...track,
          clips: track.clips
            .flatMap((entry) => (entry.id === clip.id ? [head, tail] : [entry]))
            .sort((left, right) => left.start - right.start),
        }
      : track,
  );

  return ok(withPayload({ ...payload, tracks }, `Split clip at ${seconds(time)}`));
}

/** Removes a clip. The media record stays so it can be re-placed. */
export function removeClipCommand(document: ForgeDocument, clipId: string): Result<SceneCommand> {
  const payloadResult = videoPayload(document);
  if (!payloadResult.ok) return payloadResult;
  const payload = payloadResult.value;
  const located = findClip(document, clipId);
  if (!located) {
    return err(
      forgeError('not-found', 'That clip is no longer on the timeline.', { retryable: false }),
    );
  }
  const tracks = payload.tracks.map((track) =>
    track.id === located.track.id
      ? { ...track, clips: track.clips.filter((clip) => clip.id !== clipId) }
      : track,
  );
  return ok(withPayload({ ...payload, tracks }, `Remove “${clipLabel(located.clip)}”`));
}

export type ClipAudioInput = {
  readonly clipId: string;
  readonly volume?: number;
  readonly muted?: boolean;
};

/** Sets a clip's gain or mute. */
export function setClipAudioCommand(
  document: ForgeDocument,
  input: ClipAudioInput,
): Result<SceneCommand> {
  const payloadResult = videoPayload(document);
  if (!payloadResult.ok) return payloadResult;
  const payload = payloadResult.value;
  const located = findClip(document, input.clipId);
  if (!located || !isVideoClip(located.clip)) {
    return err(
      forgeError('not-found', 'That audio setting applies to a media clip.', { retryable: false }),
    );
  }
  const volume =
    input.volume === undefined
      ? located.clip.volume
      : Math.min(1, Math.max(0, Number.isFinite(input.volume) ? input.volume : 0));
  const muted = input.muted ?? located.clip.muted;
  const tracks = payload.tracks.map((track) =>
    track.id === located.track.id
      ? {
          ...track,
          clips: track.clips.map((clip) =>
            clip.id === input.clipId && isVideoClip(clip) ? { ...clip, volume, muted } : clip,
          ),
        }
      : track,
  );
  const label =
    input.muted !== undefined
      ? `${muted ? 'Mute' : 'Unmute'} “${located.clip.name}”`
      : `Set “${located.clip.name}” volume to ${String(Math.round(volume * 100))}%`;
  return ok(withPayload({ ...payload, tracks }, label));
}

export type AddTitleInput = {
  readonly text: string;
  readonly start: number;
  readonly duration?: number;
  readonly position?: TitlePosition;
  readonly color?: string;
  readonly background?: string | null;
  readonly fontSize?: number;
  readonly trackId?: string;
};

/** Adds a title to a title track, creating one if the timeline has none. */
export function addTitleCommand(
  document: ForgeDocument,
  input: AddTitleInput,
): Result<SceneCommand> {
  const payloadResult = videoPayload(document);
  if (!payloadResult.ok) return payloadResult;
  const payload = payloadResult.value;

  const text = input.text.trim();
  if (text.length === 0) {
    return err(forgeError('validation-failed', 'A title needs some text.', { retryable: false }));
  }
  if (clipCount(payload) >= MAX_VIDEO_CLIPS) {
    return err(
      forgeError('validation-failed', 'This timeline has reached its clip limit.', {
        detail: `A timeline can hold at most ${String(MAX_VIDEO_CLIPS)} clips.`,
        retryable: false,
      }),
    );
  }

  let tracks = payload.tracks;
  let track = input.trackId
    ? tracks.find((entry) => entry.id === input.trackId && entry.kind === 'title')
    : tracks.find((entry) => entry.kind === 'title');

  if (!track) {
    if (tracks.length >= MAX_VIDEO_TRACKS) {
      return err(
        forgeError('validation-failed', 'This timeline has reached its track limit.', {
          detail: `A timeline can hold at most ${String(MAX_VIDEO_TRACKS)} tracks.`,
          retryable: false,
        }),
      );
    }
    track = {
      id: createPayloadItemId('track'),
      kind: 'title',
      name: `Titles ${String(tracks.filter((entry) => entry.kind === 'title').length + 1)}`,
      clips: [],
    };
    tracks = [...tracks, track];
  }

  const start = roundTime(Math.max(0, input.start));
  const duration = roundTime(Math.min(input.duration ?? 3, Math.max(0, payload.duration - start)));
  if (duration < MIN_CLIP_DURATION) {
    return err(
      forgeError('validation-failed', 'That title would be too short to read.', {
        retryable: false,
      }),
    );
  }

  const title: TitleClip = {
    id: createPayloadItemId('title'),
    kind: 'title',
    text: text.slice(0, 200),
    start,
    duration,
    color: input.color ?? '#ffffff',
    background: input.background ?? null,
    fontSize: Math.min(200, Math.max(8, input.fontSize ?? 64)),
    position: input.position ?? 'lower',
  };

  const trackId = track.id;
  const nextTracks = tracks.map((entry) =>
    entry.id === trackId ? { ...entry, clips: overwrite(entry.clips, title) } : entry,
  );

  return ok(
    withPayload(
      { ...payload, tracks: nextTracks },
      `Add title “${title.text}” at ${seconds(start)}`,
    ),
  );
}

export type TitlePatch = Partial<
  Pick<TitleClip, 'text' | 'duration' | 'color' | 'background' | 'fontSize' | 'position'>
>;

/** Changes a title's words or styling. */
export function updateTitleCommand(
  document: ForgeDocument,
  clipId: string,
  patch: TitlePatch,
): Result<SceneCommand> {
  const payloadResult = videoPayload(document);
  if (!payloadResult.ok) return payloadResult;
  const payload = payloadResult.value;
  const located = findClip(document, clipId);
  if (!located || !isTitleClip(located.clip)) {
    return err(
      forgeError('not-found', 'That title is no longer on the timeline.', { retryable: false }),
    );
  }

  const next: TitleClip = {
    ...located.clip,
    text: (patch.text ?? located.clip.text).trim().slice(0, 200),
    duration: Math.max(MIN_CLIP_DURATION, roundTime(patch.duration ?? located.clip.duration)),
    color: patch.color ?? located.clip.color,
    background: patch.background === undefined ? located.clip.background : patch.background,
    fontSize: Math.min(200, Math.max(8, patch.fontSize ?? located.clip.fontSize)),
    position:
      patch.position && TITLE_POSITIONS.includes(patch.position)
        ? patch.position
        : located.clip.position,
  };
  if (next.text.length === 0) {
    return err(forgeError('validation-failed', 'A title cannot be empty.', { retryable: false }));
  }

  const tracks = payload.tracks.map((track) =>
    track.id === located.track.id
      ? { ...track, clips: track.clips.map((clip) => (clip.id === clipId ? next : clip)) }
      : track,
  );
  return ok(withPayload({ ...payload, tracks }, 'Edit title'));
}

export type TimelineSettings = {
  readonly duration?: number;
  readonly fps?: number;
};

/** Changes the composition length or frame rate. */
export function setTimelineCommand(
  document: ForgeDocument,
  settings: TimelineSettings,
): Result<SceneCommand> {
  const payloadResult = videoPayload(document);
  if (!payloadResult.ok) return payloadResult;
  const payload = payloadResult.value;

  const duration = settings.duration ?? payload.duration;
  const fps = settings.fps ?? payload.fps;
  if (!Number.isFinite(duration) || duration < 1 || duration > MAX_VIDEO_DURATION) {
    return err(
      forgeError('validation-failed', 'The composition length is out of range.', {
        detail: `A timeline can be 1–${String(MAX_VIDEO_DURATION)} seconds long.`,
        retryable: false,
      }),
    );
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > MAX_VIDEO_FPS) {
    return err(
      forgeError('validation-failed', 'The frame rate is out of range.', {
        detail: `A timeline can run at 1–${String(MAX_VIDEO_FPS)} frames per second.`,
        retryable: false,
      }),
    );
  }
  if (duration === payload.duration && fps === payload.fps) {
    return err(
      forgeError('validation-failed', 'Those settings are already applied.', { retryable: false }),
    );
  }

  return ok(withPayload({ ...payload, duration: roundTime(duration), fps }, 'Set timeline length'));
}

/** Adds an empty track of a kind. */
export function addTrackCommand(
  document: ForgeDocument,
  kind: VideoTrackKind,
): Result<SceneCommand> {
  const payloadResult = videoPayload(document);
  if (!payloadResult.ok) return payloadResult;
  const payload = payloadResult.value;
  if (payload.tracks.length >= MAX_VIDEO_TRACKS) {
    return err(
      forgeError('validation-failed', 'This timeline has reached its track limit.', {
        detail: `A timeline can hold at most ${String(MAX_VIDEO_TRACKS)} tracks.`,
        retryable: false,
      }),
    );
  }
  const count = payload.tracks.filter((track) => track.kind === kind).length + 1;
  const label = kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : 'Titles';
  const track: VideoTrack = {
    id: createPayloadItemId('track'),
    kind,
    name: `${label} ${String(count)}`,
    clips: [],
  };
  return ok(
    withPayload(
      { ...payload, tracks: [...payload.tracks, track] },
      `Add ${label.toLowerCase()} track`,
    ),
  );
}

/** Removes an empty track. A track with clips must be emptied first, so nothing vanishes silently. */
export function removeTrackCommand(document: ForgeDocument, trackId: string): Result<SceneCommand> {
  const payloadResult = videoPayload(document);
  if (!payloadResult.ok) return payloadResult;
  const payload = payloadResult.value;
  const track = payload.tracks.find((entry) => entry.id === trackId);
  if (!track) {
    return err(
      forgeError('not-found', 'That track is not part of this timeline.', { retryable: false }),
    );
  }
  if (track.clips.length > 0) {
    return err(
      forgeError('validation-failed', 'That track still has clips.', {
        detail: 'Move or remove the clips first, so nothing disappears without a labelled step.',
        retryable: false,
      }),
    );
  }
  if (payload.tracks.length <= 1) {
    return err(
      forgeError('validation-failed', 'A timeline needs at least one track.', { retryable: false }),
    );
  }
  return ok(
    withPayload(
      { ...payload, tracks: payload.tracks.filter((entry) => entry.id !== trackId) },
      `Remove ${track.name}`,
    ),
  );
}
