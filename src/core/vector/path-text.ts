/**
 * Text laid along a vector path.
 *
 * The geometry is worked out here, in artwork units, from the same flattened contour the boolean
 * engine and the SVG writer use — so the preview, the frame export and the file all follow the same
 * line. Glyph *advances* are injected: `src/core/**` has no browser font engine, so a canvas context
 * supplies `measureText` at paint time and a deterministic fake supplies it in tests.
 *
 * Two limits are deliberate and documented rather than hidden:
 *
 * - The text follows the **first** contour that has at least two points, including its closing
 *   segment when the contour is closed. That matches what an SVG viewer does with a single-subpath
 *   `textPath` reference and is the only rule that makes both ends behave the same.
 * - Characters are Unicode **code points**, not grapheme clusters. A combining sequence can therefore
 *   be split across glyph placements; the studio's content limit keeps this to a case a user can see
 *   and fix, and it avoids a dependency on an ICU segmentation table that varies by runtime.
 */

import type { VectorPath } from './types';
import { flattenContour } from './flatten';

/** Default flattening tolerance for text layout, in artwork units. */
export const PATH_TEXT_FLATTENING = 0.25;

export type PathTextLayoutSettings = {
  readonly content: string;
  /** Glyph size in artwork units. */
  readonly fontSize: number;
  /** Extra advance between glyphs, in artwork units; may be negative. */
  readonly letterSpacing: number;
  /** Where along the contour the run starts, as a fraction of its length (0–1). */
  readonly startOffset: number;
};

/** Measures one glyph's advance in artwork units, without letter spacing applied. */
export type GlyphMeasurer = (glyph: string) => number;

export type PlacedGlyph = {
  readonly char: string;
  /** Anchor on the path: the midpoint of the glyph's own advance. */
  readonly x: number;
  readonly y: number;
  /** Tangent direction at the anchor, in radians. */
  readonly angle: number;
  /** Advance consumed by this glyph, including any spacing that preceded it. */
  readonly advance: number;
};

export type PathTextLayout = {
  readonly glyphs: readonly PlacedGlyph[];
  /** Length of the contour the text is laid on, in artwork units. */
  readonly pathLength: number;
  /** Code points that did not fit before the contour ended. */
  readonly dropped: number;
  /** True when at least one character was dropped. */
  readonly tooLong: boolean;
};

type Segment = {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  readonly start: number;
  readonly length: number;
  readonly angle: number;
};

function polylineOf(path: VectorPath): {
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly closed: boolean;
} {
  for (const contour of path.contours) {
    const flat = flattenContour(contour, PATH_TEXT_FLATTENING);
    if (flat.points.length >= 2) return { points: flat.points, closed: flat.closed };
  }
  return { points: [], closed: false };
}

function segmentsOfPolyline(
  points: readonly { readonly x: number; readonly y: number }[],
  closed: boolean,
): { readonly segments: readonly Segment[]; readonly length: number } {
  const segments: Segment[] = [];
  let total = 0;
  const limit = closed && points.length > 2 ? points.length : points.length - 1;
  for (let index = 0; index < limit; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    if (!from || !to) continue;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length <= 0) continue;
    segments.push({
      from,
      to,
      start: total,
      length,
      angle: Math.atan2(to.y - from.y, to.x - from.x),
    });
    total += length;
  }
  return { segments, length: total };
}

/** Position and tangent at an arclength, clamped to the polyline. */
function pointAt(
  segments: readonly Segment[],
  distance: number,
  total: number,
): { readonly x: number; readonly y: number; readonly angle: number } | null {
  if (segments.length === 0) return null;
  const target = Math.min(Math.max(distance, 0), total);
  for (const segment of segments) {
    const end = segment.start + segment.length;
    // `>=` on the last segment keeps a run that ends exactly at the contour's end on the line.
    if (target <= end || segment === segments[segments.length - 1]) {
      const t = Math.min(1, Math.max(0, (target - segment.start) / segment.length));
      return {
        x: segment.from.x + (segment.to.x - segment.from.x) * t,
        y: segment.from.y + (segment.to.y - segment.from.y) * t,
        angle: segment.angle,
      };
    }
  }
  return null;
}

/**
 * Lays a run of text along a path.
 *
 * Deterministic for a given path, settings and measurer: the same inputs produce the same glyph
 * positions, which is what lets a test compare a layout with itself and lets the export match the
 * preview exactly when both use the same measurer.
 */
export function layoutPathText(
  path: VectorPath,
  settings: PathTextLayoutSettings,
  measure: GlyphMeasurer,
): PathTextLayout {
  const { points, closed } = polylineOf(path);
  const { segments, length } = segmentsOfPolyline(points, closed);
  const glyphs: PlacedGlyph[] = [];
  if (segments.length === 0 || settings.content.length === 0) {
    return { glyphs, pathLength: length, dropped: 0, tooLong: false };
  }

  const characters = Array.from(settings.content);
  const offset = Math.min(1, Math.max(0, settings.startOffset)) * length;
  let pen = offset;
  let dropped = 0;

  for (const [index, char] of characters.entries()) {
    if (index > 0) pen += settings.letterSpacing;
    const advance = Math.max(0, measure(char));
    const centre = pen + advance / 2;
    if (advance <= 0 && index > 0) {
      // A zero-width glyph (a combining mark measured as nothing) still needs a position; it goes
      // where the pen is, which keeps the run's order intact.
      const anchor = pointAt(segments, pen, length);
      if (!anchor) {
        dropped = characters.length - index;
        break;
      }
      glyphs.push({ char, x: anchor.x, y: anchor.y, angle: anchor.angle, advance: 0 });
      continue;
    }
    if (centre > length) {
      dropped = characters.length - index;
      break;
    }
    const anchor = pointAt(segments, centre, length);
    if (!anchor) {
      dropped = characters.length - index;
      break;
    }
    glyphs.push({ char, x: anchor.x, y: anchor.y, angle: anchor.angle, advance });
    pen += advance;
  }

  return {
    glyphs,
    pathLength: length,
    dropped,
    tooLong: dropped > 0,
  };
}

/** True when a path is long enough at all to lay text on. */
export function pathCanCarryText(path: VectorPath): boolean {
  const { points } = polylineOf(path);
  return points.length >= 2;
}
