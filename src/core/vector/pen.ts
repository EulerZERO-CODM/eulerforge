/**
 * The pen: a draft path being drawn.
 *
 * Drawing is a *transient* interaction with a real geometry state underneath, so the state lives here
 * as plain data — no DOM event, no React state, no pointer id. A caller feeds it points and drags and
 * gets back a path it can preview; nothing is added to the document until the draft is finished, and
 * an abandoned draft leaves no trace in the scene or in history.
 *
 * The shape of the interaction it models is the standard one, chosen because it is the one every
 * vector tool teaches:
 *
 *  - click places a corner node;
 *  - click-and-drag places a node *and* pulls its outgoing handle, mirroring the incoming one so the
 *    next segment leaves the node smoothly;
 *  - clicking the first node closes the contour;
 *  - Escape or Enter finishes the draft as an open path.
 *
 * The draft is a path, not a special case: `penPreview` returns ordinary kernel geometry, so the same
 * renderer that paints committed artwork paints the draft, and `penToPath` produces a value that can
 * go straight into a document.
 */

import {
  createContour,
  createPath,
  MAX_NODES_PER_CONTOUR,
  type PathNode,
  type VectorPath,
  type VectorPoint,
} from './types';
import { err, forgeError, ok, type Result } from '../result';

export type PenDraft = {
  /** Placed nodes. An empty draft has not started. */
  readonly nodes: readonly PathNode[];
  /** True once the contour has been closed back to its first node. */
  readonly closed: boolean;
  /** Where the pointer is now, for the rubber-band segment. `null` while a drag owns the pointer. */
  readonly pointer: VectorPoint | null;
  /** True while a pointer drag is pulling the handle of the most recently placed node. */
  readonly dragging: boolean;
  /** Handles are pulled at the pointer position, so a drag is the same distance as the pointer is. */
  readonly dragAnchor: VectorPoint | null;
};

export const EMPTY_PEN_DRAFT: PenDraft = Object.freeze({
  nodes: Object.freeze([]),
  closed: false,
  pointer: null,
  dragging: false,
  dragAnchor: null,
});

/** Tolerance for "the pointer is on that node": a click, not a drag. */
export const PEN_CLOSE_DISTANCE = 8;

/** Starts a draft with one corner node at `point`. */
export function penStart(point: VectorPoint): PenDraft {
  return Object.freeze({
    nodes: Object.freeze([cornerNode(point)]),
    closed: false,
    pointer: point,
    dragging: true,
    dragAnchor: point,
  });
}

/**
 * Places another node at `point`.
 *
 * A closed draft is not extended: the contour has already returned to its first node, so the only
 * meaningful next action is to finish or to start a new one. The caller decides which; silently
 * adding nodes after a close would produce a path whose last segment doubles back over the first.
 */
export function penAddNode(draft: PenDraft, point: VectorPoint): PenDraft {
  if (draft.closed) return draft;
  if (draft.nodes.length >= MAX_NODES_PER_CONTOUR) return draft;
  return Object.freeze({
    nodes: Object.freeze([...draft.nodes, cornerNode(point)]),
    closed: false,
    pointer: point,
    dragging: true,
    dragAnchor: point,
  });
}

/**
 * Pulls the outgoing handle of the newest node to `to`, mirroring the incoming handle.
 *
 * This is what a click-drag does: the segment *before* the node curves as well as the one after it,
 * which is the behaviour that makes a pen tool feel like a pen. Dragging back to the anchor removes
 * the handles again, so a drag that turns out to be a click leaves a corner.
 */
export function penDragHandle(draft: PenDraft, to: VectorPoint): PenDraft {
  const index = draft.nodes.length - 1;
  const node = draft.nodes[index];
  if (!node || draft.nodes.length === 0) return draft;

  const distance = Math.hypot(to.x - node.point.x, to.y - node.point.y);
  const updated: PathNode =
    distance <= 0.001
      ? cornerNode(node.point)
      : {
          point: node.point,
          handleOut: { x: to.x, y: to.y },
          // The incoming handle mirrors the outgoing one: the node is smooth in the sense the pen
          // tool means, without a separate "make smooth" step.
          handleIn: { x: 2 * node.point.x - to.x, y: 2 * node.point.y - to.y },
        };

  return Object.freeze({
    ...draft,
    nodes: Object.freeze(
      draft.nodes.map((candidate, position) => (position === index ? updated : candidate)),
    ),
    pointer: null,
    dragging: true,
    dragAnchor: draft.dragAnchor ?? node.point,
  });
}

/** Ends a drag: the handle stays where the pointer left it, and the rubber band resumes. */
export function penEndDrag(draft: PenDraft): PenDraft {
  if (!draft.dragging) return draft;
  return Object.freeze({ ...draft, dragging: false, dragAnchor: null, pointer: null });
}

/** Moves the rubber-band end of the path. Ignored while a drag is in flight. */
export function penSetPointer(draft: PenDraft, point: VectorPoint): PenDraft {
  if (draft.dragging || draft.closed) return draft;
  return Object.freeze({ ...draft, pointer: point });
}

/** True when `point` is close enough to the first node to close the contour by clicking it. */
export function penCanClose(
  draft: PenDraft,
  point: VectorPoint,
  distance = PEN_CLOSE_DISTANCE,
): boolean {
  const first = draft.nodes[0];
  if (!first || draft.nodes.length < 3 || draft.closed) return false;
  return Math.hypot(point.x - first.point.x, point.y - first.point.y) <= distance;
}

/** Closes the contour. Refused below three nodes, which is not a shape but a line. */
export function penClose(draft: PenDraft): PenDraft {
  if (draft.nodes.length < 3 || draft.closed) return draft;
  return Object.freeze({
    ...draft,
    closed: true,
    dragging: false,
    dragAnchor: null,
    pointer: null,
  });
}

/**
 * Turns the draft into a path.
 *
 * Refuses a draft with fewer than two nodes: one node is a point, and committing it would create a
 * layer whose bounds are empty and whose export is invisible. The error says so instead.
 */
export function penToPath(draft: PenDraft): Result<VectorPath> {
  if (draft.nodes.length < 2) {
    return err(
      forgeError('validation-failed', 'A path needs at least two nodes.', {
        detail: 'Click again to place another node, or press Escape to abandon the shape.',
        retryable: false,
      }),
    );
  }
  return ok(createPath([createContour(draft.nodes, draft.closed)]));
}

/**
 * The path as it should be painted right now: placed segments plus, when the pointer is somewhere
 * useful, one rubber-band segment to where the pointer is.
 *
 * Returns `null` for a draft with nothing to show, so a caller can skip painting entirely.
 */
export function penPreview(draft: PenDraft): VectorPath | null {
  if (draft.nodes.length === 0) return null;
  const nodes: PathNode[] = [...draft.nodes];
  if (!draft.closed && draft.pointer && !draft.dragging && draft.nodes.length >= 1) {
    nodes.push(cornerNode(draft.pointer));
  }
  if (nodes.length === 1) return null;
  return createPath([createContour(nodes, draft.closed)]);
}

/** Number of placed nodes, for status text. */
export function penNodeCount(draft: PenDraft): number {
  return draft.nodes.length;
}

function cornerNode(point: VectorPoint): PathNode {
  return { point: { x: point.x, y: point.y }, handleIn: null, handleOut: null };
}
