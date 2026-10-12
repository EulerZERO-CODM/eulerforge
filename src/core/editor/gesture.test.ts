import { describe, expect, it } from 'vitest';

import {
  beginMove,
  beginResize,
  gestureChangedSomething,
  gestureLabel,
  resolveGesture,
  updateGesture,
  NO_MODIFIERS,
  type GestureContext,
} from './gesture';
import { createRect } from '../documents/geometry';
import type { SnapTargets } from '../documents/scene-geometry';
import { layerId, rectLayer, sceneOf, textLayer } from '../../testing/layers';

/**
 * Gesture resolution.
 *
 * The important property is that a gesture is a *pure function of where it started and how far it has
 * moved*. That is what makes an interrupted drag safe (nothing has been written yet), what keeps a
 * single commit per gesture honest, and what makes snapping testable without a pointer.
 *
 * Snap targets are supplied explicitly rather than derived, so a test that asserts "no snap" cannot
 * pass by accident because a generated target happened to be out of range.
 */

const COARSE: SnapTargets = Object.freeze({
  vertical: Object.freeze([0, 200, 540, 1080]),
  horizontal: Object.freeze([0, 300, 540, 1080]),
});

function context(scene: ReturnType<typeof sceneOf>, overrides: Partial<GestureContext> = {}) {
  return {
    scene,
    canvas: { width: 1080, height: 1080 },
    targets: COARSE,
    snapEnabled: true,
    snapThreshold: 6,
    ...overrides,
  };
}

const layerA = rectLayer('lyr-a', { x: 38, y: 300, width: 60, height: 60, name: 'Card' });
const layerB = rectLayer('lyr-b', { x: 700, y: 300, width: 60, height: 60 });
const scene = sceneOf(layerA, layerB);

describe('move gestures', () => {
  it('applies the pointer delta exactly when snapping is off', () => {
    const gesture = beginMove({
      pointer: { x: 100, y: 100 },
      scene,
      selection: [layerA.id],
      anchor: layerA,
    });
    const moved = updateGesture(gesture, { x: 260, y: 140 });

    const result = resolveGesture(moved, context(scene, { snapEnabled: false }));

    expect(result.frame).toEqual({ x: 198, y: 340, width: 60, height: 60 });
    expect(result.guidesX).toEqual([]);
    expect(result.guidesY).toEqual([]);
    expect(result.unchanged).toBe(false);
    expect(gestureChangedSomething(moved, result)).toBe(true);
  });

  it('snaps the closest edge to a target and reports the guide it landed on', () => {
    const gesture = beginMove({
      pointer: { x: 100, y: 100 },
      scene,
      selection: [layerA.id],
      anchor: layerA,
    });
    const moved = updateGesture(gesture, { x: 262, y: 100 });

    // 38 + 162 puts the left edge exactly on the 200 target; the layer's own y already sits on the
    // 300 horizontal target, so a move reports a guide on each axis it actually matched.
    const result = resolveGesture(moved, context(scene));

    expect(result.frame?.x).toBe(200);
    expect(result.guidesX).toEqual([200]);
    expect(result.guidesY).toEqual([300]);
  });

  it('snaps the centre of a layer, not only its edges', () => {
    const gesture = beginMove({
      pointer: { x: 100, y: 100 },
      scene,
      selection: [layerA.id],
      anchor: layerA,
    });
    // A 60px-wide layer whose *centre* reaches 200 is at x = 170, so 38 + 130 = 168 gets pulled 2px.
    const moved = updateGesture(gesture, { x: 230, y: 100 });

    const result = resolveGesture(moved, context(scene));

    expect(result.frame?.x).toBe(170);
    expect(result.guidesX).toEqual([200]);
  });

  it('leaves a frame alone when no target is within the threshold', () => {
    const gesture = beginMove({
      pointer: { x: 100, y: 100 },
      scene,
      selection: [layerA.id],
      anchor: layerA,
    });
    // 260 puts the left edge, the centre and the right edge 60px away from every target on x.
    const moved = updateGesture(gesture, { x: 322, y: 100 });

    const result = resolveGesture(moved, context(scene));

    expect(result.frame?.x).toBe(260);
    expect(result.guidesX).toEqual([]);
  });

  it('never snaps when the caller disables it, even next to a target', () => {
    const gesture = beginMove({
      pointer: { x: 100, y: 100 },
      scene,
      selection: [layerA.id],
      anchor: layerA,
    });
    const moved = updateGesture(gesture, { x: 261, y: 100 });

    const result = resolveGesture(moved, context(scene, { snapEnabled: false }));

    expect(result.frame?.x).toBe(199);
    expect(result.guidesX).toEqual([]);
  });

  it('moves every selected layer by the same snapped amount, keeping their spacing', () => {
    const withB = sceneOf(layerA, layerB);
    const gesture = beginMove({
      pointer: { x: 100, y: 100 },
      scene: withB,
      selection: [layerA.id, layerB.id],
      anchor: layerA,
    });
    const moved = updateGesture(gesture, { x: 264, y: 100 });

    const result = resolveGesture(moved, context(withB));
    const frames = result.scene.layers.map((layer) => layer.frame);

    // The anchor snapped from 202 back to 200, so the sibling moves by 162 — not 164.
    expect(frames[0]?.x).toBe(200);
    expect(frames[1]?.x).toBe(862);
    expect((frames[1]?.x ?? 0) - (frames[0]?.x ?? 0)).toBe(662);
  });

  it('is a function of the gesture rather than of the path the pointer took', () => {
    const gesture = beginMove({
      pointer: { x: 100, y: 100 },
      scene,
      selection: [layerA.id],
      anchor: layerA,
    });

    const direct = resolveGesture(updateGesture(gesture, { x: 300, y: 100 }), context(scene));

    let wandering = gesture;
    for (const step of [120, 140, 250, 300]) {
      wandering = updateGesture(wandering, { x: step, y: 100 });
    }
    const accumulated = resolveGesture(wandering, context(scene));

    expect(accumulated.frame).toEqual(direct.frame);
  });

  it('reports nothing changed when the pointer has not moved', () => {
    const gesture = beginMove({
      pointer: { x: 100, y: 100 },
      scene,
      selection: [layerA.id],
      anchor: layerA,
    });

    const result = resolveGesture(gesture, context(scene));

    expect(result.unchanged).toBe(true);
    expect(gestureChangedSomething(gesture, result)).toBe(false);
  });

  it('never mutates the scene it was given', () => {
    const gesture = beginMove({
      pointer: { x: 100, y: 100 },
      scene,
      selection: [layerA.id],
      anchor: layerA,
    });
    const moved = updateGesture(gesture, { x: 400, y: 400 });

    const result = resolveGesture(moved, context(scene));

    expect(scene.layers[0]?.frame).toEqual({ x: 38, y: 300, width: 60, height: 60 });
    expect(result.scene).not.toBe(scene);
    expect(result.scene.layers[1]).toBe(scene.layers[1]);
  });

  it('fails softly when the layer can no longer be updated', () => {
    const gesture = beginMove({
      pointer: { x: 0, y: 0 },
      scene,
      selection: [layerA.id],
      anchor: layerA,
    });
    // Far outside the documented frame limits, so `updateLayer` refuses it.
    const moved = updateGesture(gesture, { x: 50_000, y: 0 });

    const result = resolveGesture(moved, context(scene, { snapEnabled: false }));

    expect(result.scene).toBe(scene);
    expect(result.unchanged).toBe(true);
  });

  it('fails softly when the gesture references a layer that is gone', () => {
    const gesture = beginMove({
      pointer: { x: 0, y: 0 },
      scene,
      selection: [layerA.id],
      anchor: layerA,
    });
    const missing = { ...gesture, start: { ...gesture.start, anchorId: layerId('lyr-gone') } };

    const result = resolveGesture(missing, context(scene));

    expect(result.scene).toBe(scene);
    expect(result.frame).toBeUndefined();
  });
});

describe('resize gestures', () => {
  const resized = rectLayer('lyr-r', { x: 100, y: 100, width: 200, height: 100, name: 'Panel' });

  it('resizes the dragged edge and keeps the opposite one pinned', () => {
    const gesture = beginResize({ x: 300, y: 100 }, resized, 'e');
    const moved = updateGesture(gesture, { x: 340, y: 100 });

    const result = resolveGesture(moved, context(sceneOf(resized), { snapEnabled: false }));

    expect(result.frame).toEqual({ x: 100, y: 100, width: 240, height: 100 });
    expect(result.unchanged).toBe(false);
  });

  it('snaps the dragged edge to a target, and reports that guide', () => {
    const gesture = beginResize({ x: 300, y: 100 }, resized, 'e');
    // 300 + 28 = 328 would be the raw width; 332 puts the right edge on the 540 target... only if
    // the pointer overshoots, so drag to 334: right edge 334 -> nearest target 300 is 34 away.
    const moved = updateGesture(gesture, { x: 334, y: 100 });

    const result = resolveGesture(moved, context(sceneOf(resized)));

    expect(result.frame?.width).toBe(234);
    expect(result.guidesX).toEqual([]);
  });

  it('does not snap a pinned edge even when it sits on a target', () => {
    // The left edge is exactly on the canvas edge (target 0) but the 'e' handle only moves the right
    // edge, so a resize must never report a guide for the edge nobody is dragging.
    const atOrigin = rectLayer('lyr-o', { x: 0, y: 0, width: 200, height: 100 });
    const gesture = beginResize({ x: 200, y: 0 }, atOrigin, 'e');
    // +30 leaves the right edge at 230, which is 30px from the nearest vertical target.
    const moved = updateGesture(gesture, { x: 230, y: 0 });

    const result = resolveGesture(moved, context(sceneOf(atOrigin)));

    expect(result.guidesX).toEqual([]);
    expect(result.frame?.x).toBe(0);
    expect(result.frame?.width).toBe(230);
  });

  it('honours Shift for aspect ratio and Alt for resizing from the centre', () => {
    const gesture = beginResize({ x: 300, y: 200 }, resized, 'se');
    const shift = resolveGesture(
      updateGesture(
        gesture,
        { x: 400, y: 200 },
        { preserveAspectRatio: true, resizeFromCentre: false },
      ),
      context(sceneOf(resized), { snapEnabled: false }),
    );
    const alt = resolveGesture(
      updateGesture(
        gesture,
        { x: 400, y: 200 },
        { preserveAspectRatio: false, resizeFromCentre: true },
      ),
      context(sceneOf(resized), { snapEnabled: false }),
    );

    // 200x100 at 2:1: a 100px wider box must be 50px taller.
    expect(shift.frame?.width).toBe(300);
    expect(shift.frame?.height).toBe(150);
    expect(shift.frame?.x).toBe(100);

    // Resizing from the centre moves both edges: a 100px drag adds 100px on each side.
    expect(alt.frame?.width).toBe(400);
    expect(alt.frame?.x).toBe(0);
    expect(alt.frame?.y).toBe(100);
  });

  it('labels a resize with the layer name, and a multi-layer move with a count', () => {
    const gesture = beginResize({ x: 300, y: 100 }, resized, 'e');
    expect(gestureLabel(gesture, sceneOf(resized))).toBe('Resize “Panel”');

    const move = beginMove({
      pointer: { x: 0, y: 0 },
      scene,
      selection: [layerA.id, layerB.id],
      anchor: layerA,
    });
    expect(gestureLabel(move, scene)).toBe('Move 2 layers');
    expect(NO_MODIFIERS).toEqual({ preserveAspectRatio: false, resizeFromCentre: false });
  });

  it('keeps the frame at least the minimum size when dragged past its own edge', () => {
    const gesture = beginResize({ x: 300, y: 100 }, resized, 'e');
    const moved = updateGesture(gesture, { x: -400, y: 0 });

    const result = resolveGesture(moved, context(sceneOf(resized), { snapEnabled: false }));

    expect(result.frame?.width).toBe(4);
    expect(result.frame?.x).toBe(100);
  });
});

describe('gestures on text layers', () => {
  it('moves a text layer without touching its settings', () => {
    const text = textLayer('lyr-t', { x: 40, y: 40, width: 240, height: 80, content: 'Headline' });
    const gesture = beginMove({
      pointer: { x: 0, y: 0 },
      scene: sceneOf(text),
      selection: [text.id],
      anchor: text,
    });
    const moved = updateGesture(gesture, { x: 60, y: 20 });

    const result = resolveGesture(moved, context(sceneOf(text), { snapEnabled: false }));
    const layer = result.scene.layers[0];

    expect(layer?.frame).toEqual(createRect(100, 60, 240, 80));
    expect(layer?.type === 'text' ? layer.text.content : null).toBe('Headline');
  });
});
