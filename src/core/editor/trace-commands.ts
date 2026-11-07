/**
 * Turning a trace into document layers.
 *
 * `traceImage` produces geometry in *source-image* coordinates because that is the only space in
 * which its boundaries mean anything. A document has its own canvas, so the artwork is fitted into
 * that canvas here — uniformly scaled (never stretched), centred, with the frame of every layer
 * derived from its geometry exactly as `createPathLayerCommand` does. The whole trace becomes **one**
 * command, so a person who traces a photograph gets a single "Trace image" entry in the history and
 * one undo removes all of it (ADR-0006).
 *
 * Colours are emitted as solid fills with the even-odd rule: a region's holes are inner contours, and
 * even-odd is what makes them holes. A stroke is off — a trace of a photograph is filled shapes, not
 * an outline drawing.
 */

import { err, forgeError, ok, type Result } from '../result';
import { createRect, type Rect } from '../documents/geometry';
import { createLayer } from '../documents/layer-operations';
import { MAX_LAYERS } from '../documents/layer-types';
import type { DocumentPatch } from '../documents/patch';
import type { ForgeDocument } from '../documents/types';
import type { SceneCommand } from './commands';
import { boundsOfPath, matrix, transformPath, type VectorPath } from '../vector';
import type { TraceRegion, TraceReport } from '../vector/trace';

export type TracedLayer = {
  readonly name: string;
  readonly path: VectorPath;
  readonly fill: string;
  /** Area in document units after fitting, for the layer name and the report. */
  readonly area: number;
};

export type TracePlacement = {
  readonly layers: readonly TracedLayer[];
  /** Uniform scale applied to the source geometry. */
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  /** Bounds of the placed artwork, in document coordinates. */
  readonly box: Rect | null;
};

/**
 * Fits traced regions into a canvas.
 *
 * Exported separately from the command because "where did my trace land?" is a question tests and
 * the panel both need answered without building layers.
 */
export function placeTrace(
  report: Pick<TraceReport, 'regions'>,
  canvas: { readonly width: number; readonly height: number },
  options: { readonly margin?: number } = {},
): TracePlacement {
  const margin = Math.max(0, options.margin ?? 0);
  const usableWidth = Math.max(1, canvas.width - margin * 2);
  const usableHeight = Math.max(1, canvas.height - margin * 2);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const region of report.regions) {
    const box = boundsOfPath(region.path);
    if (!box) continue;
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { layers: [], scale: 1, offsetX: 0, offsetY: 0, box: null };
  }

  const width = Math.max(1e-6, maxX - minX);
  const height = Math.max(1e-6, maxY - minY);
  const scale = Math.min(usableWidth / width, usableHeight / height);
  const offsetX = margin + (usableWidth - width * scale) / 2 - minX * scale;
  const offsetY = margin + (usableHeight - height * scale) / 2 - minY * scale;

  const layers = report.regions.map((region: TraceRegion, index: number) => ({
    name: `Traced ${String(index + 1)} (${region.colour})`,
    path: transformPath(region.path, matrix(scale, 0, 0, scale, offsetX, offsetY)),
    fill: region.colour,
    area: region.area * scale * scale,
  }));

  const placedBox = createRect(
    margin + (usableWidth - width * scale) / 2,
    margin + (usableHeight - height * scale) / 2,
    width * scale,
    height * scale,
  );

  return {
    layers: Object.freeze(layers),
    scale,
    offsetX,
    offsetY,
    box: placedBox,
  };
}

/**
 * Adds a whole trace to a document as one undoable step.
 *
 * Regions arrive largest-first, and the layers are appended in that order, so the small details —
 * eyes, highlights, lettering — paint on top of the large areas instead of being buried beneath them.
 */
export function traceLayersCommand(
  document: ForgeDocument,
  report: TraceReport,
  options: {
    readonly generateId?: (() => string) | undefined;
    readonly margin?: number | undefined;
  } = {},
): Result<SceneCommand> {
  if (report.regions.length === 0) {
    return err(
      forgeError('validation-failed', 'That trace has no regions to add.', {
        detail: 'Trace the image again with more colours or more detail.',
        retryable: false,
      }),
    );
  }

  const room = MAX_LAYERS - document.scene.layers.length;
  if (report.regions.length > room) {
    return err(
      forgeError(
        'validation-failed',
        `This trace needs ${String(report.regions.length)} layers, but this document has room for ${String(Math.max(0, room))}.`,
        {
          detail:
            room <= 0
              ? 'Delete a layer, or trace into a new document.'
              : 'Lower the number of colours and trace again.',
          retryable: false,
        },
      ),
    );
  }

  const placement = placeTrace(report, document.canvas, {
    ...(options.margin === undefined ? {} : { margin: options.margin }),
  });
  if (placement.layers.length === 0) {
    return err(
      forgeError('validation-failed', 'That trace has no geometry to place.', { retryable: false }),
    );
  }

  const created = [];
  for (const traced of placement.layers) {
    const box = boundsOfPath(traced.path);
    if (!box) continue;
    const frame = createRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
    const layer = createLayer(
      {
        type: 'path',
        frame,
        vector: {
          path: traced.path,
          style: { fill: traced.fill, fillRule: 'evenodd', stroke: null, strokeWidth: 0 },
        },
      },
      {
        ...(options.generateId ? { generateId: options.generateId } : {}),
        name: traced.name,
      },
    );
    if (!layer.ok) return err(layer.error);
    created.push(layer.value);
  }

  if (created.length === 0) {
    return err(
      forgeError('validation-failed', 'That trace has no geometry to place.', { retryable: false }),
    );
  }

  const layers = [...document.scene.layers, ...created];
  const patch: DocumentPatch = Object.freeze({ scene: { layers } });
  return ok({
    label: `Trace image (${String(created.length)} ${created.length === 1 ? 'layer' : 'layers'})`,
    patch,
  });
}
