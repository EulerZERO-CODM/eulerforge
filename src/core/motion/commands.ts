/**
 * Motion editing commands.
 *
 * Every timeline action is one command with a human label and a document patch, so undo, redo,
 * autosave and the save indicator behave exactly as they do in the other studios. A keyframe drag
 * is one command when it ends, not one per pointer move; the workspace keeps the in-flight value in
 * transient state and commits the resolved time (ADR-0017).
 */

import type {
  MotionEasing,
  MotionKeyframe,
  MotionPayload,
  MotionProperty,
  MotionTrack,
} from '../documents/payload';
import {
  MAX_MOTION_DURATION,
  MAX_MOTION_FPS,
  MAX_MOTION_KEYFRAMES,
  MAX_MOTION_TRACKS,
  MIN_MOTION_DURATION,
  MOTION_PROPERTY_INFO,
  createPayloadItemId,
} from '../documents/payload';
import type { ForgeDocument } from '../documents/types';
import { deleteLayersCommand, type SceneCommand } from '../editor/commands';
import { err, forgeError, ok, type Result } from '../result';

function motionPayload(document: ForgeDocument): Result<MotionPayload> {
  const payload = document.studioPayload;
  if (!payload || payload.kind !== 'motion') {
    return err(
      forgeError('validation-failed', 'This document is not a motion document.', {
        detail: 'Motion commands only apply to documents whose studio payload is a motion scene.',
        retryable: false,
      }),
    );
  }
  return ok(payload);
}

function withPayload(payload: MotionPayload, label: string): SceneCommand {
  return { label, patch: { studioPayload: payload } };
}

/** Rounds a time to milliseconds, the resolution the timeline edits at. */
export function roundTime(time: number): number {
  return Math.round(time * 1000) / 1000;
}

function clampTimeToPayload(payload: MotionPayload, time: number): number {
  return Math.min(payload.duration, Math.max(0, roundTime(time)));
}

/**
 * Finds or creates a track, returning a new track list.
 *
 * A track with no keyframes is not kept: an empty track is a row the user cannot see a reason for
 * and a keyframe-less property is the same as no animation at all.
 */
function upsertTrack(
  payload: MotionPayload,
  layerId: string,
  property: MotionProperty,
  keyframes: readonly MotionKeyframe[],
): Result<readonly MotionTrack[]> {
  const existingIndex = payload.tracks.findIndex(
    (track) => track.layerId === layerId && track.property === property,
  );
  if (keyframes.length === 0) {
    if (existingIndex === -1) return ok(payload.tracks);
    return ok(payload.tracks.filter((_, index) => index !== existingIndex));
  }
  const track: MotionTrack = { layerId, property, keyframes };
  if (existingIndex === -1) {
    if (payload.tracks.length >= MAX_MOTION_TRACKS) {
      return err(
        forgeError('validation-failed', 'This scene has reached its animation track limit.', {
          detail: `A composition can animate at most ${String(MAX_MOTION_TRACKS)} layer properties.`,
          retryable: false,
        }),
      );
    }
    return ok([...payload.tracks, track]);
  }
  return ok(
    payload.tracks.map((candidate, index) => (index === existingIndex ? track : candidate)),
  );
}

function sortedKeyframes(keyframes: readonly MotionKeyframe[]): readonly MotionKeyframe[] {
  return [...keyframes].sort((left, right) => left.time - right.time);
}

/** Refuses a keyframe time that is already taken by another keyframe on the same track. */
function timeIsFree(
  keyframes: readonly MotionKeyframe[],
  time: number,
  exceptId: string | null,
): boolean {
  return !keyframes.some(
    (keyframe) => keyframe.id !== exceptId && Math.abs(keyframe.time - time) < 1e-6,
  );
}

/**
 * Sets the composition length and frame rate.
 *
 * Keyframes outside the new duration are kept rather than deleted: shortening a scene is a viewing
 * decision, and silently destroying keyframes the user cannot see yet is exactly the kind of data
 * loss the document model exists to prevent. They simply do not affect the exported range.
 */
export function setMotionTimingCommand(
  document: ForgeDocument,
  timing: { readonly duration?: number; readonly fps?: number },
): Result<SceneCommand> {
  const payload = motionPayload(document);
  if (!payload.ok) return payload;
  const duration = timing.duration ?? payload.value.duration;
  const fps = timing.fps ?? payload.value.fps;
  if (
    !Number.isFinite(duration) ||
    duration < MIN_MOTION_DURATION ||
    duration > MAX_MOTION_DURATION
  ) {
    return err(
      forgeError('validation-failed', 'That composition length is out of range.', {
        detail: `Choose between ${String(MIN_MOTION_DURATION)} and ${String(MAX_MOTION_DURATION)} seconds.`,
        retryable: false,
      }),
    );
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > MAX_MOTION_FPS) {
    return err(
      forgeError('validation-failed', 'That frame rate is out of range.', {
        detail: `Choose a whole number of frames per second between 1 and ${String(MAX_MOTION_FPS)}.`,
        retryable: false,
      }),
    );
  }
  const next: MotionPayload = { ...payload.value, duration: roundTime(duration), fps };
  return ok(
    withPayload(
      next,
      timing.duration !== undefined && duration !== payload.value.duration
        ? `Set length to ${String(roundTime(duration))} s`
        : `Set frame rate to ${String(fps)} fps`,
    ),
  );
}

/**
 * Adds a keyframe, or updates the one already at that time.
 *
 * Adding at the playhead is the primary action in the property panel, and pressing it twice at the
 * same time must not create two keyframes a millisecond apart: that would make the curve
 * unreadable and the undo history noisy.
 */
export function addKeyframeCommand(
  document: ForgeDocument,
  request: {
    readonly layerId: string;
    readonly property: MotionProperty;
    readonly time: number;
    readonly value: number;
    readonly easing?: MotionEasing;
    readonly id?: string;
  },
): Result<SceneCommand> {
  const payload = motionPayload(document);
  if (!payload.ok) return payload;
  const time = clampTimeToPayload(payload.value, request.time);
  const track = payload.value.tracks.find(
    (candidate) => candidate.layerId === request.layerId && candidate.property === request.property,
  );
  const existing = track?.keyframes.find((keyframe) => Math.abs(keyframe.time - time) < 1e-6);
  const value = Number.isFinite(request.value) ? request.value : 0;

  if (existing) {
    const keyframes = (track?.keyframes ?? []).map((keyframe) =>
      keyframe.id === existing.id ? { ...keyframe, value } : keyframe,
    );
    const tracks = upsertTrack(payload.value, request.layerId, request.property, keyframes);
    if (!tracks.ok) return tracks;
    return ok(withPayload({ ...payload.value, tracks: tracks.value }, 'Set keyframe value'));
  }

  if ((track?.keyframes.length ?? 0) >= MAX_MOTION_KEYFRAMES) {
    return err(
      forgeError('validation-failed', 'This property has reached its keyframe limit.', {
        detail: `One property can hold at most ${String(MAX_MOTION_KEYFRAMES)} keyframes.`,
        retryable: false,
      }),
    );
  }

  const keyframe: MotionKeyframe = {
    id: request.id ?? createPayloadItemId('kf'),
    time,
    value,
    easing: request.easing ?? { kind: 'ease-in-out' },
  };
  const tracks = upsertTrack(
    payload.value,
    request.layerId,
    request.property,
    sortedKeyframes([...(track?.keyframes ?? []), keyframe]),
  );
  if (!tracks.ok) return tracks;
  return ok(
    withPayload(
      { ...payload.value, tracks: tracks.value },
      `Add ${MOTION_PROPERTY_INFO[request.property].label.toLowerCase()} keyframe`,
    ),
  );
}

/** Changes a keyframe's time, refusing a collision on the same track. */
export function moveKeyframeCommand(
  document: ForgeDocument,
  request: {
    readonly layerId: string;
    readonly property: MotionProperty;
    readonly keyframeId: string;
    readonly time: number;
  },
): Result<SceneCommand> {
  const payload = motionPayload(document);
  if (!payload.ok) return payload;
  const track = payload.value.tracks.find(
    (candidate) => candidate.layerId === request.layerId && candidate.property === request.property,
  );
  if (!track) {
    return err(forgeError('not-found', 'That keyframe is no longer in the scene.'));
  }
  const time = clampTimeToPayload(payload.value, request.time);
  if (!timeIsFree(track.keyframes, time, request.keyframeId)) {
    return err(
      forgeError('validation-failed', 'There is already a keyframe at that time.', {
        detail: 'Move it to a different moment, or delete the existing keyframe first.',
        retryable: false,
      }),
    );
  }
  const keyframes = sortedKeyframes(
    track.keyframes.map((keyframe) =>
      keyframe.id === request.keyframeId ? { ...keyframe, time } : keyframe,
    ),
  );
  const tracks = upsertTrack(payload.value, request.layerId, request.property, keyframes);
  if (!tracks.ok) return tracks;
  return ok(withPayload({ ...payload.value, tracks: tracks.value }, 'Move keyframe'));
}

/** Sets a keyframe's value, e.g. from the property panel's numeric field. */
export function setKeyframeValueCommand(
  document: ForgeDocument,
  request: {
    readonly layerId: string;
    readonly property: MotionProperty;
    readonly keyframeId: string;
    readonly value: number;
  },
): Result<SceneCommand> {
  const payload = motionPayload(document);
  if (!payload.ok) return payload;
  if (!Number.isFinite(request.value)) {
    return err(forgeError('validation-failed', 'A keyframe value must be a number.'));
  }
  const existing = payload.value.tracks.find(
    (track) => track.layerId === request.layerId && track.property === request.property,
  );
  if (!existing?.keyframes.some((keyframe) => keyframe.id === request.keyframeId)) {
    return err(forgeError('not-found', 'That keyframe is no longer in the scene.'));
  }
  const tracks = payload.value.tracks.map((track) => {
    if (track.layerId !== request.layerId || track.property !== request.property) return track;
    return {
      ...track,
      keyframes: track.keyframes.map((keyframe) =>
        keyframe.id === request.keyframeId ? { ...keyframe, value: request.value } : keyframe,
      ),
    };
  });
  return ok(withPayload({ ...payload.value, tracks }, 'Set keyframe value'));
}

/** Sets the easing of the segment that starts at a keyframe. */
export function setKeyframeEasingCommand(
  document: ForgeDocument,
  request: {
    readonly layerId: string;
    readonly property: MotionProperty;
    readonly keyframeId: string;
    readonly easing: MotionEasing;
  },
): Result<SceneCommand> {
  const payload = motionPayload(document);
  if (!payload.ok) return payload;
  const existing = payload.value.tracks.find(
    (track) => track.layerId === request.layerId && track.property === request.property,
  );
  if (!existing?.keyframes.some((keyframe) => keyframe.id === request.keyframeId)) {
    return err(forgeError('not-found', 'That keyframe is no longer in the scene.'));
  }
  const tracks = payload.value.tracks.map((track) => {
    if (track.layerId !== request.layerId || track.property !== request.property) return track;
    return {
      ...track,
      keyframes: track.keyframes.map((keyframe) =>
        keyframe.id === request.keyframeId ? { ...keyframe, easing: request.easing } : keyframe,
      ),
    };
  });
  return ok(withPayload({ ...payload.value, tracks }, 'Set keyframe easing'));
}

/** Removes a keyframe and, when it was the last one, the track that held it. */
export function removeKeyframeCommand(
  document: ForgeDocument,
  request: {
    readonly layerId: string;
    readonly property: MotionProperty;
    readonly keyframeId: string;
  },
): Result<SceneCommand> {
  const payload = motionPayload(document);
  if (!payload.ok) return payload;
  const track = payload.value.tracks.find(
    (candidate) => candidate.layerId === request.layerId && candidate.property === request.property,
  );
  if (!track || !track.keyframes.some((keyframe) => keyframe.id === request.keyframeId)) {
    return err(forgeError('not-found', 'That keyframe is no longer in the scene.'));
  }
  const keyframes = track.keyframes.filter((keyframe) => keyframe.id !== request.keyframeId);
  const tracks = upsertTrack(payload.value, request.layerId, request.property, keyframes);
  if (!tracks.ok) return tracks;
  return ok(withPayload({ ...payload.value, tracks: tracks.value }, 'Delete keyframe'));
}

/**
 * Removes every keyframe that belongs to a layer.
 *
 * Called by the workspace when a layer is deleted, so an animation cannot outlive the layer it
 * animates and reappear if a new layer is ever given the same id.
 */
export function pruneLayerTracksCommand(
  document: ForgeDocument,
  layerId: string,
): Result<SceneCommand> {
  const payload = motionPayload(document);
  if (!payload.ok) return payload;
  const tracks = payload.value.tracks.filter((track) => track.layerId !== layerId);
  if (tracks.length === payload.value.tracks.length) {
    return err(forgeError('validation-failed', 'That layer has no animation to remove.'));
  }
  return ok(withPayload({ ...payload.value, tracks }, 'Remove layer animation'));
}

/** Finds a keyframe by id, with the layer and property it belongs to. */
export function findKeyframe(
  payload: MotionPayload,
  keyframeId: string,
): {
  readonly layerId: string;
  readonly property: MotionProperty;
  readonly keyframe: MotionKeyframe;
} | null {
  for (const track of payload.tracks) {
    const keyframe = track.keyframes.find((candidate) => candidate.id === keyframeId);
    if (keyframe) return { layerId: track.layerId, property: track.property, keyframe };
  }
  return null;
}

/** True when the payload animates anything — used by the empty states and the ledger copy. */
export function motionHasAnimation(payload: MotionPayload): boolean {
  return payload.tracks.some((track) => track.keyframes.length > 0);
}

/** Every track for one layer, in property order, for the property panel. */
export function tracksForLayer(payload: MotionPayload, layerId: string): readonly MotionTrack[] {
  const order: readonly MotionProperty[] = ['x', 'y', 'scale', 'opacity'];
  return order
    .map((property) => findTrack(payload, layerId, property))
    .filter((track): track is MotionTrack => track !== null);
}

function findTrack(
  payload: MotionPayload,
  layerId: string,
  property: MotionProperty,
): MotionTrack | null {
  return (
    payload.tracks.find((track) => track.layerId === layerId && track.property === property) ?? null
  );
}

/**
 * Deletes a layer and the animation that belongs to it, in one patch.
 *
 * Two commands committed one after the other would be two undo steps for one decision, and undoing
 * only the first would leave keyframes pointing at a layer that no longer exists.
 */
export function deleteMotionLayerCommand(
  document: ForgeDocument,
  layerId: string,
): Result<SceneCommand> {
  const removed = deleteLayersCommand(document, [layerId]);
  if (!removed.ok) return removed;
  const pruned = pruneLayerTracksCommand(document, layerId);
  if (!pruned.ok) return removed;
  const payload = pruned.value.patch.studioPayload;
  if (!payload) return removed;
  return ok({
    label: removed.value.label,
    patch: {
      ...removed.value.patch,
      studioPayload: payload,
    },
  });
}
