/**
 * The bridge between a document scene and SVG artwork.
 *
 * A document layer is an editing concept (a name, visibility, a lock, a frame); an SVG file is a
 * painting concept (shapes, paint, geometry). Converting directly from one to the other would tie the
 * exporter to the layer model, so both directions go through the neutral artwork description in
 * `./artwork`:
 *
 *   scene layers  →  artwork  →  SVG string
 *   SVG string    →  artwork  →  scene layers
 *
 * ## What is supported, and what is reported instead
 *
 * Vector paths, rectangles and ellipses have exact equivalents in both directions. Text and graphic
 * (raster) layers do not: outlining a font is a different problem from serialising a path, and an
 * embedded bitmap is not vector artwork. They are therefore **reported by name**, and the caller
 * decides — the export panel blocks the export and says which layers are in the way, the import panel
 * lists what a file could not carry. Nothing is ever dropped silently: a document with three text
 * layers and one path exports to a file that contains the path and an explanation of why the text is
 * missing, or it does not export at all.
 */

import type { ForgeDocument } from '../documents/types';
import type { Layer, PathLayer, Scene } from '../documents/layer-types';
import { LAYER_TYPE_LABELS } from '../documents/layer-types';
import { createLayer } from '../documents/layer-operations';
import {
  boundsOfPath,
  transformPath,
  type Matrix,
  type VectorBox,
  type VectorPath,
  type VectorStyle,
} from '../vector';
import { ellipsePath, rectanglePath } from '../vector/shapes';
import { DEFAULT_VECTOR_STYLE, normaliseVectorStyle } from '../vector/style';
import { err, forgeError, ok, type Result } from '../result';
import { createArtwork, createShape, type SvgArtwork, type SvgShape } from './artwork';

/** A layer that has no SVG representation, named so a user knows what to do about it. */
export type UnsupportedLayer = {
  readonly layerId: string;
  readonly layerName: string;
  readonly layerType: Layer['type'];
  readonly reason: string;
};

export type ArtworkFromSceneResult = {
  readonly artwork: SvgArtwork;
  readonly unsupported: readonly UnsupportedLayer[];
  /** True when no layer produced any geometry. */
  readonly empty: boolean;
};

const TEXT_REASON =
  'Text is not converted to outlines in this build, so it cannot be written as vector artwork. Remove or replace it, or export a raster format.';
const IMAGE_REASON =
  'A graphic layer is raster artwork, which an SVG export would have to embed as a bitmap rather than describe as geometry.';

function styleFor(layer: Layer): VectorStyle {
  switch (layer.type) {
    case 'rect':
    case 'ellipse':
      return normaliseVectorStyle({
        fill: layer.shape.fill,
        stroke: layer.shape.stroke,
        strokeWidth: layer.shape.strokeWidth,
      });
    case 'path':
      return layer.vector.style;
    case 'text':
    case 'image':
      // Only reached for the types that are reported unsupported, where the style is never used.
      return DEFAULT_VECTOR_STYLE;
  }
}

function geometryFor(layer: Layer): VectorPath | null {
  switch (layer.type) {
    case 'text':
    case 'image':
      // No vector geometry exists for these: the caller reports them by name instead of guessing.
      return null;
    case 'path':
      return layer.vector.path;
    case 'rect':
      return rectanglePath(
        {
          minX: layer.frame.x,
          minY: layer.frame.y,
          maxX: layer.frame.x + layer.frame.width,
          maxY: layer.frame.y + layer.frame.height,
        },
        layer.shape.cornerRadius,
      );
    case 'ellipse':
      return ellipsePath({
        minX: layer.frame.x,
        minY: layer.frame.y,
        maxX: layer.frame.x + layer.frame.width,
        maxY: layer.frame.y + layer.frame.height,
      });
    default:
      return null;
  }
}

/**
 * Turns a document into artwork.
 *
 * Hidden layers are skipped — they are not part of what the document looks like — and the reason is
 * not recorded as "unsupported", because hiding a layer is a deliberate act rather than a limitation.
 */
export function artworkFromDocument(
  document: ForgeDocument,
  options: { readonly includeBackground?: boolean } = {},
): ArtworkFromSceneResult {
  const shapes: SvgShape[] = [];
  const unsupported: UnsupportedLayer[] = [];

  for (const layer of document.scene.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const geometry = geometryFor(layer);
    if (!geometry) {
      unsupported.push({
        layerId: layer.id,
        layerName: layer.name,
        layerType: layer.type,
        reason: layer.type === 'text' ? TEXT_REASON : IMAGE_REASON,
      });
      continue;
    }
    shapes.push(
      createShape(
        layer.name,
        geometry,
        styleFor(layer),
        layer.opacity,
        layer.type === 'path' ? (layer.vector.text ?? null) : null,
      ),
    );
  }

  const includeBackground = options.includeBackground ?? true;
  const artwork = createArtwork(
    { width: document.canvas.width, height: document.canvas.height },
    shapes,
    includeBackground && !document.canvas.transparent
      ? { background: document.canvas.background }
      : {},
  );

  return { artwork, unsupported, empty: shapes.length === 0 };
}

export type ArtworkImportOptions = {
  /** Where to place the artwork. Defaults to the artwork's own coordinates. */
  readonly offset?: { readonly x: number; readonly y: number } | undefined;
  /** Scale the whole drawing into this box instead of placing it at its own size. */
  readonly fitTo?: VectorBox | undefined;
  /** Prefix for generated layer names, so an imported icon set stays identifiable. */
  readonly namePrefix?: string | undefined;
  /** Injected so ids are deterministic in tests and collision-free in the app. */
  readonly generateId?: (() => string) | undefined;
};

/** A short, human-readable summary of what an import carried, for the panel to show. */
export type ArtworkImportSummary = {
  readonly layerCount: number;
  readonly scaledFrom: VectorBox | null;
  readonly scaledTo: VectorBox | null;
  readonly names: readonly string[];
};

export type ArtworkImportResult = {
  readonly layers: readonly PathLayer[];
  readonly summary: ArtworkImportSummary;
};

function matrixFor(artwork: SvgArtwork, options: ArtworkImportOptions): Matrix | null {
  if (!options.fitTo) return null;
  const bounds = artwork.shapes.reduce<VectorBox | null>((accumulated, shape) => {
    const box = boundsOfPath(shape.path);
    if (!box) return accumulated;
    if (!accumulated) return box;
    return {
      minX: Math.min(accumulated.minX, box.minX),
      minY: Math.min(accumulated.minY, box.minY),
      maxX: Math.max(accumulated.maxX, box.maxX),
      maxY: Math.max(accumulated.maxY, box.maxY),
    };
  }, null);
  if (!bounds) return null;
  const target = options.fitTo;
  const fromWidth = bounds.maxX - bounds.minX;
  const fromHeight = bounds.maxY - bounds.minY;
  // A single-axis scale: artwork with no width (a vertical line) keeps its proportions rather than
  // being multiplied by an infinite ratio.
  const scaleX = fromWidth <= 0 ? 1 : (target.maxX - target.minX) / fromWidth;
  const scaleY = fromHeight <= 0 ? 1 : (target.maxY - target.minY) / fromHeight;
  return {
    a: scaleX,
    b: 0,
    c: 0,
    d: scaleY,
    e: target.minX - bounds.minX * scaleX,
    f: target.minY - bounds.minY * scaleY,
  };
}

/**
 * Turns imported artwork into layers.
 *
 * Every shape becomes a path layer, including the shapes an SVG file expressed as `<rect>` or
 * `<circle>`: after import they are geometry the node editor can work on, which is the point of
 * importing into a vector document. The frame of each layer is its geometry's bounds, so selection,
 * snapping and the layer tree behave exactly as they do for hand-drawn paths.
 */
export function layersFromArtwork(
  artwork: SvgArtwork,
  options: ArtworkImportOptions = {},
): Result<ArtworkImportResult> {
  const matrix = matrixFor(artwork, options);
  const offset = options.offset ?? { x: 0, y: 0 };
  const layers: PathLayer[] = [];
  const names: string[] = [];

  for (const [index, shape] of artwork.shapes.entries()) {
    const placed = matrix ? transformPath(shape.path, matrix) : shape.path;
    const geometry =
      offset.x === 0 && offset.y === 0
        ? placed
        : transformPath(placed, { a: 1, b: 0, c: 0, d: 1, e: offset.x, f: offset.y });
    const bounds = boundsOfPath(geometry);
    if (!bounds) continue;

    const fallbackName = `Imported shape ${String(index + 1)}`;
    const baseName = shape.name.trim().length > 0 ? shape.name : fallbackName;
    const name = options.namePrefix ? `${options.namePrefix}${baseName}` : baseName;

    const created = createLayer(
      {
        type: 'path',
        frame: {
          x: bounds.minX,
          y: bounds.minY,
          width: bounds.maxX - bounds.minX,
          height: bounds.maxY - bounds.minY,
        },
        vector: {
          path: geometry,
          style: shape.style,
          ...(shape.text ? { text: shape.text } : {}),
        },
      },
      {
        name: name.slice(0, 80),
        ...(options.generateId ? { generateId: options.generateId } : {}),
      },
    );
    if (!created.ok) return err(created.error);
    if (created.value.type !== 'path') {
      return err(forgeError('unknown', 'An imported shape did not become a vector layer.'));
    }
    layers.push(created.value);
    names.push(created.value.name);
  }

  if (layers.length === 0) {
    return err(
      forgeError('unsupported', 'That file contains no shapes this editor can place.', {
        detail: 'Empty files and files with only unsupported elements have nothing to import.',
        retryable: false,
      }),
    );
  }

  const scaled = matrix ? artworkBoundsOf(artwork) : null;
  return ok({
    layers,
    summary: {
      layerCount: layers.length,
      scaledFrom: scaled,
      scaledTo: matrix ? (options.fitTo ?? null) : null,
      names,
    },
  });
}

function artworkBoundsOf(artwork: SvgArtwork): VectorBox | null {
  return artwork.shapes.reduce<VectorBox | null>((accumulated, shape) => {
    const box = boundsOfPath(shape.path);
    if (!box) return accumulated;
    if (!accumulated) return box;
    return {
      minX: Math.min(accumulated.minX, box.minX),
      minY: Math.min(accumulated.minY, box.minY),
      maxX: Math.max(accumulated.maxX, box.maxX),
      maxY: Math.max(accumulated.maxY, box.maxY),
    };
  }, null);
}

/** Layer types an SVG export can carry, for the export check and for the interchange report. */
export const SVG_CARRYABLE_LAYER_TYPES: readonly Layer['type'][] = ['path', 'rect', 'ellipse'];

export function svgUnsupportedReasons(scene: Scene): readonly UnsupportedLayer[] {
  const result: UnsupportedLayer[] = [];
  for (const layer of scene.layers) {
    if (!layer.visible) continue;
    if (layer.type === 'text') {
      result.push({
        layerId: layer.id,
        layerName: layer.name,
        layerType: 'text',
        reason: TEXT_REASON,
      });
    }
    if (layer.type === 'image') {
      result.push({
        layerId: layer.id,
        layerName: layer.name,
        layerType: 'image',
        reason: IMAGE_REASON,
      });
    }
  }
  return result;
}

/** Human label for a layer type, used when a report names the kind of layer it left out. */
export function layerTypeLabel(type: Layer['type']): string {
  return LAYER_TYPE_LABELS[type];
}
