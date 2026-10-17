/**
 * Picking inside a path: which node, handle or segment is under the pointer.
 *
 * This is deliberately separate from `hit.ts`, which answers "does this shape cover that point" — the
 * question a select gesture asks. Editing asks a different question: "what part of this outline is
 * the pointer near", and the answer has to prefer the smallest target, because a handle sits on top
 * of its node and a node sits on top of the segment it joins. Getting that order wrong makes handles
 * impossible to grab, so it is written down here and tested rather than left to each call site.
 *
 * Every distance is in the path's own units. A caller working at a zoom passes a tolerance already
 * divided by that zoom, which is how "eight screen pixels" stays eight screen pixels at 400%.
 */

import { distance, closestPointOnPath } from './flatten';
import { segmentsOf } from './path';
import type { HandleSide } from './ops';
import type { VectorBox, VectorPath, VectorPoint } from './types';

/** Default pick radius in path units. A caller at zoom `z` passes `PICK_RADIUS / z`. */
export const PICK_RADIUS = 6;

export type NodeReference = {
  readonly contourIndex: number;
  readonly nodeIndex: number;
};

export type PickTarget =
  | ({ readonly kind: 'node'; readonly point: VectorPoint } & NodeReference)
  | ({
      readonly kind: 'handle';
      readonly side: HandleSide;
      readonly point: VectorPoint;
    } & NodeReference)
  | {
      readonly kind: 'segment';
      readonly contourIndex: number;
      readonly segmentIndex: number;
      readonly t: number;
      readonly point: VectorPoint;
      readonly distance: number;
    };

export type PickOptions = {
  /** Pick radius in path units. */
  readonly radius?: number | undefined;
  /** Whether handles are candidates at all; the node tool shows them, the select tool does not. */
  readonly includeHandles?: boolean | undefined;
  /** Whether a point on the outline is a candidate, which is how "insert a node" is offered. */
  readonly includeSegments?: boolean | undefined;
  /** Restrict picking to one node, so a drag that started on a node keeps following that node. */
  readonly only?: NodeReference | undefined;
};

/**
 * The node, handle or segment nearest `point`, preferring smaller targets.
 *
 * Order matters and is the documented contract: handle, then node, then segment. A node's handle is
 * therefore always grabbable even when it lies exactly under the node, and a segment is only picked
 * where no node or handle is within reach.
 */
export function pickPathTarget(
  path: VectorPath,
  point: VectorPoint,
  options: PickOptions = {},
): PickTarget | null {
  const radius = options.radius ?? PICK_RADIUS;
  const includeHandles = options.includeHandles ?? false;
  const includeSegments = options.includeSegments ?? true;

  if (includeHandles) {
    const handle = nearestHandle(path, point, radius, options.only);
    if (handle) return handle;
  }

  const node = nearestNode(path, point, radius, options.only);
  if (node) return node;

  if (!includeSegments) return null;

  const closest = closestPointOnPath(path, point);
  if (!closest || closest.distance > radius) return null;
  return {
    kind: 'segment',
    contourIndex: closest.contourIndex,
    segmentIndex: closest.segmentIndex,
    t: closest.t,
    point: closest.point,
    distance: closest.distance,
  };
}

function nearestNode(
  path: VectorPath,
  point: VectorPoint,
  radius: number,
  only?: NodeReference,
): PickTarget | null {
  let best: PickTarget | null = null;
  let bestDistance = radius;
  path.contours.forEach((contour, contourIndex) => {
    contour.nodes.forEach((node, nodeIndex) => {
      if (only && (only.contourIndex !== contourIndex || only.nodeIndex !== nodeIndex)) return;
      const candidate = distance(node.point, point);
      if (candidate > bestDistance) return;
      bestDistance = candidate;
      best = { kind: 'node', contourIndex, nodeIndex, point: node.point };
    });
  });
  return best;
}

function nearestHandle(
  path: VectorPath,
  point: VectorPoint,
  radius: number,
  only?: NodeReference,
): PickTarget | null {
  let best: PickTarget | null = null;
  let bestDistance = radius;
  path.contours.forEach((contour, contourIndex) => {
    contour.nodes.forEach((node, nodeIndex) => {
      if (only && (only.contourIndex !== contourIndex || only.nodeIndex !== nodeIndex)) return;
      for (const side of ['in', 'out'] as const) {
        const handle = side === 'in' ? node.handleIn : node.handleOut;
        if (!handle) continue;
        const candidate = distance(handle, point);
        if (candidate > bestDistance) continue;
        bestDistance = candidate;
        best = { kind: 'handle', contourIndex, nodeIndex, side, point: handle };
      }
    });
  });
  return best;
}

/** Every node inside `box`, for a marquee in node mode. */
export function nodesInBox(path: VectorPath, box: VectorBox): readonly NodeReference[] {
  const found: NodeReference[] = [];
  path.contours.forEach((contour, contourIndex) => {
    contour.nodes.forEach((node, nodeIndex) => {
      const { x, y } = node.point;
      if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY) return;
      found.push({ contourIndex, nodeIndex });
    });
  });
  return found;
}

/**
 * The point where a node would be inserted by clicking `at`, or `null` when the click is too far from
 * the outline. Used to draw the insertion marker, so what the marker promises is exactly what the
 * command will do.
 */
export function insertionPointFor(
  path: VectorPath,
  at: VectorPoint,
  radius: number = PICK_RADIUS,
): {
  readonly contourIndex: number;
  readonly segmentIndex: number;
  readonly t: number;
  readonly point: VectorPoint;
} | null {
  const closest = closestPointOnPath(path, at);
  if (!closest || closest.distance > radius) return null;
  return {
    contourIndex: closest.contourIndex,
    segmentIndex: closest.segmentIndex,
    t: closest.t,
    point: closest.point,
  };
}

/** True when two references are the same node. */
export function sameNode(a: NodeReference, b: NodeReference): boolean {
  return a.contourIndex === b.contourIndex && a.nodeIndex === b.nodeIndex;
}

/** Stable key for a node reference, for React keys and for de-duplicating selections. */
export function nodeKey(reference: NodeReference): string {
  return `${String(reference.contourIndex)}:${String(reference.nodeIndex)}`;
}

/**
 * Every node of a path, in contour order. Used by "select all nodes" and by the keyboard path that
 * moves a whole shape node by node.
 */
export function allNodes(path: VectorPath): readonly NodeReference[] {
  const found: NodeReference[] = [];
  path.contours.forEach((contour, contourIndex) => {
    contour.nodes.forEach((_node, nodeIndex) => found.push({ contourIndex, nodeIndex }));
  });
  return found;
}

/**
 * Handles whose segments are curved, with their sides: what the outline draws in node mode.
 *
 * Straight segments have no handles, so a corner node shows only its point — which is the visual
 * answer to "why can I not pull a handle here": there is none until the node is made smooth or a
 * handle is dragged out of it.
 */
export function visibleHandles(
  path: VectorPath,
): readonly ({ readonly side: HandleSide } & NodeReference)[] {
  const out: ({ readonly side: HandleSide } & NodeReference)[] = [];
  path.contours.forEach((contour, contourIndex) => {
    contour.nodes.forEach((node, nodeIndex) => {
      if (node.handleIn) out.push({ contourIndex, nodeIndex, side: 'in' });
      if (node.handleOut) out.push({ contourIndex, nodeIndex, side: 'out' });
    });
  });
  return out;
}

/** Segment count of a path, for status text. */
export function segmentTotal(path: VectorPath): number {
  return path.contours.reduce((total, contour) => total + segmentsOf(contour).length, 0);
}
