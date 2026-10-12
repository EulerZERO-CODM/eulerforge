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

import { createRect, unionRects, type Point, type Rect } from '../documents/geometry';
import { updateLayer } from '../documents/layer-operations';
import { asLayerId, type Layer, type LayerId, type Scene } from '../documents/layer-types';
import {
  applyGroupTransform,
  computeSnap,
  groupTransformForHandle,
  MOVE_SNAP_EDGES,
  resizeFrame,
  snapEdgesForHandle,
  type SnapTargets,
  type TransformHandle,
  type TransformTarget,
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
  /** Frames of every layer the gesture changes, as they were when it began. */
  readonly frames: readonly TransformTarget[];
  /**
   * Bounding box of `frames` when the gesture began: the box the handles describe and the box a
   * resize scales. Locked layers are absent from `frames`, so they are absent from this box too.
   */
  readonly box: Rect;
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

/**
 * Frames a pointer gesture may change.
 *
 * Locked layers are dropped here, at the source of the gesture, so nothing downstream has to
 * remember to skip them: the preview, the commit and the box the handles are drawn from all come
 * from this one list.
 */
/** Every transformable layer of a gesture: the anchor plus the rest of an unlocked selection. */
export function gestureFrames(
  scene: Scene,
  selection: readonly LayerId[],
  anchorId: LayerId | string,
): readonly TransformTarget[] {
  const wanted = new Set([String(anchorId), ...selection.map(String)]);
  return scene.layers
    .filter((layer) => !layer.locked && wanted.has(String(layer.id)))
    .map((layer) => ({ id: layer.id, frame: layer.frame }));
}

/** The box a set of targets occupies; the handles and the resize maths share it. */
export function targetsBox(targets: readonly TransformTarget[]): Rect {
  return unionRects(targets.map((target) => target.frame)) ?? createRect(0, 0, 0, 0);
}

/** Starts a move of every unlocked selected layer, anchored on the layer under the pointer. */
export function beginMove(input: BeginMoveInput): GestureState {
  const frames = gestureFrames(input.scene, input.selection, input.anchor.id);
  const targets = frames.length > 0 ? frames : [{ id: input.anchor.id, frame: input.anchor.frame }];

  return {
    kind: 'move',
    start: {
      pointer: input.pointer,
      frames: targets,
      box: targetsBox(targets),
      anchorId: input.anchor.id,
      handle: null,
    },
    delta: { x: 0, y: 0 },
    modifiers: NO_MODIFIERS,
  };
}

/**
 * Starts a resize of a whole selection.
 *
 * Takes the frames rather than one layer: a bounding-box handle transforms every unlocked selected
 * layer through one scale, so the box the handles are drawn around is exactly the box that changes.
 */
export function beginResize(
  pointer: Point,
  targets: readonly TransformTarget[],
  handle: TransformHandle,
): GestureState {
  const anchor = targets[targets.length - 1];
  return {
    kind: 'resize',
    start: {
      pointer,
      frames: targets,
      box: targetsBox(targets),
      // With no targets there is nothing to resize; `resolveGesture` then reports no change and the
      // caller commits nothing, rather than moving a layer the gesture never included.
      anchorId: anchor?.id ?? asLayerId(''),
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
  const box = gesture.start.box;
  const options = {
    preserveAspectRatio: gesture.modifiers.preserveAspectRatio,
    resizeFromCentre: gesture.modifiers.resizeFromCentre,
  };

  // 1. Where the pointer alone would put the box, before snapping.
  const attempted =
    gesture.kind === 'resize' && handle
      ? resizeFrame(box, handle, gesture.delta, options)
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

  // 3. Re-derive every frame from its start frame, so the result is a function of the gesture and
  //    cannot accumulate rounding across pointer moves. A resize is one scale about the fixed edge
  //    for the whole selection, which is what keeps a group's internal spacing intact.
  const transform =
    gesture.kind === 'resize' && handle
      ? groupTransformForHandle(box, handle, effectiveDelta, options)
      : null;

  const primary = transform
    ? applyGroupTransform(box, transform, options)
    : createRect(
        anchorStart.frame.x + effectiveDelta.x,
        anchorStart.frame.y + effectiveDelta.y,
        anchorStart.frame.width,
        anchorStart.frame.height,
      );

  let scene = context.scene;
  for (const entry of gesture.start.frames) {
    const nextFrame = transform
      ? applyGroupTransform(entry.frame, transform, options)
      : createRect(
          entry.frame.x + (primary.x - anchorStart.frame.x),
          entry.frame.y + (primary.y - anchorStart.frame.y),
          entry.frame.width,
          entry.frame.height,
        );
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

/**
 * True when the gesture is worth committing: *something* about the document changed.
 *
 * Every frame is compared, not just the anchor's: a group resize can leave the anchor layer exactly
 * where it was (a layer sitting on the pinned edge) while the rest of the selection scales, and
 * treating that as "nothing happened" would silently drop a real edit.
 */
export function gestureChangedSomething(gesture: GestureState, result: GestureResult): boolean {
  if (!result.frame) return false;
  return gesture.start.frames.some((entry) => {
    const now = result.scene.layers.find((layer) => String(layer.id) === String(entry.id))?.frame;
    if (!now) return false;
    return (
      Math.abs(now.x - entry.frame.x) > EPSILON ||
      Math.abs(now.y - entry.frame.y) > EPSILON ||
      Math.abs(now.width - entry.frame.width) > EPSILON ||
      Math.abs(now.height - entry.frame.height) > EPSILON
    );
  });
}

/** Sub-pixel tolerance: a drag that resolves below it is not an edit. */
export const EPSILON = 0.001;
