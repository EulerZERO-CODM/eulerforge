/**
 * Vector editing commands.
 *
 * Every node edit, handle drag, style change and boolean operation in the Illustration Studio becomes
 * a document change through one of these functions, so it enters the same history, the same
 * persistence and the same undo labels as everything else in the application (ADR-0006). Nothing here
 * touches the DOM: a command reads a document and returns a patch, which is what lets the whole
 * editing surface be tested without a browser.
 *
 * Two invariants are enforced here rather than trusted:
 *
 *  - **The frame follows the geometry.** Path layers store their frame as the bounds of their outline,
 *    so every geometry command goes through `updatePathGeometry`, and a transform of a path layer
 *    moves its *nodes* — never a frame that the geometry would then contradict.
 *  - **Refusals explain themselves.** Inserting a node too far from the outline, combining a locked
 *    shape, or outlining something that is already a path all produce a `Result` error with a reason
 *    instead of a silently-ignored instruction.
 */

import { err, forgeError, ok, type Result } from '../result';
import type { Rect } from '../documents/geometry';
import { createRect } from '../documents/geometry';
import {
  createLayer,
  updateLayer,
  updateLayerSettings,
  updatePathGeometry,
  updatePathText,
  type NewLayerInput,
} from '../documents/layer-operations';
import {
  DEFAULT_PATH_TEXT,
  isPathLayer,
  LAYER_TYPE_LABELS,
  normalisePathText,
  type Layer,
  type LayerId,
  type PathText,
} from '../documents/layer-types';
import {
  geometryBoundsOf,
  layersToVector,
  vectorGeometryOf,
  vectorStyleOf,
} from '../documents/interchange';
import type { DocumentPatch } from '../documents/patch';
import type { ForgeDocument } from '../documents/types';
import type { SceneCommand } from './commands';
import {
  BOOLEAN_OPERATION_LABELS,
  booleanPaths,
  boundsOfPath,
  describePaint,
  matrixBetweenBoxes,
  transformPath,
  translatePath,
  type BooleanOperation,
  type BooleanResult,
  type VectorPath,
  type VectorStyle,
} from '../vector';
import {
  deleteNode,
  insertNodeAt,
  moveHandle,
  moveNode,
  setNodeKind,
  type HandleSide,
  type NodeKind,
} from '../vector/ops';
import type { NodeReference } from '../vector/pick';
import type { SvgArtwork } from '../svg/artwork';
import { layersFromArtwork } from '../svg/from-scene';

function freezePatch(patch: DocumentPatch): DocumentPatch {
  return Object.freeze(patch);
}

function layerOf(document: ForgeDocument, id: LayerId | string): Result<Layer> {
  const layer = document.scene.layers.find((candidate) => String(candidate.id) === String(id));
  if (!layer) return err(forgeError('not-found', 'That layer is no longer in the document.'));
  return ok(layer);
}

function requireEditablePath(
  document: ForgeDocument,
  id: LayerId | string,
): Result<Extract<Layer, { type: 'path' }>> {
  const found = layerOf(document, id);
  if (!found.ok) return err(found.error);
  const layer = found.value;
  if (!isPathLayer(layer)) {
    return err(
      forgeError(
        'validation-failed',
        `“${layer.name}” is a ${LAYER_TYPE_LABELS[layer.type].toLowerCase()} layer, so it has no path to edit.`,
        {
          detail:
            layer.type === 'rect' || layer.type === 'ellipse'
              ? 'Convert it to editable paths first.'
              : 'Only vector paths carry nodes.',
          retryable: false,
        },
      ),
    );
  }
  if (layer.locked) {
    return err(
      forgeError('validation-failed', `“${layer.name}” is locked.`, {
        detail: 'Unlock it in the layer list to edit its geometry.',
        retryable: false,
      }),
    );
  }
  return ok(layer);
}

/* -------------------------------------------------------------------------------------------- */
/* Creating paths                                                                                 */
/* -------------------------------------------------------------------------------------------- */

export type CreatePathInput = {
  readonly path: VectorPath;
  readonly style?: Partial<VectorStyle> | undefined;
  readonly name?: string | undefined;
};

/**
 * Adds a new vector layer on top of the scene.
 *
 * The pen tool, the shape tools and SVG import all end here, so a path created by drawing, by a shape
 * preset or by an imported file is the same kind of layer with the same guarantees.
 */
export function createPathLayerCommand(
  document: ForgeDocument,
  input: CreatePathInput,
  options: { readonly generateId?: (() => string) | undefined } = {},
): Result<SceneCommand> {
  const bounds = boundsOfPath(input.path);
  // A straight line has zero width or height and is still real artwork, so the test is "two distinct
  // nodes" rather than "encloses an area". A path with a single node, or two nodes in the same
  // place, has no geometry at all and is refused.
  if (!bounds || (bounds.maxX - bounds.minX <= 0 && bounds.maxY - bounds.minY <= 0)) {
    return err(
      forgeError('validation-failed', 'That path has no geometry, so there is nothing to draw.', {
        detail: 'A path needs at least two nodes in different places.',
        retryable: false,
      }),
    );
  }

  const frame: Rect = createRect(
    bounds.minX,
    bounds.minY,
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
  );
  const created = createLayer(
    {
      type: 'path',
      frame,
      vector: { path: input.path, ...(input.style ? { style: input.style } : {}) },
    },
    {
      ...(options.generateId ? { generateId: options.generateId } : {}),
      ...(input.name ? { name: input.name } : {}),
    },
  );
  if (!created.ok) return err(created.error);

  const layers = [...document.scene.layers, created.value];
  return ok({
    label: `Draw “${created.value.name}”`,
    patch: freezePatch({ scene: { layers } }),
  });
}

/**
 * Outlines a rectangle or ellipse into an editable path, in place.
 *
 * The shape keeps its name, its position in the stack and its paint, so "Convert to paths" reads as
 * the same object becoming editable rather than a new object appearing. The substitution is exact:
 * the generated outline is the same curve, not an approximation of it.
 */
export function outlineShapeCommand(
  document: ForgeDocument,
  id: LayerId | string,
  options: { readonly generateId?: (() => string) | undefined } = {},
): Result<SceneCommand> {
  const found = layerOf(document, id);
  if (!found.ok) return err(found.error);
  const layer = found.value;
  if (isPathLayer(layer)) {
    return err(
      forgeError('validation-failed', `“${layer.name}” is already made of paths.`, {
        detail: 'Its nodes can be edited directly with the node tool.',
        retryable: false,
      }),
    );
  }
  if (layer.type !== 'rect' && layer.type !== 'ellipse') {
    return err(
      forgeError(
        'unsupported',
        `A ${LAYER_TYPE_LABELS[layer.type].toLowerCase()} layer cannot be outlined.`,
        {
          detail:
            layer.type === 'text'
              ? 'Text is not outlined in this build: that needs the font engine, not the shape engine.'
              : 'A graphic layer is a bitmap, so it has no outline.',
          retryable: false,
        },
      ),
    );
  }
  if (layer.locked) {
    return err(forgeError('validation-failed', `“${layer.name}” is locked.`));
  }

  const converted = layersToVector([layer], options);
  if (!converted.ok) return err(converted.error);
  const path = converted.value.layers[0];
  if (!path) return err(forgeError('unknown', 'The outline could not be built.'));

  const layers = document.scene.layers.map((candidate) =>
    String(candidate.id) === String(id) ? path : candidate,
  );
  return ok({
    label: `Convert “${layer.name}” to paths`,
    patch: freezePatch({ scene: { layers } }),
  });
}

/* -------------------------------------------------------------------------------------------- */
/* Editing nodes                                                                                  */
/* -------------------------------------------------------------------------------------------- */

/** Replaces a path layer's geometry and labels the change for the history panel. */
export function updatePathGeometryCommand(
  document: ForgeDocument,
  id: LayerId | string,
  path: VectorPath,
  label: string,
): Result<SceneCommand> {
  const changed = updatePathGeometry(document.scene, id, path);
  if (!changed.ok) return err(changed.error);
  return ok({ label, patch: freezePatch({ scene: changed.value }) });
}

/**
 * Moves one or more nodes, carrying each node's handles with it.
 *
 * A whole drag is *one* command and therefore one history entry: the pointer moves are previewed by
 * the caller, and only the final positions arrive here. Moves are applied in order, so a selection
 * of several nodes moves as a rigid group rather than each node fighting the others.
 */
export function movePathNodesCommand(
  document: ForgeDocument,
  id: LayerId | string,
  moves: readonly {
    readonly ref: NodeReference;
    readonly to: { readonly x: number; readonly y: number };
  }[],
  label?: string,
): Result<SceneCommand> {
  if (moves.length === 0) {
    return err(forgeError('validation-failed', 'No nodes were moved.', { retryable: false }));
  }
  const layer = requireEditablePath(document, id);
  if (!layer.ok) return err(layer.error);

  let path = layer.value.vector.path;
  for (const move of moves) {
    const moved = moveNode(path, move.ref.contourIndex, move.ref.nodeIndex, move.to);
    if (!moved.ok) return err(moved.error);
    path = moved.value;
  }

  const verb = moves.length > 1 ? `Move ${String(moves.length)} nodes` : 'Move node';
  return updatePathGeometryCommand(document, id, path, label ?? `${verb} on “${layer.value.name}”`);
}

/** Moves one Bezier handle. `mirroring: 'opposite'` keeps the node smooth. */
export function movePathHandleCommand(
  document: ForgeDocument,
  id: LayerId | string,
  ref: NodeReference,
  side: HandleSide,
  to: { readonly x: number; readonly y: number },
  mirroring: 'none' | 'opposite' = 'none',
): Result<SceneCommand> {
  const layer = requireEditablePath(document, id);
  if (!layer.ok) return err(layer.error);
  const moved = moveHandle(
    layer.value.vector.path,
    ref.contourIndex,
    ref.nodeIndex,
    side,
    to,
    mirroring,
  );
  if (!moved.ok) return err(moved.error);
  return updatePathGeometryCommand(
    document,
    id,
    moved.value,
    `${mirroring === 'opposite' ? 'Smooth' : 'Move'} handle on “${layer.value.name}”`,
  );
}

/** Adds a node on the outline nearest `at`, without changing the shape (an exact de Casteljau split). */
export function insertPathNodeCommand(
  document: ForgeDocument,
  id: LayerId | string,
  at: { readonly x: number; readonly y: number },
  options: { readonly maxDistance?: number | undefined } = {},
): Result<SceneCommand> {
  const layer = requireEditablePath(document, id);
  if (!layer.ok) return err(layer.error);

  const inserted = insertNodeAt(layer.value.vector.path, at, undefined, options.maxDistance);
  if (!inserted.ok) return err(inserted.error);
  if (inserted.value.refused) {
    return err(
      forgeError('validation-failed', 'That point is not on the outline.', {
        detail: 'Click on the path to add a node, or drag a node to move it.',
        retryable: false,
      }),
    );
  }

  return updatePathGeometryCommand(
    document,
    id,
    inserted.value.path,
    `Add node to “${layer.value.name}”`,
  );
}

/** Deletes nodes. A contour that drops below three nodes is opened rather than left unrenderable. */
export function deletePathNodesCommand(
  document: ForgeDocument,
  id: LayerId | string,
  refs: readonly NodeReference[],
): Result<SceneCommand> {
  if (refs.length === 0) {
    return err(forgeError('validation-failed', 'No nodes were selected.', { retryable: false }));
  }
  const layer = requireEditablePath(document, id);
  if (!layer.ok) return err(layer.error);

  // Deleting shifts the indices of later nodes, so removals run from the end of each contour
  // backwards. Otherwise the second delete of a pair would remove the wrong node.
  const ordered = [...refs].sort((a, b) =>
    a.contourIndex === b.contourIndex ? b.nodeIndex - a.nodeIndex : b.contourIndex - a.contourIndex,
  );
  let path = layer.value.vector.path;
  let opened = false;
  for (const ref of ordered) {
    const deleted = deleteNode(path, ref.contourIndex, ref.nodeIndex);
    if (!deleted.ok) return err(deleted.error);
    path = deleted.value.path;
    opened = opened || deleted.value.openedContour;
  }

  const label =
    refs.length > 1
      ? `Delete ${String(refs.length)} nodes`
      : `Delete node from “${layer.value.name}”`;
  const command = updatePathGeometryCommand(document, id, path, label);
  if (!command.ok) return err(command.error);
  return ok({
    label: opened
      ? `${label} (contour opened — a closed shape needs three nodes)`
      : command.value.label,
    patch: command.value.patch,
  });
}

/** Converts nodes between corner and smooth. */
export function setPathNodesKindCommand(
  document: ForgeDocument,
  id: LayerId | string,
  refs: readonly NodeReference[],
  kind: NodeKind,
): Result<SceneCommand> {
  if (refs.length === 0) {
    return err(forgeError('validation-failed', 'No nodes were selected.', { retryable: false }));
  }
  const layer = requireEditablePath(document, id);
  if (!layer.ok) return err(layer.error);

  let path = layer.value.vector.path;
  for (const ref of refs) {
    const changed = setNodeKind(path, ref.contourIndex, ref.nodeIndex, kind);
    if (!changed.ok) return err(changed.error);
    path = changed.value;
  }

  return updatePathGeometryCommand(
    document,
    id,
    path,
    `${kind === 'smooth' ? 'Smooth' : 'Make corner'} ${refs.length > 1 ? `${String(refs.length)} nodes` : 'node'} on “${layer.value.name}”`,
  );
}

/**
 * Transforms a path layer's geometry through a box-to-box matrix.
 *
 * This is how a vector layer is moved or resized: the caller has an old bounds and a new bounds, and
 * the *nodes* are transformed. Translating the stored frame instead would leave the geometry where it
 * was and break the invariant that a path layer's frame is truthful.
 */
export function transformPathLayerCommand(
  document: ForgeDocument,
  id: LayerId | string,
  from: Rect,
  to: Rect,
  label?: string,
): Result<SceneCommand> {
  const layer = requireEditablePath(document, id);
  if (!layer.ok) return err(layer.error);

  if (from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0) {
    return err(
      forgeError('validation-failed', 'A shape cannot be transformed from or to an empty box.', {
        detail: 'Give the shape some size before transforming it.',
        retryable: false,
      }),
    );
  }
  const matrix = matrixBetweenBoxes(
    { minX: from.x, minY: from.y, maxX: from.x + from.width, maxY: from.y + from.height },
    { minX: to.x, minY: to.y, maxX: to.x + to.width, maxY: to.y + to.height },
  );
  if (!matrix) {
    return err(
      forgeError('validation-failed', 'That transform is degenerate.', { retryable: false }),
    );
  }
  const transformed = transformPath(layer.value.vector.path, matrix);
  return updatePathGeometryCommand(
    document,
    id,
    transformed,
    label ?? `Transform “${layer.value.name}”`,
  );
}

/** Moves a path layer by a delta: the vector equivalent of dragging a layer. */
export function translatePathLayerCommand(
  document: ForgeDocument,
  id: LayerId | string,
  dx: number,
  dy: number,
): Result<SceneCommand> {
  const layer = requireEditablePath(document, id);
  if (!layer.ok) return err(layer.error);
  if (dx === 0 && dy === 0) {
    return err(forgeError('validation-failed', 'Nothing moved.', { retryable: false }));
  }
  return updatePathGeometryCommand(
    document,
    id,
    translatePath(layer.value.vector.path, dx, dy),
    dx === 0 ? `Move “${layer.value.name}” vertically` : `Move “${layer.value.name}”`,
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Paint                                                                                         */
/* -------------------------------------------------------------------------------------------- */

/**
 * Changes fill, stroke, opacity, cap or dash on one or more vector layers.
 *
 * `opacity` is the layer's own opacity, not the fill's: keeping them separate is what lets a user dim
 * a whole shape without also changing its paint, and the two are shown separately in the inspector.
 */
export function setVectorStyleCommand(
  document: ForgeDocument,
  ids: readonly (LayerId | string)[],
  patch: Partial<VectorStyle> & { readonly opacity?: number | undefined },
): Result<SceneCommand> {
  if (ids.length === 0) {
    return err(
      forgeError('validation-failed', 'Select a vector layer first.', { retryable: false }),
    );
  }

  const { opacity, ...style } = patch;
  if (opacity === undefined && Object.keys(style).length === 0) {
    return err(
      forgeError('validation-failed', 'No paint setting was changed.', { retryable: false }),
    );
  }

  let scene = document.scene;
  const names: string[] = [];
  for (const id of ids) {
    const found = layerOf(document, id);
    if (!found.ok) return err(found.error);
    if (!isPathLayer(found.value)) {
      return err(
        forgeError(
          'validation-failed',
          `“${found.value.name}” is a ${LAYER_TYPE_LABELS[found.value.type].toLowerCase()} layer.`,
          { detail: 'Convert it to paths to change its fill and stroke.', retryable: false },
        ),
      );
    }
    if (found.value.locked) {
      return err(forgeError('validation-failed', `“${found.value.name}” is locked.`));
    }
    names.push(found.value.name);

    if (Object.keys(style).length > 0) {
      const styled = updateLayerSettings(scene, id, { style });
      if (!styled.ok) return err(styled.error);
      scene = styled.value;
    }
    if (opacity !== undefined) {
      const dimmed = updateLayer(scene, id, { opacity });
      if (!dimmed.ok) return err(dimmed.error);
      scene = dimmed.value;
    }
  }

  const label =
    ids.length > 1
      ? `Restyle ${String(ids.length)} paths`
      : describeStyleChange(names[0] ?? 'path', patch);

  return ok({ label, patch: freezePatch({ scene }) });
}

/** A label that names what actually changed, so history reads like a description of the work. */
function describeStyleChange(
  name: string,
  patch: Partial<VectorStyle> & { readonly opacity?: number | undefined },
): string {
  if (patch.fillPaint !== undefined) {
    return patch.fillPaint === null
      ? `Remove fill paint from “${name}”`
      : `Set ${describePaint(patch.fillPaint, 'fill')} on “${name}”`;
  }
  if (patch.strokePaint !== undefined) {
    return patch.strokePaint === null
      ? `Remove stroke paint from “${name}”`
      : `Set ${describePaint(patch.strokePaint, 'stroke')} on “${name}”`;
  }
  if (patch.fill !== undefined) return `Set fill of “${name}”`;
  if (patch.stroke !== undefined)
    return patch.stroke === null ? `Remove stroke from “${name}”` : `Set stroke of “${name}”`;
  if (patch.strokeWidth !== undefined) return `Set stroke width of “${name}”`;
  if (patch.fillRule !== undefined) return `Set fill rule of “${name}”`;
  if (patch.lineCap !== undefined) return `Set line cap of “${name}”`;
  if (patch.lineJoin !== undefined) return `Set line join of “${name}”`;
  if (patch.dashArray !== undefined) return `Set dashes on “${name}”`;
  if (patch.fillOpacity !== undefined || patch.strokeOpacity !== undefined)
    return `Set paint opacity of “${name}”`;
  return `Restyle “${name}”`;
}

/* -------------------------------------------------------------------------------------------- */
/* Text on a path                                                                                */
/* -------------------------------------------------------------------------------------------- */

/**
 * Changes the text laid along a path's own contour.
 *
 * The run is a *property of the path*, so a geometry edit carries it along and one undo puts both the
 * letters and the curve back. Settings are normalised against the published limits rather than
 * trusted from the caller: a slider is a hint, and nothing outside the schema may reach the document.
 */
export function setVectorTextCommand(
  document: ForgeDocument,
  id: LayerId | string,
  patch: Partial<PathText>,
): Result<SceneCommand> {
  const found = layerOf(document, id);
  if (!found.ok) return err(found.error);
  if (found.value.type !== 'path') {
    return err(
      forgeError(
        'validation-failed',
        `“${found.value.name}” is a ${LAYER_TYPE_LABELS[found.value.type].toLowerCase()} layer.`,
        { detail: 'Text on a path attaches to vector paths.', retryable: false },
      ),
    );
  }
  if (found.value.locked) {
    return err(forgeError('validation-failed', `“${found.value.name}” is locked.`));
  }
  if (Object.keys(patch).length === 0) {
    return err(
      forgeError('validation-failed', 'No text setting was changed.', { retryable: false }),
    );
  }

  // Changing a setting on a path that has no text yet creates the run but leaves it empty: seeding
  // the default sentence would put words on the artboard that nobody typed.
  const current = found.value.vector.text ?? null;
  const merged: Partial<PathText> = current
    ? { ...current, ...patch }
    : { ...DEFAULT_PATH_TEXT, content: '', ...patch };
  const updated = updatePathText(document.scene, id, normalisePathText(merged));
  if (!updated.ok) return err(updated.error);

  return ok({
    label: describeTextChange(found.value.name, patch),
    patch: freezePatch({ scene: updated.value }),
  });
}

/** Removes the text from a path, leaving its geometry and paint exactly as they were. */
export function clearVectorTextCommand(
  document: ForgeDocument,
  id: LayerId | string,
): Result<SceneCommand> {
  const found = layerOf(document, id);
  if (!found.ok) return err(found.error);
  if (found.value.type !== 'path') {
    return err(
      forgeError(
        'validation-failed',
        `“${found.value.name}” is a ${LAYER_TYPE_LABELS[found.value.type].toLowerCase()} layer.`,
        { detail: 'Text on a path attaches to vector paths.', retryable: false },
      ),
    );
  }
  if (found.value.locked) {
    return err(forgeError('validation-failed', `“${found.value.name}” is locked.`));
  }
  if (found.value.vector.text == null) {
    return err(
      forgeError('validation-failed', `“${found.value.name}” has no text on its path.`, {
        retryable: false,
      }),
    );
  }
  const updated = updatePathText(document.scene, id, null);
  if (!updated.ok) return err(updated.error);
  return ok({
    label: `Remove text from “${found.value.name}”`,
    patch: freezePatch({ scene: updated.value }),
  });
}

/** Names the field that actually changed, so history reads like a description of the work. */
function describeTextChange(name: string, patch: Partial<PathText>): string {
  if (patch.content !== undefined) {
    return patch.content.trim().length === 0 ? `Clear text on “${name}”` : `Set text on “${name}”`;
  }
  if (patch.fontSize !== undefined) return `Set text size on “${name}”`;
  if (patch.letterSpacing !== undefined) return `Set text spacing on “${name}”`;
  if (patch.startOffset !== undefined) return `Set text start offset on “${name}”`;
  if (patch.baseline !== undefined) return `Set text baseline on “${name}”`;
  if (patch.colour !== undefined) return `Set text colour on “${name}”`;
  if (patch.fontStackId !== undefined) return `Set text font on “${name}”`;
  return `Restyle text on “${name}”`;
}

/* -------------------------------------------------------------------------------------------- */
/* Boolean operations                                                                            */
/* -------------------------------------------------------------------------------------------- */

export type BooleanCommandResult = {
  readonly command: SceneCommand;
  readonly result: BooleanResult;
};

/**
 * Combines two or more shapes into one path.
 *
 * The inputs keep their z-order meaning: the *back-most* shape is the subject, so "Subtract" removes
 * everything drawn over it — the same convention every vector editor uses. The result replaces the
 * topmost input in the stack, so the combination appears where the user was looking. The returned
 * `BooleanResult` carries the approximation report (flattening tolerance, segment counts) which the
 * caller shows to the user rather than hiding.
 */
export function booleanLayersCommand(
  document: ForgeDocument,
  ids: readonly (LayerId | string)[],
  operation: BooleanOperation,
  options: { readonly generateId?: (() => string) | undefined } = {},
): Result<BooleanCommandResult> {
  if (ids.length < 2) {
    return err(
      forgeError('validation-failed', 'Combining shapes needs at least two shapes.', {
        detail: 'Select two or more vector layers, or convert shapes to paths first.',
        retryable: false,
      }),
    );
  }

  const selected: { readonly layer: Layer; readonly index: number }[] = [];
  for (const id of ids) {
    const index = document.scene.layers.findIndex((layer) => String(layer.id) === String(id));
    if (index === -1)
      return err(forgeError('not-found', 'A selected layer is no longer in the document.'));
    const layer = document.scene.layers[index];
    if (!layer)
      return err(forgeError('not-found', 'A selected layer is no longer in the document.'));
    if (layer.locked) {
      return err(
        forgeError('validation-failed', `“${layer.name}” is locked.`, {
          detail: 'Unlock it in the layer list to combine it with other shapes.',
          retryable: false,
        }),
      );
    }
    if (layer.type === 'text' || layer.type === 'image') {
      return err(
        forgeError(
          'unsupported',
          `A ${LAYER_TYPE_LABELS[layer.type].toLowerCase()} layer cannot take part in a boolean operation.`,
          {
            detail:
              layer.type === 'text'
                ? 'Outline the text first — which this build does not do.'
                : 'A graphic layer is a bitmap, not geometry.',
            retryable: false,
          },
        ),
      );
    }
    selected.push({ layer, index });
  }

  // Document order is bottom-first, so sorting by index makes the back-most shape the subject.
  const ordered = [...selected].sort((a, b) => a.index - b.index);
  const paths: VectorPath[] = [];
  for (const entry of ordered) {
    const geometry = vectorGeometryOf(entry.layer);
    if (!geometry) {
      return err(forgeError('unsupported', `“${entry.layer.name}” has no geometry.`));
    }
    paths.push(geometry);
  }

  const combined = booleanPaths(operation, paths);
  if (!combined.ok) return err(combined.error);

  const label = BOOLEAN_OPERATION_LABELS[operation];
  const style = vectorStyleOf(ordered[0]!.layer);
  const bounds = boundsOfPath(combined.value.path);
  if (!bounds) {
    // Nothing survived the operation: report it without writing an empty layer into the document.
    return err(
      forgeError('unsupported', `${label} left no shape behind.`, {
        detail: 'The shapes did not overlap, so the result would be empty. Nothing was changed.',
        retryable: false,
      }),
    );
  }

  const created = createLayer(
    {
      type: 'path',
      frame: createRect(
        bounds.minX,
        bounds.minY,
        bounds.maxX - bounds.minX,
        bounds.maxY - bounds.minY,
      ),
      vector: { path: combined.value.path, style },
    },
    {
      ...(options.generateId ? { generateId: options.generateId } : {}),
      name: `${label} of ${String(ordered.length)} shapes`,
    },
  );
  if (!created.ok) return err(created.error);

  const removedIds = new Set(ordered.map((entry) => String(entry.layer.id)));
  const insertAt = Math.max(...ordered.map((entry) => entry.index));
  const remaining = document.scene.layers.filter((layer) => !removedIds.has(String(layer.id)));
  // `insertAt` was an index in the original array; removing layers below it shifts it down.
  const removedBelow = ordered.filter((entry) => entry.index < insertAt).length;
  const target = insertAt - removedBelow;
  const layers = [...remaining.slice(0, target), created.value, ...remaining.slice(target)];

  return ok({
    command: {
      label: `${label} ${String(ordered.length)} shapes`,
      patch: freezePatch({ scene: { layers } }),
    },
    result: combined.value,
  });
}

/* -------------------------------------------------------------------------------------------- */
/* Importing                                                                                     */
/* -------------------------------------------------------------------------------------------- */

/**
 * Imports parsed SVG artwork as new vector layers.
 *
 * The parsed artwork is already validated and sanitised by the importer, so this command only decides
 * *where* the artwork lands: unchanged (the file's own coordinate space), offset, or scaled into a
 * box. The caller gets the layer names back so it can report what arrived.
 */
export function importArtworkCommand(
  document: ForgeDocument,
  artwork: SvgArtwork,
  options: {
    readonly offset?: { readonly x: number; readonly y: number } | undefined;
    readonly fitTo?:
      | {
          readonly minX: number;
          readonly minY: number;
          readonly maxX: number;
          readonly maxY: number;
        }
      | undefined;
    readonly namePrefix?: string | undefined;
    readonly generateId?: (() => string) | undefined;
  } = {},
): Result<SceneCommand & { readonly layerNames: readonly string[] }> {
  const converted = layersFromArtwork(artwork, {
    ...(options.offset ? { offset: options.offset } : {}),
    ...(options.fitTo ? { fitTo: options.fitTo } : {}),
    ...(options.namePrefix ? { namePrefix: options.namePrefix } : {}),
    ...(options.generateId ? { generateId: options.generateId } : {}),
  });
  if (!converted.ok) return err(converted.error);

  const layers = [...document.scene.layers, ...converted.value.layers];
  return ok({
    label: `Import ${String(converted.value.layers.length)} shape${converted.value.layers.length === 1 ? '' : 's'} from SVG`,
    patch: freezePatch({ scene: { layers } }),
    layerNames: converted.value.layers.map((layer) => layer.name),
  });
}

/** Bounds of a layer's geometry, for the transform controls and for tests. */
export function layerGeometryBounds(layer: Layer) {
  return geometryBoundsOf(layer);
}

/** Re-exported for the inspector, which needs the same type the commands use. */
export type { NewLayerInput };
