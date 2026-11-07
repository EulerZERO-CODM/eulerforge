/**
 * Path structure: segments, validation and the small structural helpers everything else needs.
 *
 * A `VectorPath` is data; this module turns it into segments and checks that it is well formed.
 * Nothing here mutates: every function returns a new path or a `Result`.
 */

import {
  createContour,
  createPath,
  isEmptyPath,
  MAX_CONTOURS,
  MAX_HANDLE_DISTANCE,
  MAX_NODES_PER_CONTOUR,
  MAX_NODES_TOTAL,
  MAX_PATH_COORDINATE,
  nodeCount,
  samePoint,
  type Contour,
  type PathNode,
  type PathSegment,
  type VectorPath,
  type VectorPoint,
} from './types';
import { TOLERANCE, type Tolerance } from './tolerance';
import { err, forgeError, ok, type Result } from '../result';

/** Geometry issue kinds a caller can act on, rather than free-form strings. */
export type PathIssueCode =
  | 'empty'
  | 'no-nodes'
  | 'too-many-contours'
  | 'too-many-nodes'
  | 'non-finite'
  | 'out-of-range'
  | 'degenerate-contour'
  | 'duplicate-node'
  | 'zero-length-handle';

export type PathIssue = {
  readonly code: PathIssueCode;
  /** 0-based contour index, or null when the issue is about the path as a whole. */
  readonly contourIndex: number | null;
  /** 0-based node index, or null when the issue is about a whole contour. */
  readonly nodeIndex: number | null;
  readonly message: string;
  /** True when the geometry cannot be used at all; false when it is merely suspicious. */
  readonly severe: boolean;
};

function issue(
  code: PathIssueCode,
  message: string,
  options: {
    readonly contourIndex?: number | null;
    readonly nodeIndex?: number | null;
    readonly severe?: boolean;
  } = {},
): PathIssue {
  return {
    code,
    contourIndex: options.contourIndex ?? null,
    nodeIndex: options.nodeIndex ?? null,
    message,
    severe: options.severe ?? false,
  };
}

/**
 * Decomposes a contour into the segments a painter, a bounds calculation or a flattening step
 * iterates. A closed contour's last segment runs back to the first node; an open one does not.
 */
export function segmentsOf(contour: Contour): readonly PathSegment[] {
  const nodes = contour.nodes;
  if (nodes.length < 2) return [];

  const segments: PathSegment[] = [];
  const lastIndex = contour.closed ? nodes.length : nodes.length - 1;
  for (let index = 0; index < lastIndex; index += 1) {
    const from = nodes[index];
    const to = nodes[(index + 1) % nodes.length];
    if (!from || !to) continue;
    segments.push(segmentBetween(from, to));
  }
  return segments;
}

/** The segment from one node to the next, as a line unless a handle makes it a curve. */
export function segmentBetween(from: PathNode, to: PathNode): PathSegment {
  if (from.handleOut === null && to.handleIn === null) {
    return { kind: 'line', from: from.point, to: to.point, control1: null, control2: null };
  }
  return {
    kind: 'cubic',
    from: from.point,
    to: to.point,
    control1: from.handleOut ?? from.point,
    control2: to.handleIn ?? to.point,
  };
}

export function allSegments(path: VectorPath): readonly PathSegment[] {
  return path.contours.flatMap((contour) => [...segmentsOf(contour)]);
}

/** True when any contour contains a curve; used by inspectors and by the SVG size comparison. */
export function hasCurves(path: VectorPath): boolean {
  return allSegments(path).some((segment) => segment.kind === 'cubic');
}

export function isClosedContour(contour: Contour): boolean {
  return contour.closed;
}

/**
 * Validates a path against the structure rules and the resource limits.
 *
 * Returns *every* issue rather than the first, because an importer's error message is much more
 * useful when it can say "three contours have fewer than three nodes" than "the first one does".
 */
export function validatePath(
  path: VectorPath,
  tolerance: Tolerance = TOLERANCE,
): readonly PathIssue[] {
  const issues: PathIssue[] = [];

  if (isEmptyPath(path)) {
    issues.push(issue('empty', 'The path has no geometry.', { severe: true }));
    return issues;
  }
  if (path.contours.length > MAX_CONTOURS) {
    issues.push(
      issue('too-many-contours', `A path may hold at most ${MAX_CONTOURS} contours.`, {
        severe: true,
      }),
    );
  }
  if (nodeCount(path) > MAX_NODES_TOTAL) {
    issues.push(
      issue('too-many-nodes', `A path may hold at most ${MAX_NODES_TOTAL} nodes in total.`, {
        severe: true,
      }),
    );
  }

  path.contours.forEach((contour, contourIndex) => {
    if (contour.nodes.length === 0) {
      issues.push(
        issue('no-nodes', `Contour ${contourIndex} has no nodes.`, { contourIndex, severe: true }),
      );
      return;
    }
    if (contour.nodes.length > MAX_NODES_PER_CONTOUR) {
      issues.push(
        issue(
          'too-many-nodes',
          `Contour ${contourIndex} has more than ${MAX_NODES_PER_CONTOUR} nodes.`,
          { contourIndex, severe: true },
        ),
      );
    }
    if (contour.closed && contour.nodes.length < 3) {
      issues.push(
        issue(
          'degenerate-contour',
          `Closed contour ${contourIndex} has ${contour.nodes.length} node(s); a closed shape needs three.`,
          { contourIndex },
        ),
      );
    }

    contour.nodes.forEach((node, nodeIndex) => {
      const points: readonly (VectorPoint | null)[] = [node.point, node.handleIn, node.handleOut];
      points.forEach((candidate, pointIndex) => {
        if (candidate === null) return;
        const label =
          pointIndex === 0 ? 'node' : pointIndex === 1 ? 'incoming handle' : 'outgoing handle';
        if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) {
          issues.push(
            issue(
              'non-finite',
              `Contour ${contourIndex} ${label} ${nodeIndex} is not a finite point.`,
              {
                contourIndex,
                nodeIndex,
                severe: true,
              },
            ),
          );
          return;
        }
        const limit = pointIndex === 0 ? MAX_PATH_COORDINATE : MAX_HANDLE_DISTANCE;
        if (Math.abs(candidate.x) > limit || Math.abs(candidate.y) > limit) {
          issues.push(
            issue(
              'out-of-range',
              `Contour ${contourIndex} ${label} ${nodeIndex} is outside the supported coordinate range.`,
              { contourIndex, nodeIndex, severe: true },
            ),
          );
        }
      });

      const previous = contour.nodes[nodeIndex - 1];
      if (previous && samePoint(previous.point, node.point, tolerance.point)) {
        issues.push(
          issue(
            'duplicate-node',
            `Contour ${contourIndex} has two nodes at the same point (${node.point.x}, ${node.point.y}).`,
            { contourIndex, nodeIndex },
          ),
        );
      }
    });
  });

  return issues;
}

/** True when nothing about the path prevents geometry operations on it. */
export function isUsablePath(path: VectorPath, tolerance: Tolerance = TOLERANCE): boolean {
  return !validatePath(path, tolerance).some((entry) => entry.severe);
}

/** Every point mentioned by the path, in drawing order. Used by tests and by bounds fallbacks. */
export function pointsOf(path: VectorPath): readonly VectorPoint[] {
  return path.contours.flatMap((contour) =>
    contour.nodes.flatMap((node) =>
      node.handleIn === null && node.handleOut === null
        ? [node.point]
        : [node.point, node.handleIn, node.handleOut].filter(
            (candidate): candidate is VectorPoint => candidate !== null,
          ),
    ),
  );
}

/** Translates the whole path. Handles move with their node. */
export function translatePath(path: VectorPath, dx: number, dy: number): VectorPath {
  if (dx === 0 && dy === 0) return path;
  const shift = (candidate: VectorPoint | null): VectorPoint | null =>
    candidate === null ? null : { x: candidate.x + dx, y: candidate.y + dy };
  return createPath(
    path.contours.map((contour) =>
      createContour(
        contour.nodes.map((node) => ({
          point: { x: node.point.x + dx, y: node.point.y + dy },
          handleIn: shift(node.handleIn),
          handleOut: shift(node.handleOut),
        })),
        contour.closed,
      ),
    ),
  );
}

/**
 * Reverses a contour's direction, swapping handles so the shape is unchanged.
 *
 * Winding matters to the boolean kernel (outer contours and holes have opposite orientations) so
 * this is a real operation, not a cosmetic one.
 */
export function reverseContour(contour: Contour): Contour {
  return createContour(
    [...contour.nodes]
      .reverse()
      .map((node) => ({ point: node.point, handleIn: node.handleOut, handleOut: node.handleIn })),
    contour.closed,
  );
}

export function reversePath(path: VectorPath): VectorPath {
  return createPath(path.contours.map(reverseContour));
}

/** Opens a closed contour, or closes an open one. Refuses a close that would create a degenerate shape. */
export function setContourClosed(
  path: VectorPath,
  contourIndex: number,
  closed: boolean,
): Result<VectorPath> {
  const contour = path.contours[contourIndex];
  if (!contour) {
    return err(forgeError('not-found', `Contour ${contourIndex} does not exist.`));
  }
  if (closed && contour.nodes.length < 3) {
    return err(
      forgeError('validation-failed', 'A closed shape needs at least three nodes.', {
        detail: 'Add another node before closing the path.',
      }),
    );
  }
  return ok(
    createPath(
      path.contours.map((candidate, index) =>
        index === contourIndex ? createContour(candidate.nodes, closed) : candidate,
      ),
    ),
  );
}

/** Removes contours that carry no drawable geometry, keeping the rest in order. */
export function withoutEmptyContours(path: VectorPath): VectorPath {
  const contours = path.contours.filter((contour) => contour.nodes.length > 0);
  return contours.length === path.contours.length ? path : createPath(contours);
}
