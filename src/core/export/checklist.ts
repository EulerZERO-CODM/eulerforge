/**
 * Export readiness checks.
 *
 * These are real, deterministic evaluations over the document model — not a decorative progress bar.
 * Each check reports `pass`, `warning` or `blocked`, and every result explains what to do about it.
 * The checks are format-specific because the requirements genuinely differ per destination.
 */

import { fitsWithinCanvasLimits } from '../documents/validation';
import type { ForgeDocument } from '../documents/types';
import { MAX_CANVAS_PX, PRINT_DPI, SCREEN_DPI } from '../documents/units';
import { forgeDocumentSchema } from '../documents/schema';
import {
  getExportFormat,
  PROJECT_FILE_FORMAT_ID,
  type ExportFormat,
  type ExportFormatId,
} from './formats';

export type CheckStatus = 'pass' | 'warning' | 'blocked';

export type ExportCheck = {
  readonly id: string;
  readonly label: string;
  readonly status: CheckStatus;
  readonly detail: string;
  /** What the user should do; omitted when the check passes with nothing to act on. */
  readonly remedy?: string;
};

export type ExportChecklist = {
  readonly format: ExportFormat;
  readonly checks: readonly ExportCheck[];
  readonly blocked: readonly ExportCheck[];
  readonly warnings: readonly ExportCheck[];
  /** True when no check is blocking. */
  readonly ready: boolean;
  /** Human summary used in buttons and headings. */
  readonly summary: string;
};

function check(
  id: string,
  label: string,
  status: CheckStatus,
  detail: string,
  remedy?: string,
): ExportCheck {
  return remedy === undefined
    ? { id, label, status, detail }
    : { id, label, status, detail, remedy };
}

function projectFileChecks(document: ForgeDocument): readonly ExportCheck[] {
  const parsed = forgeDocumentSchema.safeParse(document);
  return [
    check(
      'schema-valid',
      'Document validates against the current schema',
      parsed.success ? 'pass' : 'blocked',
      parsed.success
        ? `Schema version ${document.schemaVersion} is valid.`
        : 'The document does not satisfy the published schema, so a project file would be unreadable.',
      parsed.success ? undefined : 'Fix the reported field and try again.',
    ),
    check(
      'titled',
      'Project has a descriptive name',
      document.title.trim().length >= 3 && !/^untitled/i.test(document.title.trim())
        ? 'pass'
        : 'warning',
      document.title.trim().length >= 3
        ? `Named “${document.title}”.`
        : 'The project is still called something like “Untitled”. A name is what you will search for later.',
      'Rename the project in the inspector.',
    ),
    check(
      'canvas-limits',
      'Canvas within supported limits',
      fitsWithinCanvasLimits(document.canvas) ? 'pass' : 'blocked',
      `Canvas is ${document.canvas.width} × ${document.canvas.height} px (limits ${MAX_CANVAS_PX} px per side).`,
      'Reduce the canvas size in the inspector.',
    ),
    check(
      'palette',
      'Working palette captured',
      document.palette.length >= 2 ? 'pass' : 'warning',
      document.palette.length >= 2
        ? `${document.palette.length} palette colours travel with the document.`
        : 'No palette is set, so this document carries no colour decisions forward.',
      'Add at least two colours in the palette section.',
    ),
  ];
}

function rasterChecks(document: ForgeDocument, format: ExportFormat): readonly ExportCheck[] {
  const { canvas } = document;
  const checks: ExportCheck[] = [];

  checks.push(
    check(
      'renderer',
      'Raster renderer available',
      'blocked',
      `${format.label} export requires a raster renderer, which is not implemented in this build.`,
      'Export the project file instead, or follow the roadmap for the raster pipeline.',
    ),
  );

  checks.push(
    check(
      'resolution',
      'Resolution appropriate for the declared output',
      canvas.dpi >= PRINT_DPI ? 'pass' : canvas.unit === 'px' ? 'pass' : 'warning',
      canvas.unit === 'px'
        ? `Canvas is measured in pixels at ${canvas.dpi} DPI reference. Pixel documents are unaffected by print DPI.`
        : `Canvas is measured in ${canvas.unit} at ${canvas.dpi} DPI.`,
      canvas.dpi >= PRINT_DPI ? undefined : 'Raise DPI to 300 for print output.',
    ),
  );

  if (format.capabilities.printReady && canvas.unit !== 'px') {
    checks.push(
      check(
        'bleed',
        'Bleed configured for print',
        document.guides.bleedMm >= 3 ? 'pass' : 'warning',
        document.guides.bleedMm >= 3
          ? `Bleed is set to ${document.guides.bleedMm} mm.`
          : 'Print output without bleed risks white slivers where the piece is trimmed.',
        'Set bleed to at least 3 mm in the guides panel.',
      ),
    );
  }

  if (format.capabilities.transparency) {
    checks.push(
      check(
        'transparency',
        'Transparency supported by the chosen format',
        'pass',
        `${format.label} can carry an alpha channel${canvas.transparent ? ' and the document is transparent' : '; this document has a background colour'}.`,
      ),
    );
  } else {
    checks.push(
      check(
        'transparency',
        'Transparency supported by the chosen format',
        canvas.transparent ? 'blocked' : 'pass',
        canvas.transparent
          ? `${format.label} cannot store transparency, so the transparent area would be flattened.`
          : `${format.label} does not store alpha; this document has a background colour, so nothing is lost.`,
        canvas.transparent
          ? 'Set a background colour or choose a format with alpha support.'
          : undefined,
      ),
    );
  }

  return checks;
}

function plannedFormatChecks(format: ExportFormat): readonly ExportCheck[] {
  return [
    check(
      'implementation',
      'Export implementation available',
      'blocked',
      `${format.label} export is planned, not implemented. Choosing it here does not produce a file.`,
      'Use the project file export, or track the roadmap item for this format.',
    ),
  ];
}

/**
 * Builds the checklist for a document + chosen format.
 * @param formatId defaults to the project file, the only implemented format.
 */
export function buildExportChecklist(
  document: ForgeDocument,
  formatId: ExportFormatId | string = PROJECT_FILE_FORMAT_ID,
): ExportChecklist {
  const format = getExportFormat(String(formatId));
  if (!format) {
    throw new Error(`Unknown export format: ${String(formatId)}`);
  }

  const checks =
    format.id === PROJECT_FILE_FORMAT_ID
      ? projectFileChecks(document)
      : [...plannedFormatChecks(format), ...rasterChecks(document, format)];

  const blocked = checks.filter((entry) => entry.status === 'blocked');
  const warnings = checks.filter((entry) => entry.status === 'warning');
  const ready = blocked.length === 0;

  const summary = ready
    ? warnings.length === 0
      ? 'Ready to export'
      : `Ready to export with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`
    : `${blocked.length} blocking issue${blocked.length === 1 ? '' : 's'}`;

  return { format, checks, blocked, warnings, ready, summary };
}

/** Screen-resolution reference used by the inspector; exported for reuse in the UI. */
export const REFERENCE_SCREEN_DPI = SCREEN_DPI;
