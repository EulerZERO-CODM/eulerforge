/**
 * Paint for vector artwork.
 *
 * Paint is not geometry, but it belongs in the vector domain rather than in the SVG layer: the same
 * style object is stored in a document, drawn by the canvas painter, written by the SVG serialiser
 * and read back by the importer, and if each of those had its own copy the four would drift.
 *
 * The vocabulary is deliberately SVG's — fill, stroke, dash — because that is the vocabulary users
 * of a vector editor already have, and because it is the one that can be written to a file without a
 * lossy translation step. Colours are sRGB hex strings: no colour spaces, no named palettes, nothing
 * that depends on the CSS environment, so a document stored today renders the same colour tomorrow.
 */

/** A colour as `#rrggbb`, or `null` for "no paint" — a real state, not a missing value. */
export type VectorPaint = string | null;

export const STROKE_LINE_CAPS = ['butt', 'round', 'square'] as const;
export type StrokeLineCap = (typeof STROKE_LINE_CAPS)[number];

export const STROKE_LINE_JOINS = ['miter', 'round', 'bevel', 'miter-clip'] as const;
export type StrokeLineJoin = (typeof STROKE_LINE_JOINS)[number];

export type VectorStyle = {
  readonly fill: VectorPaint;
  readonly fillRule: 'nonzero' | 'evenodd';
  /** 0–1. Independent of `fill` so a hue can be faded without losing it. */
  readonly fillOpacity: number;
  readonly stroke: VectorPaint;
  /** In artwork units. Zero means the stroke draws nothing, which the painter and the importer agree on. */
  readonly strokeWidth: number;
  readonly strokeOpacity: number;
  readonly lineCap: StrokeLineCap;
  readonly lineJoin: StrokeLineJoin;
  /** Dash pattern in artwork units; empty means a solid stroke. */
  readonly dashArray: readonly number[];
};

export const VECTOR_STYLE_LIMITS = Object.freeze({
  maxStrokeWidth: 2_000,
  maxDashEntries: 16,
  maxDashLength: 2_000,
});

export const DEFAULT_VECTOR_STYLE: VectorStyle = Object.freeze({
  fill: '#000000',
  fillRule: 'nonzero' as const,
  fillOpacity: 1,
  stroke: null,
  strokeWidth: 1,
  strokeOpacity: 1,
  lineCap: 'butt' as const,
  lineJoin: 'miter' as const,
  dashArray: Object.freeze([]) as readonly number[],
});

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

export function isHexColour(value: string): boolean {
  return HEX_COLOUR.test(value);
}

/** Expands `#abc` and lower-cases `#AABBCC`; returns null for anything else. */
export function normaliseHexColour(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r ?? '0'}${r ?? '0'}${g ?? '0'}${g ?? '0'}${b ?? '0'}${b ?? '0'}`.toLowerCase();
  }
  if (HEX_COLOUR.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

export function withStyle(style: VectorStyle, patch: Partial<VectorStyle>): VectorStyle {
  return Object.freeze({ ...style, ...patch });
}

/**
 * Whether a style would paint anything.
 *
 * A shape with no fill and no stroke is a real state (a path being drawn, geometry kept for later),
 * and both the render plan and the exporter use this one predicate so they cannot disagree about
 * whether it draws something.
 */
export function stylePaintsSomething(style: VectorStyle): boolean {
  return style.fill !== null || (style.stroke !== null && style.strokeWidth > 0);
}

/**
 * Clamps a style into the supported range.
 *
 * Used at the boundary (importing a file, reading a stored document) so no algorithm downstream has
 * to defend itself against a stroke width of Infinity or a thousand dash entries.
 */
export function normaliseVectorStyle(input: Partial<VectorStyle>): VectorStyle {
  const fill = input.fill === undefined ? DEFAULT_VECTOR_STYLE.fill : input.fill;
  const stroke = input.stroke === undefined ? DEFAULT_VECTOR_STYLE.stroke : input.stroke;
  const clamp01 = (value: number): number =>
    Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
  const strokeWidth =
    input.strokeWidth === undefined
      ? DEFAULT_VECTOR_STYLE.strokeWidth
      : Math.min(VECTOR_STYLE_LIMITS.maxStrokeWidth, Math.max(0, input.strokeWidth));

  return Object.freeze({
    fill: fill === null ? null : (normaliseHexColour(fill) ?? DEFAULT_VECTOR_STYLE.fill),
    fillRule: input.fillRule ?? DEFAULT_VECTOR_STYLE.fillRule,
    fillOpacity: clamp01(input.fillOpacity ?? DEFAULT_VECTOR_STYLE.fillOpacity),
    stroke: stroke === null ? null : (normaliseHexColour(stroke) ?? DEFAULT_VECTOR_STYLE.stroke),
    strokeWidth: Number.isFinite(strokeWidth) ? strokeWidth : DEFAULT_VECTOR_STYLE.strokeWidth,
    strokeOpacity: clamp01(input.strokeOpacity ?? DEFAULT_VECTOR_STYLE.strokeOpacity),
    lineCap: input.lineCap ?? DEFAULT_VECTOR_STYLE.lineCap,
    lineJoin: input.lineJoin ?? DEFAULT_VECTOR_STYLE.lineJoin,
    dashArray: Object.freeze(
      (input.dashArray ?? []).slice(0, VECTOR_STYLE_LIMITS.maxDashEntries).map((entry) =>
        Number.isFinite(entry)
          ? Math.min(VECTOR_STYLE_LIMITS.maxDashLength, Math.max(0, entry))
          : 0,
      ),
    ),
  });
}
