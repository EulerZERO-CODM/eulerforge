/**
 * Pointer gestures.
 *
 * A gesture is described as *data* — what the pointer grabbed, where it started, how far it has
 * moved — and resolved by a pure function into a preview scene plus the guide lines to draw. Nothing
 * here knows about React, the DOM or pointer events, which means:
 *
 *  - the same maths runs in tests as in the browser;
 *  - the preview is a value, so an interrupted gesture simply stops being applied and never leaves a
 *    half-finished document behind;
 *  - exactly one commit happens, at the end, by the caller.
 */

import { createRect, type Point, type Rect } from '../documents/geometry';
import { updateLayer } from '../documents/layer-operations';
import type { Layer, LayerId, Scene } from '../documents/layer-types';
import {
  computeSnap,
  MOVE_SNAP_EDGES,
  resizeFrame,
  snapEdgesForHandle,
  type SnapTargets,
  type TransformHandle,
} from '../documents/scene-geometry';
import type { Size } from '../documents/types';

export type GestureModifiers = {
  /** Shift: constrain a resize to the original aspect ratio. */
  readonly preserveAspectRatio: boolean;
  /** Alt/Option: resize from the centre. */
  readonly resizeFromCentre: boolean;
};

export const NO_MODIFIERS: GestureModifiers = {
  preserveAspectRatio: false,
  resizeFromCentre: false,
};

export type GestureStart = {
  /** Pointer position in document pixels when the gesture began. */
  readonly pointer: Point;
  /** Frames of every layer the gesture moves, as they were when it began. */
  readonly frames: readonly { readonly id: LayerId; readonly frame: Rect }[];
  /** The layer whose frame drives snapping: the one under the pointer. */
  readonly anchorId: LayerId;
  readonly handle: TransformHandle | null;
};

export type GestureState = {
  readonly kind: 'move' | 'resize';
  readonly start: GestureStart;
  /** Total movement since the gesture began, in document pixels. */
  readonly delta: Point;
  readonly modifiers: GestureModifiers;
};

export type BeginMoveInput = {
  readonly pointer: Point;
  readonly scene: Scene;
  readonly selection: readonly LayerId[];
  readonly anchor: Layer;
};

/** Starts a move of every selected layer. */
export function beginMove(input: BeginMoveInput): GestureState {
  const moving = input.scene.layers.filter(
    (layer) =>
      String(layer.id) === String(input.anchor.id) ||
      input.selection.some((id) => String(id) === String(layer.id)),
  );
  const frames = (moving.length > 0 ? moving : [input.anchor]).map((layer) => ({
    id: layer.id,
    frame: layer.frame,
  }));

  return {
    kind: 'move',
    start: { pointer: input.pointer, frames, anchorId: input.anchor.id, handle: null },
    delta: { x: 0, y: 0 },
    modifiers: NO_MODIFIERS,
  };
}

export function beginResize(pointer: Point, layer: Layer, handle: TransformHandle): GestureState {
  return {
    kind: 'resize',
    start: {
      pointer,
      frames: [{ id: layer.id, frame: layer.frame }],
      anchorId: layer.id,
      handle,
    },
    delta: { x: 0, y: 0 },
    modifiers: NO_MODIFIERS,
  };
}

/** Applies a pointer position (and modifier keys) to an in-flight gesture. */
export function updateGesture(
  gesture: GestureState,
  pointer: Point,
  modifiers: GestureModifiers = NO_MODIFIERS,
): GestureState {
  return {
    ...gesture,
    delta: { x: pointer.x - gesture.start.pointer.x, y: pointer.y - gesture.start.pointer.y },
    modifiers,
  };
}

export type GestureContext = {
  readonly scene: Scene;
  readonly canvas: Size;
  readonly targets: SnapTargets;
  readonly snapEnabled: boolean;
  /** Snapping distance in document pixels for the current zoom. */
  readonly snapThreshold: number;
};

export type GestureResult = {
  /** The scene as it would be if the gesture ended now; the committed scene when idle. */
  readonly scene: Scene;
  /** Frame of the layer driving the gesture, after snapping. */
  readonly frame: Rect | undefined;
  readonly guidesX: readonly number[];
  readonly guidesY: readonly number[];
  /** True when nothing about the document would change, so committing would be dishonest. */
  readonly unchanged: boolean;
};

const NO_GESTURE: GestureResult = {
  scene: { layers: [] },
  frame: undefined,
  guidesX: [],
  guidesY: [],
  unchanged: true,
};

/**
 * Resolves a gesture into a preview scene.
 *
 * Snapping is computed once, from the anchor layer's frame, and the resulting adjustment is applied
 * to every moved layer — so a multi-layer drag keeps its internal spacing instead of each layer
 * snapping to its own nearest edge.
 */
export function resolveGesture(
  gesture: GestureState | null,
  context: GestureContext,
): GestureResult {
  if (!gesture) return { ...NO_GESTURE, scene: context.scene };

  const anchorStart = gesture.start.frames.find(
    (entry) => String(entry.id) === String(gesture.start.anchorId),
  );
  if (!anchorStart) return { ...NO_GESTURE, scene: context.scene };

  const handle = gesture.start.handle;
  const options = {
    preserveAspectRatio: gesture.modifiers.preserveAspectRatio,
    resizeFromCentre: gesture.modifiers.resizeFromCentre,
  };

  // 1. Where the pointer alone would put the anchor, before snapping.
  const attempted =
    gesture.kind === 'resize' && handle
      ? resizeFrame(anchorStart.frame, handle, gesture.delta, options)
      : createRect(
          anchorStart.frame.x + gesture.delta.x,
          anchorStart.frame.y + gesture.delta.y,
          anchorStart.frame.width,
          anchorStart.frame.height,
        );

  // 2. How far snapping would pull it, and which guide lines explain that pull.
  const adjustment =
    gesture.kind === 'resize' && handle
      ? computeSnap({
          frame: attempted,
          targets: context.targets,
          threshold: context.snapThreshold,
          edges: snapEdgesForHandle(handle),
          enabled: context.snapEnabled,
          mode: 'resize',
          handle,
        })
      : computeSnap({
          frame: attempted,
          targets: context.targets,
          threshold: context.snapThreshold,
          edges: MOVE_SNAP_EDGES,
          enabled: context.snapEnabled,
          mode: 'move',
        });

  const effectiveDelta: Point = {
    x: gesture.delta.x + adjustment.delta.x,
    y: gesture.delta.y + adjustment.delta.y,
  };

  // 3. Re-derive the anchor frame from its start frame, so the result is a function of the gesture
  //    and cannot accumulate rounding across pointer moves.
  const primary =
    gesture.kind === 'resize' && handle
      ? resizeFrame(anchorStart.frame, handle, effectiveDelta, options)
      : createRect(
          anchorStart.frame.x + effectiveDelta.x,
          anchorStart.frame.y + effectiveDelta.y,
          anchorStart.frame.width,
          anchorStart.frame.height,
        );

  let scene = context.scene;
  for (const entry of gesture.start.frames) {
    const frame =
      gesture.kind === 'resize'
        ? entry.frame // a resize gesture has exactly one entry, handled by the anchor frames
        : createRect(
            entry.frame.x + (primary.x - anchorStart.frame.x),
            entry.frame.y + (primary.y - anchorStart.frame.y),
            entry.frame.width,
            entry.frame.height,
          );
    const nextFrame = gesture.kind === 'resize' ? primary : frame;
    const updated = updateLayer(scene, entry.id, { frame: nextFrame });
    if (!updated.ok) return { ...NO_GESTURE, scene: context.scene };
    scene = updated.value;
  }

  return {
    scene,
    frame: primary,
    guidesX: adjustment.guidesX,
    guidesY: adjustment.guidesY,
    unchanged: effectiveDelta.x === 0 && effectiveDelta.y === 0,
  };
}

/** Label for the commit a finished gesture will produce. */
export function gestureLabel(gesture: GestureState, scene: Scene): string {
  const anchor = scene.layers.find((layer) => String(layer.id) === String(gesture.start.anchorId));
  const name = anchor?.name ?? 'layer';
  if (gesture.start.frames.length > 1) {
    return gesture.kind === 'resize'
      ? `Resize ${String(gesture.start.frames.length)} layers`
      : `Move ${String(gesture.start.frames.length)} layers`;
  }
  return gesture.kind === 'resize' ? `Resize “${name}”` : `Move “${name}”`;
}

/** True when the gesture is worth committing: something actually moved. */
export function gestureChangedSomething(gesture: GestureState, result: GestureResult): boolean {
  if (!result.frame) return false;
  const startFrame = gesture.start.frames.find(
    (entry) => String(entry.id) === String(gesture.start.anchorId),
  )?.frame;
  if (!startFrame) return false;
  return (
    Math.abs(result.frame.x - startFrame.x) > 0.001 ||
    Math.abs(result.frame.y - startFrame.y) > 0.001 ||
    Math.abs(result.frame.width - startFrame.width) > 0.001 ||
    Math.abs(result.frame.height - startFrame.height) > 0.001
  );
}
