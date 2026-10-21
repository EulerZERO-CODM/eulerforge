/**
 * Layer operations.
 *
 * Every operation is a pure function that returns a new `Scene`; nothing mutates in place. They are
 * deliberately *not* commands: a command decides what to call an edit and when to record it, while
 * these functions only say what the new state is. That separation is what lets the editor preview a
 * drag without touching history.
 *
 * Z-order is positional: index 0 is the bottom-most layer. Reordering helpers move one layer by a
 * step or to an extreme, so the same function backs both a button ("bring forward") and the layer
 * tree's keyboard shortcuts.
 */

import { err, forgeError, ok, type Result } from '../result';
import { brand } from '../types/brand';
import { createRect, type Rect } from './geometry';
import { asLayerId } from './layer-types';
import type {
  AttributionRecord,
  EllipseLayer,
  ImageLayer,
  ImageSettings,
  Layer,
  LayerId,
  LayerType,
  RectLayer,
  Scene,
  ShapeSettings,
  TextLayer,
  TextSettings,
} from './layer-types';
import { MAX_ATTRIBUTION_RECORDS, MAX_LAYERS, MAX_LAYER_NAME_LENGTH } from './layer-types';
import { DEFAULT_LAYER_OPACITY, defaultNameFor, layerDefaultsFor } from './layer-defaults';
import { validateLayer, validateTextSettings as textSettingsIssues } from './validation';

export const EMPTY_SCENE: Scene = Object.freeze({ layers: Object.freeze([]) });

export type LayerIdGenerator = () => string;

/** Collision-resistant layer id; mirrors the document id generator's approach. */
export function createLayerId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `lyr-${Date.now().toString(36)}-${random}`;
}

export function emptyScene(): Scene {
  return EMPTY_SCENE;
}

function freezeScene(layers: readonly Layer[]): Scene {
  return Object.freeze({ layers: Object.freeze([...layers]) });
}

/** True when both scenes hold the same layers in the same order, by value. */
export function scenesEqual(a: Scene, b: Scene): boolean {
  if (a.layers === b.layers) return true;
  if (a.layers.length !== b.layers.length) return false;
  return a.layers.every((layer, index) => layersEqual(layer, b.layers[index]));
}

function layersEqual(a: Layer | undefined, b: Layer | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Deep-freezes a layer so a caller cannot mutate one that is already inside a scene. */
export function freezeLayer(layer: Layer): Layer {
  switch (layer.type) {
    case 'text':
      return Object.freeze({
        ...layer,
        frame: Object.freeze(layer.frame),
        text: Object.freeze(layer.text),
      });
    case 'rect':
    case 'ellipse':
      return Object.freeze({
        ...layer,
        frame: Object.freeze(layer.frame),
        shape: Object.freeze(layer.shape),
      });
    case 'image':
      return Object.freeze({
        ...layer,
        frame: Object.freeze(layer.frame),
        image: Object.freeze(layer.image),
      });
  }
}

export type CreateLayerOptions = {
  readonly id?: LayerId;
  readonly name?: string;
  readonly generateId?: LayerIdGenerator;
};

function nextId(options: CreateLayerOptions, existing: readonly Layer[]): Result<LayerId> {
  const generate = options.generateId ?? createLayerId;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate: LayerId = options.id ?? asLayerId(generate());
    if (!existing.some((layer) => layer.id === candidate)) return ok(candidate);
    if (options.id !== undefined) break;
  }
  return err(
    forgeError('validation-failed', 'A unique layer id could not be generated.', {
      detail: 'Retry the operation; if it repeats, the scene may hold a duplicate id.',
    }),
  );
}

function boundedName(name: string | undefined, fallback: string): string {
  const trimmed = (name ?? fallback).trim();
  const safe = trimmed.length === 0 ? fallback : trimmed;
  return safe.slice(0, MAX_LAYER_NAME_LENGTH);
}

export type NewLayerInput =
  | {
      readonly type: 'text';
      readonly frame: Rect;
      readonly text?: Partial<TextSettings> | undefined;
    }
  | {
      readonly type: 'rect';
      readonly frame: Rect;
      readonly shape?: Partial<ShapeSettings> | undefined;
    }
  | {
      readonly type: 'ellipse';
      readonly frame: Rect;
      readonly shape?: Partial<ShapeSettings> | undefined;
    }
  | {
      readonly type: 'image';
      readonly frame: Rect;
      readonly image: Partial<ImageSettings> & { href: string };
    };

/**
 * Builds a layer from partial input, filling unspecified properties from the defaults for its type.
 *
 * Returns a `Result` rather than throwing because the same code path serves user input (a toolbar
 * click) and untrusted data (a duplicated layer read back from storage).
 */
export function createLayer(input: NewLayerInput, options: CreateLayerOptions = {}): Result<Layer> {
  const defaults = layerDefaultsFor(input.type);
  const base = {
    visible: true,
    locked: false,
    opacity: DEFAULT_LAYER_OPACITY,
    frame: createRect(input.frame.x, input.frame.y, input.frame.width, input.frame.height),
  };

  switch (input.type) {
    case 'text': {
      const layer: TextLayer = {
        ...base,
        id: brand<'LayerId'>('pending'),
        name: '',
        type: 'text',
        text: { ...defaults.text, ...input.text },
      };
      return finalise(layer, input.type, options);
    }
    case 'rect':
    case 'ellipse': {
      const layer: RectLayer | EllipseLayer = {
        ...base,
        id: brand<'LayerId'>('pending'),
        name: '',
        type: input.type,
        shape: { ...defaults.shape, ...input.shape },
      };
      return finalise(layer, input.type, options);
    }
    case 'image': {
      const layer: ImageLayer = {
        ...base,
        id: brand<'LayerId'>('pending'),
        name: '',
        type: 'image',
        image: {
          assetId: input.image.assetId ?? null,
          href: input.image.href,
          intrinsicWidth: input.image.intrinsicWidth ?? Math.round(input.frame.width),
          intrinsicHeight: input.image.intrinsicHeight ?? Math.round(input.frame.height),
          fit: input.image.fit ?? 'contain',
          tint: input.image.tint ?? null,
        },
      };
      return finalise(layer, 'image', options);
    }
  }
}

function finalise(layer: Layer, type: LayerType, options: CreateLayerOptions): Result<Layer> {
  const id = options.id ?? brand<'LayerId'>((options.generateId ?? createLayerId)());
  const named = { ...layer, id, name: boundedName(options.name, defaultNameFor(type)) } as Layer;
  return ok(freezeLayer(named));
}

/**
 * Appends a layer on top of the scene.
 *
 * Refuses once `MAX_LAYERS` is reached: a boundless scene is a resource limit the browser would
 * otherwise enforce by becoming unresponsive.
 */
export function addLayer(scene: Scene, layer: Layer): Result<Scene> {
  if (scene.layers.some((existing) => existing.id === layer.id)) {
    return err(
      forgeError('validation-failed', 'A layer with that id already exists in the scene.', {
        detail: `Duplicate layer id: ${layer.id}`,
      }),
    );
  }
  if (scene.layers.length >= MAX_LAYERS) {
    return err(
      forgeError(
        'unsupported',
        `This document already holds the maximum of ${MAX_LAYERS} layers.`,
        {
          detail: 'Delete or group layers before adding more.',
        },
      ),
    );
  }
  return ok(freezeScene([...scene.layers, layer]));
}

/** Adds a new layer built from `input` directly onto the scene. */
export function addNewLayer(
  scene: Scene,
  input: NewLayerInput,
  options: CreateLayerOptions = {},
): Result<{ readonly scene: Scene; readonly layer: Layer }> {
  const id = nextId(options, scene.layers);
  if (!id.ok) return err(id.error);

  const layer = createLayer(input, { ...options, id: id.value });
  if (!layer.ok) return err(layer.error);

  const next = addLayer(scene, layer.value);
  if (!next.ok) return err(next.error);

  return ok({ scene: next.value, layer: layer.value });
}

/**
 * A change to a layer's own properties.
 *
 * `id` and `type` are absent by design: changing either would silently repoint selection or
 * reinterpret stored settings. Type-specific properties are listed explicitly so a patch that tries
 * to give a rectangle some text is rejected at compile time, not discovered at render time.
 */
export type LayerPatch = {
  readonly name?: string;
  readonly visible?: boolean;
  readonly locked?: boolean;
  readonly opacity?: number;
  readonly frame?: Rect;
  readonly text?: TextSettings;
  readonly shape?: ShapeSettings;
  readonly image?: ImageSettings;
};

/** Settings a patch may carry, checked against the layer's type before the patch is applied. */
const PATCH_PROPERTY_TYPES = {
  text: 'text',
  shape: 'shape',
  image: 'image',
} as const;

function patchMatchesLayerType(layer: Layer, patch: LayerPatch): boolean {
  for (const property of ['text', 'shape', 'image'] as const) {
    if (patch[property] === undefined) continue;
    const expects = PATCH_PROPERTY_TYPES[property];
    if (property === 'shape') {
      if (layer.type !== 'rect' && layer.type !== 'ellipse') return false;
      continue;
    }
    if (layer.type !== expects) return false;
  }
  return true;
}

/**
 * Replaces one layer, keeping its position in the stack.
 *
 * The patch is merged over the existing layer, so a caller changes one property without having to
 * reconstruct the layer — which is what makes inspector edits read as single-line intentions.
 */
export function updateLayer(scene: Scene, id: LayerId | string, patch: LayerPatch): Result<Scene> {
  const index = scene.layers.findIndex((layer) => layer.id === id);
  if (index === -1) {
    return err(forgeError('not-found', 'That layer is no longer in the document.'));
  }
  const existing = scene.layers[index];
  if (!existing) return err(forgeError('not-found', 'That layer is no longer in the document.'));
  if (!patchMatchesLayerType(existing, patch)) {
    return err(
      forgeError('validation-failed', 'That setting does not apply to this layer type.', {
        detail: `Layer "${existing.name}" is a ${existing.type} layer.`,
        retryable: false,
      }),
    );
  }

  const merged = { ...existing, ...patch } as Layer;

  // The layer is re-checked *after* the merge, so a patch can never leave the scene in a state the
  // schema would refuse. A gesture that would do so (dragging a layer to an impossible coordinate)
  // gets a normal error result and simply stops applying, rather than corrupting the document.
  const issues = validateLayer(merged);
  if (issues.length > 0) {
    return err(
      forgeError('validation-failed', issues[0]?.message ?? 'That change is not valid.', {
        detail: issues
          .slice(1)
          .map((issue) => issue.message)
          .join(' '),
        retryable: false,
      }),
    );
  }

  const next = [...scene.layers];
  next[index] = freezeLayer(merged);
  return ok(freezeScene(next));
}

/** Applies a type-specific nested patch (text settings, shape settings or image settings). */
/**
 * Applies a type-specific nested patch (text settings, shape settings or image settings).
 *
 * Settings that do not belong to the layer's type are an *error*, not something quietly dropped: an
 * edit that reports success while changing nothing is exactly the kind of dishonesty this codebase
 * refuses. The inspector is structured so a user cannot reach this path, and the guard stays as the
 * safety net behind it.
 */
export function updateLayerSettings(
  scene: Scene,
  id: LayerId | string,
  patch: {
    readonly text?: Partial<TextSettings> | undefined;
    readonly shape?: Partial<ShapeSettings> | undefined;
    readonly image?: Partial<ImageSettings> | undefined;
  },
): Result<Scene> {
  const existing = scene.layers.find((layer) => layer.id === id);
  if (!existing) return err(forgeError('not-found', 'That layer is no longer in the document.'));

  const mismatched =
    (patch.text !== undefined && existing.type !== 'text') ||
    (patch.image !== undefined && existing.type !== 'image') ||
    (patch.shape !== undefined && existing.type !== 'rect' && existing.type !== 'ellipse');
  if (mismatched) {
    return err(
      forgeError('validation-failed', 'That setting does not apply to this layer type.', {
        detail: `Layer "${existing.name}" is a ${existing.type} layer.`,
        retryable: false,
      }),
    );
  }

  switch (existing.type) {
    case 'text':
      return patch.text
        ? updateLayer(scene, id, { text: { ...existing.text, ...patch.text } })
        : ok(scene);
    case 'rect':
    case 'ellipse':
      return patch.shape
        ? updateLayer(scene, id, { shape: { ...existing.shape, ...patch.shape } })
        : ok(scene);
    case 'image':
      return patch.image
        ? updateLayer(scene, id, { image: { ...existing.image, ...patch.image } })
        : ok(scene);
  }
}

export function deleteLayer(scene: Scene, id: LayerId | string): Result<Scene> {
  const remaining = scene.layers.filter((layer) => layer.id !== id);
  if (remaining.length === scene.layers.length) {
    return err(forgeError('not-found', 'That layer is no longer in the document.'));
  }
  return ok(freezeScene(remaining));
}

export function deleteLayers(scene: Scene, ids: readonly (LayerId | string)[]): Result<Scene> {
  const removing = new Set(ids.map(String));
  if (removing.size === 0) return ok(scene);
  const remaining = scene.layers.filter((layer) => !removing.has(String(layer.id)));
  if (remaining.length === scene.layers.length) {
    return err(forgeError('not-found', 'Those layers are no longer in the document.'));
  }
  return ok(freezeScene(remaining));
}

function copyName(name: string): string {
  const base = `${name} copy`;
  return base.length <= MAX_LAYER_NAME_LENGTH
    ? base
    : `${base.slice(0, MAX_LAYER_NAME_LENGTH - 5)} copy`;
}

/**
 * Duplicates a layer directly above the original.
 *
 * The copy gets a fresh id and a distinct name; everything else is preserved so duplicating is a
 * faithful "make another one of these". Delegates to `duplicateLayers` so the single and batch paths
 * cannot diverge.
 */
export function duplicateLayer(
  scene: Scene,
  id: LayerId | string,
  options: CreateLayerOptions = {},
): Result<{ readonly scene: Scene; readonly layer: Layer }> {
  const duplicated = duplicateLayers(scene, [id], options);
  if (!duplicated.ok) return err(duplicated.error);
  const layer = duplicated.value.layers[0];
  if (!layer) return err(forgeError('not-found', 'That layer is no longer in the document.'));
  return ok({ scene: duplicated.value.scene, layer });
}

export type ReorderTarget = 'front' | 'back' | 'forward' | 'backward';

/**
 * Moves a layer within the stack.
 *
 * `forward`/`backward` step one position; `front`/`back` go to the extremes. Moving past either end
 * is a no-op that succeeds, so a button bound to "bring forward" is safe to press repeatedly.
 */
/** Moves one layer within the stack. Delegates to the batch operation: one code path, one meaning. */
export function reorderLayer(
  scene: Scene,
  id: LayerId | string,
  target: ReorderTarget,
): Result<Scene> {
  return reorderLayers(scene, [id], target);
}

/**
 * Duplicates several layers in one pass.
 *
 * Each copy is inserted directly above its own source, so the result keeps both the scene's order and
 * the selection's relative order — duplicating three layers in a stack gives three copies sitting
 * where their originals were, not three copies piled at the top. Ids are generated against the whole
 * growing result, so duplicates can never collide with each other.
 */
export function duplicateLayers(
  scene: Scene,
  ids: readonly (LayerId | string)[],
  options: CreateLayerOptions = {},
): Result<{ readonly scene: Scene; readonly layers: readonly Layer[] }> {
  const wanted = new Set(ids.map((id) => String(id)));
  const selected = scene.layers.filter((layer) => wanted.has(String(layer.id)));
  if (selected.length === 0) {
    return err(forgeError('not-found', 'That layer is no longer in the document.'));
  }
  if (scene.layers.length + selected.length > MAX_LAYERS) {
    return err(
      forgeError(
        'unsupported',
        `This document can hold at most ${MAX_LAYERS} layers; duplicating these would exceed it.`,
      ),
    );
  }

  const next: Layer[] = [];
  const copies: Layer[] = [];
  for (const layer of scene.layers) {
    next.push(layer);
    if (!wanted.has(String(layer.id))) continue;
    const generatedId = nextId(options, next);
    if (!generatedId.ok) return err(generatedId.error);
    const copy: Layer = freezeLayer({
      ...layer,
      id: generatedId.value,
      name: copyName(layer.name),
    });
    next.push(copy);
    copies.push(copy);
  }

  return ok({ scene: freezeScene(next), layers: Object.freeze(copies) });
}

/**
 * Moves a whole selection within the stack, as one operation.
 *
 * `forward` and `backward` step the selected block past its unselected neighbours without letting
 * selected layers cross each other, so the selection's internal order is preserved no matter how
 * many times the button is pressed. `front` and `back` move the whole block to an extreme, again in
 * order. Doing this per layer instead would let later moves undo earlier ones.
 */
export function reorderLayers(
  scene: Scene,
  ids: readonly (LayerId | string)[],
  target: ReorderTarget,
): Result<Scene> {
  const wanted = new Set(ids.map((id) => String(id)));
  const selected = scene.layers.filter((layer) => wanted.has(String(layer.id)));
  if (selected.length === 0) {
    return err(forgeError('not-found', 'That layer is no longer in the document.'));
  }
  if (selected.length === scene.layers.length) return ok(scene);

  if (target === 'front' || target === 'back') {
    const rest = scene.layers.filter((layer) => !wanted.has(String(layer.id)));
    return ok(freezeScene(target === 'front' ? [...rest, ...selected] : [...selected, ...rest]));
  }

  const layers = [...scene.layers];
  if (target === 'forward') {
    // Top-most first, so a layer that has just moved up is not considered again.
    for (let index = layers.length - 2; index >= 0; index -= 1) {
      const layer = layers[index];
      const above = layers[index + 1];
      if (!layer || !above) continue;
      if (!wanted.has(String(layer.id)) || wanted.has(String(above.id))) continue;
      layers[index] = above;
      layers[index + 1] = layer;
    }
  } else {
    for (let index = 1; index < layers.length; index += 1) {
      const layer = layers[index];
      const below = layers[index - 1];
      if (!layer || !below) continue;
      if (!wanted.has(String(layer.id)) || wanted.has(String(below.id))) continue;
      layers[index] = below;
      layers[index - 1] = layer;
    }
  }

  return ok(freezeScene(layers));
}

/**
 * Moves a layer to an explicit index, as a layer-tree drag would.
 * The index is the desired final position in the resulting array.
 */
export function moveLayerTo(scene: Scene, id: LayerId | string, index: number): Result<Scene> {
  const from = scene.layers.findIndex((layer) => layer.id === id);
  const layer = scene.layers[from];
  if (from === -1 || !layer) {
    return err(forgeError('not-found', 'That layer is no longer in the document.'));
  }
  const destination = Math.max(0, Math.min(scene.layers.length - 1, Math.round(index)));
  if (destination === from) return ok(scene);

  const next = scene.layers.filter((candidate) => candidate.id !== id);
  next.splice(destination, 0, layer);
  return ok(freezeScene(next));
}

export function setLayerVisibility(
  scene: Scene,
  id: LayerId | string,
  visible: boolean,
): Result<Scene> {
  return updateLayer(scene, id, { visible });
}

export function renameLayer(scene: Scene, id: LayerId | string, name: string): Result<Scene> {
  const trimmed = name.trim().slice(0, MAX_LAYER_NAME_LENGTH);
  if (trimmed.length === 0) {
    return err(forgeError('validation-failed', 'A layer needs a name.', { retryable: false }));
  }
  return updateLayer(scene, id, { name: trimmed });
}

/** Applies several layer patches at once, as one logical edit (used by multi-select transforms). */
export function updateLayers(
  scene: Scene,
  patches: readonly { readonly id: LayerId | string; readonly patch: LayerPatch }[],
): Result<Scene> {
  let next = scene;
  for (const entry of patches) {
    const updated = updateLayer(next, entry.id, entry.patch);
    if (!updated.ok) return err(updated.error);
    next = updated.value;
  }
  return ok(next);
}

/** Layers that should respond to pointer interaction and export, in paint order. */
export function visibleLayers(scene: Scene): readonly Layer[] {
  return scene.layers.filter((layer) => layer.visible && layer.opacity > 0);
}

/** Top-most layer whose frame contains the point, or undefined. Locked/hidden layers are skipped. */
export function topmostLayerAt(
  scene: Scene,
  point: { readonly x: number; readonly y: number },
  contains: (layer: Layer, point: { readonly x: number; readonly y: number }) => boolean,
): Layer | undefined {
  for (let index = scene.layers.length - 1; index >= 0; index -= 1) {
    const layer = scene.layers[index];
    // A layer that draws nothing cannot be picked: the renderer skips it, so a click has to fall
    // through to whatever is actually visible underneath.
    if (!layer || !layer.visible || layer.opacity <= 0 || layer.locked) continue;
    if (contains(layer, point)) return layer;
  }
  return undefined;
}

/**
 * Validates a text patch before it reaches the document, with user-facing messages.
 *
 * The rules live in `validation.ts` so that the inspector, an export check and this guard cannot
 * drift apart; this wrapper only projects them down to the message strings callers already show.
 */
export function validateTextSettings(text: TextSettings): readonly string[] {
  return textSettingsIssues(text).map((issue) => issue.message);
}

/** Adds an attribution record, de-duplicating by asset id and bounding the collection. */
export function addAttribution(
  records: readonly AttributionRecord[],
  record: AttributionRecord,
): readonly AttributionRecord[] {
  const existing = records.findIndex((entry) => entry.assetId === record.assetId);
  if (existing !== -1) {
    const next = [...records];
    next[existing] = record;
    return Object.freeze(next);
  }
  const next = [...records, record];
  // At the cap the *oldest* record goes, never the one just added: the record that was just written
  // describes a graphic the document now contains, and dropping it would lose a licence obligation
  // the export is meant to list. The order stays oldest first.
  return Object.freeze(
    next.length > MAX_ATTRIBUTION_RECORDS
      ? next.slice(next.length - MAX_ATTRIBUTION_RECORDS)
      : next,
  );
}

export function findAttribution(
  records: readonly AttributionRecord[],
  assetId: string,
): AttributionRecord | undefined {
  return records.find((entry) => entry.assetId === assetId);
}

/** Attribution records for every graphic currently placed, so export can list obligations. */
export function attributionForScene(
  records: readonly AttributionRecord[],
  scene: Scene,
): readonly AttributionRecord[] {
  const placed = new Set(
    scene.layers
      .filter((layer): layer is ImageLayer => layer.type === 'image')
      .map((layer) => layer.image.assetId)
      .filter((assetId): assetId is string => assetId !== null),
  );
  return records.filter((record) => placed.has(record.assetId));
}

/** Rect used when a new layer is created from a toolbar, centred in the canvas. */
export function defaultFrameFor(
  type: LayerType,
  canvas: { readonly width: number; readonly height: number },
): Rect {
  const shortest = Math.min(canvas.width, canvas.height);
  switch (type) {
    case 'text': {
      const width = Math.round(Math.min(canvas.width * 0.7, 720));
      const height = 96;
      return createRect(
        Math.round((canvas.width - width) / 2),
        Math.round(canvas.height * 0.18),
        Math.max(40, width),
        height,
      );
    }
    case 'image': {
      const size = Math.round(Math.max(120, shortest * 0.4));
      return createRect(
        Math.round((canvas.width - size) / 2),
        Math.round((canvas.height - size) / 2),
        size,
        size,
      );
    }
    case 'rect':
    case 'ellipse': {
      const size = Math.round(Math.max(80, shortest * 0.33));
      return createRect(
        Math.round((canvas.width - size) / 2),
        Math.round((canvas.height - size) / 2),
        size,
        size,
      );
    }
  }
}
