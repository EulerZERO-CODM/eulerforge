/**
 * Artwork interchange between Design and Illustration documents.
 *
 * A Design document and a vector document hold the same kind of scene — the layer model is shared —
 * so "interchange" is not a format conversion but a deliberate retyping of layers, and this module is
 * where that policy lives:
 *
 * - **Vector → Design.** A path layer means the same thing in both documents: the geometry is copied
 *   unchanged, because the paint and the frame are already the same shape of data.
 * - **Design → Vector.** A rectangle or an ellipse becomes a path with exactly the same outline, at
 *   the same place: the corner radius becomes four arcs' worth of cubic segments, and the ellipse
 *   becomes four cubics through the axis points. Neither is an approximation of the shape a designer
 *   drew — both are the same curve, expressed as nodes.
 * - **Text and graphics.** A text layer is not geometry until a font is outlined, which is a
 *   different algorithm (and a licensing question) than anything in this kernel, and a graphic layer
 *   is a bitmap. Neither is converted. They are listed by name with the reason, and the caller shows
 *   the list; nothing is silently dropped.
 *
 * Rotation is not part of the document model (frames are axis-aligned), so there is no rotation to
 * lose in either direction; the limitation is recorded in the interchange report anyway, so a future
 * rotation feature cannot quietly start dropping it.
 */

import type { Layer, PathLayer, VectorContent } from './layer-types';
import { isPathLayer } from './layer-types';
import { LAYER_TYPE_LABELS } from './layer-types';
import { createLayer } from './layer-operations';
import { ellipsePath, rectanglePath } from '../vector/shapes';
import { DEFAULT_VECTOR_STYLE, normaliseVectorStyle } from '../vector/style';
import { boundsOfPath, type VectorPath, type VectorStyle } from '../vector';
import type { Result } from '../result';
import { err, forgeError, ok } from '../result';

export type InterchangeDirection = 'to-vector' | 'to-design';

export type InterchangeSkip = {
  readonly layerId: string;
  readonly layerName: string;
  readonly layerType: Layer['type'];
  readonly reason: string;
};

export type InterchangeResult = {
  readonly layers: readonly Layer[];
  /** Layer names that came through, in order. */
  readonly converted: readonly string[];
  readonly skipped: readonly InterchangeSkip[];
  /** Limitations that apply to the direction itself, quoted in the UI. */
  readonly limitations: readonly string[];
};

const TEXT_SKIP =
  'Text is not converted to outlines in this build, so it cannot become vector paths.';

const IMAGE_SKIP = 'A graphic layer is a bitmap, not geometry.';

/**
 * The limitations of the *model* rather than of a particular layer.
 *
 * Stated on every interchange so the UI can show them without knowing which layers were chosen: a
 * report that only mentions what happened to be unsupported today would let a future editor assume
 * the rest is complete.
 */
export const INTERCHANGE_LIMITATIONS: readonly string[] = [
  'Frames are axis-aligned in both studios, so no rotation is applied or lost.',
  'Path layers cross in both directions with their geometry, paint and styles unchanged, including gradient and pattern fills and any text laid along the path. Rectangle and ellipse layers carry solid paint only, and no studio applies blur or image filters.',
  'Text becomes paths only when font outlining exists; until then it is listed as skipped.',
  'Boolean operations flatten curved outlines to line segments at the documented flattening tolerance, so a combined shape is polygonal rather than curved.',
];

function rectangleContent(layer: Extract<Layer, { type: 'rect' }>): VectorContent {
  const path = rectanglePath(
    {
      minX: layer.frame.x,
      minY: layer.frame.y,
      maxX: layer.frame.x + layer.frame.width,
      maxY: layer.frame.y + layer.frame.height,
    },
    layer.shape.cornerRadius,
  );
  const style = normaliseVectorStyle({
    fill: layer.shape.fill,
    stroke: layer.shape.stroke,
    strokeWidth: layer.shape.strokeWidth,
  });
  return { path, style };
}

function ellipseContent(layer: Extract<Layer, { type: 'ellipse' }>): VectorContent {
  const path = ellipsePath({
    minX: layer.frame.x,
    minY: layer.frame.y,
    maxX: layer.frame.x + layer.frame.width,
    maxY: layer.frame.y + layer.frame.height,
  });
  return {
    path,
    style: normaliseVectorStyle({
      fill: layer.shape.fill,
      stroke: layer.shape.stroke,
      strokeWidth: layer.shape.strokeWidth,
    }),
  };
}

/**
 * Converts layers into vector layers, keeping order, names, visibility, locks and opacity.
 *
 * Returns a `Result` because a conversion can genuinely fail — a rectangle whose frame cannot produce
 * geometry, a layer the factory rejects — and a partial conversion reported as success is the kind of
 * silent data loss this codebase refuses.
 */
export function layersToVector(
  layers: readonly Layer[],
  options: { readonly generateId?: (() => string) | undefined } = {},
): Result<InterchangeResult> {
  const out: Layer[] = [];
  const converted: string[] = [];
  const skipped: InterchangeSkip[] = [];

  for (const layer of layers) {
    let content: VectorContent | null = null;
    switch (layer.type) {
      case 'path':
        content = layer.vector;
        break;
      case 'rect':
        content = rectangleContent(layer);
        break;
      case 'ellipse':
        content = ellipseContent(layer);
        break;
      case 'text':
      case 'image':
        skipped.push({
          layerId: layer.id,
          layerName: layer.name,
          layerType: layer.type,
          reason: layer.type === 'text' ? TEXT_SKIP : IMAGE_SKIP,
        });
        continue;
    }

    const created = createLayer(
      { type: 'path', frame: layer.frame, vector: content },
      {
        name: layer.name,
        ...(options.generateId ? { generateId: options.generateId } : {}),
      },
    );
    if (!created.ok) {
      return err(
        forgeError(
          created.error.code,
          `“${layer.name}” could not be converted: ${created.error.message}`,
          {
            retryable: created.error.retryable,
          },
        ),
      );
    }

    // The frame is derived from the geometry by the factory, so the converted layer carries the same
    // artwork in the same place; visibility, lock and opacity are carried over deliberately.
    out.push({
      ...created.value,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
    });
    converted.push(layer.name);
  }

  if (out.length === 0) {
    return err(
      forgeError('unsupported', 'None of the chosen layers can become vector artwork.', {
        detail:
          skipped.length > 0
            ? skipped.map((entry) => `${entry.layerName}: ${entry.reason}`).join(' ')
            : 'Choose at least one layer.',
        retryable: false,
      }),
    );
  }

  return ok({ layers: out, converted, skipped, limitations: INTERCHANGE_LIMITATIONS });
}

/**
 * Converts layers into layers a Design canvas can hold.
 *
 * Path layers are copied unchanged — the design surface paints them with the same renderer — and
 * everything else already belongs to the design studio, so this direction is lossless for the artwork
 * a vector document can contain.
 */
export function layersToDesign(
  layers: readonly Layer[],
  options: { readonly generateId?: (() => string) | undefined } = {},
): Result<InterchangeResult> {
  const out: Layer[] = [];
  const converted: string[] = [];
  const skipped: InterchangeSkip[] = [];

  for (const layer of layers) {
    if (!isPathLayer(layer)) {
      out.push(layer);
      converted.push(layer.name);
      continue;
    }
    const copied = copyPathLayer(layer, options);
    if (!copied.ok) return err(copied.error);
    out.push(copied.value);
    converted.push(layer.name);
  }

  if (out.length === 0) {
    return err(forgeError('unsupported', 'There is no artwork to send.', { retryable: false }));
  }

  return ok({ layers: out, converted, skipped, limitations: INTERCHANGE_LIMITATIONS });
}

function copyPathLayer(
  layer: PathLayer,
  options: { readonly generateId?: (() => string) | undefined },
): Result<PathLayer> {
  const created = createLayer(
    { type: 'path', frame: layer.frame, vector: layer.vector },
    { name: layer.name, ...(options.generateId ? { generateId: options.generateId } : {}) },
  );
  if (!created.ok) return err(created.error);
  if (created.value.type !== 'path') {
    return err(forgeError('unknown', 'The copied layer did not come back as a vector layer.'));
  }
  return ok({
    ...created.value,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
  });
}

/** Names a layer's type for a report line. */
export function describeLayerType(type: Layer['type']): string {
  return LAYER_TYPE_LABELS[type];
}

/** Geometry of a layer as a path, or `null` when the layer has no vector geometry. */
export function vectorGeometryOf(layer: Layer): VectorPath | null {
  switch (layer.type) {
    case 'path':
      return layer.vector.path;
    case 'rect':
      return rectangleContent(layer).path;
    case 'ellipse':
      return ellipseContent(layer).path;
    case 'text':
    case 'image':
      return null;
  }
}

/** The style a design layer would carry into the vector document. */
export function vectorStyleOf(layer: Layer): VectorStyle {
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
      return DEFAULT_VECTOR_STYLE;
  }
}

/** Bounds of a layer's geometry, used by the interchange panels to describe what will be copied. */
export function geometryBoundsOf(layer: Layer) {
  const geometry = vectorGeometryOf(layer);
  return geometry ? boundsOfPath(geometry) : null;
}
