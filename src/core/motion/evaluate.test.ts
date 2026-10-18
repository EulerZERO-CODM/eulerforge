/**
 * The deterministic scene evaluator.
 *
 * The tests are written against times and expected geometry, never against the evaluator's own
 * output: a title that starts at x = 0, moves to x = 300 over one second, holds for a second and
 * fades must evaluate to exactly the numbers a person would write on paper.
 */

import { describe, expect, it } from 'vitest';

import { createDocument, DEFAULT_CANVAS, DEFAULT_GUIDES } from '../documents/factories';
import type { MotionPayload } from '../documents/payload';
import type { ForgeDocument } from '../documents/types';
import type { SceneCommand } from '../editor/commands';
import { brand } from '../types/brand';
import { addKeyframeCommand } from './commands';
import {
  clampTime,
  evaluateDocumentAt,
  evaluateTrack,
  frameIndexAt,
  keyframeTimes,
  motionPayloadOf,
} from './evaluate';

function motionDocument(): ForgeDocument {
  const created = createDocument(
    {
      title: 'Motion test',
      studioId: 'motion',
      documentTypeId: brand<'DocumentTypeId'>('motion.scene'),
      canvas: DEFAULT_CANVAS,
      guides: DEFAULT_GUIDES,
    },
    { generateId: () => 'doc-motion' },
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

/** Applies a command the way the session would, so the fixture is a real document. */
function apply(document: ForgeDocument, command: SceneCommand): ForgeDocument {
  const patch = command.patch;
  const scene = patch.scene ?? document.scene;
  const canvas = patch.canvas ?? document.canvas;
  const studioPayload = patch.studioPayload ?? document.studioPayload;
  return { ...document, scene, canvas, studioPayload };
}

function withLayer(document: ForgeDocument): {
  readonly document: ForgeDocument;
  readonly id: string;
} {
  return {
    document: {
      ...document,
      scene: {
        layers: [
          {
            id: brand<'LayerId'>('lyr-title'),
            name: 'Title',
            visible: true,
            locked: false,
            opacity: 1,
            frame: { x: 100, y: 200, width: 400, height: 100 },
            type: 'rect',
            shape: { fill: '#ff8800', stroke: null, strokeWidth: 0, cornerRadius: 0 },
          },
        ],
      },
    },
    id: 'lyr-title',
  };
}

function keyed(
  document: ForgeDocument,
  id: string,
  property: 'x' | 'y' | 'scale' | 'opacity',
  frames: readonly { time: number; value: number; easing?: 'linear' | 'hold' | 'ease-in-out' }[],
): ForgeDocument {
  let current = document;
  for (const frame of frames) {
    const command = addKeyframeCommand(current, {
      layerId: id,
      property,
      time: frame.time,
      value: frame.value,
      ...(frame.easing ? { easing: { kind: frame.easing } } : {}),
    });
    if (!command.ok) throw new Error(command.error.message);
    current = apply(current, command.value);
  }
  return current;
}

describe('evaluateTrack', () => {
  it('interpolates linearly between keyframes and holds outside them', () => {
    const track = {
      layerId: 'lyr-title',
      property: 'x' as const,
      keyframes: [
        { id: 'a', time: 0, value: 0, easing: { kind: 'linear' as const } },
        { id: 'b', time: 1, value: 300, easing: { kind: 'linear' as const } },
      ],
    };
    expect(evaluateTrack(track, 0)).toBe(0);
    expect(evaluateTrack(track, 0.25)).toBeCloseTo(75, 9);
    expect(evaluateTrack(track, 0.5)).toBeCloseTo(150, 9);
    expect(evaluateTrack(track, 1)).toBe(300);
    expect(evaluateTrack(track, -2)).toBe(0);
    expect(evaluateTrack(track, 99)).toBe(300);
  });

  it('uses the easing of the segment that starts at the left keyframe', () => {
    const track = {
      layerId: 'lyr-title',
      property: 'opacity' as const,
      keyframes: [
        { id: 'a', time: 0, value: 0, easing: { kind: 'ease-in-out' as const } },
        { id: 'b', time: 1, value: 1, easing: { kind: 'linear' as const } },
        { id: 'c', time: 2, value: 0, easing: { kind: 'linear' as const } },
      ],
    };
    expect(evaluateTrack(track, 0.5)).toBeCloseTo(0.5, 6);
    // The second segment is linear, so its midpoint is exactly halfway between 1 and 0.
    expect(evaluateTrack(track, 1.5)).toBeCloseTo(0.5, 6);
  });

  it('holds the left value for a hold segment', () => {
    const track = {
      layerId: 'lyr-title',
      property: 'x' as const,
      keyframes: [
        { id: 'a', time: 0, value: 10, easing: { kind: 'hold' as const } },
        { id: 'b', time: 1, value: 90, easing: { kind: 'linear' as const } },
      ],
    };
    expect(evaluateTrack(track, 0)).toBe(10);
    expect(evaluateTrack(track, 0.999)).toBe(10);
    expect(evaluateTrack(track, 1)).toBe(90);
  });

  it('treats a single keyframe as a constant and an empty track as nothing', () => {
    const single = {
      layerId: 'lyr-title',
      property: 'x' as const,
      keyframes: [{ id: 'a', time: 2, value: 42, easing: { kind: 'linear' as const } }],
    };
    expect(evaluateTrack(single, 0)).toBe(42);
    expect(evaluateTrack({ ...single, keyframes: [] }, 1)).toBeNull();
  });
});

describe('scene evaluation', () => {
  it('moves a layer with its keyframed position and keeps its size', () => {
    const base = withLayer(motionDocument());
    const document = keyed(base.document, base.id, 'x', [
      { time: 0, value: 0, easing: 'linear' },
      { time: 1, value: 300, easing: 'linear' },
    ]);
    const atZero = evaluateDocumentAt(document, 0).scene.layers[0];
    const atHalf = evaluateDocumentAt(document, 0.5).scene.layers[0];
    expect(atZero?.frame.x).toBe(0);
    expect(atHalf?.frame.x).toBeCloseTo(150, 6);
    expect(atHalf?.frame.width).toBe(400);
    expect(atHalf?.frame.height).toBe(100);
  });

  it('scales around the centre of the frame, not its corner', () => {
    const base = withLayer(motionDocument());
    const document = keyed(base.document, base.id, 'scale', [{ time: 0, value: 2 }]);
    const layer = evaluateDocumentAt(document, 0).scene.layers[0];
    // Centre of the 400 × 100 frame at (100, 200) is (300, 250); doubling keeps it there.
    expect(layer?.frame.width).toBe(800);
    expect(layer?.frame.height).toBe(200);
    expect(layer?.frame.x).toBe(-100);
    expect(layer?.frame.y).toBe(150);
    expect((layer?.frame.x ?? 0) + (layer?.frame.width ?? 0) / 2).toBeCloseTo(300, 9);
    expect((layer?.frame.y ?? 0) + (layer?.frame.height ?? 0) / 2).toBeCloseTo(250, 9);
  });

  it('multiplies nothing: opacity is the keyframed value, clamped', () => {
    const base = withLayer(motionDocument());
    const document = keyed(base.document, base.id, 'opacity', [
      { time: 0, value: 0, easing: 'linear' },
      { time: 2, value: 1, easing: 'linear' },
    ]);
    expect(evaluateDocumentAt(document, 1).scene.layers[0]?.opacity).toBeCloseTo(0.5, 6);
    const clamped = keyed(base.document, base.id, 'opacity', [{ time: 0, value: 2 }]);
    expect(evaluateDocumentAt(clamped, 0).scene.layers[0]?.opacity).toBe(1);
  });

  it('leaves a layer alone when its payload has no track for it', () => {
    const base = withLayer(motionDocument());
    const payload = motionPayloadOf(base.document);
    expect(payload?.tracks).toEqual([]);
    const layer = evaluateDocumentAt(base.document, 7).scene.layers[0];
    expect(layer?.frame).toEqual({ x: 100, y: 200, width: 400, height: 100 });
  });

  it('is deterministic: same inputs, same geometry, whatever the order', () => {
    const base = withLayer(motionDocument());
    const document = keyed(base.document, base.id, 'x', [
      { time: 0, value: 0, easing: 'linear' },
      { time: 1, value: 300, easing: 'linear' },
    ]);
    const first = evaluateDocumentAt(document, 0.37);
    const second = evaluateDocumentAt(document, 0.37);
    expect(second).toEqual(first);
    // Evaluating another time in between cannot change the first result.
    void evaluateDocumentAt(document, 9);
    expect(evaluateDocumentAt(document, 0.37)).toEqual(first);
    expect(JSON.stringify(evaluateDocumentAt(document, 0.37).scene)).toBe(
      JSON.stringify(evaluateDocumentAt(document, 0.37).scene),
    );
  });

  it('clamps times and maps them to frame indices', () => {
    const payload = motionPayloadOf(motionDocument()) as MotionPayload;
    expect(clampTime(payload, -3)).toBe(0);
    expect(clampTime(payload, 999)).toBe(payload.duration);
    expect(frameIndexAt(payload, 0)).toBe(0);
    expect(frameIndexAt(payload, 1 / payload.fps + 1e-6)).toBe(1);
  });

  it('lists the keyframe times it was given', () => {
    const base = withLayer(motionDocument());
    const document = keyed(base.document, base.id, 'x', [
      { time: 0.5, value: 1 },
      { time: 0.25, value: 2 },
      { time: 0.75, value: 3 },
    ]);
    const payload = motionPayloadOf(document) as MotionPayload;
    expect(keyframeTimes(payload)).toEqual([0.25, 0.5, 0.75]);
  });
});
