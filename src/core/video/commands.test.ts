/**
 * Video commands: overwrite semantics, trim clamping, splitting, and the refusals.
 *
 * The tests assert the payload that would be saved and the label that appears in history, because
 * those two are what undo shows the user; and they assert that an impossible edit produces a
 * sentence rather than a silently wrong timeline.
 */

import { describe, expect, it } from 'vitest';

import { createDocument, DEFAULT_CANVAS, DEFAULT_GUIDES } from '../documents/factories';
import type { TitleClip, VideoClip, VideoPayload } from '../documents/payload';
import { MAX_VIDEO_TRACKS } from '../documents/payload';
import type { ForgeDocument } from '../documents/types';
import { brand } from '../types/brand';
import {
  addTitleCommand,
  addTrackCommand,
  findClip,
  moveClipCommand,
  placeClipCommand,
  registerMediaCommand,
  removeMediaCommand,
  removeClipCommand,
  removeTrackCommand,
  setClipAudioCommand,
  setTimelineCommand,
  splitClipCommand,
  trimClipCommand,
  updateTitleCommand,
} from './commands';

const MEDIA = {
  id: 'media-a',
  name: 'clip.mp4',
  kind: 'video' as const,
  mimeType: 'video/mp4',
  duration: 8,
  width: 1920,
  height: 1080,
  size: 4_000_000,
};

const AUDIO = {
  id: 'media-b',
  name: 'music.mp3',
  kind: 'audio' as const,
  mimeType: 'audio/mpeg',
  duration: 30,
  width: 0,
  height: 0,
  size: 900_000,
};

const VIDEO_TRACK = 'track-video-1';
const AUDIO_TRACK = 'track-audio-1';

function videoDocument(): ForgeDocument {
  const created = createDocument(
    {
      title: 'Video commands',
      studioId: 'video',
      documentTypeId: brand<'DocumentTypeId'>('video.timeline'),
      canvas: { ...DEFAULT_CANVAS, width: 1920, height: 1080 },
      guides: DEFAULT_GUIDES,
    },
    { generateId: () => 'doc-video' },
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function payloadAfter(command: {
  readonly patch: { readonly studioPayload?: unknown };
}): VideoPayload {
  return command.patch.studioPayload as VideoPayload;
}

function apply(
  document: ForgeDocument,
  command: {
    readonly patch: { readonly studioPayload?: unknown };
  },
): ForgeDocument {
  return { ...document, studioPayload: payloadAfter(command) };
}

function place(
  document: ForgeDocument,
  options: { start?: number; inPoint?: number; duration?: number; media?: typeof MEDIA } = {},
): { document: ForgeDocument; clipId: string } {
  const command = placeClipCommand(document, {
    trackId: VIDEO_TRACK,
    media: options.media ?? MEDIA,
    start: options.start ?? 0,
    ...(options.inPoint === undefined ? {} : { inPoint: options.inPoint }),
    ...(options.duration === undefined ? {} : { duration: options.duration }),
  });
  if (!command.ok) throw new Error(command.error.message);
  const next = apply(document, command.value);
  const payload = payloadAfter(command.value);
  const clip = payload.tracks.flatMap((track) => track.clips).at(-1);
  if (!clip) throw new Error('clip was not placed');
  return { document: next, clipId: clip.id };
}

function clipsOf(
  document: ForgeDocument,
  trackId = VIDEO_TRACK,
): readonly (VideoClip | TitleClip)[] {
  const payload = document.studioPayload as VideoPayload;
  return payload.tracks.find((track) => track.id === trackId)?.clips ?? [];
}

describe('placeClipCommand', () => {
  it('places a clip with the media record and a history label', () => {
    const document = videoDocument();
    const command = placeClipCommand(document, { trackId: VIDEO_TRACK, media: MEDIA, start: 1.5 });
    expect(command.ok).toBe(true);
    if (!command.ok) return;

    expect(command.value.label).toBe('Add “clip.mp4” at 1.50 s');
    const payload = payloadAfter(command.value);
    expect(payload.media).toEqual([MEDIA]);
    const clip = payload.tracks.find((track) => track.id === VIDEO_TRACK)?.clips[0];
    expect(clip?.start).toBeCloseTo(1.5, 6);
    // The default length is the whole file; it fits inside the composition from 1.5 s (9.5 ≤ 10).
    expect(clip?.duration).toBeCloseTo(8, 6);
  });

  it('trims what it covers instead of stacking clips', () => {
    const placed = place(videoDocument(), { start: 0, duration: 6 });
    const second = placeClipCommand(placed.document, {
      trackId: VIDEO_TRACK,
      media: MEDIA,
      start: 2,
      duration: 2,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const clips = [...clipsOf(apply(placed.document, second.value))].sort(
      (left, right) => left.start - right.start,
    );
    // The 6 s clip is cut in two around the new 2 s clip: a head, the new clip, and a tail. Nothing
    // is stacked, so "what is playing" stays a single answer per track.
    expect(clips).toHaveLength(3);
    const [head, inserted, tail] = clips as readonly VideoClip[];
    expect(head?.start).toBeCloseTo(0, 6);
    expect(head?.duration).toBeCloseTo(2, 6);
    expect(inserted?.start).toBeCloseTo(2, 6);
    // The tail keeps its source alignment: it resumes 4 s into the file, not at 0.
    expect(tail?.start).toBeCloseTo(4, 6);
    expect(tail?.duration).toBeCloseTo(2, 6);
    expect(tail?.inPoint).toBeCloseTo(4, 6);
  });

  it('drops a clip that is fully covered', () => {
    const placed = place(videoDocument(), { start: 0, duration: 2 });
    const covering = placeClipCommand(placed.document, {
      trackId: VIDEO_TRACK,
      media: MEDIA,
      start: 0,
      duration: 6,
    });
    if (!covering.ok) throw new Error(covering.error.message);
    const clips = clipsOf(apply(placed.document, covering.value));
    expect(clips).toHaveLength(1);
    expect(clips[0]?.duration).toBeCloseTo(6, 6);
  });

  it('refuses a video on a title track, an audio on a video track, and a clip too short to see', () => {
    const document = videoDocument();
    const onTitle = placeClipCommand(document, {
      trackId: 'track-title-1',
      media: MEDIA,
      start: 0,
    });
    expect(onTitle.ok).toBe(false);
    if (!onTitle.ok) expect(onTitle.error.message).toMatch(/title track/i);

    const wrongKind = placeClipCommand(document, {
      trackId: VIDEO_TRACK,
      media: AUDIO,
      start: 0,
    });
    expect(wrongKind.ok).toBe(false);
    if (!wrongKind.ok) expect(wrongKind.error.message).toMatch(/audio track/i);

    const tooShort = placeClipCommand(document, {
      trackId: VIDEO_TRACK,
      media: MEDIA,
      start: 0,
      duration: 0.01,
    });
    expect(tooShort.ok).toBe(false);
    if (!tooShort.ok) expect(tooShort.error.message).toMatch(/too short/i);
  });

  it('refuses an unknown track', () => {
    const result = placeClipCommand(videoDocument(), {
      trackId: 'track-nope',
      media: MEDIA,
      start: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/not part of this timeline/i);
  });
});

describe('moveClipCommand', () => {
  it('moves a clip and overwrites what it lands on', () => {
    const placed = place(videoDocument(), { start: 0, duration: 2 });
    const moved = moveClipCommand(placed.document, { clipId: placed.clipId, toStart: 4 });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.label).toBe('Move “clip.mp4” to 4.00 s');
    expect(clipsOf(apply(placed.document, moved.value))[0]?.start).toBeCloseTo(4, 6);
  });

  it('refuses a move that would not change anything or would leave the kind of track', () => {
    const placed = place(videoDocument(), { start: 0 });
    const nowhere = moveClipCommand(placed.document, { clipId: placed.clipId, toStart: 0 });
    expect(nowhere.ok).toBe(false);

    const wrongTrack = moveClipCommand(placed.document, {
      clipId: placed.clipId,
      toStart: 1,
      toTrackId: AUDIO_TRACK,
    });
    expect(wrongTrack.ok).toBe(false);
    if (!wrongTrack.ok) expect(wrongTrack.error.message).toMatch(/video track/i);
  });

  it('clamps a move to the composition so a clip cannot be pushed off the end', () => {
    const placed = place(videoDocument(), { start: 0, duration: 2 });
    const moved = moveClipCommand(placed.document, { clipId: placed.clipId, toStart: 99 });
    if (!moved.ok) throw new Error(moved.error.message);
    expect(clipsOf(apply(placed.document, moved.value))[0]?.start).toBeCloseTo(8, 6);
  });
});

describe('trimming and splitting', () => {
  it('trims the head by moving the source in-point with it', () => {
    const placed = place(videoDocument(), { start: 1, duration: 5 });
    const trimmed = trimClipCommand(placed.document, {
      clipId: placed.clipId,
      edge: 'start',
      to: 2,
    });
    expect(trimmed.ok).toBe(true);
    if (!trimmed.ok) return;
    const clip = clipsOf(apply(placed.document, trimmed.value))[0] as VideoClip;
    expect(clip.start).toBeCloseTo(2, 6);
    expect(clip.duration).toBeCloseTo(4, 6);
    expect(clip.inPoint).toBeCloseTo(1, 6);
  });

  it('clamps the tail to the end of the source file', () => {
    const placed = place(videoDocument(), { start: 0, duration: 2 });
    const trimmed = trimClipCommand(placed.document, {
      clipId: placed.clipId,
      edge: 'end',
      to: 9.5,
    });
    if (!trimmed.ok) throw new Error(trimmed.error.message);
    const clip = clipsOf(apply(placed.document, trimmed.value))[0] as VideoClip;
    expect(clip.duration).toBeCloseTo(8, 6);
  });

  it('stops a trim at a tenth of a second instead of collapsing the clip', () => {
    const placed = place(videoDocument(), { start: 0, duration: 2 });
    const result = trimClipCommand(placed.document, {
      clipId: placed.clipId,
      edge: 'end',
      to: 0.02,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const clip = clipsOf(apply(placed.document, result.value))[0] as VideoClip;
    expect(clip.duration).toBeCloseTo(0.1, 6);
  });

  it('splits a clip into two that keep the source alignment', () => {
    const placed = place(videoDocument(), { start: 0, duration: 6 });
    const split = splitClipCommand(placed.document, placed.clipId, 2);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(split.value.label).toBe('Split clip at 2.00 s');
    const clips = clipsOf(apply(placed.document, split.value)) as readonly VideoClip[];
    expect(clips).toHaveLength(2);
    expect(clips[0]?.duration).toBeCloseTo(2, 6);
    expect(clips[1]?.start).toBeCloseTo(2, 6);
    expect(clips[1]?.inPoint).toBeCloseTo(2, 6);
    // The halves are distinct clips, so selecting one does not select the other.
    expect(clips[0]?.id).not.toBe(clips[1]?.id);
  });

  it('refuses a split at an edge', () => {
    const placed = place(videoDocument(), { start: 0, duration: 4 });
    const result = splitClipCommand(placed.document, placed.clipId, 0.01);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/at least 0\.10 s/);
  });
});

describe('remove, audio, timeline settings and tracks', () => {
  it('removes a clip but keeps the media for re-placing', () => {
    const placed = place(videoDocument(), { start: 0, duration: 2 });
    const removed = removeClipCommand(placed.document, placed.clipId);
    if (!removed.ok) throw new Error(removed.error.message);
    const next = apply(placed.document, removed.value);
    expect(clipsOf(next)).toHaveLength(0);
    expect((next.studioPayload as VideoPayload).media).toHaveLength(1);
  });

  it('sets volume and mute with a readable label', () => {
    const placed = place(videoDocument(), { start: 0 });
    const volume = setClipAudioCommand(placed.document, { clipId: placed.clipId, volume: 0.4 });
    if (!volume.ok) throw new Error(volume.error.message);
    expect(volume.value.label).toBe('Set “clip.mp4” volume to 40%');
    const muted = setClipAudioCommand(placed.document, { clipId: placed.clipId, muted: true });
    if (!muted.ok) throw new Error(muted.error.message);
    expect(muted.value.label).toBe('Mute “clip.mp4”');

    const withAudio = apply(placed.document, volume.value);
    const next = setClipAudioCommand(withAudio, { clipId: placed.clipId, volume: 4 });
    if (!next.ok) throw new Error(next.error.message);
    // Out-of-range gain is clamped, not stored as 4.
    expect((clipsOf(apply(withAudio, next.value))[0] as VideoClip).volume).toBe(1);
  });

  it('changes the composition length and frame rate with validation', () => {
    const document = videoDocument();
    const longer = setTimelineCommand(document, { duration: 30 });
    if (!longer.ok) throw new Error(longer.error.message);
    expect((longer.value.patch.studioPayload as VideoPayload).duration).toBe(30);

    expect(setTimelineCommand(document, { duration: 0 }).ok).toBe(false);
    expect(setTimelineCommand(document, { fps: 0 }).ok).toBe(false);
    expect(setTimelineCommand(document, { fps: 24.5 }).ok).toBe(false);
    expect(setTimelineCommand(document, { duration: 10 }).ok).toBe(false);
  });

  it('adds and removes empty tracks, refusing to remove a used or last one', () => {
    const document = videoDocument();
    const added = addTrackCommand(document, 'video');
    if (!added.ok) throw new Error(added.error.message);
    expect(added.value.label).toBe('Add video track');
    const next = apply(document, added.value);
    expect((next.studioPayload as VideoPayload).tracks).toHaveLength(4);

    const placed = place(next, { start: 0 });
    const used = removeTrackCommand(placed.document, VIDEO_TRACK);
    expect(used.ok).toBe(false);
    if (!used.ok) expect(used.error.message).toMatch(/still has clips/);

    const emptyTrackId = (added.value.patch.studioPayload as VideoPayload).tracks.at(-1)?.id;
    if (!emptyTrackId) throw new Error('no track was added');
    const removed = removeTrackCommand(next, emptyTrackId);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.value.label).toBe('Remove Video 2');
  });

  it('refuses to add tracks beyond the limit', () => {
    let document = videoDocument();
    const payload = document.studioPayload as VideoPayload;
    for (let index = payload.tracks.length; index < MAX_VIDEO_TRACKS; index += 1) {
      const added = addTrackCommand(document, 'audio');
      if (!added.ok) throw new Error(added.error.message);
      document = apply(document, added.value);
    }
    const overflow = addTrackCommand(document, 'audio');
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.error.message).toMatch(/track limit/i);
  });

  it('keeps the payload immutable so history cannot be mutated by the UI', () => {
    const placed = place(videoDocument(), { start: 0 });
    const before = JSON.stringify(placed.document.studioPayload);
    const removed = removeClipCommand(placed.document, placed.clipId);
    if (!removed.ok) throw new Error(removed.error.message);
    expect(JSON.stringify(placed.document.studioPayload)).toBe(before);
    expect(Object.isFrozen(removed.value.patch.studioPayload)).toBe(true);
  });
});

describe('titles', () => {
  it('adds a title on the existing title track, overwriting what it covers', () => {
    const document = videoDocument();
    const added = addTitleCommand(document, { text: '  Hello world  ', start: 1, duration: 2 });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.label).toBe('Add title “Hello world” at 1.00 s');

    const second = addTitleCommand(apply(document, added.value), {
      text: 'Second',
      start: 1.5,
      duration: 2,
    });
    if (!second.ok) throw new Error(second.error.message);
    const titleTrack = (
      apply(apply(document, added.value), second.value).studioPayload as VideoPayload
    ).tracks.find((track) => track.kind === 'title');
    expect(titleTrack?.clips).toHaveLength(2);
    expect(titleTrack?.clips[0]?.duration).toBeCloseTo(0.5, 6);
  });

  it('refuses an empty title and an out-of-range size', () => {
    expect(addTitleCommand(videoDocument(), { text: '   ', start: 0 }).ok).toBe(false);

    const added = addTitleCommand(videoDocument(), { text: 'Hi', start: 0 });
    if (!added.ok) throw new Error(added.error.message);
    const payload = added.value.patch.studioPayload as VideoPayload;
    const title = payload.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.kind === 'title');
    if (!title) throw new Error('title was not added');

    const edited = updateTitleCommand(apply(videoDocument(), added.value), title.id, {
      text: 'Big',
      fontSize: 999,
    });
    if (!edited.ok) throw new Error(edited.error.message);
    const updated = (edited.value.patch.studioPayload as VideoPayload).tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.id === title.id) as TitleClip;
    expect(updated.text).toBe('Big');
    expect(updated.fontSize).toBe(200);
    expect(edited.value.label).toBe('Edit title');
  });

  it('refuses to empty a title through an update', () => {
    const document = videoDocument();
    const added = addTitleCommand(document, { text: 'Hi', start: 0 });
    if (!added.ok) throw new Error(added.error.message);
    const id = (
      (added.value.patch.studioPayload as VideoPayload).tracks.flatMap(
        (track) => track.clips,
      )[0] as TitleClip
    ).id;
    const emptied = updateTitleCommand(apply(document, added.value), id, { text: ' ' });
    expect(emptied.ok).toBe(false);
  });
});

describe('media registration', () => {
  it('adds a media record once and refuses a duplicate', () => {
    const document = videoDocument();
    const registered = registerMediaCommand(document, MEDIA);
    if (!registered.ok) throw new Error(registered.error.message);
    expect(registered.value.label).toBe('Import “clip.mp4”');
    const next = apply(document, registered.value);
    expect((next.studioPayload as VideoPayload).media).toHaveLength(1);

    const again = registerMediaCommand(next, MEDIA);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.message).toMatch(/already in the media bin/);
  });

  it('refuses to forget a file a clip still uses, then forgets it', () => {
    const placed = place(videoDocument(), { start: 0 });
    const inUse = removeMediaCommand(placed.document, MEDIA.id);
    expect(inUse.ok).toBe(false);
    if (!inUse.ok) expect(inUse.error.message).toMatch(/still used by 1 clip/);

    const removed = removeClipCommand(placed.document, placed.clipId);
    if (!removed.ok) throw new Error(removed.error.message);
    const empty = apply(placed.document, removed.value);
    const forgotten = removeMediaCommand(empty, MEDIA.id);
    expect(forgotten.ok).toBe(true);
    if (forgotten.ok) {
      expect(forgotten.value.label).toBe('Remove “clip.mp4” from the media bin');
      expect((forgotten.value.patch.studioPayload as VideoPayload).media).toHaveLength(0);
    }
  });

  it('reports a missing clip via findClip instead of throwing', () => {
    const document = videoDocument();
    expect(findClip(document, 'clip-nope')).toBeNull();
    expect(removeClipCommand(document, 'clip-nope').ok).toBe(false);
  });
});
