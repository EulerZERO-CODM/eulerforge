/**
 * Photo editing commands.
 *
 * Every action a photographer can take is one command with a human label and a document patch, so
 * undo, redo, persistence and the save indicator behave exactly as they do in the other studios.
 * Nothing here touches the DOM: the commands operate on the payload and return immutable values.
 */

import type { ForgeDocument } from '../documents/types';
import {
  MAX_MASK_RANGES,
  MAX_MASK_STROKES,
  MAX_PHOTO_ADJUSTMENTS,
  MAX_RETOUCH_STROKES,
  PHOTO_ADJUSTMENT_INFO,
  createPayloadItemId,
  maskHasCoverage,
  type PhotoPoint,
  type PhotoAdjustment,
  type PhotoAdjustmentKind,
  type PhotoEnginePreference,
  type PhotoMask,
  type PhotoMaskStroke,
  type PhotoPayload,
  type PhotoRangeSelection,
  type PhotoRetouchStroke,
  type PhotoSource,
  type RetouchMode,
} from '../documents/payload';
import type { SceneCommand } from '../editor/commands';
import { err, forgeError, ok, type Result } from '../result';

function photoPayload(document: ForgeDocument): Result<PhotoPayload> {
  const payload = document.studioPayload;
  if (!payload || payload.kind !== 'photo') {
    return err(
      forgeError('validation-failed', 'This document is not a photo document.', {
        detail: 'Photo commands only apply to documents whose studio payload is a photo.',
        retryable: false,
      }),
    );
  }
  return ok(payload);
}

function withPayload(
  document: ForgeDocument,
  payload: PhotoPayload,
  label: string,
): Result<SceneCommand> {
  void document;
  return ok({ label, patch: { studioPayload: payload } });
}

/**
 * Replaces the embedded working copy, e.g. after an import.
 *
 * The document canvas follows the image: a photo document's canvas *is* the photo, so exporting at
 * canvas size means exporting the same pixels the preview shows. Unit, DPI and background are kept.
 */
export function setPhotoSourceCommand(
  document: ForgeDocument,
  source: PhotoSource,
  options: { readonly resetEdits?: boolean } = {},
): Result<SceneCommand> {
  const payload = photoPayload(document);
  if (!payload.ok) return payload;
  const next: PhotoPayload = {
    ...payload.value,
    source,
    ...(options.resetEdits === true ? { adjustments: [], mask: null, retouch: [] } : {}),
  };
  return ok({
    label: `Import “${source.name}”`,
    patch: {
      studioPayload: next,
      canvas: {
        ...document.canvas,
        width: source.width,
        height: source.height,
      },
    },
  });
}

/** Adds an adjustment to the top of the stack with the kind's documented initial value. */
export function addPhotoAdjustmentCommand(
  document: ForgeDocument,
  kind: PhotoAdjustmentKind,
): Result<SceneCommand> {
  const payload = photoPayload(document);
  if (!payload.ok) return payload;
  if (payload.value.adjustments.length >= MAX_PHOTO_ADJUSTMENTS) {
    return err(
      forgeError('validation-failed', 'The adjustment stack is full.', {
        detail: `A photo can carry at most ${String(MAX_PHOTO_ADJUSTMENTS)} adjustments. Remove one first.`,
        retryable: false,
      }),
    );
  }
  const info = PHOTO_ADJUSTMENT_INFO[kind];
  const adjustment: PhotoAdjustment = {
    id: createPayloadItemId(kind),
    kind,
    value: info.initial,
    enabled: true,
  };
  return withPayload(
    document,
    { ...payload.value, adjustments: [...payload.value.adjustments, adjustment] },
    `Add ${info.label.toLowerCase()}`,
  );
}

/** Sets one adjustment's value. Out-of-range input is clamped to the documented range. */
export function setPhotoAdjustmentValueCommand(
  document: ForgeDocument,
  id: string,
  value: number,
): Result<SceneCommand> {
  const payload = photoPayload(document);
  if (!payload.ok) return payload;
  const adjustment = payload.value.adjustments.find((item) => item.id === id);
  if (!adjustment) {
    return err(forgeError('not-found', 'That adjustment is no longer in the stack.'));
  }
  if (!Number.isFinite(value)) {
    return err(forgeError('validation-failed', 'The adjustment value must be a finite number.'));
  }
  const info = PHOTO_ADJUSTMENT_INFO[adjustment.kind];
  const clamped = Math.min(info.max, Math.max(info.min, value));
  if (clamped === adjustment.value) {
    return err(forgeError('validation-failed', 'That value is unchanged.', { retryable: false }));
  }
  const adjustments = payload.value.adjustments.map((item) =>
    item.id === id ? { ...item, value: clamped } : item,
  );
  return withPayload(
    document,
    { ...payload.value, adjustments },
    `${info.label} ${formatSigned(clamped)}`,
  );
}

function formatSigned(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? `+${String(rounded)}` : String(rounded);
}

/** Enables or bypasses one adjustment without losing its value. */
export function setPhotoAdjustmentEnabledCommand(
  document: ForgeDocument,
  id: string,
  enabled: boolean,
): Result<SceneCommand> {
  const payload = photoPayload(document);
  if (!payload.ok) return payload;
  const adjustment = payload.value.adjustments.find((item) => item.id === id);
  if (!adjustment) {
    return err(forgeError('not-found', 'That adjustment is no longer in the stack.'));
  }
  const adjustments = payload.value.adjustments.map((item) =>
    item.id === id ? { ...item, enabled } : item,
  );
  return withPayload(
    document,
    { ...payload.value, adjustments },
    `${enabled ? 'Enable' : 'Bypass'} ${PHOTO_ADJUSTMENT_INFO[adjustment.kind].label.toLowerCase()}`,
  );
}

/** Removes an adjustment from the stack. */
export function removePhotoAdjustmentCommand(
  document: ForgeDocument,
  id: string,
): Result<SceneCommand> {
  const payload = photoPayload(document);
  if (!payload.ok) return payload;
  const adjustment = payload.value.adjustments.find((item) => item.id === id);
  if (!adjustment) {
    return err(forgeError('not-found', 'That adjustment is no longer in the stack.'));
  }
  return withPayload(
    document,
    {
      ...payload.value,
      adjustments: payload.value.adjustments.filter((item) => item.id !== id),
    },
    `Remove ${PHOTO_ADJUSTMENT_INFO[adjustment.kind].label.toLowerCase()}`,
  );
}

/** Moves an adjustment one place earlier or later in the stack (the order is the edit order). */
export function movePhotoAdjustmentCommand(
  document: ForgeDocument,
  id: string,
  direction: 'up' | 'down',
): Result<SceneCommand> {
  const payload = photoPayload(document);
  if (!payload.ok) return payload;
  const index = payload.value.adjustments.findIndex((item) => item.id === id);
  if (index < 0) return err(forgeError('not-found', 'That adjustment is no longer in the stack.'));
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= payload.value.adjustments.length) {
    return err(forgeError('validation-failed', 'That adjustment is already at the end.'));
  }
  const adjustments = [...payload.value.adjustments];
  const current = adjustments[index];
  const other = adjustments[target];
  if (!current || !other) return err(forgeError('validation-failed', 'That move is not possible.'));
  adjustments[index] = other;
  adjustments[target] = current;
  const label = PHOTO_ADJUSTMENT_INFO[current.kind].label.toLowerCase();
  return withPayload(
    document,
    { ...payload.value, adjustments },
    `Move ${label} ${direction === 'up' ? 'earlier' : 'later'}`,
  );
}

/* --------------------------------------------------------------------------------------------- */
/* Mask and retouch                                                                               */
/* --------------------------------------------------------------------------------------------- */

export type MaskStrokeInput = {
  readonly points: readonly PhotoPoint[];
  readonly radius: number;
  readonly hardness: number;
  readonly erase: boolean;
  readonly fill: boolean;
};

/** Adds one mask stroke (a brush pass or a filled lasso) as a single undoable action. */
export function addMaskStrokeCommand(
  document: ForgeDocument,
  stroke: MaskStrokeInput,
): Result<SceneCommand> {
  const payload = photoPayload(document);
  if (!payload.ok) return payload;
  if (stroke.points.length === 0) {
    return err(forgeError('validation-failed', 'A mask stroke needs at least one point.'));
  }
  const mask = payload.value.mask ?? { strokes: [], inverted: false };
  if (mask.strokes.length >= MAX_MASK_STROKES) {
    return err(
      forgeError('validation-failed', 'The mask has reached its stroke limit.', {
        detail: `Clear the mask or remove strokes; at most ${String(MAX_MASK_STROKES)} are kept.`,
        retryable: false,
      }),
    );
  }
  const nextStroke: PhotoMaskStroke = {
    id: createPayloadItemId('mask'),
    points: stroke.points.map((point) => ({
      x: Math.min(1.25, Math.max(-0.25, point.x)),
      y: Math.min(1.25, Math.max(-0.25, point.y)),
    })),
    radius: Math.min(0.5, Math.max(0.001, stroke.radius)),
    hardness: Math.min(1, Math.max(0, stroke.hardness)),
    erase: stroke.erase,
    fill: stroke.fill,
  };
  return withPayload(
    document,
    { ...payload.value, mask: { ...mask, strokes: [...mask.strokes, nextStroke] } },
    stroke.erase ? 'Erase mask' : stroke.fill ? 'Lasso mask' : 'Paint mask',
  );
}

export function undoMaskStrokeCommand(document: ForgeDocument): Result<SceneCommand> {
  const payload = photoPayload(document);
  if (!payload.ok) return payload;
  const mask = payload.value.mask;
  if (!mask || mask.strokes.length === 0) {
    return err(forgeError('validation-failed', 'The mask has no strokes to remove.'));
  }
  return withPayload(
    document,
    { ...payload.value, mask: { ...mask, strokes: mask.strokes.slice(0, -1) } },
    'Remove last mask stroke',
  );
}

export function clearMaskCommand(document: ForgeDocument): Result<SceneCommand> {
  const payload = photoPayload(document);
  if (!payload.ok) return payload;
  const mask = payload.value.mask;
  if (!mask || !maskHasCoverage(mask)) {
    return err(forgeError('validation-failed', 'The mask is already empty.'));
  }
  return withPayload(
    document,
    { ...payload.value, mask: { ...mask, strokes: [], ranges: [] } },
    'Clear mask',
  );
}

/* --------------------------------------------------------------------------------------------- */
/* Range selections                                                                               */
/* --------------------------------------------------------------------------------------------- */

export type RangeSelectionInput =
  | {
      readonly kind: 'luminance';
      readonly min: number;
      readonly max: number;
      readonly feather: number;
    }
  | {
      readonly kind: 'colour';
      readonly colour: string;
      readonly tolerance: number;
      readonly feather: number;
    };

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

/**
 * Adds one source-pixel selection to the mask.
 *
 * The selection is stored, not rasterised: it is evaluated against the photograph every time it is
 * needed, so it stays correct if the preview size changes and it can be removed without a bitmap to
 * undo. Ranges and painted strokes combine as a union, and the mask's inversion applies to the union.
 */
export function addRangeSelectionCommand(
  document: ForgeDocument,
  input: RangeSelectionInput,
): Result<SceneCommand> {
  const payload = photoPayload(document);
  if (!payload.ok) return payload;
  if (payload.value.source === null) {
    return err(
      forgeError('validation-failed', 'Import a photograph before selecting part of it.', {
        detail: 'A range selection is measured from the photograph’s own pixels.',
        retryable: false,
      }),
    );
  }
  const mask = payload.value.mask ?? { strokes: [], inverted: false };
  const ranges = mask.ranges ?? [];
  if (ranges.length >= MAX_MASK_RANGES) {
    return err(
      forgeError('validation-failed', 'This mask already holds the maximum number of ranges.', {
        detail: `At most ${String(MAX_MASK_RANGES)} range selections are kept per mask.`,
        retryable: false,
      }),
    );
  }

  const feather = Math.min(1, Math.max(0, input.feather));
  let range: PhotoRangeSelection;
  if (input.kind === 'luminance') {
    const min = Math.min(1, Math.max(0, input.min));
    const max = Math.min(1, Math.max(0, input.max));
    if (!(min <= max)) {
      return err(
        forgeError('validation-failed', 'The luminance range ends before it starts.', {
          detail: 'Set the lower bound at or below the upper bound.',
          retryable: false,
        }),
      );
    }
    range = { id: createPayloadItemId('range'), kind: 'luminance', min, max, feather };
  } else {
    if (!HEX_COLOUR.test(input.colour)) {
      return err(
        forgeError('validation-failed', 'A colour selection needs a six-digit hex colour.', {
          retryable: false,
        }),
      );
    }
    range = {
      id: createPayloadItemId('range'),
      kind: 'colour',
      colour: input.colour.toLowerCase(),
      tolerance: Math.min(1, Math.max(0, input.tolerance)),
      feather,
    };
  }

  return withPayload(
    document,
    { ...payload.value, mask: { ...mask, ranges: [...ranges, range] } },
    range.kind === 'luminance' ? 'Select by luminance' : 'Select by colour',
  );
}

export function removeRangeSelectionCommand(
  document: ForgeDocument,
  id: string,
): Result<SceneCommand> {
  const payload = photoPayload(document);
  if (!payload.ok) return payload;
  const mask = payload.value.mask;
  const ranges = mask?.ranges ?? [];
  if (!ranges.some((range) => range.id === id)) {
    return err(forgeError('validation-failed', 'That range selection is not in this mask.'));
  }
  return withPayload(
    document,
    {
      ...payload.value,
      mask: { ...(mask as PhotoMask), ranges: ranges.filter((range) => range.id !== id) },
    },
    'Remove range selection',
  );
}

export function clearRangeSelectionsCommand(document: ForgeDocument): Result<SceneCommand> {
  const payload = photoPayload(document);
  if (!payload.ok) return payload;
  const mask = payload.value.mask;
  const ranges = mask?.ranges ?? [];
  if (ranges.length === 0) {
    return err(forgeError('validation-failed', 'This mask has no range selections.'));
  }
  return withPayload(
    document,
    { ...payload.value, mask: { ...(mask as PhotoMask), ranges: [] } },
    'Clear range selections',
  );
}

export function setMaskInvertedCommand(
  document: ForgeDocument,
  inverted: boolean,
): Result<SceneCommand> {
  const payload = photoPayload(document);
  if (!payload.ok) return payload;
  const mask: PhotoMask = payload.value.mask ?? { strokes: [], inverted: false };
  return withPayload(
    document,
    { ...payload.value, mask: { ...mask, inverted } },
    inverted ? 'Invert mask' : 'Un-invert mask',
  );
}

export type RetouchStrokeInput = {
  readonly mode: RetouchMode;
  readonly points: readonly PhotoPoint[];
  readonly radius: number;
  readonly hardness: number;
  readonly offsetX: number;
  readonly offsetY: number;
};

export function addRetouchStrokeCommand(
  document: ForgeDocument,
  stroke: RetouchStrokeInput,
): Result<SceneCommand> {
  const payload = photoPayload(document);
  if (!payload.ok) return payload;
  if (stroke.points.length === 0) {
    return err(forgeError('validation-failed', 'A retouch stroke needs at least one point.'));
  }
  if (payload.value.retouch.length >= MAX_RETOUCH_STROKES) {
    return err(
      forgeError('validation-failed', 'The retouch stack is full.', {
        detail: `At most ${String(MAX_RETOUCH_STROKES)} retouch strokes are kept.`,
        retryable: false,
      }),
    );
  }
  const next: PhotoRetouchStroke = {
    id: createPayloadItemId('retouch'),
    mode: stroke.mode,
    points: stroke.points.map((point) => ({ x: point.x, y: point.y })),
    radius: Math.min(0.5, Math.max(0.001, stroke.radius)),
    hardness: Math.min(1, Math.max(0, stroke.hardness)),
    offsetX: Math.min(1, Math.max(-1, stroke.offsetX)),
    offsetY: Math.min(1, Math.max(-1, stroke.offsetY)),
  };
  return withPayload(
    document,
    { ...payload.value, retouch: [...payload.value.retouch, next] },
    stroke.mode === 'clone' ? 'Clone stamp' : 'Heal spot',
  );
}

export function undoRetouchCommand(document: ForgeDocument): Result<SceneCommand> {
  const payload = photoPayload(document);
  if (!payload.ok) return payload;
  if (payload.value.retouch.length === 0) {
    return err(forgeError('validation-failed', 'There is no retouch stroke to remove.'));
  }
  return withPayload(
    document,
    { ...payload.value, retouch: payload.value.retouch.slice(0, -1) },
    'Remove last retouch',
  );
}

export function clearRetouchCommand(document: ForgeDocument): Result<SceneCommand> {
  const payload = photoPayload(document);
  if (!payload.ok) return payload;
  if (payload.value.retouch.length === 0) {
    return err(forgeError('validation-failed', 'There is no retouch to clear.'));
  }
  return withPayload(document, { ...payload.value, retouch: [] }, 'Clear retouch');
}

/** Chooses which renderer to use; the choice is part of the document so it survives a reload. */
export function setPhotoEngineCommand(
  document: ForgeDocument,
  engine: PhotoEnginePreference,
): Result<SceneCommand> {
  const payload = photoPayload(document);
  if (!payload.ok) return payload;
  if (payload.value.engine === engine) {
    return err(forgeError('validation-failed', 'That engine is already selected.'));
  }
  const label =
    engine === 'webgl2'
      ? 'Use the GPU renderer'
      : engine === 'canvas2d'
        ? 'Use the CPU renderer'
        : 'Choose the renderer automatically';
  return withPayload(document, { ...payload.value, engine }, label);
}

/** True when the payload has an image and at least one enabled adjustment or retouch. */
export function photoHasEdits(payload: PhotoPayload): boolean {
  return (
    payload.adjustments.some((adjustment) => adjustment.enabled && adjustment.value !== 0) ||
    payload.retouch.length > 0 ||
    maskHasCoverage(payload.mask)
  );
}
