/**
 * Motion commands: one labelled, undoable patch per decision.
 *
 * The tests assert the payload that would be saved and the label that appears in history, plus the
 * refusals — duplicate times, unknown keyframes, limits, and commands aimed at the wrong studio.
 */

import { describe, expect, it } from 'vitest';

import { createDocument, DEFAULT_CANVAS, DEFAULT_GUIDES } from '../documents/factories';
import type { MotionPayload } from '../documents/payload';
import { MAX_MOTION_KEYFRAMES } from '../documents/payload';
import type { ForgeDocument } from '../documents/types';
import { brand } from '../types/brand';
import {
  addKeyframeCommand,
  motionHasAnimation,
  moveKeyframeCommand,
  pruneLayerTracksCommand,
  removeKeyframeCommand,
  setKeyframeEasingCommand,
  setKeyframeValueCommand,
  setMotionTimingCommand,
  tracksForLayer,
} from './commands';

function motionDocument(): ForgeDocument {
  const created = createDocument(
    {
      title: 'Motion commands',
      studioId: 'motion',
      documentTypeId: brand<'DocumentTypeId'>('motion.scene'),
      canvas: DEFAULT_CANVAS,
      guides: DEFAULT_GUIDES,
    },
    { generateId: () => 'doc-commands' },
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function payloadAfter(command: {
  readonly patch: { readonly studioPayload?: unknown };
}): MotionPayload {
  return command.patch.studioPayload as MotionPayload;
}

const LAYER = 'lyr-title';

function add(
  document: ForgeDocument,
  time: number,
  value: number,
  property: 'x' | 'y' | 'scale' | 'opacity' = 'x',
): ForgeDocument {
  const command = addKeyframeCommand(document, { layerId: LAYER, property, time, value });
  if (!command.ok) throw new Error(command.error.message);
  return { ...document, studioPayload: payloadAfter(command.value) };
}

describe('motion commands', () => {
  it('adds a keyframe and labels the history entry', () => {
    const document = motionDocument();
    const command = addKeyframeCommand(document, {
      layerId: LAYER,
      property: 'x',
      time: 1,
      value: 50,
    });
    expect(command.ok).toBe(true);
    if (!command.ok) return;
    expect(command.value.label).toBe('Add x position keyframe');
    const payload = payloadAfter(command.value);
    expect(payload.tracks).toHaveLength(1);
    expect(payload.tracks[0]?.keyframes).toEqual([
      {
        id: expect.stringMatching(/^kf-/) as string,
        time: 1,
        value: 50,
        easing: { kind: 'ease-in-out' },
      },
    ]);
    expect(motionHasAnimation(payload)).toBe(true);
  });

  it('keeps keyframes sorted and does not mutate the original payload', () => {
    const document = motionDocument();
    const withLater = add(document, 2, 200);
    const withEarlier = add(withLater, 0.5, 10);
    const payload = withEarlier.studioPayload as MotionPayload;
    expect(payload.tracks[0]?.keyframes.map((frame) => frame.time)).toEqual([0.5, 2]);
    expect((withLater.studioPayload as MotionPayload).tracks[0]?.keyframes).toHaveLength(1);
    expect((document.studioPayload as MotionPayload).tracks).toHaveLength(0);
  });

  it('updates instead of duplicating a keyframe at the same time', () => {
    const document = add(motionDocument(), 1, 10);
    const command = addKeyframeCommand(document, {
      layerId: LAYER,
      property: 'x',
      time: 1,
      value: 20,
    });
    if (!command.ok) throw new Error(command.error.message);
    expect(command.value.label).toBe('Set keyframe value');
    const payload = payloadAfter(command.value);
    expect(payload.tracks[0]?.keyframes).toHaveLength(1);
    expect(payload.tracks[0]?.keyframes[0]?.value).toBe(20);
  });

  it('rounds keyframe times to the millisecond and clamps them into the composition', () => {
    const document = motionDocument();
    const command = addKeyframeCommand(document, {
      layerId: LAYER,
      property: 'y',
      time: 1.23456,
      value: 3,
    });
    if (!command.ok) throw new Error(command.error.message);
    expect(payloadAfter(command.value).tracks[0]?.keyframes[0]?.time).toBe(1.235);

    const clamped = addKeyframeCommand(document, {
      layerId: LAYER,
      property: 'y',
      time: 999,
      value: 3,
    });
    if (!clamped.ok) throw new Error(clamped.error.message);
    const payload = payloadAfter(clamped.value);
    expect(payload.tracks[0]?.keyframes[0]?.time).toBe(payload.duration);
  });

  it('moves a keyframe and refuses a collision', () => {
    const document = add(add(motionDocument(), 0, 0), 1, 100);
    const id = (document.studioPayload as MotionPayload).tracks[0]?.keyframes[1]?.id as string;
    const collision = moveKeyframeCommand(document, {
      layerId: LAYER,
      property: 'x',
      keyframeId: id,
      time: 0,
    });
    expect(collision.ok).toBe(false);
    if (!collision.ok) expect(collision.error.message).toMatch(/already a keyframe/i);

    const move = moveKeyframeCommand(document, {
      layerId: LAYER,
      property: 'x',
      keyframeId: id,
      time: 0.25,
    });
    if (!move.ok) throw new Error(move.error.message);
    const payload = payloadAfter(move.value);
    expect(payload.tracks[0]?.keyframes.map((frame) => frame.time)).toEqual([0, 0.25]);
  });

  it('sets values, easing and removes the track with its last keyframe', () => {
    const document = add(motionDocument(), 0, 0);
    const id = (document.studioPayload as MotionPayload).tracks[0]?.keyframes[0]?.id as string;

    const value = setKeyframeValueCommand(document, {
      layerId: LAYER,
      property: 'x',
      keyframeId: id,
      value: 77,
    });
    if (!value.ok) throw new Error(value.error.message);
    const valued: ForgeDocument = { ...document, studioPayload: payloadAfter(value.value) };
    expect((valued.studioPayload as MotionPayload).tracks[0]?.keyframes[0]?.value).toBe(77);

    const easing = setKeyframeEasingCommand(valued, {
      layerId: LAYER,
      property: 'x',
      keyframeId: id,
      easing: { kind: 'cubic', x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 },
    });
    if (!easing.ok) throw new Error(easing.error.message);
    expect(payloadAfter(easing.value).tracks[0]?.keyframes[0]?.easing).toEqual({
      kind: 'cubic',
      x1: 0.1,
      y1: 0.2,
      x2: 0.3,
      y2: 0.4,
    });

    const removed = removeKeyframeCommand(document, {
      layerId: LAYER,
      property: 'x',
      keyframeId: id,
    });
    if (!removed.ok) throw new Error(removed.error.message);
    expect(payloadAfter(removed.value).tracks).toEqual([]);
  });

  it('refuses to touch a keyframe that is not there', () => {
    const document = add(motionDocument(), 0, 0);
    const missing = removeKeyframeCommand(document, {
      layerId: LAYER,
      property: 'x',
      keyframeId: 'kf-nope',
    });
    expect(missing.ok).toBe(false);
    const wrongProperty = removeKeyframeCommand(document, {
      layerId: LAYER,
      property: 'y',
      keyframeId: 'kf-nope',
    });
    expect(wrongProperty.ok).toBe(false);
  });

  it('prunes every track of a deleted layer and refuses when there is nothing to prune', () => {
    const document = add(add(motionDocument(), 0, 0), 1, 10, 'opacity');
    const pruned = pruneLayerTracksCommand(document, LAYER);
    if (!pruned.ok) throw new Error(pruned.error.message);
    expect(payloadAfter(pruned.value).tracks).toEqual([]);
    expect(pruneLayerTracksCommand(document, 'lyr-other').ok).toBe(false);
  });

  it('sets timing within limits and refuses values outside them', () => {
    const document = motionDocument();
    const longer = setMotionTimingCommand(document, { duration: 12 });
    if (!longer.ok) throw new Error(longer.error.message);
    expect(payloadAfter(longer.value).duration).toBe(12);
    expect(longer.value.label).toBe('Set length to 12 s');

    const faster = setMotionTimingCommand(document, { fps: 24 });
    if (!faster.ok) throw new Error(faster.error.message);
    expect(payloadAfter(faster.value).fps).toBe(24);

    expect(setMotionTimingCommand(document, { duration: 0 }).ok).toBe(false);
    expect(setMotionTimingCommand(document, { duration: 500 }).ok).toBe(false);
    expect(setMotionTimingCommand(document, { fps: 0 }).ok).toBe(false);
    expect(setMotionTimingCommand(document, { fps: 24.5 }).ok).toBe(false);
  });

  it('refuses commands aimed at a document from another studio', () => {
    const created = createDocument(
      {
        title: 'Design',
        studioId: 'design',
        documentTypeId: brand<'DocumentTypeId'>('design.canvas'),
        canvas: DEFAULT_CANVAS,
        guides: DEFAULT_GUIDES,
      },
      { generateId: () => 'doc-design' },
    );
    if (!created.ok) throw new Error(created.error.message);
    const command = addKeyframeCommand(created.value, {
      layerId: LAYER,
      property: 'x',
      time: 0,
      value: 1,
    });
    expect(command.ok).toBe(false);
    if (!command.ok) expect(command.error.message).toMatch(/not a motion document/i);
  });

  it('stops at the documented keyframe limit', () => {
    // A long composition, so the keyframe cap is what stops the loop rather than the duration.
    const timing = setMotionTimingCommand(motionDocument(), { duration: 120, fps: 30 });
    if (!timing.ok) throw new Error(timing.error.message);
    let document: ForgeDocument = {
      ...motionDocument(),
      studioPayload: payloadAfter(timing.value),
    };
    for (let index = 0; index < MAX_MOTION_KEYFRAMES; index += 1) {
      document = add(document, index * 0.5, index);
    }
    const payload = document.studioPayload as MotionPayload;
    expect(payload.tracks[0]?.keyframes).toHaveLength(MAX_MOTION_KEYFRAMES);
    const extra = addKeyframeCommand(document, {
      layerId: LAYER,
      property: 'x',
      time: 110,
      value: 1,
    });
    expect(extra.ok).toBe(false);
    // Adding is limited by the keyframe cap, not by the track cap; the error names the keyframe cap.
    if (!extra.ok) expect(extra.error.message).toMatch(/keyframe limit/i);
  });

  it('lists the tracks of one layer in property order', () => {
    let document = add(motionDocument(), 0, 1, 'opacity');
    document = add(document, 0, 2, 'x');
    const payload = document.studioPayload as MotionPayload;
    expect(tracksForLayer(payload, LAYER).map((track) => track.property)).toEqual(['x', 'opacity']);
    expect(tracksForLayer(payload, 'lyr-other')).toEqual([]);
  });
});
