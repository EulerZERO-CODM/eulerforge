/**
 * Document validation helpers shared by the workspace UI and the export checks.
 *
 * These are the *field-level* rules users interact with; `schema.ts` holds the authoritative
 * structural schemas. Keeping the messages here means a form and an export check cannot disagree
 * about whether a canvas is valid.
 */

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

/** Cheap structural sanity check used by the store before persisting. */
export function isDocumentStructurallySound(document: ForgeDocument): boolean {
  return (
    validateCanvas(document.canvas).length === 0 &&
    validateGuides(document.guides).length === 0 &&
    validateTitle(document.title).length === 0 &&
    document.schemaVersion >= 1
  );
}
