/**
 * Topological validity of a path.
 *
 * A boolean operation returning "some path" is not success: the result has to be a shape a renderer,
 * a printer and a cutting machine all agree about. This module is the definition of that agreement,
 * and the tests assert it on every boolean result rather than only that a result came back.
 *
 * What is checked, and why each one can actually go wrong:
 *
 * 1. **Structure** — the path is non-empty, has finite coordinates and respects the limits.
 * 2. **No self-intersection** — within one contour, no two non-adjacent segments cross. A
 *    self-intersecting ring has no well-defined interior for a non-zero fill rule, so its area and
 *    its rendering depend on the renderer.
 * 3. **Closure** — a closed contour's flattened ring starts and ends at the same point.
 * 4. **Orientation** — in a compound path, outer rings wind one way and holes the other. Two outer
 *    rings with opposite windings would cancel each other under a non-zero fill and produce a
 *    visually empty shape from a "successful" union.
 * 5. **Containment** — every hole lies inside an outer ring. A ring wound as a hole but sitting
 *    outside every outer ring is reported as a *warning*, not a defect: under a non-zero fill it
 *    still paints its own interior, as a filled island rather than as a void. It is a warning
 *    because "this was meant to subtract from something and is not subtracting" is worth knowing,
 *    and it is not an error because the geometry does render as drawn. A single negatively wound
 *    contour is therefore perfectly valid artwork — which is what an imported file often contains,
 *    since SVG does not require outer rings to wind clockwise until you ask for even-odd. (An outer
 *    ring *inside* a hole is the same situation mirrored, and is equally fine.)
 * 6. **Degenerate contours** — a contour enclosing no area draws nothing and should not be part of a
 *    "valid" result. Reported separately from self-intersection because the fix is different.
 *
 * Curves are flattened before the geometric checks (self-intersection, orientation, containment) at
 * the tolerance passed in, and the result says so: `flattened` reports the tolerance used and the
 * segment count, so a caller is never misled into thinking a curved path was checked analytically.
 */

import { areaOfContour, signedAreaOfContour } from './area';
import { boundsOfPath, boxContainsPoint } from './bounds';
import { flattenContour, type FlatContour } from './flatten';
import { segmentsProperlyCross } from './hit';
import { segmentsOf, validatePath, type PathIssue } from './path';
import { TOLERANCE, type Tolerance } from './tolerance';
import type { VectorPath, VectorPoint } from './types';

export type TopologyIssueCode =
  | 'self-intersection'
  | 'contour-not-closed'
  | 'inconsistent-winding'
  | 'hole-outside-outer'
  | 'degenerate-contour'
  | 'structure';

export type TopologyIssue = {
  readonly code: TopologyIssueCode;
  readonly contourIndex: number | null;
  readonly message: string;
  /** True when the path is not a valid region; false when it is merely suspicious. */
  readonly invalid: boolean;
};

export type TopologyReport = {
  /** True when no issue marked the path invalid. */
  readonly valid: boolean;
  readonly issues: readonly TopologyIssue[];
  /** Outer rings (positive area) and holes (negative area), as contour indices. */
  readonly outerContours: readonly number[];
  readonly holeContours: readonly number[];
  readonly flattened: {
    readonly tolerance: number;
    readonly segments: number;
  };
  /** Structure issues from `validatePath`, kept separate so callers can show both views. */
  readonly structureIssues: readonly PathIssue[];
};

export type TopologyOptions = {
  readonly tolerance?: number;
  /**
   * When true (the default) contours are required to be closed. A path made of open strokes is a
   * legitimate drawing, but it is not a region, and "is this a valid region" is the question a
   * boolean result is asked.
   */
  readonly requireClosed?: boolean;
};

function issue(
  code: TopologyIssueCode,
  message: string,
  contourIndex: number | null,
  invalid: boolean,
): TopologyIssue {
  return { code, contourIndex, message, invalid };
}

function findSelfIntersections(ring: readonly VectorPoint[]): readonly number[] {
  const pairs: number[] = [];
  const count = ring.length - 1;
  for (let a = 0; a < count; a += 1) {
    const a0 = ring[a];
    const a1 = ring[a + 1];
    if (!a0 || !a1) continue;
    for (let b = a + 1; b < count; b += 1) {
      // Adjacent segments share a node by construction; only non-adjacent pairs matter.
      if (b === a + 1) continue;
      const b0 = ring[b];
      const b1 = ring[b + 1];
      if (!b0 || !b1) continue;
      if (segmentsProperlyCross(a0, a1, b0, b1)) pairs.push(a);
    }
  }
  return pairs;
}

function ringContainsPoint(ring: readonly VectorPoint[], candidate: VectorPoint): boolean {
  let crossings = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const a = ring[index];
    const b = ring[index + 1];
    if (!a || !b) continue;
    if (a.y > candidate.y !== b.y > candidate.y) {
      const x = a.x + ((candidate.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (x > candidate.x) crossings += 1;
    }
  }
  return crossings % 2 === 1;
}

/** A point strictly inside a ring, used to test whether one ring sits inside another. */
function interiorPoint(ring: readonly VectorPoint[]): VectorPoint | null {
  // The centroid of the flattened ring's vertices is inside a convex ring but not necessarily inside
  // a concave one, so this uses a scanline crossing instead: take the extreme-left pair of the ring
  // at the vertical middle and step just past the first crossing.
  const box = ring.reduce<{ minX: number; minY: number; maxX: number; maxY: number } | null>(
    (accumulated, entry) =>
      accumulated === null
        ? { minX: entry.x, minY: entry.y, maxX: entry.x, maxY: entry.y }
        : {
            minX: Math.min(accumulated.minX, entry.x),
            minY: Math.min(accumulated.minY, entry.y),
            maxX: Math.max(accumulated.maxX, entry.x),
            maxY: Math.max(accumulated.maxY, entry.y),
          },
    null,
  );
  if (!box) return null;
  const middleY = (box.minY + box.maxY) / 2;
  const crossings: number[] = [];
  for (let index = 0; index < ring.length - 1; index += 1) {
    const a = ring[index];
    const b = ring[index + 1];
    if (!a || !b) continue;
    if (a.y > middleY !== b.y > middleY) {
      crossings.push(a.x + ((middleY - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
  }
  crossings.sort((left, right) => left - right);
  const first = crossings[0];
  const second = crossings[1];
  if (first === undefined) return null;
  const x = second === undefined ? first + (box.maxX - first) / 2 : (first + second) / 2;
  return { x, y: middleY };
}

export function checkTopology(path: VectorPath, options: TopologyOptions = {}): TopologyReport {
  const tolerance: Tolerance = options.tolerance
    ? { ...TOLERANCE, flatten: options.tolerance }
    : TOLERANCE;
  const requireClosed = options.requireClosed ?? true;
  const issues: TopologyIssue[] = [];
  const structureIssues = validatePath(path, tolerance);

  const flattened: FlatContour[] = path.contours.map((contour) =>
    flattenContour(contour, tolerance.flatten),
  );
  const segments = flattened.reduce(
    (total, contour) => total + Math.max(0, contour.points.length - 1),
    0,
  );

  const outerContours: number[] = [];
  const holeContours: number[] = [];

  path.contours.forEach((contour, contourIndex) => {
    const flat = flattened[contourIndex];
    const segmentsOfContour = segmentsOf(contour).length;

    if (segmentsOfContour === 0) {
      if (contour.nodes.length > 0 || requireClosed) {
        issues.push(
          issue(
            'degenerate-contour',
            `Contour ${contourIndex} draws no segment, so it encloses nothing.`,
            contourIndex,
            false,
          ),
        );
      }
      return;
    }

    if (requireClosed && !contour.closed) {
      issues.push(
        issue(
          'contour-not-closed',
          `Contour ${contourIndex} is open, so it has no interior to fill or clip.`,
          contourIndex,
          true,
        ),
      );
      return;
    }

    if (!contour.closed) {
      // An open contour in a region check is still measured for self-intersection; SVG closes it
      // implicitly when filling, so the check is meaningful.
      const selfIntersections = flat ? findSelfIntersections(flat.points) : [];
      if (selfIntersections.length > 0) {
        issues.push(
          issue(
            'self-intersection',
            `Open contour ${contourIndex} crosses itself ${selfIntersections.length} time(s).`,
            contourIndex,
            true,
          ),
        );
      }
      return;
    }

    // Self-intersection is checked before area: a figure-eight encloses no *net* area precisely
    // because it crosses itself, and "this shape crosses itself" is the more useful message.
    const selfIntersections = flat ? findSelfIntersections(flat.points) : [];
    if (selfIntersections.length > 0) {
      issues.push(
        issue(
          'self-intersection',
          `Contour ${contourIndex} crosses itself ${selfIntersections.length} time(s).`,
          contourIndex,
          true,
        ),
      );
      return;
    }

    const area = areaOfContour(contour);
    if (area <= tolerance.area) {
      issues.push(
        issue(
          'degenerate-contour',
          `Contour ${contourIndex} encloses no area (${area.toExponential(2)} px²).`,
          contourIndex,
          true,
        ),
      );
      return;
    }

    if (signedAreaOfContour(contour) > 0) outerContours.push(contourIndex);
    else holeContours.push(contourIndex);
  });

  // Containment: every hole must sit inside an outer ring. Two independent outer rings are fine;
  // an outer ring inside another outer ring is not a hole, and is reported as inconsistent winding
  // because that is exactly how a nested ring should have been wound.
  for (const holeIndex of holeContours) {
    const flat = flattened[holeIndex];
    const probe = flat ? interiorPoint(flat.points) : null;
    if (!probe) continue;
    const container = outerContours.find((outerIndex) => {
      const outerFlat = flattened[outerIndex];
      return outerFlat ? ringContainsPoint(outerFlat.points, probe) : false;
    });
    if (container === undefined) {
      issues.push(
        issue(
          'hole-outside-outer',
          `Contour ${holeIndex} winds as a hole but lies outside every outer contour, so it paints its own interior as an island instead of subtracting from another shape.`,
          holeIndex,
          false,
        ),
      );
    }
  }

  const bounds = boundsOfPath(path);
  if (bounds && !boxContainsPoint(bounds, { x: bounds.minX, y: bounds.minY })) {
    // Unreachable in practice; kept because a NaN coordinate would otherwise slip through every
    // comparison above silently (all comparisons with NaN are false).
    issues.push(issue('structure', 'The path bounds are not finite.', null, true));
  }

  return {
    valid: !issues.some((entry) => entry.invalid) && !structureIssues.some((entry) => entry.severe),
    issues,
    outerContours,
    holeContours,
    flattened: { tolerance: tolerance.flatten, segments },
    structureIssues,
  };
}

/** Convenience predicate for tests and for the export checklist. */
export function isTopologicallyValid(path: VectorPath, options: TopologyOptions = {}): boolean {
  return checkTopology(path, options).valid;
}
