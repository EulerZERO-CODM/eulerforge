/**
 * Scene-space interaction geometry: hit-testing, transform handles and snapping.
 *
 * Everything here works in **document pixels**. A caller converts pointer coordinates into document
 * space before calling in (see `src/components/workspace/artboard-pointer.ts`), which is what keeps
 * snapping and handle sizes identical at 25 % and at 400 % zoom — the failure mode this design
 * exists to prevent.
 *
 * Pure functions, no React and no DOM.
 */

import { createRect, rectContainsPoint, type Point, type Rect } from './geometry';
import type { Layer, LayerId, Scene } from './layer-types';
import type { Size } from './types';

/**
 * Handle footprint in document pixels.
 *
 * Deliberately *not* scaled by zoom: handles are hit areas measured against the pointer's document
 * position, and the artboard derives their on-screen size from `HANDLE_SCREEN_PX`. Keeping the
 * interaction footprint in document units is what makes a 900-px-wide layer resizable at 25 % zoom,
 * where the whole selection is only ~225 screen pixels across.
 */
export const MIN_HANDLE_HIT_DOCUMENT_PX = 6;

export const TRANSFORM_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type TransformHandle = (typeof TRANSFORM_HANDLES)[number];

export const HANDLE_LABELS: Readonly<Record<TransformHandle, string>> = {
  nw: 'Top left',
  n: 'Top',
  ne: 'Top right',
  e: 'Right',
  se: 'Bottom right',
  s: 'Bottom',
  sw: 'Bottom left',
  w: 'Left',
};

/** Unit position of each handle inside the frame, used for both drawing and hit-testing. */
export const HANDLE_ANCHORS: Readonly<Record<TransformHandle, Point>> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};

export function handlePosition(frame: Rect, handle: TransformHandle): Point {
  const anchor = HANDLE_ANCHORS[handle];
  return { x: frame.x + frame.width * anchor.x, y: frame.y + frame.height * anchor.y };
}

export function handleCursor(handle: TransformHandle): string {
  switch (handle) {
    case 'nw':
    case 'se':
      return 'nwse-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
  }
}

/**
 * Which handle (if any) the pointer is over, in document coordinates.
 *
 * Returns null when the pointer is inside the frame but away from every handle: that is a move, not
 * a resize, and conflating the two would make a selection impossible to nudge precisely.
 */
export function handleAtPoint(
  frame: Rect,
  point: Point,
  toleranceDocumentPx = MIN_HANDLE_HIT_DOCUMENT_PX,
): TransformHandle | null {
  let best: { handle: TransformHandle; distance: number } | null = null;
  for (const handle of TRANSFORM_HANDLES) {
    const position = handlePosition(frame, handle);
    const distance = Math.max(Math.abs(position.x - point.x), Math.abs(position.y - point.y));
    if (distance <= toleranceDocumentPx && (!best || distance < best.distance)) {
      best = { handle, distance };
    }
  }
  return best ? best.handle : null;
}

/**
 * Picks the top-most visible layer under a point.
 *
 * Iterates the scene backwards because the last layer paints on top, matching compositing order
 * exactly — a shape drawn under a graphic must not steal the click.
 *
 * Locked layers are skipped by default, so a click falls through to whatever can actually be
 * transformed. Pass `{ includeLocked: true }` to see what is *actually* on top instead: the artboard
 * uses that to notice that the user clicked a locked layer rather than empty space, which is the
 * difference between "nothing happens here" and "start a marquee and clear the selection".
 */
export function hitTestScene(
  scene: Scene,
  point: Point,
  options: { readonly includeLocked?: boolean } = {},
): Layer | null {
  for (let index = scene.layers.length - 1; index >= 0; index -= 1) {
    const layer = scene.layers[index];
    if (!layer || !layer.visible) continue;
    if (layer.locked && options.includeLocked !== true) continue;
    if (layerContainsPoint(layer, point)) return layer;
  }
  return null;
}

/**
 * Hit-test for a layer's own geometry.
 *
 * Text and image layers are boxes; an ellipse excludes the corners outside the ellipse so clicking a
 * transparent corner selects what is underneath instead of the ellipse.
 */
export function layerContainsPoint(layer: Layer, point: Point): boolean {
  if (!rectContainsPoint(layer.frame, point)) return false;
  if (layer.type !== 'ellipse') return true;
  const centre = {
    x: layer.frame.x + layer.frame.width / 2,
    y: layer.frame.y + layer.frame.height / 2,
  };
  const radiusX = layer.frame.width / 2;
  const radiusY = layer.frame.height / 2;
  if (radiusX <= 0 || radiusY <= 0) return false;
  const normalisedX = (point.x - centre.x) / radiusX;
  const normalisedY = (point.y - centre.y) / radiusY;
  return normalisedX * normalisedX + normalisedY * normalisedY <= 1;
}

/** Every layer in the scene, top-most first: the tree's visual order. */
export function layersTopFirst(scene: Scene): readonly Layer[] {
  return [...scene.layers].reverse();
}

/** Layers whose frame overlaps a marquee rectangle, used by rubber-band selection. */
export function layersInRect(scene: Scene, rect: Rect): readonly Layer[] {
  return scene.layers.filter((layer) => {
    if (!layer.visible || layer.locked) return false;
    const frame = layer.frame;
    return !(
      frame.x + frame.width < rect.x ||
      rect.x + rect.width < frame.x ||
      frame.y + frame.height < rect.y ||
      rect.y + rect.height < frame.y
    );
  });
}

export type TransformOptions = {
  /** Locks the aspect ratio of the original frame (Shift). */
  readonly preserveAspectRatio?: boolean | undefined;
  /** Removes the gesture history's ability to make a frame degenerate (Alt = resize from centre). */
  readonly resizeFromCentre?: boolean | undefined;
  readonly minSize?: number | undefined;
  readonly maxSize?: number | undefined;
};

const DEFAULT_MIN_SIZE = 4;
export const MAX_TRANSFORM_SIZE = 20_000;

/**
 * Applies a drag of one handle to a frame.
 *
 * Returns the frame the layer would have if the gesture ended here. Purely a function of the
 * original frame and the total delta, so replaying the same delta always produces the same result
 * and a gesture cannot accumulate floating-point drift.
 */
export function resizeFrame(
  frame: Rect,
  handle: TransformHandle,
  delta: Point,
  options: TransformOptions = {},
): Rect {
  const minSize = options.minSize ?? DEFAULT_MIN_SIZE;
  const maxSize = options.maxSize ?? MAX_TRANSFORM_SIZE;

  const anchor = HANDLE_ANCHORS[handle];
  const movesLeft = anchor.x === 0;
  const movesRight = anchor.x === 1;
  const movesTop = anchor.y === 0;
  const movesBottom = anchor.y === 1;

  // Edges that do not move stay pinned; the opposite edge follows the pointer.
  let left = frame.x;
  let right = frame.x + frame.width;
  let top = frame.y;
  let bottom = frame.y + frame.height;

  if (options.resizeFromCentre) {
    if (movesLeft) {
      left = frame.x + delta.x;
      right = frame.x + frame.width - delta.x;
    } else if (movesRight) {
      right = frame.x + frame.width + delta.x;
      left = frame.x - delta.x;
    }
    if (movesTop) {
      top = frame.y + delta.y;
      bottom = frame.y + frame.height - delta.y;
    } else if (movesBottom) {
      bottom = frame.y + frame.height + delta.y;
      top = frame.y - delta.y;
    }
  } else {
    if (movesLeft) left = frame.x + delta.x;
    if (movesRight) right = frame.x + frame.width + delta.x;
    if (movesTop) top = frame.y + delta.y;
    if (movesBottom) bottom = frame.y + frame.height + delta.y;
  }

  let width = Math.max(minSize, Math.min(maxSize, right - left));
  let height = Math.max(minSize, Math.min(maxSize, bottom - top));

  if (options.preserveAspectRatio && frame.width > 0 && frame.height > 0) {
    const ratio = frame.width / frame.height;
    const horizontalDominant = Math.abs(delta.x) >= Math.abs(delta.y);
    const hasHorizontalHandle = movesLeft || movesRight;
    const hasVerticalHandle = movesTop || movesBottom;

    if (hasHorizontalHandle && (!hasVerticalHandle || horizontalDominant)) {
      height = Math.max(minSize, Math.min(maxSize, width / ratio));
    } else if (hasVerticalHandle) {
      width = Math.max(minSize, Math.min(maxSize, height * ratio));
    }
    // Re-anchor the edge that must stay put after the driven dimension changed.
    if (movesLeft) {
      left = options.resizeFromCentre ? frame.x + frame.width / 2 - width / 2 : right - width;
    } else if (movesRight) {
      right = options.resizeFromCentre ? frame.x + frame.width / 2 + width / 2 : left + width;
    } else {
      left = frame.x + (frame.width - width) / 2;
    }
    if (movesTop) {
      top = options.resizeFromCentre ? frame.y + frame.height / 2 - height / 2 : bottom - height;
    } else if (movesBottom) {
      bottom = options.resizeFromCentre ? frame.y + frame.height / 2 + height / 2 : top + height;
    } else {
      top = frame.y + (frame.height - height) / 2;
    }
    return createRect(left, top, width, height);
  }

  if (movesLeft) left = right - width;
  if (movesTop) top = bottom - height;
  if (options.resizeFromCentre) {
    left = frame.x + (frame.width - width) / 2;
    top = frame.y + (frame.height - height) / 2;
  }

  return createRect(left, top, width, height);
}

/* ---------------------------------------------------------------------------------------------- */
/* Group transforms                                                                                */
/* ---------------------------------------------------------------------------------------------- */

/** A frame a gesture can transform, identified so the result can be committed per layer. */
export type TransformTarget = {
  readonly id: LayerId;
  readonly frame: Rect;
};

/**
 * A uniform scale about a fixed point, applied to every frame inside a selection.
 *
 * A multi-layer resize cannot be a per-layer `resizeFrame` call: each layer has its own pinned
 * edges, so resizing two layers independently would distort their relative arrangement. One scale
 * about one origin keeps the group's internal spacing and proportions, which is what the visible
 * bounding-box handles promise.
 */
export type GroupTransform = {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly origin: Point;
};

/** Kills floating-point dust so a clean drag produces clean numbers (301, not 301.00000000000006). */
function clean(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * The fixed point of a handle drag: the edge (or, from the centre, the midpoint) that does not move.
 *
 * For a vertical-only handle the horizontal scale is 1, so the horizontal origin is irrelevant to
 * the result unless `preserveAspectRatio` re-centres the box - which the centre reproduces exactly.
 */
function fixedOrigin(start: Rect, handle: TransformHandle, fromCentre: boolean): Point {
  const anchor = HANDLE_ANCHORS[handle];
  if (fromCentre) {
    return { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  }
  return {
    x:
      anchor.x === 0 ? start.x + start.width : anchor.x === 1 ? start.x : start.x + start.width / 2,
    y:
      anchor.y === 0
        ? start.y + start.height
        : anchor.y === 1
          ? start.y
          : start.y + start.height / 2,
  };
}

/** The scale a handle drag implies for the whole selection box. */
export function groupTransformForHandle(
  start: Rect,
  handle: TransformHandle,
  delta: Point,
  options: TransformOptions = {},
): GroupTransform {
  const next = resizeFrame(start, handle, delta, options);
  return {
    scaleX: start.width === 0 ? 1 : next.width / start.width,
    scaleY: start.height === 0 ? 1 : next.height / start.height,
    origin: fixedOrigin(start, handle, options.resizeFromCentre === true),
  };
}

/** Applies a group transform to one frame, with the same size clamps a single-layer resize uses. */
export function applyGroupTransform(
  frame: Rect,
  transform: GroupTransform,
  options: TransformOptions = {},
): Rect {
  const minSize = options.minSize ?? DEFAULT_MIN_SIZE;
  const maxSize = options.maxSize ?? MAX_TRANSFORM_SIZE;
  const { origin, scaleX, scaleY } = transform;
  return createRect(
    clean(origin.x + (frame.x - origin.x) * scaleX),
    clean(origin.y + (frame.y - origin.y) * scaleY),
    clean(Math.max(minSize, Math.min(maxSize, frame.width * scaleX))),
    clean(Math.max(minSize, Math.min(maxSize, frame.height * scaleY))),
  );
}

/** Applies one group transform to every target, preserving relative arrangement and order. */
export function transformTargets(
  targets: readonly TransformTarget[],
  transform: GroupTransform,
  options: TransformOptions = {},
): readonly TransformTarget[] {
  return targets.map((target) => ({
    id: target.id,
    frame: applyGroupTransform(target.frame, transform, options),
  }));
}

/**
 * A scale that maps one box onto another, about the source box's top-left corner.
 *
 * Used by the inspector, where a person types a width and height for the whole selection instead of
 * dragging a handle: the same maths, so the two paths cannot disagree.
 */
export function groupTransformToFit(from: Rect, to: Rect): GroupTransform {
  return {
    scaleX: from.width === 0 ? 1 : to.width / from.width,
    scaleY: from.height === 0 ? 1 : to.height / from.height,
    origin: { x: from.x, y: from.y },
  };
}

export const GRID_SNAP_DIVISIONS = [2, 3, 4, 6, 8, 12] as const;

/**
 * Snapping targets in document space.
 *
 * Built from the canvas bounds, the centre lines, optional thirds/fifths guides, the grid step and
 * every sibling layer's edges and centres. Because the targets are derived from the document, not
 * from the screen, snapping behaves identically at every zoom level.
 */
export type SnapTargets = {
  readonly vertical: readonly number[];
  readonly horizontal: readonly number[];
};

export type SnapTargetSource = {
  readonly canvas: Size;
  readonly gridMm: number;
  readonly pixelsPerMm: number;
  /** Layers to align against; the layers being dragged are excluded by the caller. */
  readonly siblings: readonly Layer[];
  readonly alignmentGuides: readonly number[];
};

export const SNAP_GUIDE_DIVISIONS = [3, 6] as const;
const MAX_TARGETS_PER_AXIS = 240;

/** Builds the deduplicated, sorted snap targets for a document. */
export function buildSnapTargets(source: SnapTargetSource): SnapTargets {
  const vertical = new Set<number>([0, source.canvas.width / 2, source.canvas.width]);
  const horizontal = new Set<number>([0, source.canvas.height / 2, source.canvas.height]);

  for (const division of GRID_SNAP_DIVISIONS) {
    vertical.add(round2((source.canvas.width * division) / 12));
    horizontal.add(round2((source.canvas.height * division) / 12));
  }

  for (const division of SNAP_GUIDE_DIVISIONS) {
    for (let step = 1; step < division; step += 1) {
      vertical.add(round2((source.canvas.width * step) / division));
      horizontal.add(round2((source.canvas.height * step) / division));
    }
  }

  for (const guide of source.alignmentGuides) {
    if (Number.isFinite(guide)) vertical.add(round2(guide));
  }

  const gridStep = source.gridMm * source.pixelsPerMm;
  if (Number.isFinite(gridStep) && gridStep > 1) {
    for (let position = gridStep; position < source.canvas.width; position += gridStep) {
      vertical.add(round2(position));
    }
    for (let position = gridStep; position < source.canvas.height; position += gridStep) {
      horizontal.add(round2(position));
    }
  }

  for (const layer of source.siblings) {
    const frame = layer.frame;
    for (const value of [frame.x, frame.x + frame.width / 2, frame.x + frame.width]) {
      vertical.add(round2(value));
    }
    for (const value of [frame.y, frame.y + frame.height / 2, frame.y + frame.height]) {
      horizontal.add(round2(value));
    }
  }

  return {
    vertical: sortedLimited(vertical, MAX_TARGETS_PER_AXIS),
    horizontal: sortedLimited(horizontal, MAX_TARGETS_PER_AXIS),
  };
}

function sortedLimited(values: Set<number>, limit: number): readonly number[] {
  const sorted = [...values].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length <= limit) return sorted;
  // Keep the outermost targets, which are the ones a user reaches for.
  const half = Math.floor(limit / 2);
  return [...sorted.slice(0, half), ...sorted.slice(-half)];
}

export type SnapAdjustment = {
  readonly delta: Point;
  /** Document-space vertical guide lines the frame landed on, for the on-screen hint. */
  readonly guidesX: readonly number[];
  readonly guidesY: readonly number[];
};

export type SnapInput = {
  /** Frame the layer would occupy if the gesture ended now, before snapping. */
  readonly frame: Rect;
  readonly targets: SnapTargets;
  /** Maximum distance in document pixels a value may move in order to snap. */
  readonly threshold: number;
  /** Handles whose edges are candidates. A move uses every edge; a resize uses the dragged edges. */
  readonly edges: readonly SnapEdge[];
  readonly enabled: boolean;
  readonly mode: 'move' | 'resize';
  /** For a resize, which handle is being dragged (decides which edges may move). */
  readonly handle?: TransformHandle | undefined;
};

export type SnapEdge = 'left' | 'centreX' | 'right' | 'top' | 'centreY' | 'bottom';

/**
 * Computes the snap adjustment for a frame.
 *
 * Candidate edges are matched against the target list; the closest match within the threshold on each
 * axis wins. Ties break towards the axis with the smaller move so a corner snap cannot pull a frame
 * further than necessary.
 */
export function computeSnap(input: SnapInput): SnapAdjustment {
  const none: SnapAdjustment = { delta: { x: 0, y: 0 }, guidesX: [], guidesY: [] };
  if (!input.enabled || input.threshold <= 0) return none;

  const frame = input.frame;
  const values: Record<SnapEdge, number> = {
    left: frame.x,
    centreX: frame.x + frame.width / 2,
    right: frame.x + frame.width,
    top: frame.y,
    centreY: frame.y + frame.height / 2,
    bottom: frame.y + frame.height,
  };

  const horizontalCandidates: { delta: number; guide: number }[] = [];
  const verticalCandidates: { delta: number; guide: number }[] = [];

  for (const edge of input.edges) {
    if (edge === 'left' || edge === 'centreX' || edge === 'right') {
      const value = values[edge];
      for (const target of input.targets.vertical) {
        const delta = target - value;
        if (Math.abs(delta) <= input.threshold) {
          horizontalCandidates.push({ delta, guide: target });
        }
      }
    } else {
      const value = values[edge];
      for (const target of input.targets.horizontal) {
        const delta = target - value;
        if (Math.abs(delta) <= input.threshold) {
          verticalCandidates.push({ delta, guide: target });
        }
      }
    }
  }

  const bestX = closest(horizontalCandidates);
  const bestY = closest(verticalCandidates);

  return {
    delta: { x: bestX ? round2(bestX.delta) : 0, y: bestY ? round2(bestY.delta) : 0 },
    guidesX: bestX ? [bestX.guide] : [],
    guidesY: bestY ? [bestY.guide] : [],
  };
}

function closest(
  candidates: readonly { delta: number; guide: number }[],
): { delta: number; guide: number } | null {
  let best: { delta: number; guide: number } | null = null;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.delta);
    if (!best || distance < Math.abs(best.delta)) best = candidate;
  }
  return best;
}

/** Edges that a move snaps: the frame's leading edge, centre and trailing edge on both axes. */
export const MOVE_SNAP_EDGES: readonly SnapEdge[] = [
  'left',
  'centreX',
  'right',
  'top',
  'centreY',
  'bottom',
];

/**
 * Edges that a given resize handle is allowed to snap.
 *
 * Only edges the handle actually *moves*. Snapping the frame's centre while dragging an edge would
 * translate the whole frame sideways, which is not what the gesture means — a right-edge drag must
 * change the width and nothing else.
 */
export function snapEdgesForHandle(handle: TransformHandle): readonly SnapEdge[] {
  const edges: SnapEdge[] = [];
  const anchor = HANDLE_ANCHORS[handle];
  if (anchor.x === 0) edges.push('left');
  if (anchor.x === 1) edges.push('right');
  if (anchor.y === 0) edges.push('top');
  if (anchor.y === 1) edges.push('bottom');
  return edges;
}

/** Snapping threshold in document pixels: constant on screen, so zoom never changes the feel. */
export function snapThresholdForZoom(zoom: number, screenPx = 6): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return screenPx;
  return screenPx / zoom;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Converts a pointer client position into document coordinates. */
export function toDocumentPoint(
  point: Point,
  origin: Point,
  zoom: number,
  scroll: Point = { x: 0, y: 0 },
): Point {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return {
    x: (point.x - origin.x + scroll.x) / scale,
    y: (point.y - origin.y + scroll.y) / scale,
  };
}
