/**
 * Numeric tolerances, in one place.
 *
 * Every geometric decision that compares floating point numbers takes its tolerance from here or
 * from an explicit option — never from a magic literal buried in an algorithm. The requirement that
 * no function silently changes a tolerance is met structurally: a caller that needs a different
 * tolerance passes it, and the functions that consume one document the tolerance they used in their
 * result (see `BooleanResult.tolerance`).
 *
 * The defaults are chosen for a document in CSS pixels:
 *
 * - `point` — two coordinates closer than 1e-6 px are the same coordinate. Well below the precision
 *   of any display and of SVG's own serialisation, so it catches genuine coincidence (an imported
 *   path whose closing node repeats the first) without merging distinct geometry.
 * - `flatten` — a curve may deviate from its true shape by at most 0.05 px when flattened. A
 *   quarter-pixel at 100 % zoom: invisible on screen, and small enough that a flattened path
 *   re-exported as curves-free geometry still looks right.
 * - `area` — a contour must enclose at least 1e-6 px² to count as two-dimensional. Below that it is
 *   a line or a dot, and boolean operations are not defined for it.
 *
 * These are *not* a promise about pixels on a device; they are the resolution at which this kernel
 * declares two things equal or distinct.
 */

export type Tolerance = {
  /** Coordinates closer than this are the same coordinate. */
  readonly point: number;
  /** Maximum permitted deviation when approximating a curve with line segments, in document px. */
  readonly flatten: number;
  /** Minimum enclosed area for a contour to be considered two-dimensional. */
  readonly area: number;
  /** Slack added when picking a stroke of a given width, in document px. */
  readonly strokeSlack: number;
};

export const TOLERANCE: Tolerance = Object.freeze({
  point: 1e-6,
  flatten: 0.05,
  area: 1e-6,
  strokeSlack: 3,
});

/** A tolerance with individual members overridden; validates the parts it is given. */
export function toleranceWith(overrides: Partial<Tolerance>): Tolerance {
  const merged: Tolerance = { ...TOLERANCE, ...overrides };
  for (const [name, value] of Object.entries(merged)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(
        `Tolerance "${name}" must be a positive finite number, received ${String(value)}.`,
      );
    }
  }
  return Object.freeze(merged);
}

/** Rounds a coordinate for serialisation only. Geometry is never stored rounded. */
export function roundCoordinate(value: number, digits = 3): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  // `-0` serialises as "-0" and would make two identical documents differ byte-for-byte.
  return Object.freeze(rounded === 0 ? 0 : rounded);
}
