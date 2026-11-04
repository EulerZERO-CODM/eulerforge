/**
 * Paint beyond a flat colour: gradients and patterns.
 *
 * A solid fill is a hex string and stays one, because that is what every document written before
 * this module contains and what the overwhelming majority of vector artwork needs. Everything else
 * is described here, once, in the same vocabulary the SVG writer emits and the canvas painter draws:
 *
 * - a **gradient** is two points (linear) or a centre and a radius (radial) plus ordered stops;
 * - a **pattern** is a repeating geometric motif — stripes, dots, a grid or checks — with a tile
 *   size, a rotation and colours.
 *
 * Coordinates are **fractions of the shape's bounding box**, in SVG's `objectBoundingBox` sense:
 * `(0,0)` is the top-left corner of the artwork, `(1,1)` the bottom-right. Storing fractions rather
 * than absolute pixels means a gradient survives moving, resizing and re-importing a shape, and it
 * makes the document independent of the artwork's current size. Both renderers convert the
 * fractions to absolute coordinates from the *same* bounds, so they cannot disagree.
 *
 * A pattern is a motif rather than a reference to arbitrary artwork on purpose. A motif is
 * deterministic, resolution-independent, encodable as a handful of SVG primitives and drawable by
 * the canvas painter with no intermediate bitmap — so preview, export and import describe the same
 * picture instead of three approximations of it.
 */

import type { VectorBox } from './types';

/** One gradient stop. `offset` is 0–1 along the gradient; `color` is `#rrggbb`. */
export type GradientStop = {
  readonly offset: number;
  readonly color: string;
};

export type SolidPaint = {
  readonly kind: 'solid';
  readonly color: string;
};

export type LinearGradientPaint = {
  readonly kind: 'linear-gradient';
  /** Start point as a fraction of the shape's bounds. */
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  readonly stops: readonly GradientStop[];
};

export type RadialGradientPaint = {
  readonly kind: 'radial-gradient';
  /** Centre as a fraction of the shape's bounds. */
  readonly centre: { readonly x: number; readonly y: number };
  /** Radius as a fraction of the bounds' shorter side. */
  readonly radius: number;
  readonly stops: readonly GradientStop[];
};

export const PATTERN_MOTIFS = ['stripes', 'dots', 'grid', 'checks'] as const;
export type PatternMotif = (typeof PATTERN_MOTIFS)[number];

export type PatternPaint = {
  readonly kind: 'pattern';
  readonly motif: PatternMotif;
  readonly foreground: string;
  /** Painted behind the motif, or `null` to leave the surface showing. */
  readonly background: string | null;
  /** Tile size as a fraction of the bounds' shorter side: 0.05–1. */
  readonly scale: number;
  /** Rotation of the whole tiled surface, in degrees. */
  readonly rotation: number;
};

export type GradientPaint = LinearGradientPaint | RadialGradientPaint;
export type PaintSpec = SolidPaint | GradientPaint | PatternPaint;

export const PAINT_LIMITS = Object.freeze({
  minStops: 2,
  maxStops: 8,
  minPatternScale: 0.02,
  maxPatternScale: 1,
  maxRotationDegrees: 360,
});

/** The palette a pattern can use, matching the vector kernel's hex-only colour rule. */
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

export function isPaintColour(value: string): boolean {
  return HEX_COLOUR.test(value);
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

/**
 * Sorts, clamps and de-duplicates stops.
 *
 * SVG requires offsets to be non-decreasing; an unsorted list is a malformed file that browsers
 * silently repair in different ways. Sorting here means the stored document, the canvas gradient and
 * the written file all agree on the order, and a stop outside 0–1 is clamped rather than dropped.
 */
export function normaliseStops(stops: readonly GradientStop[]): readonly GradientStop[] {
  const cleaned = stops
    .filter((stop) => isPaintColour(stop.color))
    .map((stop) => ({
      offset: clamp(stop.offset, 0, 1),
      color: stop.color.toLowerCase(),
    }))
    .sort((a, b) => a.offset - b.offset)
    .slice(0, PAINT_LIMITS.maxStops);

  // A gradient needs at least two stops to exist at all; a single one becomes a flat colour pair so
  // the paint still renders instead of disappearing.
  if (cleaned.length === 0) {
    return Object.freeze([
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#ffffff' },
    ]);
  }
  if (cleaned.length === 1) {
    const only = cleaned[0] as GradientStop;
    return Object.freeze([only, { offset: 1, color: only.color }]);
  }
  return Object.freeze(cleaned);
}

/** Clamps a paint into the supported range, or returns `null` when it cannot describe any paint. */
export function normalisePaint(input: PaintSpec | null | undefined): PaintSpec | null {
  if (!input) return null;
  switch (input.kind) {
    case 'solid':
      return isPaintColour(input.color)
        ? Object.freeze({ kind: 'solid' as const, color: input.color.toLowerCase() })
        : null;
    case 'linear-gradient':
      return Object.freeze({
        kind: 'linear-gradient' as const,
        from: Object.freeze({
          x: clamp(input.from.x, -4, 5),
          y: clamp(input.from.y, -4, 5),
        }),
        to: Object.freeze({ x: clamp(input.to.x, -4, 5), y: clamp(input.to.y, -4, 5) }),
        stops: normaliseStops(input.stops),
      });
    case 'radial-gradient':
      return Object.freeze({
        kind: 'radial-gradient' as const,
        centre: Object.freeze({
          x: clamp(input.centre.x, -4, 5),
          y: clamp(input.centre.y, -4, 5),
        }),
        radius: clamp(input.radius, 0.01, 4),
        stops: normaliseStops(input.stops),
      });
    case 'pattern':
      return Object.freeze({
        kind: 'pattern' as const,
        motif: PATTERN_MOTIFS.includes(input.motif) ? input.motif : 'stripes',
        foreground: isPaintColour(input.foreground) ? input.foreground.toLowerCase() : '#000000',
        background:
          input.background !== null && isPaintColour(input.background)
            ? input.background.toLowerCase()
            : null,
        scale: clamp(input.scale, PAINT_LIMITS.minPatternScale, PAINT_LIMITS.maxPatternScale),
        rotation: clamp(
          input.rotation,
          -PAINT_LIMITS.maxRotationDegrees,
          PAINT_LIMITS.maxRotationDegrees,
        ),
      });
    default:
      return null;
  }
}

/**
 * A flat colour standing in for any paint.
 *
 * Used where a single colour is genuinely required — an icon-set manifest, a swatch, a fallback
 * renderer — and by tests as the expected average of a gradient. It is deliberately *not* used to
 * render: a gradient drawn as its midpoint would be a lie about what the file contains.
 */
export function representativeColour(paint: PaintSpec | null, fallback: string): string {
  if (!paint) return fallback;
  switch (paint.kind) {
    case 'solid':
      return paint.color;
    case 'pattern':
      return paint.foreground;
    case 'linear-gradient':
    case 'radial-gradient': {
      const stops = normaliseStops(paint.stops);
      const middle = stops[Math.floor(stops.length / 2)] ?? stops[0];
      return middle?.color ?? fallback;
    }
  }
}

/** Absolute geometry of a gradient in the shape's own coordinate space. */
export type ResolvedGradient =
  | {
      readonly kind: 'linear';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly stops: readonly GradientStop[];
    }
  | {
      readonly kind: 'radial';
      readonly cx: number;
      readonly cy: number;
      readonly radius: number;
      readonly stops: readonly GradientStop[];
    };

/**
 * Converts a gradient's fractional description into absolute coordinates for a bounding box.
 *
 * A zero-width or zero-height box (a horizontal line, say) is widened to one unit so the gradient
 * still has a direction; dividing by zero here would make the paint NaN and the canvas would draw
 * nothing at all.
 */
export function resolveGradient(paint: GradientPaint, box: VectorBox): ResolvedGradient {
  const width = Math.max(box.maxX - box.minX, 1e-6);
  const height = Math.max(box.maxY - box.minY, 1e-6);
  const x = (fraction: number): number => box.minX + width * fraction;
  const y = (fraction: number): number => box.minY + height * fraction;
  if (paint.kind === 'linear-gradient') {
    return {
      kind: 'linear',
      x1: x(paint.from.x),
      y1: y(paint.from.y),
      x2: x(paint.to.x),
      y2: y(paint.to.y),
      stops: normaliseStops(paint.stops),
    };
  }
  return {
    kind: 'radial',
    cx: x(paint.centre.x),
    cy: y(paint.centre.y),
    radius: Math.max(Math.min(width, height) * paint.radius, 1e-6),
    stops: normaliseStops(paint.stops),
  };
}

/**
 * The primitives a pattern tile is made of, in absolute coordinates.
 *
 * One description, drawn by the canvas painter and written by the SVG serialiser, so the preview and
 * the file cannot drift apart. Everything is expressed as axis-aligned rectangles and circles inside
 * a square tile of `tile` units, then rotated about the *shape's* centre by the paint's rotation —
 * the same rotation SVG applies with `patternTransform`.
 */
export type PatternPrimitive =
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly color: string;
    }
  | {
      readonly kind: 'circle';
      readonly cx: number;
      readonly cy: number;
      readonly radius: number;
      readonly color: string;
    };

export type ResolvedPattern = {
  readonly motif: PatternMotif;
  readonly background: string | null;
  readonly tile: number;
  readonly rotation: number;
  /** Rotation pivot, in the shape's coordinate space: the centre of the artwork's bounds. */
  readonly pivot: { readonly x: number; readonly y: number };
  /** Area the tiling has to cover, in the shape's coordinate space. */
  readonly area: VectorBox;
  /**
   * Where the tile grid starts. Anchored to the area's top-left corner so the canvas and the SVG
   * `<pattern>` describe the same grid without either having to know about the other.
   */
  readonly grid: { readonly x: number; readonly y: number };
  /** Primitives for one tile, in tile-local coordinates. */
  readonly primitives: readonly PatternPrimitive[];
};

/** The motif drawn inside one tile of `tile` units, in tile-local coordinates. */
export function motifPrimitives(
  motif: PatternMotif,
  tile: number,
  foreground: string,
): readonly PatternPrimitive[] {
  const size = Math.max(tile, 1e-6);
  const half = size / 2;
  const stroke = Math.max(size / 8, 0.5);
  switch (motif) {
    case 'stripes':
      return Object.freeze([
        { kind: 'rect', x: 0, y: 0, width: half, height: size, color: foreground },
      ]);
    case 'dots':
      return Object.freeze([
        { kind: 'circle', cx: half, cy: half, radius: half / 2, color: foreground },
      ]);
    case 'grid':
      return Object.freeze([
        { kind: 'rect', x: 0, y: 0, width: size, height: stroke, color: foreground },
        { kind: 'rect', x: 0, y: 0, width: stroke, height: size, color: foreground },
      ]);
    case 'checks':
      return Object.freeze([
        { kind: 'rect', x: 0, y: 0, width: half, height: half, color: foreground },
        { kind: 'rect', x: half, y: half, width: half, height: half, color: foreground },
      ]);
    default:
      return Object.freeze([]);
  }
}

/**
 * Converts a pattern's fractional description into the tile it will draw, positioned in the shape's
 * coordinate space.
 *
 * The tile size is a fraction of the bounds' **shorter** side, so a wide banner and a square icon get
 * the same number of visible repeats rather than a smear. Tiles are aligned to the area's top-left
 * corner, which keeps the pattern stable when a shape is moved (the artwork moves, the tile grid
 * moves with it) and identical between the canvas and the file.
 */
export function resolvePattern(paint: PatternPaint, box: VectorBox): ResolvedPattern {
  const width = Math.max(box.maxX - box.minX, 1e-6);
  const height = Math.max(box.maxY - box.minY, 1e-6);
  const tile = Math.max(Math.min(width, height) * paint.scale, 0.5);
  return {
    motif: paint.motif,
    background: paint.background,
    tile,
    rotation: paint.rotation,
    pivot: { x: box.minX + width / 2, y: box.minY + height / 2 },
    area: box,
    grid: { x: box.minX, y: box.minY },
    primitives: motifPrimitives(paint.motif, tile, paint.foreground),
  };
}

/** A one-line human description, used by the editor's style controls and by export reports. */
export function describePaint(paint: PaintSpec | null, fallback: string): string {
  if (!paint) return fallback;
  switch (paint.kind) {
    case 'solid':
      return paint.color;
    case 'linear-gradient':
      return `linear gradient, ${String(paint.stops.length)} stops`;
    case 'radial-gradient':
      return `radial gradient, ${String(paint.stops.length)} stops`;
    case 'pattern':
      return `${paint.motif} pattern`;
  }
}
