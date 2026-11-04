/**
 * The vector domain model.
 *
 * A path is a list of contours; a contour is a list of nodes; a node is a point plus up to two
 * Bezier handles. That is the whole model. It is deliberately *not* SVG: SVG path data is one
 * serialisation of this model, not its definition, so the same geometry can be drawn into a canvas,
 * serialised as SVG, flattened for boolean operations or hit-tested without any of those layers
 * knowing about the others (ADR-0020).
 *
 * Two decisions are worth stating because everything downstream depends on them:
 *
 * 1. **Curves are cubic only.** Quadratic segments from SVG (`Q`, `T`) and elliptical arcs (`A`) are
 *    converted on import: a quadratic is exactly representable as a cubic, and an arc is
 *    approximated within a documented tolerance. Keeping one curve type means every operation,
 *    tolerance and test is written once.
 * 2. **Handles are absolute points.** A handle is a control point in the same coordinate space as
 *    its node, not a delta. Absolute handles make transforms, hit-testing and serialisation
 *    straightforward, and make a node's own record self-describing.
 *
 * Everything here is framework-free data: no DOM, no React, no storage. Like the rest of
 * `src/core/**` this module is imported by Node tests, by the server renderer and by the export
 * pipeline, none of which have a `document`.
 */

/** A point in the path's own coordinate space. */
export type VectorPoint = {
  readonly x: number;
  readonly y: number;
};

/**
 * One node of a contour.
 *
 * `handleIn` controls the segment arriving at this node, `handleOut` the segment leaving it. `null`
 * means "no handle", which makes the adjoining segment straight — the distinction between a corner
 * node and a smooth node, kept explicit rather than implied by a tangent calculation.
 */
export type PathNode = {
  readonly point: VectorPoint;
  readonly handleIn: VectorPoint | null;
  readonly handleOut: VectorPoint | null;
};

/**
 * A single subpath.
 *
 * `closed` adds the segment from the last node back to the first. The first node is never repeated
 * at the end: a closed contour with three nodes has three nodes, not four, which is what keeps node
 * editing and node counts honest.
 */
export type Contour = {
  readonly nodes: readonly PathNode[];
  readonly closed: boolean;
};

/** A path: zero or more contours. An empty path is a real state (no geometry), not an error. */
export type VectorPath = {
  readonly contours: readonly Contour[];
};

/** An axis-aligned box. `width`/`height` are never negative; an empty box has zero size. */
export type VectorBox = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/** How a self-intersecting contour decides what is "inside". */
export type FillRule = 'nonzero' | 'evenodd';

export const FILL_RULES: readonly FillRule[] = ['nonzero', 'evenodd'] as const;

export const FILL_RULE_LABELS: Readonly<Record<FillRule, string>> = {
  nonzero: 'Non-zero',
  evenodd: 'Even-odd',
};

/**
 * Segment between two nodes, as geometry rather than as data.
 *
 * Produced by `segmentsOf` so that bounds, flattening, hit-testing and serialisation all iterate the
 * same decomposition instead of each re-deriving "is this a line or a curve".
 */
export type PathSegment = {
  readonly kind: 'line' | 'cubic';
  readonly from: VectorPoint;
  readonly to: VectorPoint;
  /** Cubic only: the two control points. */
  readonly control1: VectorPoint | null;
  readonly control2: VectorPoint | null;
};

/**
 * Resource limits.
 *
 * A path arrives from user drawing, from an imported file or from local storage, so every collection
 * needs a bound or a malformed file can freeze the browser instead of failing cleanly. The numbers
 * are far above what hand-drawn iconography needs.
 */
export const MAX_CONTOURS = 400;
export const MAX_NODES_PER_CONTOUR = 4_000;
export const MAX_NODES_TOTAL = 40_000;
/** Coordinates may be negative (local space) but stay inside a sane numeric range. */
export const MAX_PATH_COORDINATE = 1_000_000;
export const MAX_HANDLE_DISTANCE = 1_000_000;

export function point(x: number, y: number): VectorPoint {
  return { x, y };
}

export function samePoint(a: VectorPoint, b: VectorPoint, tolerance: number): boolean {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

export function emptyPath(): VectorPath {
  return EMPTY_PATH;
}

/** Shared empty path so equality checks and memoisation have a stable identity. */
export const EMPTY_PATH: VectorPath = Object.freeze({ contours: Object.freeze([]) });

export function isPoint(value: unknown): value is VectorPoint {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { x?: unknown; y?: unknown };
  return typeof candidate.x === 'number' && typeof candidate.y === 'number';
}

/** Total node count, used by the resource limits and by the inspector. */
export function nodeCount(path: VectorPath): number {
  return path.contours.reduce((total, contour) => total + contour.nodes.length, 0);
}

export function isEmptyPath(path: VectorPath): boolean {
  return path.contours.every((contour) => contour.nodes.length === 0);
}

export function createNode(
  at: VectorPoint,
  handles: { readonly handleIn?: VectorPoint | null; readonly handleOut?: VectorPoint | null } = {},
): PathNode {
  const handleIn = handles.handleIn ?? null;
  const handleOut = handles.handleOut ?? null;
  return Object.freeze({ point: at, handleIn, handleOut });
}

export function createContour(nodes: readonly PathNode[], closed: boolean): Contour {
  return Object.freeze({ nodes: Object.freeze([...nodes]), closed });
}

export function createPath(contours: readonly Contour[]): VectorPath {
  return Object.freeze({ contours: Object.freeze([...contours]) });
}

/**
 * Deep-frozen copy of a path.
 *
 * Paths live inside documents, and documents are frozen so that a stored scene cannot be mutated
 * behind the history's back. `createPath` only freezes the outermost array, so anything crossing that
 * boundary goes through here: a frozen node is what makes "the document is immutable" true rather
 * than aspirational.
 */
export function freezePath(path: VectorPath): VectorPath {
  return Object.freeze({
    contours: Object.freeze(
      path.contours.map((contour) =>
        Object.freeze({
          closed: contour.closed,
          nodes: Object.freeze(
            contour.nodes.map((node) =>
              Object.freeze({
                point: Object.freeze({ x: node.point.x, y: node.point.y }),
                handleIn: node.handleIn
                  ? Object.freeze({ x: node.handleIn.x, y: node.handleIn.y })
                  : null,
                handleOut: node.handleOut
                  ? Object.freeze({ x: node.handleOut.x, y: node.handleOut.y })
                  : null,
              }),
            ),
          ),
        }),
      ),
    ),
  });
}
