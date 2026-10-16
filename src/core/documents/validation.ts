/**
 * Document validation helpers shared by the workspace UI and the export checks.
 *
 * These are the *field-level* rules users interact with; `schema.ts` holds the authoritative
 * structural schemas. Keeping the messages here means a form and an export check cannot disagree
 * about whether a canvas is valid.
 */

import { validatePath, VECTOR_STYLE_LIMITS } from '../vector';
import type { Rect } from './geometry';
import type {
  ImageSettings,
  Layer,
  Scene,
  ShapeSettings,
  TextSettings,
  VectorContent,
} from './layer-types';
import {
  FONT_STACKS,
  FONT_WEIGHTS,
  IMAGE_FITS,
  MAX_FRAME_COORDINATE,
  MAX_LAYERS,
  MAX_LAYER_NAME_LENGTH,
  MAX_LAYER_SIZE,
  MAX_TEXT_LENGTH,
  MIN_LAYER_SIZE,
  TEXT_ALIGNMENTS,
} from './layer-types';
import type { Canvas, ForgeDocument, GuideSettings } from './types';
import { MAX_CANVAS_PX, MIN_CANVAS_PX, isValidDpi } from './units';

export type FieldValidation = {
  readonly field: string;
  readonly message: string;
};

export function fitsWithinCanvasLimits(canvas: Pick<Canvas, 'width' | 'height'>): boolean {
  return (
    Number.isInteger(canvas.width) &&
    Number.isInteger(canvas.height) &&
    canvas.width >= MIN_CANVAS_PX &&
    canvas.height >= MIN_CANVAS_PX &&
    canvas.width <= MAX_CANVAS_PX &&
    canvas.height <= MAX_CANVAS_PX
  );
}

/** Validates an edited canvas and returns one message per invalid field. */
export function validateCanvas(canvas: Canvas): readonly FieldValidation[] {
  const issues: FieldValidation[] = [];

  if (!Number.isFinite(canvas.width) || !Number.isFinite(canvas.height)) {
    issues.push({ field: 'canvas', message: 'Width and height must be numbers.' });
  } else {
    if (canvas.width < MIN_CANVAS_PX || canvas.height < MIN_CANVAS_PX) {
      issues.push({
        field: 'canvas',
        message: `Both sides must be at least ${MIN_CANVAS_PX} px.`,
      });
    }
    if (canvas.width > MAX_CANVAS_PX || canvas.height > MAX_CANVAS_PX) {
      issues.push({
        field: 'canvas',
        message: `Both sides must be at most ${MAX_CANVAS_PX} px.`,
      });
    }
    if (!Number.isInteger(canvas.width) || !Number.isInteger(canvas.height)) {
      issues.push({
        field: 'canvas',
        message: 'Canvas sides are stored as whole pixels; round them before saving.',
      });
    }
  }

  if (!isValidDpi(canvas.dpi)) {
    issues.push({ field: 'dpi', message: 'DPI must be between 36 and 1200.' });
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(canvas.background)) {
    issues.push({ field: 'background', message: 'Background must be a 6-digit hex colour.' });
  }

  return issues;
}

export function validateGuides(guides: GuideSettings): readonly FieldValidation[] {
  const issues: FieldValidation[] = [];
  if (
    !Number.isFinite(guides.safeMarginMm) ||
    guides.safeMarginMm < 0 ||
    guides.safeMarginMm > 100
  ) {
    issues.push({ field: 'safeMarginMm', message: 'Safe margin must be between 0 and 100 mm.' });
  }
  if (!Number.isFinite(guides.bleedMm) || guides.bleedMm < 0 || guides.bleedMm > 50) {
    issues.push({ field: 'bleedMm', message: 'Bleed must be between 0 and 50 mm.' });
  }
  if (!Number.isFinite(guides.gridMm) || guides.gridMm < 1 || guides.gridMm > 100) {
    issues.push({ field: 'gridMm', message: 'Grid spacing must be between 1 and 100 mm.' });
  }
  return issues;
}

export function validateTitle(title: string): readonly FieldValidation[] {
  const trimmed = title.trim();
  if (trimmed.length === 0) return [{ field: 'title', message: 'A project needs a name.' }];
  if (trimmed.length > 120) {
    return [{ field: 'title', message: 'Project names are limited to 120 characters.' }];
  }
  return [];
}

/* ---------------------------------------------------------------------------------------------- */
/* Layers                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

const HEX = /^#[0-9a-fA-F]{6}$/;

function finite(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function between(value: number, min: number, max: number): boolean {
  return finite(value) && value >= min && value <= max;
}

/**
 * Frame rules.
 *
 * A layer may sit partly off the canvas — designers genuinely park things at the edge — so the
 * coordinate limits are generous. What they must not be is unbounded, because a saved document is
 * re-opened by the same renderer that draws it.
 */
export function validateLayerFrame(frame: Rect): readonly FieldValidation[] {
  const issues: FieldValidation[] = [];
  if (!finite(frame.x) || Math.abs(frame.x) > MAX_FRAME_COORDINATE) {
    issues.push({
      field: 'x',
      message: `X must be a number between -${MAX_FRAME_COORDINATE} and ${MAX_FRAME_COORDINATE}.`,
    });
  }
  if (!finite(frame.y) || Math.abs(frame.y) > MAX_FRAME_COORDINATE) {
    issues.push({
      field: 'y',
      message: `Y must be a number between -${MAX_FRAME_COORDINATE} and ${MAX_FRAME_COORDINATE}.`,
    });
  }
  for (const axis of ['width', 'height'] as const) {
    const value = frame[axis];
    if (!between(value, MIN_LAYER_SIZE, MAX_LAYER_SIZE)) {
      issues.push({
        field: axis,
        message: `Layer ${axis} must be between ${MIN_LAYER_SIZE} and ${MAX_LAYER_SIZE} px.`,
      });
    }
  }
  return issues;
}

export function validateTextSettings(text: TextSettings): readonly FieldValidation[] {
  const issues: FieldValidation[] = [];
  if (text.content.length > MAX_TEXT_LENGTH) {
    issues.push({
      field: 'content',
      message: `Text is limited to ${MAX_TEXT_LENGTH.toLocaleString('en-US')} characters.`,
    });
  }
  if (!between(text.fontSize, 4, 800)) {
    issues.push({ field: 'fontSize', message: 'Font size must be between 4 and 800 px.' });
  }
  if (!FONT_WEIGHTS.includes(text.fontWeight)) {
    issues.push({
      field: 'fontWeight',
      message: `Weight must be one of ${FONT_WEIGHTS.join(', ')}.`,
    });
  }
  if (!FONT_STACKS.includes(text.fontStackId)) {
    issues.push({
      field: 'fontStackId',
      message: `Typeface must be one of ${FONT_STACKS.join(', ')}.`,
    });
  }
  if (!between(text.lineHeight, 0.5, 4)) {
    issues.push({
      field: 'lineHeight',
      message: 'Line height must be between 0.5 and 4 times the font size.',
    });
  }
  if (!between(text.letterSpacing, -50, 200)) {
    issues.push({
      field: 'letterSpacing',
      message: 'Letter spacing must be between -50 and 200 px.',
    });
  }
  if (!TEXT_ALIGNMENTS.includes(text.align)) {
    issues.push({ field: 'align', message: 'Alignment must be left, center or right.' });
  }
  if (!HEX.test(text.color)) {
    issues.push({ field: 'color', message: 'Text colour must be a 6-digit hex value.' });
  }
  return issues;
}

export function validateShapeSettings(shape: ShapeSettings): readonly FieldValidation[] {
  const issues: FieldValidation[] = [];
  if (shape.fill !== null && !HEX.test(shape.fill)) {
    issues.push({ field: 'fill', message: 'Fill must be a 6-digit hex colour, or none.' });
  }
  if (shape.stroke !== null && !HEX.test(shape.stroke)) {
    issues.push({ field: 'stroke', message: 'Stroke must be a 6-digit hex colour, or none.' });
  }
  if (!between(shape.strokeWidth, 0, 200)) {
    issues.push({ field: 'strokeWidth', message: 'Stroke width must be between 0 and 200 px.' });
  }
  if (!between(shape.cornerRadius, 0, 5_000)) {
    issues.push({ field: 'cornerRadius', message: 'Corner radius cannot be negative.' });
  }
  return issues;
}

export function validateImageSettings(image: ImageSettings): readonly FieldValidation[] {
  const issues: FieldValidation[] = [];
  if (!HEX.test(image.tint ?? '#ffffff') && image.tint !== null) {
    issues.push({ field: 'tint', message: 'Tint must be a 6-digit hex colour, or none.' });
  }
  if (!IMAGE_FITS.includes(image.fit)) {
    issues.push({ field: 'fit', message: `Fit must be one of ${IMAGE_FITS.join(', ')}.` });
  }
  if (image.assetId !== null && (image.assetId.trim().length === 0 || image.assetId.length > 80)) {
    issues.push({ field: 'assetId', message: 'Asset ids are between 1 and 80 characters.' });
  }
  if (
    image.href.length === 0 ||
    image.href.length > 2048 ||
    !/^(?:\.{0,2}\/|\/|https?:\/\/|data:image\/)/.test(image.href) ||
    /[\s<>"']/.test(image.href)
  ) {
    issues.push({
      field: 'href',
      message: 'Image source must be a relative path, an http(s) URL or an image data URL.',
    });
  }
  for (const axis of ['intrinsicWidth', 'intrinsicHeight'] as const) {
    if (!finite(image[axis]) || image[axis] < 0) {
      issues.push({ field: axis, message: `Intrinsic ${axis} cannot be negative.` });
    }
  }
  return issues;
}

/** Field-level validation for a single layer, whichever type it is. */
export function validateLayer(layer: Layer): readonly FieldValidation[] {
  const issues: FieldValidation[] = [...validateLayerFrame(layer.frame)];

  if (layer.name.trim().length === 0 || layer.name.length > MAX_LAYER_NAME_LENGTH) {
    issues.push({
      field: 'name',
      message: `Layer names are between 1 and ${MAX_LAYER_NAME_LENGTH} characters.`,
    });
  }
  if (!between(layer.opacity, 0, 1)) {
    issues.push({ field: 'opacity', message: 'Opacity must be between 0 and 100%.' });
  }

  switch (layer.type) {
    case 'text':
      issues.push(...validateTextSettings(layer.text));
      break;
    case 'rect':
    case 'ellipse':
      issues.push(...validateShapeSettings(layer.shape));
      break;
    case 'image':
      issues.push(...validateImageSettings(layer.image));
      break;
    case 'path':
      issues.push(...validateVectorContent(layer.vector));
      break;
  }

  return issues;
}

/**
 * Structural and geometric checks for a vector layer's content.
 *
 * The same properties the storage schema checks, evaluated here as well because the editor reaches
 * this function *before* a change is committed: telling a user "that node would fall outside the
 * supported range" while they drag beats rejecting their document on the next reload.
 */
export function validateVectorContent(content: VectorContent): readonly FieldValidation[] {
  const issues: FieldValidation[] = [];
  for (const issue of validatePath(content.path)) {
    issues.push({ field: 'vector.path', message: issue.message });
  }
  const { style } = content;
  if (style.strokeWidth < 0 || style.strokeWidth > VECTOR_STYLE_LIMITS.maxStrokeWidth) {
    issues.push({
      field: 'vector.style.strokeWidth',
      message: `Stroke width must be between 0 and ${String(VECTOR_STYLE_LIMITS.maxStrokeWidth)}.`,
    });
  }
  if (style.fillOpacity < 0 || style.fillOpacity > 1 || style.strokeOpacity < 0 || style.strokeOpacity > 1) {
    issues.push({ field: 'vector.style.opacity', message: 'Opacity must be between 0 and 1.' });
  }
  return issues;
}

/**
 * Scene rules that a per-layer check cannot see: the resource limit on layer count and the
 * uniqueness of ids, which every selection, hit test and reorder relies on.
 */
export function validateScene(scene: Scene): readonly FieldValidation[] {
  const issues: FieldValidation[] = [];

  if (scene.layers.length > MAX_LAYERS) {
    issues.push({
      field: 'layers',
      message: `A document can hold at most ${MAX_LAYERS} layers.`,
    });
  }

  const seen = new Set<string>();
  for (const layer of scene.layers) {
    const id = String(layer.id);
    if (seen.has(id)) {
      issues.push({ field: 'id', message: `Layer id “${id}” is used more than once.` });
    }
    seen.add(id);
    for (const issue of validateLayer(layer)) {
      issues.push({ field: `layers.${id}.${issue.field}`, message: issue.message });
    }
  }

  return issues;
}

/** Cheap structural sanity check used by the store before persisting. */
export function isDocumentStructurallySound(document: ForgeDocument): boolean {
  return (
    validateCanvas(document.canvas).length === 0 &&
    validateGuides(document.guides).length === 0 &&
    validateTitle(document.title).length === 0 &&
    validateScene(document.scene).length === 0 &&
    document.schemaVersion >= 1
  );
}
