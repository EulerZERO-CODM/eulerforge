/**
 * The artwork model that sits between a document scene and an SVG file.
 *
 * A document layer is an editing concept (a name, visibility, a lock, a frame); an SVG file is a
 * painting concept (shapes, paint, transforms). Converting directly from one to the other would tie
 * the exporter to the layer model, so both directions go through this small neutral description:
 *
 *   scene layers  →  artwork  →  SVG string
 *   SVG string    →  artwork  →  scene layers
 *
 * The model carries no document identity, no ids and no ordering rules beyond "paint in order", so
 * the same code serialises an icon, an icon set and an imported file.
 */

import {
  boundsOfPath,
  checkTopology,
  nodeCount,
  transformPath,
  unionBoxes,
  validatePath,
  type Matrix,
  type StrokeLineCap,
  type StrokeLineJoin,
  type VectorBox,
  type VectorPaint,
  type VectorPath,
  type VectorStyle,
  DEFAULT_VECTOR_STYLE,
} from '../vector';
import type { Result } from '../result';
import { err, forgeError, ok } from '../result';

/**
 * Paint and geometry styling.
 *
 * The shape of a style is defined once, in the vector kernel (`core/vector/style.ts`), and reused
 * here under the names this module talks about: a document layer, the SVG writer and the SVG reader
 * all carry the same object, so there is no translation step that could lose a value.
 */
export type SvgPaint = VectorPaint;
export type SvgStrokeLineCap = StrokeLineCap;
export type SvgStrokeLineJoin = StrokeLineJoin;
export type SvgShapeStyle = VectorStyle;
export const DEFAULT_SHAPE_STYLE: SvgShapeStyle = DEFAULT_VECTOR_STYLE;

export type SvgShape = {
  /** Layer name carried through for `<title>` output and for diagnostics; never used for geometry. */
  readonly name: string;
  /** Geometry in artwork coordinates. Transforms are baked in; there are no nested groups. */
  readonly path: VectorPath;
  readonly style: SvgShapeStyle;
  /** 0–1. Shape-level transparency, like SVG's `opacity`. */
  readonly opacity: number;
};

export type SvgArtwork = {
  /** Intrinsic size written as `width`/`height`. */
  readonly width: number;
  readonly height: number;
  /** The coordinate system of the shapes. Usually `{ minX: 0, minY: 0, maxX: width, maxY: height }`. */
  readonly viewBox: VectorBox;
  /** Painted behind every shape, or `null` to leave the file transparent. */
  readonly background: string | null;
  readonly shapes: readonly SvgShape[];
};

export type ShapeStyleInput = Partial<SvgShapeStyle>;

export function createShape(
  name: string,
  path: VectorPath,
  style: ShapeStyleInput = {},
  opacity = 1,
): SvgShape {
  return Object.freeze({
    name,
    path,
    style: { ...DEFAULT_SHAPE_STYLE, ...style },
    opacity: clamp01(opacity),
  });
}

export function createArtwork(
  size: { readonly width: number; readonly height: number },
  shapes: readonly SvgShape[],
  options: { readonly viewBox?: VectorBox; readonly background?: string | null } = {},
): SvgArtwork {
  return Object.freeze({
    width: size.width,
    height: size.height,
    viewBox: options.viewBox ?? { minX: 0, minY: 0, maxX: size.width, maxY: size.height },
    background: options.background ?? null,
    shapes: Object.freeze([...shapes]),
  });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/** Bounds of every shape, or `null` for artwork with no geometry. */
export function artworkBounds(artwork: SvgArtwork): VectorBox | null {
  return artwork.shapes.reduce<VectorBox | null>(
    (accumulated, shape) => unionBoxes(accumulated, boundsOfPath(shape.path)),
    null,
  );
}

/** A shape with a matrix applied to its geometry: how a layer frame becomes artwork. */
export function transformShape(shape: SvgShape, matrix: Matrix): SvgShape {
  return { ...shape, path: transformPath(shape.path, matrix) };
}

export type ArtworkIssue = {
  readonly shapeIndex: number;
  readonly shapeName: string;
  /** `invalid` means the geometry cannot be exported; `warning` means it will be but was flagged. */
  readonly severity: 'invalid' | 'warning';
  readonly code: string;
  readonly message: string;
};

/**
 * Validates every shape's geometry.
 *
 * An exporter that writes a path it knows to be malformed would be producing a file whose rendering
 * depends on the consumer's error handling, so this is checked before serialisation rather than
 * after.
 */
export function validateArtwork(
  artwork: SvgArtwork,
): Result<{ readonly issues: readonly ArtworkIssue[] }> {
  const issues: ArtworkIssue[] = [];
  if (!Number.isFinite(artwork.width) || !Number.isFinite(artwork.height)) {
    return err(forgeError('validation-failed', 'The artwork has a non-finite size.'));
  }
  if (artwork.width <= 0 || artwork.height <= 0) {
    return err(
      forgeError(
        'validation-failed',
        `The artwork measures ${artwork.width} × ${artwork.height}; both sides must be positive.`,
      ),
    );
  }

  artwork.shapes.forEach((shape, shapeIndex) => {
    if (nodeCount(shape.path) === 0) {
      issues.push({
        shapeIndex,
        shapeName: shape.name,
        severity: 'warning',
        code: 'empty',
        message: `“${shape.name}” has no geometry and will not be written.`,
      });
      return;
    }

    // Structural problems (non-finite coordinates, exceeded limits) first: they make the
    // topological check meaningless.
    for (const issue of validatePath(shape.path)) {
      issues.push({
        shapeIndex,
        shapeName: shape.name,
        severity: issue.severe ? 'invalid' : 'warning',
        code: issue.code,
        message: issue.message,
      });
    }

    // Then topology. Exporting a shape that crosses itself would produce a file whose filled result
    // depends on the consumer's winding implementation, so it is refused rather than written.
    const topology = checkTopology(shape.path, { requireClosed: false });
    for (const issue of topology.issues) {
      if (issue.code === 'contour-not-closed') continue;
      issues.push({
        shapeIndex,
        shapeName: shape.name,
        severity: issue.invalid ? 'invalid' : 'warning',
        code: issue.code,
        message: issue.message,
      });
    }
  });

  const blocking = issues.filter((entry) => entry.severity === 'invalid');
  if (blocking.length > 0) {
    return err(
      forgeError(
        'validation-failed',
        `The artwork contains geometry that cannot be exported: ${blocking[0]?.message ?? ''}`,
        {
          detail: `${String(blocking.length)} shape(s) failed validation.`,
          retryable: false,
        },
      ),
    );
  }
  return ok({ issues });
}
