/**
 * Document domain model.
 *
 * A `ForgeDocument` is the unit of work for every studio: a design canvas today, an image,
 * timeline, scene or vector artboard later. The model is intentionally studio-neutral — studio
 * specific payloads will live in `payload` blocks once those studios exist (see ADR-0004).
 */

import type { Branded } from '../types/brand';
import { type PartialProps, type Undefinable } from '../types/optional';
import type { AttributionRecord, Scene } from './layer-types';
import type { LengthUnit } from './units';

export type DocumentId = Branded<string, 'DocumentId'>;
export type DocumentTypeId = Branded<string, 'DocumentTypeId'>;
export type CanvasPresetId = Branded<string, 'CanvasPresetId'>;

export type Size = { readonly width: number; readonly height: number };

export type DocumentStatus = 'draft' | 'in-review' | 'ready' | 'archived';

export const DOCUMENT_STATUSES: readonly DocumentStatus[] = [
  'draft',
  'in-review',
  'ready',
  'archived',
] as const;

export const DOCUMENT_STATUS_LABELS: Readonly<Record<DocumentStatus, string>> = {
  draft: 'Draft',
  'in-review': 'In review',
  ready: 'Ready',
  archived: 'Archived',
};

/**
 * Everything needed to rasterise or lay out a page.
 * `unit` and `dpi` describe how the pixel dimensions were authored; they are preserved so that a
 * print document can round-trip through millimetres without drift.
 */
export type Canvas = {
  readonly width: number;
  readonly height: number;
  readonly unit: LengthUnit;
  readonly dpi: number;
  /** sRGB hex colour, `#rrggbb`. */
  readonly background: string;
  readonly transparent: boolean;
};

export type GuideSettings = {
  /** Safe-area inset measured from every edge, in millimetres. */
  readonly safeMarginMm: number;
  /** Print bleed band around the canvas, in millimetres. 0 hides the bleed guide. */
  readonly bleedMm: number;
  readonly showGrid: boolean;
  readonly gridMm: number;
  readonly showCentreLines: boolean;
};

export type DocumentMetadata = {
  readonly authorLabel: string;
  readonly tags: readonly string[];
  readonly notes: string;
};

/**
 * Studio-neutral project record.
 *
 * `schemaVersion` drives the migration chain in `./migrations.ts`; `revision` is a monotonic
 * counter used for optimistic-concurrency checks once a remote adapter exists.
 *
 * `scene` holds the ordered layers that make up the artwork, and `attribution` records the licence
 * and provenance of every catalogue graphic that has been placed. Both are part of the document,
 * so they survive save, reload, `.forge.json` round-trip and undo. Selection, hover and in-progress
 * drags are *not* here: transient interaction state never enters a document (ADR-0015).
 */
export type ForgeDocument = {
  readonly id: DocumentId;
  readonly schemaVersion: number;
  readonly studioId: string;
  readonly documentTypeId: DocumentTypeId;
  readonly title: string;
  readonly summary: string;
  readonly canvas: Canvas;
  readonly guides: GuideSettings;
  /** Brand colours captured when the document was created; empty means "not decided yet". */
  readonly palette: readonly string[];
  /** Ordered layers, index 0 painted first (bottom of the stack). */
  readonly scene: Scene;
  /** Licence/provenance records for catalogue graphics placed in this document. */
  readonly attribution: readonly AttributionRecord[];
  readonly metadata: DocumentMetadata;
  readonly status: DocumentStatus;
  readonly revision: number;
  /** ISO-8601 timestamps. */
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** Fields a document needs at creation time. Everything else is derived. */
export type CreateDocumentInput = {
  readonly title: string;
  readonly summary?: Undefinable<string>;
  readonly studioId: string;
  readonly documentTypeId: DocumentTypeId;
  readonly canvas: Canvas;
  readonly guides?: PartialProps<GuideSettings> | undefined;
  readonly palette?: Undefinable<readonly string[]>;
  readonly tags?: Undefinable<readonly string[]>;
  /** Startup artwork, used by starters that seed a real layer stack. Omit for an empty artboard. */
  readonly scene?: Undefinable<Scene>;
};

export type CanvasPresetCategory = 'social' | 'video' | 'web' | 'print' | 'presentation' | 'custom';

export type CanvasPreset = {
  readonly id: CanvasPresetId;
  readonly label: string;
  readonly description: string;
  readonly category: CanvasPresetCategory;
  readonly size: Size;
  readonly unit: LengthUnit;
  readonly dpi: number;
  /** Background applied when the preset is chosen. */
  readonly background: string;
};

export const CANVAS_PRESET_CATEGORY_LABELS: Readonly<Record<CanvasPresetCategory, string>> = {
  social: 'Social',
  video: 'Video',
  web: 'Web',
  print: 'Print',
  presentation: 'Presentation',
  custom: 'Custom',
};
