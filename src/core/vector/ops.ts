/**
 * Editing operations on paths.
 *
 * Node editing, handle dragging and node insertion are geometry, not interface: they are here so
 * they can be tested without a pointer, and so the interface only has to decide *which* node the
 * user meant. Every function returns a new path (or a `Result` when the edit is not possible) and
 * refuses to change anything it cannot express.
 */

import { boundsOfPath } from './bounds';
import { closestPointOnPath, insertNodeBetween, pointOnSegment } from './flatten';
import { allSegments, segmentsOf } from './path';
import { TOLERANCE, type Tolerance } from './tolerance';
import {
  createContour,
  createPath,
  samePoint,
  type Contour,
  type PathNode,
  type VectorBox,
  type VectorPath,
  type VectorPoint,
} from './types';
import { matrixBetweenBoxes, transformPath } from './transform';
import { err, forgeError, ok, type Result } from '../result';

export type HandleSide = 'in' | 'out';

/** How far a handle drag is allowed to pull the opposite handle. */
export type HandleMirroring = 'none' | 'opposite';

function requireNode(
  path: VectorPath,
  contourIndex: number,
  nodeIndex: number,
): Result<{ readonly contour: Contour; readonly node: PathNode }> {
  const contour = path.contours[contourIndex];
  if (!contour) {
    return err(forgeError('not-found', `Contour ${contourIndex} does not exist.`));
  }
  const node = contour.nodes[nodeIndex];
  if (!node) {
    return err(
      forgeError('not-found', `Node ${nodeIndex} does not exist in contour ${contourIndex}.`),
    );
  }
  return ok({ contour, node });
}

function replaceNode(
  path: VectorPath,
  contourIndex: number,
  nodeIndex: number,
  next: PathNode,
): VectorPath {
  return createPath(
    path.contours.map((contour, index) =>
      index === contourIndex
        ? createContour(
            contour.nodes.map((node, position) => (position === nodeIndex ? next : node)),
            contour.closed,
          )
        : contour,
    ),
  );
}

/** Moves one node, carrying its handles: the node is dragged as a rigid unit. */
export function moveNode(
  path: VectorPath,
  contourIndex: number,
  nodeIndex: number,
  to: VectorPoint,
): Result<VectorPath> {
  const found = requireNode(path, contourIndex, nodeIndex);
  if (!found.ok) return err(found.error);
  const { node } = found.value;
  const dx = to.x - node.point.x;
  const dy = to.y - node.point.y;
  const shift = (candidate: VectorPoint | null): VectorPoint | null =>
    candidate === null ? null : { x: candidate.x + dx, y: candidate.y + dy };
  return ok(
    replaceNode(path, contourIndex, nodeIndex, {
      point: to,
      handleIn: shift(node.handleIn),
      handleOut: shift(node.handleOut),
    }),
  );
}

export function moveNodeBy(
  path: VectorPath,
  contourIndex: number,
  nodeIndex: number,
  dx: number,
  dy: number,
): Result<VectorPath> {
  const found = requireNode(path, contourIndex, nodeIndex);
  if (!found.ok) return err(found.error);
  const { node } = found.value;
  return moveNode(path, contourIndex, nodeIndex, { x: node.point.x + dx, y: node.point.y + dy });
}

/**
 * Moves a Bezier handle.
 *
 * `mirroring: 'opposite'` keeps the node smooth by placing the other handle on the same line at the
 * same distance — the behaviour a user expects when dragging a curve handle. `'none'` turns the node
 * into a corner. The choice is explicit rather than implied by a modifier key so the same geometry
 * can be produced by a keyboard user.
 */
export function moveHandle(
  path: VectorPath,
  contourIndex: number,
  nodeIndex: number,
  side: HandleSide,
  to: VectorPoint,
  mirroring: HandleMirroring = 'none',
): Result<VectorPath> {
  const found = requireNode(path, contourIndex, nodeIndex);
  if (!found.ok) return err(found.error);
  const { node } = found.value;

  const opposite = side === 'in' ? node.handleOut : node.handleIn;
  let mirrored: VectorPoint | null = opposite === null ? null : { ...opposite };
  if (
    mirroring === 'opposite' &&
    opposite !== null &&
    samePoint(node.point, to, TOLERANCE.point) === false
  ) {
    const dx = node.point.x - to.x;
    const dy = node.point.y - to.y;
    mirrored = { x: node.point.x + dx, y: node.point.y + dy };
  }

  const next: PathNode =
    side === 'in'
      ? { point: node.point, handleIn: to, handleOut: mirrored }
      : { point: node.point, handleIn: mirrored, handleOut: to };

  return ok(replaceNode(path, contourIndex, nodeIndex, next));
}

/** Sets a node's handles directly (used by the inspector's numeric fields). */
export function setNodeHandles(
  path: VectorPath,
  contourIndex: number,
  nodeIndex: number,
  handles: { readonly handleIn: VectorPoint | null; readonly handleOut: VectorPoint | null },
): Result<VectorPath> {
  const found = requireNode(path, contourIndex, nodeIndex);
  if (!found.ok) return err(found.error);
  return ok(
    replaceNode(path, contourIndex, nodeIndex, {
      point: found.value.node.point,
      handleIn: handles.handleIn,
      handleOut: handles.handleOut,
    }),
  );
}

export type NodeKind = 'corner' | 'smooth';

/**
 * Converts a node between corner and smooth.
 *
 * A corner drops both handles (the adjoining segments become straight). A smooth node gets handles
 * along the average direction of its neighbours at a third of the distance to each — the classic
 * "make smooth" result, and one that is visible immediately rather than a flag the renderer ignores.
 */
export function setNodeKind(
  path: VectorPath,
  contourIndex: number,
  nodeIndex: number,
  kind: NodeKind,
): Result<VectorPath> {
  const found = requireNode(path, contourIndex, nodeIndex);
  if (!found.ok) return err(found.error);
  const { contour, node } = found.value;

  if (kind === 'corner') {
    return ok(
      replaceNode(path, contourIndex, nodeIndex, {
        point: node.point,
        handleIn: null,
        handleOut: null,
      }),
    );
  }

  const count = contour.nodes.length;
  const previous = contour.nodes[(nodeIndex - 1 + count) % count];
  const next = contour.nodes[(nodeIndex + 1) % count];
  if (!previous || !next) {
    return err(forgeError('validation-failed', 'A node needs two neighbours to become smooth.'));
  }

  // Direction of the smoothing tangent. An open contour's first and last nodes have only one
  // real neighbour, so their tangent points along the segment they actually have — averaging with
  // the far end of an open path would aim the handle backwards.
  const isFirst = nodeIndex === 0;
  const isLast = nodeIndex === count - 1;
  const direction = contour.closed
    ? { x: next.point.x - previous.point.x, y: next.point.y - previous.point.y }
    : isFirst
      ? { x: next.point.x - node.point.x, y: next.point.y - node.point.y }
      : isLast
        ? { x: node.point.x - previous.point.x, y: node.point.y - previous.point.y }
        : { x: next.point.x - previous.point.x, y: next.point.y - previous.point.y };

  const length = Math.hypot(direction.x, direction.y);
  if (length <= TOLERANCE.point) {
    return err(
      forgeError(
        'validation-failed',
        'The neighbouring nodes are at the same place, so there is no direction to smooth along.',
      ),
    );
  }
  const unit = { x: direction.x / length, y: direction.y / length };
  const inLength = Math.hypot(node.point.x - previous.point.x, node.point.y - previous.point.y) / 3;
  const outLength = Math.hypot(next.point.x - node.point.x, next.point.y - node.point.y) / 3;
  const wantsBothHandles = contour.closed || (!isFirst && !isLast);

  return ok(
    replaceNode(path, contourIndex, nodeIndex, {
      point: node.point,
      // An open contour's first node has no incoming segment, so it gets no incoming handle.
      handleIn: wantsBothHandles
        ? { x: node.point.x - unit.x * inLength, y: node.point.y - unit.y * inLength }
        : null,
      handleOut: { x: node.point.x + unit.x * outLength, y: node.point.y + unit.y * outLength },
    }),
  );
}

/**
 * Deletes a node.
 *
 * The contour loses a node; if fewer than three nodes would remain in a closed contour it is opened
 * instead of silently becoming an unrenderable shape, and a contour with no nodes is dropped
 * entirely. The result says which of those happened.
 */
export type DeleteNodeOutcome = {
  readonly path: VectorPath;
  readonly removedContour: boolean;
  readonly openedContour: boolean;
};

export function deleteNode(
  path: VectorPath,
  contourIndex: number,
  nodeIndex: number,
): Result<DeleteNodeOutcome> {
  const found = requireNode(path, contourIndex, nodeIndex);
  if (!found.ok) return err(found.error);
  const contour = found.value.contour;

  const remaining = contour.nodes.filter((_node, index) => index !== nodeIndex);
  if (remaining.length === 0) {
    return ok({
      path: createPath(path.contours.filter((_candidate, index) => index !== contourIndex)),
      removedContour: true,
      openedContour: false,
    });
  }

  const mustOpen = contour.closed && remaining.length < 3;
  const nextContour = createContour(remaining, mustOpen ? false : contour.closed);
  return ok({
    path: createPath(
      path.contours.map((candidate, index) => (index === contourIndex ? nextContour : candidate)),
    ),
    removedContour: false,
    openedContour: mustOpen,
  });
}

export type InsertNodeOutcome = {
  readonly path: VectorPath;
  readonly contourIndex: number;
  readonly nodeIndex: number;
  readonly distance: number;
  /** True when the pointer was further from the path than the tolerance allows. */
  readonly refused: boolean;
};

/**
 * Inserts a node on the segment nearest to `at`.
 *
 * The split is exact (de Casteljau), so clicking on a curve to add a node never changes its shape —
 * which is what makes "add a node" safe to do while looking at the result.
 */
export function insertNodeAt(
  path: VectorPath,
  at: VectorPoint,
  tolerance: Tolerance = TOLERANCE,
  maxDistance: number = tolerance.flatten * 200,
): Result<InsertNodeOutcome> {
  const closest = closestPointOnPath(path, at);
  if (!closest) {
    return err(forgeError('not-found', 'There is no path here to add a node to.'));
  }
  if (closest.distance > maxDistance) {
    return ok({
      path,
      contourIndex: closest.contourIndex,
      nodeIndex: -1,
      distance: closest.distance,
      refused: true,
    });
  }

  const contour = path.contours[closest.contourIndex];
  if (!contour) {
    return err(forgeError('not-found', `Contour ${closest.contourIndex} does not exist.`));
  }
  const nodes = insertNodeBetween(contour.nodes, closest.segmentIndex, closest.t, contour.closed);
  if (!nodes) {
    return err(forgeError('validation-failed', 'The segment could not be split.'));
  }

  const nextPath = createPath(
    path.contours.map((candidate, index) =>
      index === closest.contourIndex ? createContour(nodes, candidate.closed) : candidate,
    ),
  );
  const insertedIndex =
    contour.closed && closest.segmentIndex === contour.nodes.length - 1
      ? contour.nodes.length
      : closest.segmentIndex + 1;

  return ok({
    path: nextPath,
    contourIndex: closest.contourIndex,
    nodeIndex: insertedIndex,
    distance: closest.distance,
    refused: false,
  });
}

/**
 * Removes nodes that add nothing: consecutive nodes closer together than `tolerance`, and nodes
 * lying on the straight line between their neighbours.
 *
 * There is no hiding here: the tolerance is a parameter, the caller decides whether to run it, and
 * the operation is only ever applied to polygonal geometry where "collinear" is exact.
 */
export function simplifyPath(path: VectorPath, tolerance: number = TOLERANCE.point): VectorPath {
  const contours = path.contours.map((contour) => {
    const input = contour.nodes;
    if (input.length === 0) return contour;
    const kept: PathNode[] = [];
    for (const node of input) {
      const previous = kept[kept.length - 1];
      if (previous && samePoint(previous.point, node.point, tolerance)) continue;
      kept.push(node);
    }
    if (contour.closed) {
      // Collinear removal, skipping nodes that carry curve handles: those are real geometry.
      let changed = true;
      while (changed && kept.length > 3) {
        changed = false;
        for (let index = 0; index < kept.length; index += 1) {
          const current = kept[index];
          const previous = kept[(index - 1 + kept.length) % kept.length];
          const next = kept[(index + 1) % kept.length];
          if (!current || !previous || !next) continue;
          if (current.handleIn !== null || current.handleOut !== null) continue;
          if (isCollinear(previous.point, current.point, next.point, tolerance)) {
            kept.splice(index, 1);
            changed = true;
            break;
          }
        }
      }
      const first = kept[0];
      const last = kept[kept.length - 1];
      if (kept.length > 1 && first && last && samePoint(first.point, last.point, tolerance))
        kept.pop();
    }
    return createContour(kept, contour.closed);
  });

  const filtered = contours.filter((contour) => contour.nodes.length > 0);
  return createPath(filtered);
}

function isCollinear(a: VectorPoint, b: VectorPoint, c: VectorPoint, tolerance: number): boolean {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const length = Math.hypot(c.x - a.x, c.y - a.y);
  if (length <= tolerance) return true;
  return Math.abs(cross) / length <= tolerance;
}

/**
 * Scales and moves a path so its bounds match `target`.
 *
 * Refuses when the source has no extent (a single point or a straight line has zero width or
 * height), because the scale factor would be infinite — the caller reports that instead of storing
 * `Infinity` in a document.
 */
export function fitPathIntoBox(path: VectorPath, target: VectorBox): Result<VectorPath> {
  const source = boundsOfPath(path);
  if (!source) {
    return err(forgeError('validation-failed', 'This path has no geometry to fit into a box.'));
  }
  const matrix = matrixBetweenBoxes(source, target);
  if (!matrix) {
    return err(
      forgeError(
        'validation-failed',
        'This path has no width or no height, so it cannot be scaled into a box.',
        { detail: 'Give the shape some extent first, or scale it with a proportional handle.' },
      ),
    );
  }
  return ok(transformPath(path, matrix));
}

/** Total number of segments a path draws; shown in the inspector. */
export function segmentCount(path: VectorPath): number {
  return allSegments(path).length;
}

/** The point halfway along a contour's segment, used to show a "click here to add a node" hint. */
export function midpointOfSegment(contour: Contour, segmentIndex: number): VectorPoint | null {
  const segments = segmentsOf(contour);
  const segment = segments[segmentIndex];
  if (!segment) return null;
  return pointOnSegment(segment, 0.5);
}
