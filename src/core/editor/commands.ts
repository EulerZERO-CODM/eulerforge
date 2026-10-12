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
  duplicateLayer,
  moveLayerTo,
  renameLayer,
  reorderLayer,
  updateLayer,
  updateLayerSettings,
  type ReorderTarget,
} from '../documents/layer-operations';
import type {
  AttributionRecord,
  ImageSettings,
  LayerId,
  LayerType,
  ShapeSettings,
  TextSettings,
} from '../documents/layer-types';
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

export function addLayerCommand(
  document: ForgeDocument,
  type: LayerType,
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

export function duplicateLayerCommand(
  document: ForgeDocument,
  id: LayerId | string,
  generateId?: () => string,
): Result<SceneCommand> {
  const duplicated = duplicateLayer(document.scene, id, generateId ? { generateId } : {});
  if (!duplicated.ok) return err(duplicated.error);
  return ok({
    label: `Duplicate “${duplicated.value.layer.name.replace(/ copy$/, '')}”`,
    patch: freezePatch({ scene: duplicated.value.scene }),
  });
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

export function reorderLayerCommand(
  document: ForgeDocument,
  id: LayerId | string,
  target: ReorderTarget,
): Result<SceneCommand> {
  const layer = document.scene.layers.find((candidate) => String(candidate.id) === String(id));
  if (!layer) return err(forgeError('not-found', 'That layer is no longer in the document.'));

  const reordered = reorderLayer(document.scene, id, target);
  if (!reordered.ok) return err(reordered.error);

  const verbs: Record<ReorderTarget, string> = {
    front: 'Bring to front',
    back: 'Send to back',
    forward: 'Bring forward',
    backward: 'Send backward',
  };
  return ok({
    label: `${verbs[target]}: “${layer.name}”`,
    patch: freezePatch({ scene: reordered.value }),
  });
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

export function setLayerVisibilityCommand(
  document: ForgeDocument,
  id: LayerId | string,
  visible: boolean,
): Result<SceneCommand> {
  const named_ = named(document, id, (name) => (visible ? `Show “${name}”` : `Hide “${name}”`));
  if (!named_.ok) return err(named_.error);

  const changed = updateLayer(document.scene, id, { visible });
  if (!changed.ok) return err(changed.error);
  return ok({ label: named_.value, patch: freezePatch({ scene: changed.value }) });
}

export function setLayerLockCommand(
  document: ForgeDocument,
  id: LayerId | string,
  locked: boolean,
): Result<SceneCommand> {
  const label = named(document, id, (name) => (locked ? `Lock “${name}”` : `Unlock “${name}”`));
  if (!label.ok) return err(label.error);

  const changed = updateLayer(document.scene, id, { locked });
  if (!changed.ok) return err(changed.error);
  return ok({ label: label.value, patch: freezePatch({ scene: changed.value }) });
}

export function setLayerOpacityCommand(
  document: ForgeDocument,
  id: LayerId | string,
  opacity: number,
): Result<SceneCommand> {
  const clamped = Math.max(0, Math.min(1, opacity));
  const label = named(document, id, (name) => `Set “${name}” opacity to ${n(clamped * 100)}%`);
  if (!label.ok) return err(label.error);
  if (!Number.isFinite(opacity)) {
    return err(forgeError('validation-failed', 'Opacity must be a number between 0 and 100%.'));
  }

  const changed = updateLayer(document.scene, id, { opacity: clamped });
  if (!changed.ok) return err(changed.error);
  return ok({ label: label.value, patch: freezePatch({ scene: changed.value }) });
}

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
  const changed = updateLayer(document.scene, id, { frame: trimmed });
  if (!changed.ok) return err(changed.error);

  const layerName = document.scene.layers.find((layer) => String(layer.id) === String(id))?.name;
  if (layerName === undefined) {
    return err(forgeError('not-found', 'That layer is no longer in the document.'));
  }
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
  let scene = document.scene;
  for (const entry of frames) {
    const changed = updateLayer(scene, entry.id, {
      frame: {
        x: Math.round(entry.frame.x * 100) / 100,
        y: Math.round(entry.frame.y * 100) / 100,
        width: Math.max(1, Math.round(entry.frame.width * 100) / 100),
        height: Math.max(1, Math.round(entry.frame.height * 100) / 100),
      },
    });
    if (!changed.ok) return err(changed.error);
    scene = changed.value;
  }
  return ok({ label, patch: freezePatch({ scene }) });
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
  const label = named(document, id, (name) =>
    patch.fit === undefined ? `Update “${name}”` : `Fit “${name}” graphic to ${patch.fit}`,
  );
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
