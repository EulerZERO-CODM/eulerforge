/**
 * Editor commands.
 *
 * A command is the *only* way an editing interaction becomes a document change. It pairs a
 * human-readable label with the exact patch it produces, so:
 *
 *  - undo history reads like a description of the work ("Move layer 3", "Set font size to 72px");
 *  - a command can be validated and tested without a browser, a pointer or React;
 *  - the interface never assembles a patch inline, which is what usually lets two code paths drift
 *    into disagreeing about what an edit means.
 *
 * Commands are pure: they read a document and return a patch. Nothing is applied until the session
 * commits it.
 */

import { err, forgeError, ok, type Result } from '../result';
import { createRect, type Rect } from '../documents/geometry';
import {
  addAttribution,
  addNewLayer,
  attributionForScene,
  defaultFrameFor,
  deleteLayers,
  duplicateLayers,
  moveLayerTo,
  renameLayer,
  reorderLayers,
  updateLayer,
  updateLayers,
  updateLayerSettings,
  updatePathGeometry,
  type ReorderTarget,
} from '../documents/layer-operations';
import { unionRects } from '../documents/geometry';
import {
  groupTransformToFit,
  transformTargets as applyTransform,
  type GroupTransform,
  type TransformTarget,
} from '../documents/scene-geometry';
import type {
  AttributionRecord,
  ImageSettings,
  Layer,
  LayerId,
  LayerType,
  ShapeSettings,
  TextSettings,
} from '../documents/layer-types';
import { matrixBetweenBoxes, transformPath, type VectorBox } from '../vector';
import { LAYER_TYPE_LABELS } from '../documents/layer-types';
import type { DocumentPatch } from '../documents/patch';
import type { ForgeDocument } from '../documents/types';
import type { AssetRecord } from '../assets/types';

export type SceneCommand = {
  readonly label: string;
  readonly patch: DocumentPatch;
};

/** Formats a number for a label without trailing noise: 72, 12.5, 0.35. */
function n(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function freezePatch(patch: DocumentPatch): DocumentPatch {
  return Object.freeze(patch);
}

/* -------------------------------------------------------------------------------------------- */
/* Creating                                                                                      */
/* -------------------------------------------------------------------------------------------- */

/**
 * Toolbar-creatable layer types.
 *
 * `path` is excluded because a path layer is created by drawing with a tool, not by pressing
 * "add a blank path": an empty vector layer with a frame and no geometry is not something a user can
 * do anything with, and offering the button would be a control that does not do what it says.
 */
export type CreatableLayerType = Exclude<LayerType, 'path'>;

export function addLayerCommand(
  document: ForgeDocument,
  type: CreatableLayerType,
  generateId?: () => string,
): Result<SceneCommand> {
  const frame = defaultFrameFor(type, document.canvas);
  const added = addNewLayer(
    document.scene,
    type === 'image'
      ? { type: 'image', frame, image: { href: '/forge-assets/aurora-mesh.svg' } }
      : { type, frame },
    generateId ? { generateId } : {},
  );
  if (!added.ok) return err(added.error);

  return ok({
    label: `Add ${LAYER_TYPE_LABELS[type].toLowerCase()} layer`,
    patch: freezePatch({ scene: added.value.scene }),
  });
}

/**
 * Places a catalogue graphic.
 *
 * Records the graphic's frame, an attribution record copied from the catalogue entry, and — when the
 * catalogue has not verified the licence — says so in the label-free `warnings` the caller shows.
 * A record with no file is refused: a metadata-only record must never reach a canvas.
 */
export function placeAssetCommand(
  document: ForgeDocument,
  record: AssetRecord,
  generateId?: () => string,
  placedAt: string = new Date().toISOString(),
): Result<SceneCommand> {
  if (!record.file) {
    return err(
      forgeError(
        'unsupported',
        `"${record.name}" has no file in this build, so it cannot be placed.`,
        {
          detail: 'The catalogue lists it as a reference record only.',
          retryable: false,
        },
      ),
    );
  }

  const frame = fitGraphicFrame(document.canvas, record.file.width, record.file.height);
  const added = addNewLayer(
    document.scene,
    {
      type: 'image',
      frame,
      image: {
        assetId: record.id,
        href: record.file.href,
        intrinsicWidth: record.file.width,
        intrinsicHeight: record.file.height,
        fit: 'contain',
      },
    },
    // The layer carries the catalogue name, so the layer tree and every history label name the
    // graphic a person chose instead of calling it "Graphic".
    { name: record.name, ...(generateId ? { generateId } : {}) },
  );
  if (!added.ok) return err(added.error);

  const attribution: AttributionRecord = {
    id: `attr-${record.id}-${placedAt}`,
    assetId: record.id,
    assetName: record.name,
    assetKind: record.kind,
    licenseId: record.license.id,
    licenseName: record.license.name,
    licenseUrl: record.license.url ?? null,
    attributionRequired: record.license.attributionRequired,
    commercialUse: record.license.commercialUse,
    author: record.provenance.author,
    source: record.provenance.source,
    verified: record.provenance.verified,
    notes: record.provenance.notes,
    placedAt,
  };

  return ok({
    label: `Place graphic “${record.name}”`,
    patch: freezePatch({
      scene: added.value.scene,
      attribution: addAttribution(document.attribution, attribution),
    }),
  });
}

/** Largest frame the graphic can occupy while staying inside the canvas safe margin. */
export function fitGraphicFrame(
  canvas: { readonly width: number; readonly height: number },
  intrinsicWidth: number,
  intrinsicHeight: number,
): Rect {
  const margin = Math.round(Math.min(canvas.width, canvas.height) * 0.08);
  const availableWidth = Math.max(16, canvas.width - margin * 2);
  const availableHeight = Math.max(16, canvas.height - margin * 2);
  const safeIntrinsic = {
    width: intrinsicWidth > 0 ? intrinsicWidth : availableWidth,
    height: intrinsicHeight > 0 ? intrinsicHeight : availableHeight,
  };
  const scale = Math.min(
    availableWidth / safeIntrinsic.width,
    availableHeight / safeIntrinsic.height,
    1,
  );
  const width = Math.max(1, Math.round(safeIntrinsic.width * scale));
  const height = Math.max(1, Math.round(safeIntrinsic.height * scale));
  return createRect(
    Math.round((canvas.width - width) / 2),
    Math.round((canvas.height - height) / 2),
    width,
    height,
  );
}

/**
 * Duplicates the whole selection as one edit.
 *
 * The scene is rebuilt in a single pass, so every copy is placed against the document as it will
 * exist — duplicating three layers cannot let the second copy overwrite the first, and the copies
 * inherit the selection's relative order.
 */
export function duplicateLayersCommand(
  document: ForgeDocument,
  ids: readonly (LayerId | string)[],
  generateId?: () => string,
): Result<SceneCommand> {
  const named = namesFor(document, ids);
  if (named.length === 0) {
    return err(forgeError('not-found', 'That layer is no longer in the document.'));
  }

  const duplicated = duplicateLayers(document.scene, ids, generateId ? { generateId } : {});
  if (!duplicated.ok) return err(duplicated.error);

  const label =
    named.length === 1
      ? `Duplicate “${named[0]?.replace(/ copy$/, '') ?? 'layer'}”`
      : `Duplicate ${String(named.length)} layers`;
  return ok({ label, patch: freezePatch({ scene: duplicated.value.scene }) });
}

/** Duplicates one layer. Delegates to the batch command so both paths stay identical. */
export function duplicateLayerCommand(
  document: ForgeDocument,
  id: LayerId | string,
  generateId?: () => string,
): Result<SceneCommand> {
  return duplicateLayersCommand(document, [id], generateId);
}

/* -------------------------------------------------------------------------------------------- */
/* Removing and arranging                                                                        */
/* -------------------------------------------------------------------------------------------- */

export function deleteLayersCommand(
  document: ForgeDocument,
  ids: readonly (LayerId | string)[],
): Result<SceneCommand> {
  const names = document.scene.layers
    .filter((layer) => ids.some((id) => String(id) === String(layer.id)))
    .map((layer) => layer.name);
  if (names.length === 0) {
    return err(forgeError('not-found', 'That layer is no longer in the document.'));
  }

  const deleted = deleteLayers(document.scene, ids);
  if (!deleted.ok) return err(deleted.error);

  return ok({
    label:
      names.length === 1 ? `Delete “${String(names[0])}”` : `Delete ${String(names.length)} layers`,
    patch: freezePatch({
      scene: deleted.value,
      // A document only claims attribution for the graphics it still contains.
      attribution: attributionForScene(document.attribution, deleted.value),
    }),
  });
}

const REORDER_VERBS: Readonly<Record<ReorderTarget, string>> = {
  front: 'Bring to front',
  back: 'Send to back',
  forward: 'Bring forward',
  backward: 'Send backward',
};

/**
 * Reorders the whole selection as one edit.
 *
 * The stack is rebuilt once, so moving three layers forward cannot have the second move undo the
 * first: the result is a single scene, and the selection keeps its internal order.
 */
export function reorderLayersCommand(
  document: ForgeDocument,
  ids: readonly (LayerId | string)[],
  target: ReorderTarget,
): Result<SceneCommand> {
  const named = namesFor(document, ids);
  if (named.length === 0) {
    return err(forgeError('not-found', 'That layer is no longer in the document.'));
  }

  const reordered = reorderLayers(document.scene, ids, target);
  if (!reordered.ok) return err(reordered.error);

  const label =
    named.length === 1
      ? `${REORDER_VERBS[target]}: “${named[0] ?? 'layer'}”`
      : `${REORDER_VERBS[target]}: ${String(named.length)} layers`;
  return ok({ label, patch: freezePatch({ scene: reordered.value }) });
}

/** Reorders one layer. Delegates to the batch command so both paths stay identical. */
export function reorderLayerCommand(
  document: ForgeDocument,
  id: LayerId | string,
  target: ReorderTarget,
): Result<SceneCommand> {
  return reorderLayersCommand(document, [id], target);
}

export function moveLayerToCommand(
  document: ForgeDocument,
  id: LayerId | string,
  index: number,
): Result<SceneCommand> {
  const layer = document.scene.layers.find((candidate) => String(candidate.id) === String(id));
  if (!layer) return err(forgeError('not-found', 'That layer is no longer in the document.'));
  const moved = moveLayerTo(document.scene, id, index);
  if (!moved.ok) return err(moved.error);
  return ok({
    label: `Move “${layer.name}” to position ${String(index + 1)}`,
    patch: freezePatch({ scene: moved.value }),
  });
}

/* -------------------------------------------------------------------------------------------- */
/* Layer properties                                                                              */
/* -------------------------------------------------------------------------------------------- */

/**
 * Names of the requested layers, in scene order.
 *
 * Read once from the *current* document, so a label always describes the layers the command was
 * built from — never a mix of the document before and after an earlier command in a loop.
 */
function namesFor(document: ForgeDocument, ids: readonly (LayerId | string)[]): readonly string[] {
  const wanted = new Set(ids.map((id) => String(id)));
  return document.scene.layers
    .filter((layer) => wanted.has(String(layer.id)))
    .map((layer) => layer.name);
}

function named(
  document: ForgeDocument,
  id: LayerId | string,
  action: (name: string) => string,
): Result<string> {
  const layer = document.scene.layers.find((candidate) => String(candidate.id) === String(id));
  if (!layer) return err(forgeError('not-found', 'That layer is no longer in the document.'));
  return ok(action(layer.name));
}

export function renameLayerCommand(
  document: ForgeDocument,
  id: LayerId | string,
  name: string,
): Result<SceneCommand> {
  const renamed = renameLayer(document.scene, id, name);
  if (!renamed.ok) return err(renamed.error);
  return ok({
    label: `Rename layer to “${name.trim()}”`,
    patch: freezePatch({ scene: renamed.value }),
  });
}

/**
 * Applies several layer patches as one edit: one scene, one patch, one history entry.
 *
 * Every multi-selection action funnels through here, which is what stops a loop of per-layer commands
 * from each being built against the same stale document and overwriting its predecessor.
 */
function batchCommand(
  document: ForgeDocument,
  ids: readonly (LayerId | string)[],
  patch: (scene: ForgeDocument['scene']) => Result<ForgeDocument['scene']>,
  label: (names: readonly string[]) => string,
): Result<SceneCommand> {
  const names = namesFor(document, ids);
  if (names.length === 0) {
    return err(forgeError('not-found', 'That layer is no longer in the document.'));
  }
  const changed = patch(document.scene);
  if (!changed.ok) return err(changed.error);
  return ok({ label: label(names), patch: freezePatch({ scene: changed.value }) });
}

function batchSettingsCommand(
  document: ForgeDocument,
  ids: readonly (LayerId | string)[],
  settings: Parameters<typeof updateLayers>[1][number]['patch'],
  describeOne: (name: string) => string,
  describeMany: (count: number) => string,
): Result<SceneCommand> {
  return batchCommand(
    document,
    ids,
    (scene) =>
      updateLayers(
        scene,
        ids.map((id) => ({ id, patch: settings })),
      ),
    (names) => (names.length === 1 ? describeOne(names[0] ?? 'layer') : describeMany(names.length)),
  );
}

export function setLayersVisibilityCommand(
  document: ForgeDocument,
  ids: readonly (LayerId | string)[],
  visible: boolean,
): Result<SceneCommand> {
  return batchSettingsCommand(
    document,
    ids,
    { visible },
    (name) => (visible ? `Show “${name}”` : `Hide “${name}”`),
    (count) => (visible ? `Show ${String(count)} layers` : `Hide ${String(count)} layers`),
  );
}

export function setLayersLockCommand(
  document: ForgeDocument,
  ids: readonly (LayerId | string)[],
  locked: boolean,
): Result<SceneCommand> {
  return batchSettingsCommand(
    document,
    ids,
    { locked },
    (name) => (locked ? `Lock “${name}”` : `Unlock “${name}”`),
    (count) => (locked ? `Lock ${String(count)} layers` : `Unlock ${String(count)} layers`),
  );
}

export function setLayersOpacityCommand(
  document: ForgeDocument,
  ids: readonly (LayerId | string)[],
  opacity: number,
): Result<SceneCommand> {
  if (!Number.isFinite(opacity)) {
    return err(forgeError('validation-failed', 'Opacity must be a number between 0 and 100%.'));
  }
  const clamped = Math.max(0, Math.min(1, opacity));
  return batchSettingsCommand(
    document,
    ids,
    { opacity: clamped },
    (name) => `Set “${name}” opacity to ${n(clamped * 100)}%`,
    (count) => `Set opacity of ${String(count)} layers to ${n(clamped * 100)}%`,
  );
}

export function setLayerVisibilityCommand(
  document: ForgeDocument,
  id: LayerId | string,
  visible: boolean,
): Result<SceneCommand> {
  return setLayersVisibilityCommand(document, [id], visible);
}

export function setLayerLockCommand(
  document: ForgeDocument,
  id: LayerId | string,
  locked: boolean,
): Result<SceneCommand> {
  return setLayersLockCommand(document, [id], locked);
}

export function setLayerOpacityCommand(
  document: ForgeDocument,
  id: LayerId | string,
  opacity: number,
): Result<SceneCommand> {
  return setLayersOpacityCommand(document, [id], opacity);
}

/**
 * Applies a new bounding box to one layer.
 *
 * A vector layer's frame is derived from its nodes, so the box is applied *to the geometry*: the
 * outline is transformed from where it is now to where the box says it goes. Patching the stored
 * frame instead would leave a path layer whose frame and outline disagree, which is exactly what the
 * document schema refuses on load.
 */
export function setLayerFrameCommand(
  document: ForgeDocument,
  id: LayerId | string,
  frame: Rect,
  label?: string,
): Result<SceneCommand> {
  const trimmed: Rect = {
    x: Math.round(frame.x * 100) / 100,
    y: Math.round(frame.y * 100) / 100,
    width: Math.max(1, Math.round(frame.width * 100) / 100),
    height: Math.max(1, Math.round(frame.height * 100) / 100),
  };
  const layerName = document.scene.layers.find((layer) => String(layer.id) === String(id))?.name;
  if (layerName === undefined) {
    return err(forgeError('not-found', 'That layer is no longer in the document.'));
  }

  const changed = updateLayer(document.scene, id, { frame: trimmed });
  if (!changed.ok) return err(changed.error);
  return ok({
    label: label ?? `Resize “${layerName}”`,
    patch: freezePatch({ scene: changed.value }),
  });
}

export function setLayerFramesCommand(
  document: ForgeDocument,
  frames: readonly { readonly id: LayerId | string; readonly frame: Rect }[],
  label: string,
): Result<SceneCommand> {
  if (frames.length === 0) {
    return err(forgeError('validation-failed', 'No layers were changed.', { retryable: false }));
  }

  const round = (value: number): number => Math.round(value * 100) / 100;

  let scene = document.scene;
  const textual: { readonly id: LayerId | string; readonly patch: { readonly frame: Rect } }[] = [];
  const vector: {
    readonly layer: Extract<Layer, { type: 'path' }>;
    readonly from: Rect;
    readonly to: Rect;
  }[] = [];

  for (const entry of frames) {
    const layer = document.scene.layers.find(
      (candidate) => String(candidate.id) === String(entry.id),
    );
    if (!layer) {
      return err(
        forgeError('not-found', 'A layer being transformed is no longer in the document.'),
      );
    }
    if (layer.type === 'path') {
      vector.push({ layer, from: layer.frame, to: entry.frame });
      continue;
    }
    textual.push({
      id: entry.id,
      patch: {
        frame: createRect(
          round(entry.frame.x),
          round(entry.frame.y),
          Math.max(1, round(entry.frame.width)),
          Math.max(1, round(entry.frame.height)),
        ),
      },
    });
  }

  // Vector layers are transformed through their geometry first, then the frame-valued layers are
  // patched in one batch, so a mixed selection still moves as one history entry either way.
  for (const entry of vector) {
    const matrix = matrixBetweenBoxes(boxOf(entry.from), boxOf(entry.to));
    if (!matrix) {
      return err(
        forgeError(
          'validation-failed',
          `“${entry.layer.name}” cannot be transformed to an empty box.`,
          { retryable: false },
        ),
      );
    }
    const changed = updatePathGeometry(
      scene,
      entry.layer.id,
      transformPath(entry.layer.vector.path, matrix),
    );
    if (!changed.ok) return err(changed.error);
    scene = changed.value;
  }

  if (textual.length > 0) {
    const changed = updateLayers(scene, textual);
    if (!changed.ok) return err(changed.error);
    scene = changed.value;
  }

  return ok({ label, patch: freezePatch({ scene }) });
}

function boxOf(rect: Rect): VectorBox {
  return { minX: rect.x, minY: rect.y, maxX: rect.x + rect.width, maxY: rect.y + rect.height };
}

/**
 * Sets the bounding box of a multi-layer selection from the inspector.
 *
 * The same maths a handle drag uses (`groupTransformToFit` + `applyGroupTransform`), so typing a
 * width scales the group exactly as dragging its handle would, and the keyboard path is not a
 * separate implementation that can quietly disagree with the pointer.
 */
export function setGroupBoundsCommand(
  document: ForgeDocument,
  ids: readonly (LayerId | string)[],
  bounds: {
    readonly x?: number;
    readonly y?: number;
    readonly width?: number;
    readonly height?: number;
  },
  label?: string,
): Result<SceneCommand> {
  const targets = transformTargetsFor(document, ids);
  if (targets.length === 0) {
    // Say which of the two reasons applies: a selection of locked layers is a normal thing to
    // reach, not a missing document.
    const present = document.scene.layers.some((layer) =>
      ids.some((id) => String(id) === String(layer.id)),
    );
    return err(
      present
        ? forgeError(
            'validation-failed',
            'Every selected layer is locked, so there is nothing to move or resize.',
            { retryable: false },
          )
        : forgeError('not-found', 'That layer is no longer in the document.'),
    );
  }
  const box = unionRects(targets.map((target) => target.frame));
  if (!box) {
    return err(forgeError('not-found', 'That layer is no longer in the document.'));
  }

  const width = bounds.width ?? box.width;
  const height = bounds.height ?? box.height;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    (bounds.x !== undefined && !Number.isFinite(bounds.x)) ||
    (bounds.y !== undefined && !Number.isFinite(bounds.y))
  ) {
    return err(
      forgeError('validation-failed', 'Selection bounds must be positive whole numbers.', {
        retryable: false,
      }),
    );
  }

  const transform: GroupTransform = groupTransformToFit(box, createRect(0, 0, width, height));
  const scaledBounds = applyTransform(targets, transform);
  const dx = (bounds.x ?? box.x) - box.x;
  const dy = (bounds.y ?? box.y) - box.y;

  const frames = scaledBounds.map((target) => ({
    id: target.id,
    frame: createRect(
      target.frame.x + dx,
      target.frame.y + dy,
      target.frame.width,
      target.frame.height,
    ),
  }));

  const changed = updateLayers(
    document.scene,
    frames.map((entry) => ({ id: entry.id, patch: { frame: roundFrame(entry.frame) } })),
  );
  if (!changed.ok) return err(changed.error);

  const name =
    targets.length === 1
      ? `“${targets[0]?.id === undefined ? 'layer' : layerName(document, targets[0].id)}”`
      : `${String(targets.length)} layers`;
  const moved = bounds.x !== undefined || bounds.y !== undefined;
  const sizeChanged = bounds.width !== undefined || bounds.height !== undefined;
  // The label says what actually happened, so history does not claim a resize the user never made.
  const describe =
    moved && !sizeChanged
      ? `Move ${name}`
      : sizeChanged && !moved
        ? `Resize ${name}`
        : `Set ${name} bounds to ${n(Math.round(width))} × ${n(Math.round(height))}`;
  return ok({ label: label ?? describe, patch: freezePatch({ scene: changed.value }) });
}

function layerName(document: ForgeDocument, id: LayerId | string): string {
  return document.scene.layers.find((layer) => String(layer.id) === String(id))?.name ?? 'layer';
}

/** Unlocked, existing layers of a selection, in scene order: what a group gesture can change. */
function transformTargetsFor(
  document: ForgeDocument,
  ids: readonly (LayerId | string)[],
): readonly TransformTarget[] {
  const wanted = new Set(ids.map((id) => String(id)));
  return document.scene.layers
    .filter((layer) => wanted.has(String(layer.id)) && !layer.locked)
    .map((layer) => ({ id: layer.id, frame: layer.frame }));
}

function roundFrame(frame: Rect): Rect {
  return createRect(
    Math.round(frame.x * 100) / 100,
    Math.round(frame.y * 100) / 100,
    Math.max(1, Math.round(frame.width * 100) / 100),
    Math.max(1, Math.round(frame.height * 100) / 100),
  );
}

export function setTextSettingsCommand(
  document: ForgeDocument,
  id: LayerId | string,
  patch: Partial<TextSettings>,
): Result<SceneCommand> {
  const label = named(document, id, (name) => {
    if (patch.content !== undefined) return `Edit text in “${name}”`;
    if (patch.fontSize !== undefined) return `Set “${name}” font size to ${n(patch.fontSize)}px`;
    if (patch.fontWeight !== undefined)
      return `Set “${name}” weight to ${String(patch.fontWeight)}`;
    if (patch.fontStackId !== undefined) return `Change “${name}” typeface`;
    if (patch.lineHeight !== undefined)
      return `Set “${name}” line height to ${n(patch.lineHeight)}x`;
    if (patch.letterSpacing !== undefined) {
      return `Set “${name}” letter spacing to ${n(patch.letterSpacing)}px`;
    }
    if (patch.align !== undefined) return `Align “${name}” text ${patch.align}`;
    if (patch.color !== undefined) return `Set “${name}” text colour to ${patch.color}`;
    return `Update “${name}”`;
  });
  if (!label.ok) return err(label.error);

  const changed = updateLayerSettings(document.scene, id, { text: patch });
  if (!changed.ok) return err(changed.error);
  return ok({ label: label.value, patch: freezePatch({ scene: changed.value }) });
}

export function setShapeSettingsCommand(
  document: ForgeDocument,
  id: LayerId | string,
  patch: Partial<ShapeSettings>,
): Result<SceneCommand> {
  const label = named(document, id, (name) => {
    if (patch.fill !== undefined) {
      return patch.fill === null ? `Remove “${name}” fill` : `Set “${name}” fill to ${patch.fill}`;
    }
    if (patch.stroke !== undefined) {
      return patch.stroke === null
        ? `Remove “${name}” stroke`
        : `Set “${name}” stroke to ${patch.stroke}`;
    }
    if (patch.strokeWidth !== undefined)
      return `Set “${name}” stroke width to ${n(patch.strokeWidth)}px`;
    if (patch.cornerRadius !== undefined)
      return `Set “${name}” corner radius to ${n(patch.cornerRadius)}px`;
    return `Update “${name}”`;
  });
  if (!label.ok) return err(label.error);

  const changed = updateLayerSettings(document.scene, id, { shape: patch });
  if (!changed.ok) return err(changed.error);
  return ok({ label: label.value, patch: freezePatch({ scene: changed.value }) });
}

export function setImageSettingsCommand(
  document: ForgeDocument,
  id: LayerId | string,
  patch: Partial<ImageSettings>,
): Result<SceneCommand> {
  const label = named(document, id, (name) => {
    // Each of the two graphic settings says what it did: a history entry reading "Update" would not
    // tell a person whether the fit or the tint changed.
    if (patch.fit !== undefined) return `Fit “${name}” graphic to ${patch.fit}`;
    if (patch.tint !== undefined) {
      return patch.tint === null ? `Remove “${name}” tint` : `Set “${name}” tint to ${patch.tint}`;
    }
    return `Update “${name}”`;
  });
  if (!label.ok) return err(label.error);

  const changed = updateLayerSettings(document.scene, id, { image: patch });
  if (!changed.ok) return err(changed.error);
  return ok({ label: label.value, patch: freezePatch({ scene: changed.value }) });
}

/* -------------------------------------------------------------------------------------------- */
/* Document-level                                                                                */
/* -------------------------------------------------------------------------------------------- */

/**
 * Applies a palette to the document's working colours.
 *
 * Takes only the colours: the command replaces the palette wholesale, so there is nothing to read
 * from the document first.
 */
export function applyPaletteCommand(
  colors: readonly string[],
  sourceLabel?: string,
): Result<SceneCommand> {
  const cleaned = colors
    .filter((color) => /^#[0-9a-fA-F]{6}$/.test(color))
    .slice(0, 12)
    .map((color) => color.toLowerCase());
  if (cleaned.length === 0) {
    return err(
      forgeError('validation-failed', 'That palette has no usable colours.', { retryable: false }),
    );
  }
  return ok({
    label: sourceLabel ? `Apply palette “${sourceLabel}”` : 'Apply palette',
    patch: freezePatch({ palette: cleaned }),
  });
}

/** Clears the canvas background to an exact colour or to transparent. */
export function setBackgroundCommand(
  document: ForgeDocument,
  background: { readonly color?: string; readonly transparent?: boolean },
): Result<SceneCommand> {
  const color = background.color ?? document.canvas.background;
  const transparent = background.transparent ?? document.canvas.transparent;
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return err(forgeError('validation-failed', 'Background must be a 6-digit hex colour.'));
  }
  if (color === document.canvas.background && transparent === document.canvas.transparent) {
    return err(forgeError('validation-failed', 'That change would not alter the canvas.'));
  }
  return ok({
    label: transparent
      ? 'Make the canvas background transparent'
      : `Set canvas background to ${color}`,
    patch: freezePatch({ canvas: { ...document.canvas, background: color, transparent } }),
  });
}
