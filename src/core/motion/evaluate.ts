/**
 * The motion scene evaluator.
 *
 * One pure function answers "what does this document look like at time t?". The preview and the
 * frame export both call it, so they cannot disagree about a keyframe, an easing or a boundary —
 * the only way they could differ is if one of them stopped using this module (ADR-0025).
 *
 * There is no clock in this file: `t` is a parameter, never `performance.now()`. Two calls with the
 * same document and the same `t` return structurally equal values, which the tests assert by
 * evaluation twice and by evaluating in a different order.
 */

import type {
  MotionKeyframe,
  MotionPayload,
  MotionProperty,
  MotionTrack,
} from '../documents/payload';
import { MOTION_PROPERTY_INFO } from '../documents/payload';
import type { Layer, Scene } from '../documents/layer-types';
import type { ForgeDocument } from '../documents/types';
import { applyEasing } from './easing';

/** The payload of a motion document, or null when this document belongs to another studio. */
export function motionPayloadOf(document: ForgeDocument): MotionPayload | null {
  const payload = document.studioPayload;
  return payload && payload.kind === 'motion' ? payload : null;
}

/** The base value a property has when it has no keyframes: the layer's own frame or opacity. */
export function basePropertyValue(layer: Layer, property: MotionProperty): number {
  switch (property) {
    case 'x':
      return layer.frame.x;
    case 'y':
      return layer.frame.y;
    case 'scale':
      return 1;
    case 'opacity':
      return layer.opacity;
  }
}

/** The track for one layer and property, if one exists. */
export function findTrack(
  payload: MotionPayload,
  layerId: string,
  property: MotionProperty,
): MotionTrack | null {
  return (
    payload.tracks.find((track) => track.layerId === layerId && track.property === property) ?? null
  );
}

/** Keyframes sorted by time, tolerating an unsorted payload from an older editor build. */
function sortedKeyframes(track: MotionTrack): readonly MotionKeyframe[] {
  return [...track.keyframes].sort((left, right) => left.time - right.time);
}

/**
 * The value of a track at a time.
 *
 * Outside the keyframed range the nearest keyframe's value is held; inside it the segment's easing
 * shapes the interpolation. A `hold` segment keeps the left value until the next keyframe, which is
 * what stepping animation means. A single keyframe is a constant, which is a deliberate feature: it
 * lets a property be pinned without adding a second keyframe.
 */
export function evaluateTrack(track: MotionTrack, time: number): number | null {
  const frames = sortedKeyframes(track);
  if (frames.length === 0) return null;
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (!first || !last) return null;
  if (time <= first.time) return first.value;
  if (time >= last.time) return last.value;

  for (let index = 0; index < frames.length - 1; index += 1) {
    const from = frames[index];
    const to = frames[index + 1];
    if (!from || !to) continue;
    if (time < from.time || time > to.time) continue;
    const span = to.time - from.time;
    if (span <= 0) return to.value;
    const progress = (time - from.time) / span;
    const eased = applyEasing(from.easing, progress);
    return from.value + (to.value - from.value) * eased;
  }
  return last.value;
}

function clampProperty(property: MotionProperty, value: number): number {
  const info = MOTION_PROPERTY_INFO[property];
  if (!Number.isFinite(value)) return basePropertyValueFallback(property);
  return Math.min(info.max, Math.max(info.min, value));
}

function basePropertyValueFallback(property: MotionProperty): number {
  return property === 'opacity' ? 1 : property === 'scale' ? 1 : 0;
}

/** The value of one property of one layer at a time, falling back to the layer's own value. */
export function evaluateProperty(
  layer: Layer,
  payload: MotionPayload | null,
  property: MotionProperty,
  time: number,
): number {
  const track = payload ? findTrack(payload, layer.id, property) : null;
  const base = basePropertyValue(layer, property);
  if (!track) return base;
  const value = evaluateTrack(track, time);
  if (value === null) return base;
  return clampProperty(property, value);
}

/**
 * Applies the animation to one layer.
 *
 * Order matters and is documented: position first, then scale around the centre of the *positioned*
 * frame, then opacity. Scaling around a fixed corner would make a "grow" animation drift across the
 * canvas, which is not what the property panel says it does.
 */
export function evaluateLayerAt(layer: Layer, payload: MotionPayload | null, time: number): Layer {
  if (!payload) return layer;
  const x = evaluateProperty(layer, payload, 'x', time);
  const y = evaluateProperty(layer, payload, 'y', time);
  const scale = evaluateProperty(layer, payload, 'scale', time);
  const opacity = evaluateProperty(layer, payload, 'opacity', time);

  const width = Math.max(1, layer.frame.width * scale);
  const height = Math.max(1, layer.frame.height * scale);
  // Scale is around the centre of the positioned frame, not its top-left corner.
  const centreX = x + layer.frame.width / 2;
  const centreY = y + layer.frame.height / 2;

  return {
    ...layer,
    opacity: Math.min(1, Math.max(0, opacity)),
    frame: {
      x: centreX - width / 2,
      y: centreY - height / 2,
      width,
      height,
    },
  };
}

/** Every layer at a time, in the same z-order as the document. */
export function evaluateSceneAt(document: ForgeDocument, time: number): Scene {
  const payload = motionPayloadOf(document);
  if (!payload) return document.scene;
  return {
    layers: document.scene.layers.map((layer) => evaluateLayerAt(layer, payload, time)),
  };
}

/**
 * The whole document at a time.
 *
 * Returning a `ForgeDocument` rather than a bespoke frame type is what lets the preview and the
 * export reuse the existing render plan and painter — the same code that draws the Design Studio's
 * artboard draws a motion frame, so a text layer wraps identically in both.
 */
export function evaluateDocumentAt(document: ForgeDocument, time: number): ForgeDocument {
  return { ...document, scene: evaluateSceneAt(document, time) };
}

/** Every distinct keyframe time in the payload, sorted — the times the timeline ticks. */
export function keyframeTimes(payload: MotionPayload): readonly number[] {
  const times = new Set<number>();
  for (const track of payload.tracks) {
    for (const keyframe of track.keyframes) times.add(keyframe.time);
  }
  return [...times].sort((left, right) => left - right);
}

/** Clamps a time to the composition, so a seek can never land outside the document. */
export function clampTime(payload: MotionPayload, time: number): number {
  if (!Number.isFinite(time)) return 0;
  return Math.min(payload.duration, Math.max(0, time));
}

/** The frame index for a time at a frame rate, rounded down — the frame that is on screen at `t`. */
export function frameIndexAt(payload: MotionPayload, time: number): number {
  return Math.max(0, Math.floor(clampTime(payload, time) * payload.fps + 1e-6));
}
