/**
 * Studio payloads.
 *
 * A `ForgeDocument` is studio-neutral: canvas, guides, layer scene, attribution, metadata. The
 * things that only one discipline needs — a photo's adjustment stack and mask, a motion scene's
 * keyframes, a video timeline's clips — live here in a single discriminated `studioPayload` block
 * rather than as loose top-level fields (ADR-0004 anticipated this shape).
 *
 * Three rules hold this together:
 *
 * 1. **One payload, one document type.** `studioPayload.kind` must match the document type; the
 *    document schema enforces it, so a motion payload can never be attached to a photo document.
 * 2. **Plain JSON.** Every payload is data: no classes, no functions, no DOM handles. It survives
 *    `JSON.stringify`, `.forge.json` export and a remote round trip unchanged.
 * 3. **Bounded.** Every collection and number has a documented upper bound, because a saved document
 *    is untrusted input and a payload is loaded through the same `migrateDocument` gate.
 *
 * The types are declared here (next to the document model) while the algorithms live in
 * `src/core/photo`, `src/core/motion` and `src/core/video`; both import these types, neither owns
 * the other.
 */

import { createLayerId } from './layer-operations';
import type { DocumentTypeId } from './types';

/* ------------------------------------------------------------------------------------------- */
/* Photo                                                                                       */
/* ------------------------------------------------------------------------------------------- */

/**
 * The adjustment kinds the stack understands.
 *
 * Every one is implemented by two renderers that share this list: a WebGL2 fragment shader for the
 * GPU path and a plain JavaScript pixel loop for the fallback. The shader and the loop are tested
 * against each other, so the list is a contract rather than a menu.
 */
export const PHOTO_ADJUSTMENT_KINDS = [
  'exposure',
  'contrast',
  'saturation',
  'temperature',
  'tint',
  'highlights',
  'shadows',
  'vibrance',
  'clarity',
  'grayscale',
  'sepia',
  'vignette',
] as const;

export type PhotoAdjustmentKind = (typeof PHOTO_ADJUSTMENT_KINDS)[number];

export type PhotoAdjustmentInfo = {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  /** Slider step. */
  readonly step: number;
  /** Value inserted when the adjustment is added. */
  readonly initial: number;
  /** What the numbers mean, in the panel's own words. */
  readonly description: string;
};

/** `min`/`max` are percentages or 0–100 amounts; the renderers convert them to maths. */
export const PHOTO_ADJUSTMENT_INFO: Readonly<Record<PhotoAdjustmentKind, PhotoAdjustmentInfo>> = {
  exposure: {
    label: 'Exposure',
    min: -100,
    max: 100,
    step: 1,
    initial: 20,
    description: 'Stops of brightness: ±100 is ±2 EV.',
  },
  contrast: {
    label: 'Contrast',
    min: -100,
    max: 100,
    step: 1,
    initial: 15,
    description: 'Pivot around mid-grey, without clipping the endpoints before it is asked to.',
  },
  saturation: {
    label: 'Saturation',
    min: -100,
    max: 100,
    step: 1,
    initial: 20,
    description: 'Uniform colour intensity: −100 is monochrome.',
  },
  temperature: {
    label: 'Temperature',
    min: -100,
    max: 100,
    step: 1,
    initial: 10,
    description: 'Blue on the left, amber on the right, like a white-balance slider.',
  },
  tint: {
    label: 'Tint',
    min: -100,
    max: 100,
    step: 1,
    initial: 0,
    description: 'Green on the left, magenta on the right.',
  },
  highlights: {
    label: 'Highlights',
    min: -100,
    max: 100,
    step: 1,
    initial: 0,
    description: 'Recover or lift the brightest values.',
  },
  shadows: {
    label: 'Shadows',
    min: -100,
    max: 100,
    step: 1,
    initial: 0,
    description: 'Lift or deepen the darkest values.',
  },
  vibrance: {
    label: 'Vibrance',
    min: -100,
    max: 100,
    step: 1,
    initial: 0,
    description: 'Saturation weighted towards already-muted colours.',
  },
  clarity: {
    label: 'Clarity',
    min: 0,
    max: 100,
    step: 1,
    initial: 20,
    description: 'Local contrast through a small blur difference — a real filter, not a mock.',
  },
  grayscale: {
    label: 'Monochrome',
    min: 0,
    max: 100,
    step: 1,
    initial: 100,
    description: 'Blend towards luminance.',
  },
  sepia: {
    label: 'Sepia',
    min: 0,
    max: 100,
    step: 1,
    initial: 60,
    description: 'Blend towards the classic warm print tone.',
  },
  vignette: {
    label: 'Vignette',
    min: 0,
    max: 100,
    step: 1,
    initial: 35,
    description: 'Darken towards the frame edges.',
  },
};

export type PhotoAdjustment = {
  readonly id: string;
  readonly kind: PhotoAdjustmentKind;
  /** In the units `PHOTO_ADJUSTMENT_INFO[kind]` defines. */
  readonly value: number;
  readonly enabled: boolean;
};

/**
 * A decoded, embedded working copy of the photograph.
 *
 * The bytes live in the document as a data URL so a project is portable and local-first: it can be
 * reopened on another device with no cloud storage and no broken link. That trade-off is bounded —
 * imports are capped at `MAX_PHOTO_WORKING_EDGE` on the long edge — and stated in the interface.
 */
export type PhotoSource = {
  readonly name: string;
  readonly href: string;
  readonly width: number;
  readonly height: number;
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Original dimensions, kept so the panel can say what the working copy was reduced from. */
  readonly originalWidth: number;
  readonly originalHeight: number;
};

/** A mask point in normalised document coordinates (0–1), so it survives a canvas resize. */
export type PhotoPoint = {
  readonly x: number;
  readonly y: number;
};

export type PhotoMaskStroke = {
  readonly id: string;
  readonly points: readonly PhotoPoint[];
  /** Brush radius as a fraction of the shorter canvas edge. */
  readonly radius: number;
  /** 0 = fully soft edge, 1 = hard edge. */
  readonly hardness: number;
  /** True paints back into the mask, false erases. */
  readonly erase: boolean;
  /**
   * True fills the closed outline instead of stroking it — the lasso tool. Brush strokes leave this
   * false; a filled lasso and a brushed stroke share one model so order and erasing are uniform.
   */
  readonly fill: boolean;
};

export type PhotoMask = {
  readonly strokes: readonly PhotoMaskStroke[];
  /** When true the adjustment stack applies *outside* the painted area. */
  readonly inverted: boolean;
};

export const RETOUCH_MODES = ['clone', 'heal'] as const;
export type RetouchMode = (typeof RETOUCH_MODES)[number];

/**
 * A retouch stroke.
 *
 * `clone` copies pixels from a source offset; `heal` blends towards a locally smoothed copy. Both
 * are real operations applied to the rendered pixels, not brush marks drawn on the preview.
 */
export type PhotoRetouchStroke = {
  readonly id: string;
  readonly mode: RetouchMode;
  readonly points: readonly PhotoPoint[];
  readonly radius: number;
  readonly hardness: number;
  /** Source offset in normalised units; ignored by `heal`. */
  readonly offsetX: number;
  readonly offsetY: number;
};

export const PHOTO_ENGINE_PREFERENCES = ['auto', 'webgl2', 'canvas2d'] as const;
export type PhotoEnginePreference = (typeof PHOTO_ENGINE_PREFERENCES)[number];

export type PhotoPayload = {
  readonly kind: 'photo';
  readonly version: 1;
  readonly source: PhotoSource | null;
  readonly adjustments: readonly PhotoAdjustment[];
  readonly mask: PhotoMask | null;
  readonly retouch: readonly PhotoRetouchStroke[];
  /** Which renderer the user asked for; `auto` picks WebGL2 when the browser exposes it. */
  readonly engine: PhotoEnginePreference;
};

export const MAX_PHOTO_ADJUSTMENTS = 32;
export const MAX_MASK_STROKES = 200;
export const MAX_MASK_POINTS = 2048;
export const MAX_RETOUCH_STROKES = 100;
/** Long edge of the embedded working copy. Larger imports are downscaled and reported. */
export const MAX_PHOTO_WORKING_EDGE = 2048;
/** Upper bound on the embedded data URL, in characters. */
export const MAX_PHOTO_HREF_LENGTH = 12_000_000;

/* ------------------------------------------------------------------------------------------- */
/* Motion                                                                                      */
/* ------------------------------------------------------------------------------------------- */

export const MOTION_PROPERTIES = ['x', 'y', 'scale', 'opacity'] as const;
export type MotionProperty = (typeof MOTION_PROPERTIES)[number];

export type MotionPropertyInfo = {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Base value when the layer has no keyframes for this property. */
  readonly neutral: 'frame' | 'opacity' | 1;
  readonly description: string;
};

export const MOTION_PROPERTY_INFO: Readonly<Record<MotionProperty, MotionPropertyInfo>> = {
  x: {
    label: 'X position',
    min: -40_000,
    max: 40_000,
    step: 1,
    neutral: 'frame',
    description: 'The layer frame’s left edge in document pixels.',
  },
  y: {
    label: 'Y position',
    min: -40_000,
    max: 40_000,
    step: 1,
    neutral: 'frame',
    description: 'The layer frame’s top edge in document pixels.',
  },
  scale: {
    label: 'Scale',
    min: 0.01,
    max: 20,
    step: 0.01,
    neutral: 1,
    description: 'Multiplier around the frame’s centre.',
  },
  opacity: {
    label: 'Opacity',
    min: 0,
    max: 1,
    step: 0.01,
    neutral: 'opacity',
    description: 'Layer opacity, multiplied into the scene.',
  },
};

/**
 * Easing.
 *
 * `cubic` stores the two control points of a CSS-style cubic Bézier in normalised time/value space,
 * which is exactly what the graph editor drags. `hold` keeps the previous value until the next
 * keyframe, which is what stepping animation is for.
 */
export type MotionEasing =
  | { readonly kind: 'linear' }
  | { readonly kind: 'ease-in' }
  | { readonly kind: 'ease-out' }
  | { readonly kind: 'ease-in-out' }
  | { readonly kind: 'hold' }
  | {
      readonly kind: 'cubic';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
    };

export const MOTION_EASING_PRESETS = [
  { kind: 'linear', label: 'Linear' },
  { kind: 'ease-in', label: 'Ease in' },
  { kind: 'ease-out', label: 'Ease out' },
  { kind: 'ease-in-out', label: 'Ease in-out' },
  { kind: 'hold', label: 'Hold' },
  { kind: 'cubic', label: 'Custom curve' },
] as const;

export type MotionKeyframe = {
  readonly id: string;
  /** Seconds from the start of the composition. */
  readonly time: number;
  readonly value: number;
  /** Easing of the segment that *starts* at this keyframe. */
  readonly easing: MotionEasing;
};

export type MotionTrack = {
  readonly layerId: string;
  readonly property: MotionProperty;
  /** Sorted by time, with no duplicate times. */
  readonly keyframes: readonly MotionKeyframe[];
};

export type MotionPayload = {
  readonly kind: 'motion';
  readonly version: 1;
  /** Composition length in seconds. */
  readonly duration: number;
  readonly fps: number;
  readonly tracks: readonly MotionTrack[];
};

export const MAX_MOTION_DURATION = 120;
export const MIN_MOTION_DURATION = 0.5;
export const MAX_MOTION_FPS = 60;
export const MAX_MOTION_TRACKS = 400;
export const MAX_MOTION_KEYFRAMES = 200;

/* ------------------------------------------------------------------------------------------- */
/* Video                                                                                       */
/* ------------------------------------------------------------------------------------------- */

/** Media metadata for a file the user imported; the bytes live in the browser's media store. */
export type VideoMedia = {
  readonly id: string;
  readonly name: string;
  readonly kind: 'video' | 'audio';
  readonly mimeType: string;
  /** Source duration in seconds, as reported by the decoded element. */
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  /** Bytes on disk at import time, for the resource panel. */
  readonly size: number;
};

export type VideoClip = {
  readonly id: string;
  readonly kind: 'video' | 'audio';
  readonly mediaId: string;
  readonly name: string;
  /** Timeline start in seconds. */
  readonly start: number;
  /** Length on the timeline in seconds. */
  readonly duration: number;
  /** Offset into the source file in seconds. */
  readonly inPoint: number;
  /** 0–1. */
  readonly volume: number;
  readonly muted: boolean;
};

export const TITLE_POSITIONS = ['top', 'center', 'lower'] as const;
export type TitlePosition = (typeof TITLE_POSITIONS)[number];

export type TitleClip = {
  readonly id: string;
  readonly kind: 'title';
  readonly text: string;
  readonly start: number;
  readonly duration: number;
  readonly color: string;
  readonly background: string | null;
  readonly fontSize: number;
  readonly position: TitlePosition;
};

export type VideoTrackKind = 'video' | 'audio' | 'title';

export type VideoTrack = {
  readonly id: string;
  readonly kind: VideoTrackKind;
  readonly name: string;
  readonly clips: readonly (VideoClip | TitleClip)[];
};

export type VideoPayload = {
  readonly kind: 'video';
  readonly version: 1;
  readonly duration: number;
  readonly fps: number;
  /** Imported media metadata; a clip whose `mediaId` is absent is shown as missing. */
  readonly media: readonly VideoMedia[];
  readonly tracks: readonly VideoTrack[];
};

export const MAX_VIDEO_DURATION = 3600;
export const MAX_VIDEO_FPS = 60;
export const MAX_VIDEO_TRACKS = 8;
export const MAX_VIDEO_CLIPS = 200;
export const MAX_VIDEO_MEDIA = 40;

/* ------------------------------------------------------------------------------------------- */
/* Union                                                                                       */
/* ------------------------------------------------------------------------------------------- */

export type StudioPayload = PhotoPayload | MotionPayload | VideoPayload;

export type StudioPayloadKind = StudioPayload['kind'];

/** The payload kind each document type carries; `null` means the document has no studio payload. */
export function payloadKindForDocumentType(
  documentTypeId: DocumentTypeId | string,
): StudioPayloadKind | null {
  switch (String(documentTypeId)) {
    case 'photo.image':
      return 'photo';
    case 'motion.scene':
      return 'motion';
    case 'video.timeline':
      return 'video';
    default:
      return null;
  }
}

export function defaultPhotoPayload(): PhotoPayload {
  return {
    kind: 'photo',
    version: 1,
    source: null,
    adjustments: [],
    mask: null,
    retouch: [],
    engine: 'auto',
  };
}

export function defaultMotionPayload(): MotionPayload {
  return { kind: 'motion', version: 1, duration: 5, fps: 30, tracks: [] };
}

export function defaultVideoPayload(): VideoPayload {
  return {
    kind: 'video',
    version: 1,
    duration: 10,
    fps: 30,
    media: [],
    tracks: [
      { id: 'track-video-1', kind: 'video', name: 'Video 1', clips: [] },
      { id: 'track-title-1', kind: 'title', name: 'Titles', clips: [] },
      { id: 'track-audio-1', kind: 'audio', name: 'Audio 1', clips: [] },
    ],
  };
}

/** The empty payload a new document of this type should start with, or `null`. */
export function defaultStudioPayload(
  documentTypeId: DocumentTypeId | string,
): StudioPayload | null {
  switch (payloadKindForDocumentType(documentTypeId)) {
    case 'photo':
      return defaultPhotoPayload();
    case 'motion':
      return defaultMotionPayload();
    case 'video':
      return defaultVideoPayload();
    case null:
      return null;
  }
}

/** A collision-resistant id for an item inside a payload. */
export function createPayloadItemId(prefix: string): string {
  // Reuses the layer-id generator so there is one id strategy in the domain layer.
  return `${prefix}-${createLayerId().replace(/^lyr-/, '')}`;
}
