/**
 * Layer domain model.
 *
 * A document owns an ordered `Scene`: an array of layers drawn back-to-front, so index 0 is the
 * bottom-most layer and the last entry paints on top. That single rule is the z-order contract for
 * the editor, the live renderer and the export renderer alike (ADR-0016).
 *
 * Coordinates are document pixels with the origin at the canvas top-left, independent of zoom — the
 * artboard converts to screen space at paint time and nothing here knows about the viewport.
 *
 * Everything in this module is framework-free data: no React, no DOM, no browser APIs.
 */

import { brand, type Branded } from '../types/brand';
import type { Rect } from './geometry';

export type LayerId = Branded<string, 'LayerId'>;

export const LAYER_TYPES = ['text', 'rect', 'ellipse', 'image'] as const;
export type LayerType = (typeof LAYER_TYPES)[number];

export const LAYER_TYPE_LABELS: Readonly<Record<LayerType, string>> = {
  text: 'Text',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  image: 'Graphic',
};

/**
 * Resource limits.
 *
 * These are deliberately generous but finite: a document is untrusted input (it arrives from
 * `localStorage` or a project file), so every collection and number needs an upper bound or a
 * malformed file could exhaust the browser rather than fail cleanly.
 */
export const MAX_LAYERS = 200;
export const MAX_LAYER_NAME_LENGTH = 80;
export const MAX_TEXT_LENGTH = 5_000;
export const MAX_FRAME_COORDINATE = 40_000;
export const MAX_LAYER_SIZE = 20_000;
export const MIN_LAYER_SIZE = 1;
export const MAX_ATTRIBUTION_RECORDS = 100;

/** Font stacks resolved to real, universally available families — see `FONT_STACKS_INFO.css`. */
export const FONT_STACKS = ['sans', 'serif', 'mono'] as const;
export type FontStackId = (typeof FONT_STACKS)[number];

export type FontStackInfo = {
  readonly id: FontStackId;
  readonly label: string;
  /** CSS `font-family` value. Only system fonts: nothing is downloaded, so nothing can be missing. */
  readonly css: string;
  readonly description: string;
};

/**
 * Typography.
 *
 * The stacks name only fonts that ship with macOS, Windows, Linux, iOS or Android, so a document
 * renders with the typography it declares on any machine. Nothing here implies a webfont is bundled
 * — the UI states that these are system stacks.
 */
export const FONT_STACKS_INFO: Readonly<Record<FontStackId, FontStackInfo>> = {
  sans: {
    id: 'sans',
    label: 'System sans',
    css: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
    description:
      'Interface-like neutral sans. Falls back through each operating system’s own UI font.',
  },
  serif: {
    id: 'serif',
    label: 'System serif',
    css: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, "Noto Serif", serif',
    description: 'Editorial serif for headlines and long-form copy.',
  },
  mono: {
    id: 'mono',
    label: 'System mono',
    css: 'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    description: 'Fixed-width stack for code, data and technical labels.',
  },
};

export const TEXT_ALIGNMENTS = ['left', 'center', 'right'] as const;
export type TextAlignment = (typeof TEXT_ALIGNMENTS)[number];

export const TEXT_ALIGNMENT_LABELS: Readonly<Record<TextAlignment, string>> = {
  left: 'Left',
  center: 'Centre',
  right: 'Right',
};

export const FONT_WEIGHTS = [300, 400, 500, 600, 700, 800] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

export type TextSettings = {
  readonly content: string;
  readonly fontStackId: FontStackId;
  /** Pixels. */
  readonly fontSize: number;
  readonly fontWeight: FontWeight;
  /** Multiple of the font size. */
  readonly lineHeight: number;
  /** Pixels; may be negative to tighten tracking. */
  readonly letterSpacing: number;
  readonly align: TextAlignment;
  /** sRGB hex colour. */
  readonly color: string;
};

export type ShapeSettings = {
  /** Hex colour, or null for "no fill" (a real state, not a missing value). */
  readonly fill: string | null;
  /** Hex colour, or null for "no stroke". */
  readonly stroke: string | null;
  readonly strokeWidth: number;
  /** Rectangles only; ellipses ignore it. Kept here so both shapes share one settings shape. */
  readonly cornerRadius: number;
};

export const IMAGE_FITS = ['contain', 'cover', 'stretch'] as const;
export type ImageFit = (typeof IMAGE_FITS)[number];

export const IMAGE_FIT_LABELS: Readonly<Record<ImageFit, string>> = {
  contain: 'Contain',
  cover: 'Cover',
  stretch: 'Stretch',
};

export type ImageSettings = {
  /** Catalogue record this graphic came from, when it came from the catalogue. */
  readonly assetId: string | null;
  /** Resolvable source URL (`/forge-assets/...`) drawn into the layer frame. */
  readonly href: string;
  /** Natural size, used by `contain` and `cover` so the aspect ratio is known without loading. */
  readonly intrinsicWidth: number;
  readonly intrinsicHeight: number;
  readonly fit: ImageFit;
  /** Tint applied over the graphic, or null for none. */
  readonly tint: string | null;
};

export type BaseLayerFields = {
  readonly id: LayerId;
  readonly name: string;
  readonly visible: boolean;
  /** Locked layers cannot be picked on the artboard; they still render and export. */
  readonly locked: boolean;
  /** 0–1. */
  readonly opacity: number;
  /** Position and size in document pixels. */
  readonly frame: Rect;
};

export type TextLayer = BaseLayerFields & {
  readonly type: 'text';
  readonly text: TextSettings;
};

export type RectLayer = BaseLayerFields & {
  readonly type: 'rect';
  readonly shape: ShapeSettings;
};

export type EllipseLayer = BaseLayerFields & {
  readonly type: 'ellipse';
  readonly shape: ShapeSettings;
};

export type ImageLayer = BaseLayerFields & {
  readonly type: 'image';
  readonly image: ImageSettings;
};

export type Layer = TextLayer | RectLayer | EllipseLayer | ImageLayer;

/**
 * The ordered scene. Index 0 is the bottom-most layer.
 *
 * Modelled as a plain ordered array rather than a tree: Phase 2 has no groups, and a fake nesting
 * structure would be a lie the editor has to work around. `docs/ROADMAP.md` records grouping as
 * future work.
 */
export type Scene = {
  readonly layers: readonly Layer[];
};

/**
 * Attribution captured when a catalogue asset enters a document.
 *
 * Copying the licence and provenance into the document (rather than storing an asset id and hoping
 * the catalogue is unchanged) is what makes attribution survive export, sharing and catalogue
 * changes (ADR-0008).
 */
export type AttributionRecord = {
  readonly id: string;
  readonly assetId: string;
  readonly assetName: string;
  readonly assetKind: string;
  readonly licenseId: string;
  readonly licenseName: string;
  readonly licenseUrl: string | null;
  readonly attributionRequired: boolean;
  readonly commercialUse: boolean;
  readonly author: string;
  readonly source: string;
  /** False means a human has not checked the licence or provenance of this record. */
  readonly verified: boolean;
  readonly notes: string;
  /** ISO-8601. */
  readonly placedAt: string;
};

/** Validating entry point for a raw string that is already known to be a layer id. */
export function asLayerId(value: string): LayerId {
  return brand<'LayerId'>(value);
}

export function isTextLayer(layer: Layer): layer is TextLayer {
  return layer.type === 'text';
}

export function isShapeLayer(layer: Layer): layer is RectLayer | EllipseLayer {
  return layer.type === 'rect' || layer.type === 'ellipse';
}

export function isImageLayer(layer: Layer): layer is ImageLayer {
  return layer.type === 'image';
}

/** Narrowing helper used by the shape inspector, which treats rectangles specially. */
export function isRectLayer(layer: Layer): layer is RectLayer {
  return layer.type === 'rect';
}

export function getLayer(scene: Scene, id: LayerId | string | null): Layer | undefined {
  if (id === null) return undefined;
  return scene.layers.find((layer) => layer.id === id);
}

/** Index of a layer in the scene, or -1. */
export function layerIndex(scene: Scene, id: LayerId | string): number {
  return scene.layers.findIndex((layer) => layer.id === id);
}
