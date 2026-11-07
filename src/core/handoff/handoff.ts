/**
 * Carrying work between studios.
 *
 * The product's premise is that a piece of work is not locked to the medium it was started in: a
 * poster needs a photo edit and an animated version, and those should be continuations of one
 * project rather than three unrelated files. This module is the part of that premise that can be
 * stated as data.
 *
 * It is deliberately small and honest:
 *
 *  - A handoff always produces a **new** document. Nothing is moved, and the source is untouched.
 *  - Every target declares what it `carries` and what it `loses`, as sentences the interface shows
 *    verbatim. A handoff that flattened a layer stack would be a lie if the dialog only said
 *    "continue in Photo Studio".
 *  - Only combinations that really work are offered. Design Studio's scene is a subset of what the
 *    Motion renderer and the Photo import both accept, which is why those two are the targets and
 *    the other studios are not.
 *
 * The browser half — rasterising an artboard, encoding it, decoding it again for the photo working
 * copy — lives in `src/lib/browser/handoff.ts`; this module never touches a canvas.
 */

import {
  defaultMotionPayload,
  defaultPhotoPayload,
  MAX_PHOTO_WORKING_EDGE,
  type PhotoSource,
} from '../documents/payload';
import type { CreateDocumentInput, DocumentLineage, ForgeDocument } from '../documents/types';
import { MAX_CANVAS_PX, SCREEN_DPI } from '../documents/units';
import { rasterDimensions } from '../export/raster';
import { brand } from '../types/brand';

export type HandoffOperation = 'scene-copy' | 'raster';

export type HandoffTarget = {
  /** Stable id used in tests and in the dialog's keys. */
  readonly id: 'motion' | 'photo';
  readonly studioId: string;
  readonly documentTypeId: string;
  readonly operation: HandoffOperation;
  /** The verb on the card: what carrying the work here lets you do. */
  readonly action: string;
  /** One sentence of why this is the next place for this kind of work. */
  readonly reason: string;
  /** Exactly what arrives in the new project. */
  readonly carries: readonly string[];
  /** Exactly what does not, stated before the work is carried rather than after. */
  readonly loses: readonly string[];
};

/**
 * The studios that can take a carried design canvas today.
 *
 * Motion and Photo are offered because the design scene is exactly what both accept: Motion
 * animates the shared layer model, and Photo's import pipeline takes the flattened artboard. Video
 * is not offered — a timeline needs decoded media and a clip model the design canvas does not have —
 * and Illustration is not offered — its paths live in the vector editor, not in the shared scene.
 * Offering either would be a control that produces an empty document.
 */
const DESIGN_TARGETS: readonly HandoffTarget[] = [
  {
    id: 'motion',
    studioId: 'motion',
    documentTypeId: 'motion.scene',
    operation: 'scene-copy',
    action: 'Animate it in Motion Studio',
    reason:
      'Motion animates the same layer model, so every layer arrives as a layer you can keyframe.',
    carries: [
      'Every layer — text, rectangles, ellipses and placed graphics — in the same stacking order',
      'The canvas size, background, guides, palette and placement licences',
    ],
    loses: [
      'Nothing is converted, but the composition starts with no keyframes: animating it is the work.',
    ],
  },
  {
    id: 'photo',
    studioId: 'photo',
    documentTypeId: 'photo.image',
    operation: 'raster',
    action: 'Retouch it in Photo Studio',
    reason: 'Photo Studio works on pixels, so the artboard is rendered flat at its own pixel size.',
    carries: [
      'The artboard as a PNG at the document’s pixel size, with every visible layer painted in',
      'The canvas size, set to the rendered image, and the palette as a record of the colours used',
    ],
    loses: [
      'Layers, text and editing handles: what arrives is pixels, and the layers cannot be recovered',
      'Anything outside the artboard — guides and the bleed band are editor aids, not artwork',
    ],
  },
];

/** The targets this document can be carried to. Empty means the interface hides the control. */
export function handoffTargets(source: ForgeDocument): readonly HandoffTarget[] {
  return String(source.documentTypeId) === 'design.canvas' ? DESIGN_TARGETS : [];
}

/**
 * The projects this document has already been carried into, newest first.
 *
 * Lineage is stored on the *copy*, so the forward direction is a scan of the library rather than a
 * second list kept beside it — a list could disagree with the documents, and the documents are what
 * a person can open. The scan is also the honest answer to "is this still carried?":
 * a copy that was deleted is not a descendant any more.
 *
 * Ties on `at` (two copies made inside the same millisecond) are broken by title so the order is
 * stable rather than whatever the library happened to return.
 */
export function derivedWorks(
  source: ForgeDocument,
  library: readonly ForgeDocument[],
): readonly ForgeDocument[] {
  return library
    .filter((candidate) => candidate.lineage?.sourceDocumentId === source.id)
    .sort(
      (left, right) =>
        (right.lineage?.at ?? '').localeCompare(left.lineage?.at ?? '') ||
        left.title.localeCompare(right.title),
    );
}

/**
 * The scale a design is rendered at on its way into Photo Studio.
 *
 * The photo working copy is capped at `MAX_PHOTO_WORKING_EDGE` on its long edge, so rendering above
 * that would encode pixels the receiving document then throws away. Documents smaller than the cap
 * are rendered at 1x: upscaling a 500 px artboard to 2048 px invents detail and costs time.
 */
export function handoffRasterScale(source: ForgeDocument): number {
  const longest = Math.max(source.canvas.width, source.canvas.height);
  if (longest <= MAX_PHOTO_WORKING_EDGE) return 1;
  return MAX_PHOTO_WORKING_EDGE / longest;
}

/** The pixel size the handoff raster will have, derived from the document and the cap above. */
export function handoffRasterSize(source: ForgeDocument): {
  readonly width: number;
  readonly height: number;
} {
  return rasterDimensions(source, handoffRasterScale(source));
}

/**
 * A title for the carried document.
 *
 * Titles are limited to 120 characters, so the suffix is kept and the source title is trimmed — a
 * truncated suffix (“Field audit — ret…”) would say less than a truncated subject.
 */
export function carriedTitle(source: ForgeDocument, suffix: string): string {
  const full = `${source.title} — ${suffix}`;
  if (full.length <= 120) return full;
  const room = 120 - suffix.length - 3; // " — "
  const trimmed = source.title.slice(0, Math.max(1, room)).trimEnd();
  return `${trimmed} — ${suffix}`;
}

function lineageFor(
  source: ForgeDocument,
  operation: HandoffOperation,
  at: string,
): DocumentLineage {
  return {
    sourceDocumentId: source.id,
    sourceTitle: source.title,
    sourceStudioId: source.studioId,
    sourceDocumentTypeId: source.documentTypeId,
    operation,
    at,
  };
}

/** Shared fields every carried document keeps from its source. */
function sharedFromSource(
  source: ForgeDocument,
): Pick<CreateDocumentInput, 'summary' | 'guides' | 'palette' | 'tags' | 'attribution'> {
  return {
    summary: `Carried from “${source.title}”.`,
    guides: source.guides,
    palette: source.palette,
    tags: source.metadata.tags,
    attribution: source.attribution,
  };
}

/** The input for carrying a design's layer scene into Motion Studio. Pure. */
export function toMotionDocument(
  source: ForgeDocument,
  options: { readonly at: string },
): CreateDocumentInput {
  return {
    title: carriedTitle(source, 'motion'),
    studioId: 'motion',
    documentTypeId: brand<'DocumentTypeId'>('motion.scene'),
    canvas: source.canvas,
    ...sharedFromSource(source),
    // A copy, not a reference: the two documents must be able to diverge.
    scene: { layers: source.scene.layers },
    studioPayload: defaultMotionPayload(),
    lineage: lineageFor(source, 'scene-copy', options.at),
  };
}

/**
 * The input for carrying a design's artboard into Photo Studio as pixels. Pure.
 *
 * `photo` is the encoded image the browser prepared. It is a `PhotoSource` rather than loose
 * numbers so it passes through exactly the same bounds the import panel enforces — an embedded
 * working copy, a known mime type, the original dimensions kept for an honest "reduced from"
 * message — instead of a second, slightly different code path for handoffs.
 */
export function toPhotoDocument(
  source: ForgeDocument,
  photo: PhotoSource,
  options: { readonly at: string },
): CreateDocumentInput {
  const width = Math.max(1, Math.min(MAX_CANVAS_PX, Math.round(photo.width)));
  const height = Math.max(1, Math.min(MAX_CANVAS_PX, Math.round(photo.height)));
  return {
    title: carriedTitle(source, 'retouch'),
    studioId: 'photo',
    documentTypeId: brand<'DocumentTypeId'>('photo.image'),
    canvas: {
      ...source.canvas,
      width,
      height,
      unit: 'px',
      dpi: SCREEN_DPI,
      // The PNG carries the artboard's own transparency; the canvas colour is only a backdrop.
      transparent: false,
    },
    ...sharedFromSource(source),
    scene: { layers: [] },
    studioPayload: { ...defaultPhotoPayload(), source: photo },
    lineage: lineageFor(source, 'raster', options.at),
  };
}
