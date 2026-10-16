/**
 * Boolean operations: union, subtraction, intersection and exclusive-or.
 *
 * ## Why a library, and which one
 *
 * Robust polygon clipping is a research-grade problem (degenerate overlaps, coincident edges, nearly
 * parallel segments, floating-point predicates). Writing one from scratch would put every icon in
 * this application at the mercy of a hand-rolled sweep line, so a mature implementation is used
 * instead: `polygon-clipping` (MIT, pure JavaScript, no DOM, deterministic). ADR-0021 records the
 * evaluation — the alternatives, the licence, and the edge cases it was tested against before it was
 * accepted as a dependency.
 *
 * The cost of that choice is stated rather than hidden: `polygon-clipping` clips *polygons*, so
 * curves are flattened to straight segments at a tolerance the caller sees, and every result carries
 * `tolerance`, `flattenedSegments` and `approximation` fields describing what was done. A boolean
 * result is therefore polygonal — it is a real shape, editable node by node, but it is no longer a
 * set of curves. The UI says so where the operation is offered.
 *
 * ## Input preparation
 *
 * 1. Each contour is flattened into a ring at the tolerance.
 * 2. Rings are classified into polygons by winding and containment: a positive-area ring starts a
 *    new polygon, a negative-area ring is attached as a hole to the smallest polygon containing it.
 *    This is what makes a compound path (an outer shape plus a hole) survive as one polygon instead
 *    of becoming two overlapping ones.
 * 3. Open contours are closed for the operation (SVG fills them that way) and the result says which
 *    contours were closed.
 *
 * ## Invalid input
 *
 * An empty path, a path whose contours enclose no area, or a path that fails the structural checks
 * is refused with an explanatory error rather than being fed to the library, whose behaviour on
 * degenerate input (empty output, or a result the caller cannot distinguish from "nothing
 * overlapped") would be impossible to report honestly.
 */

import * as clipping from 'polygon-clipping';

import { areaOfContour } from './area';
import { boundsOfPath } from './bounds';
import { flattenPath, type FlatContour } from './flatten';
import { isUsablePath } from './path';
import { TOLERANCE, type Tolerance } from './tolerance';
import { createContour, createPath, type VectorPath, type VectorPoint } from './types';
import { err, forgeError, ok, type Result } from '../result';

export type BooleanOperation = 'union' | 'subtract' | 'intersect' | 'exclude';

export const BOOLEAN_OPERATION_LABELS: Readonly<Record<BooleanOperation, string>> = {
  union: 'Unite',
  subtract: 'Subtract',
  intersect: 'Intersect',
  exclude: 'Exclude',
};

export const BOOLEAN_OPERATION_HINTS: Readonly<Record<BooleanOperation, string>> = {
  union: 'Merge the shapes into one outline.',
  subtract: 'Cut the later shapes out of the first one.',
  intersect: 'Keep only the area every shape covers.',
  exclude: 'Keep the area covered by an odd number of shapes.',
};

/** Tolerance of the flattening step, in the path's own units. */
export type BooleanOptions = {
  readonly tolerance?: number;
};

export type BooleanResult = {
  readonly path: VectorPath;
  readonly operation: BooleanOperation;
  /**
   * How the result was produced. `flattened-polygons` is the only method this kernel has; the field
   * exists so a caller that sees it can say the result is polygonal rather than curve-preserving.
   */
  readonly approximation: 'flattened-polygons';
  readonly tolerance: number;
  readonly flattenedSegments: {
    readonly inputs: number;
    readonly output: number;
  };
  /** Contours that were open and were closed for the operation. */
  readonly closedContours: number;
  /** True when the result carries no enclosed area (a legitimate outcome: the shapes missed). */
  readonly empty: boolean;
};

type Polygon = VectorPoint[][];

/** Converts one flattened contour into a ring, dropping a repeated closing point. */
function ringOf(contour: FlatContour): VectorPoint[] | null {
  const points = [...contour.points];
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 1 && first && last && first.x === last.x && first.y === last.y) points.pop();
  const cleaned: VectorPoint[] = [];
  for (const candidate of points) {
    const previous = cleaned[cleaned.length - 1];
    if (previous && previous.x === candidate.x && previous.y === candidate.y) continue;
    cleaned.push(candidate);
  }
  return cleaned.length >= 3 ? cleaned : null;
}

/**
 * Groups rings into polygons: positive-area rings become outer rings, negative-area rings become
 * holes of the smallest outer ring that contains them.
 */
function ringsToPolygons(
  rings: readonly { readonly ring: VectorPoint[]; readonly area: number }[],
): readonly Polygon[] {
  const outers = rings
    .filter((entry) => entry.area > 0)
    .map((entry) => ({ ring: entry.ring, area: entry.area }));
  const holes = rings.filter((entry) => entry.area < 0).map((entry) => entry.ring);

  // A path that consists only of "hole"-wound contours is still a shape: treat the largest as outer.
  if (outers.length === 0 && holes.length > 0) {
    const sorted = [...rings].sort((left, right) => Math.abs(right.area) - Math.abs(left.area));
    const largest = sorted[0];
    if (!largest) return [];
    outers.push({ ring: largest.ring, area: Math.abs(largest.area) });
    const index = holes.indexOf(largest.ring);
    if (index >= 0) holes.splice(index, 1);
  }

  const polygons: Polygon[] = outers.map((outer) => [outer.ring]);

  for (const hole of holes) {
    const container = outers
      .map((outer, index) => ({ index, area: outer.area, rings: [outer.ring, hole] }))
      .filter((entry) => ringInsideRing(hole, entry.rings[0] ?? []))
      .sort((left, right) => left.area - right.area)[0];
    if (container) {
      polygons[container.index]?.push(hole);
    } else {
      // A hole that belongs to nothing: keep it as its own polygon so the library decides what it
      // means relative to the other shapes, instead of silently discarding geometry.
      polygons.push([hole]);
    }
  }

  return polygons;
}

function ringInsideRing(inner: readonly VectorPoint[], outer: readonly VectorPoint[]): boolean {
  const probe = inner[0];
  if (!probe) return false;
  let crossings = 0;
  for (let index = 0; index < outer.length; index += 1) {
    const a = outer[index];
    const b = outer[(index + 1) % outer.length];
    if (!a || !b) continue;
    if (a.y > probe.y !== b.y > probe.y) {
      const x = a.x + ((probe.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (x > probe.x) crossings += 1;
    }
  }
  return crossings % 2 === 1;
}

/**
 * Rings in the shape the clipping library expects: `[x, y]` pairs, which its types fix as a
 * two-element tuple. The map is written with the tuple spelled out rather than asserted, so a
 * change to the library's input type is a compile error here instead of a runtime surprise.
 */
function toClippingInput(polygons: readonly Polygon[]): clipping.MultiPolygon {
  return polygons.map((polygon) =>
    polygon.map((ring) => ring.map((point): clipping.Pair => [point.x, point.y])),
  );
}

/** Rings back to a path: outer rings positive, holes negative, all closed and line-only. */
function fromClippingOutput(output: clipping.MultiPolygon): VectorPath {
  const contours = output
    .flatMap((polygon) => polygon)
    .map((ring) => {
      const points: VectorPoint[] = ring.map((pair) => ({ x: pair[0], y: pair[1] }));
      const first = points[0];
      const last = points[points.length - 1];
      if (points.length > 1 && first && last && first.x === last.x && first.y === last.y)
        points.pop();
      return points;
    })
    .filter((points) => points.length >= 3)
    .map((points) =>
      createContour(
        points.map((point) => ({ point, handleIn: null, handleOut: null })),
        true,
      ),
    )
    .filter((contour) => areaOfContour(contour) > TOLERANCE.area);

  return createPath(contours);
}

type Prepared = {
  readonly polygons: readonly Polygon[];
  readonly closedContours: number;
  readonly flattenedSegments: number;
};

function prepare(path: VectorPath, tolerance: Tolerance, label: string): Result<Prepared> {
  if (!isUsablePath(path, tolerance)) {
    return err(
      forgeError('validation-failed', `${label} has no usable geometry for a boolean operation.`, {
        detail: 'Draw a closed shape with at least three nodes before combining shapes.',
        retryable: false,
      }),
    );
  }

  const flattened = flattenPath(path, tolerance.flatten);
  const rings: { ring: VectorPoint[]; area: number }[] = [];
  let closedContours = 0;
  let flattenedSegments = 0;

  flattened.forEach((contour) => {
    const ring = ringOf(contour);
    if (!ring) return;
    flattenedSegments += Math.max(0, contour.points.length - 1);
    if (!contour.closed) closedContours += 1;
    const area = shoelaceArea(ring);
    if (Math.abs(area) <= tolerance.area) return;
    rings.push({ ring, area });
  });

  const polygons = ringsToPolygons(rings);
  if (polygons.length === 0) {
    return err(
      forgeError('validation-failed', `${label} encloses no area, so it cannot be combined.`, {
        detail:
          'Boolean operations need closed shapes. A line, a single node or a figure whose halves cancel each other out (a self-crossing loop) has no area to combine — redraw it as a closed shape first.',
        retryable: false,
      }),
    );
  }

  return ok({ polygons, closedContours, flattenedSegments });
}

function shoelaceArea(ring: readonly VectorPoint[]): number {
  let doubled = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    if (!a || !b) continue;
    doubled += a.x * b.y - b.x * a.y;
  }
  return doubled / 2;
}

/**
 * Runs one boolean operation.
 *
 * The caller passes the shapes in the order they matter: for `subtract`, every path after the first
 * is removed from the first.
 */
export function booleanPaths(
  operation: BooleanOperation,
  paths: readonly VectorPath[],
  options: BooleanOptions = {},
): Result<BooleanResult> {
  if (paths.length < 2) {
    return err(
      forgeError('validation-failed', 'Combining shapes needs at least two shapes.', {
        detail: 'Select two or more shapes and try again.',
        retryable: false,
      }),
    );
  }

  const tolerance: Tolerance = options.tolerance
    ? { ...TOLERANCE, flatten: options.tolerance }
    : TOLERANCE;

  const prepared: Prepared[] = [];
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    if (!path) continue;
    const result = prepare(path, tolerance, `Shape ${index + 1}`);
    if (!result.ok) return err(result.error);
    prepared.push(result.value);
  }

  const inputs = prepared.map((entry) => toClippingInput(entry.polygons));
  const first = inputs[0];
  if (!first) {
    return err(forgeError('validation-failed', 'Combining shapes needs at least two shapes.'));
  }

  let output: clipping.MultiPolygon;
  try {
    switch (operation) {
      case 'union':
        output = clipping.union(first, ...inputs.slice(1));
        break;
      case 'intersect':
        output = clipping.intersection(first, ...inputs.slice(1));
        break;
      case 'subtract':
        output = clipping.difference(first, ...inputs.slice(1));
        break;
      case 'exclude':
        output = clipping.xor(first, ...inputs.slice(1));
        break;
    }
  } catch (error) {
    return err(
      forgeError('unknown', 'The shapes could not be combined.', {
        detail: error instanceof Error ? error.message : String(error),
        retryable: false,
      }),
    );
  }

  const path = fromClippingOutput(output);
  return ok({
    path,
    operation,
    approximation: 'flattened-polygons',
    tolerance: tolerance.flatten,
    flattenedSegments: {
      inputs: prepared.reduce((total, entry) => total + entry.flattenedSegments, 0),
      output:
        path.contours.length === 0
          ? 0
          : path.contours.reduce((total, contour) => total + contour.nodes.length, 0),
    },
    closedContours: prepared.reduce((total, entry) => total + entry.closedContours, 0),
    empty: path.contours.length === 0,
  });
}

/** Human-readable summary of what a boolean result cost, for the UI to show next to the action. */
export function describeBooleanResult(result: BooleanResult): string {
  if (result.empty) {
    return `${BOOLEAN_OPERATION_LABELS[result.operation]} produced an empty shape — the shapes do not overlap.`;
  }
  const bounds = boundsOfPath(result.path);
  const size = bounds
    ? `${Math.round(bounds.maxX - bounds.minX)} × ${Math.round(bounds.maxY - bounds.minY)}`
    : '—';
  return `${BOOLEAN_OPERATION_LABELS[result.operation]} → ${String(result.path.contours.length)} contour(s), ${size} units, curves flattened to straight segments at ${String(result.tolerance)} units.`;
}
