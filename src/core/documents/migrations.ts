/**
 * Document schema versioning and migration.
 *
 * Rules (see docs/DECISIONS.md → ADR-0005):
 *  1. Every persisted document carries `schemaVersion`.
 *  2. Migrations are one-way steps registered in `MIGRATIONS`; the chain is applied in order.
 *  3. A document written by a *newer* app version is rejected rather than silently downgraded —
 *     silent data loss is worse than a clear error.
 *  4. `migrateDocument` is the only way to turn untrusted JSON into a `ForgeDocument`.
 */

import { err, forgeError, ok, type Result } from '../result';
import { formatIssues, forgeDocumentSchema } from './schema';
import type { ForgeDocument } from './types';
import { SCREEN_DPI } from './units';

export const CURRENT_SCHEMA_VERSION = 1;

export type Migration = {
  readonly from: number;
  readonly to: number;
  /** Shown in diagnostics so a support conversation can identify the path a file took. */
  readonly description: string;
  readonly migrate: (raw: Record<string, unknown>) => Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * v0 → v1: the first published document shape was flat
 * (`{ title, width, height, background }`). v1 nests canvas state and adds guides, metadata,
 * revision and an explicit document type.
 */
const migrateV0ToV1: Migration = {
  from: 0,
  to: 1,
  description: 'Flattened canvas fields into `canvas`, added `guides`, `metadata` and `revision`.',
  migrate: (raw) => ({
    id: stringOr(raw.id, `doc-migrated-${Date.now().toString(36)}`),
    schemaVersion: 1,
    studioId: stringOr(raw.studioId, 'design'),
    documentTypeId: stringOr(raw.documentTypeId, 'design.canvas'),
    title: stringOr(raw.title, 'Untitled project'),
    summary: stringOr(raw.summary, ''),
    canvas: {
      width: Math.round(numberOr(raw.width, 1080)),
      height: Math.round(numberOr(raw.height, 1080)),
      unit: 'px',
      dpi: numberOr(raw.dpi, SCREEN_DPI),
      background: stringOr(raw.background, '#0f1115'),
      transparent: false,
    },
    guides: {
      safeMarginMm: 8,
      bleedMm: 0,
      showGrid: false,
      gridMm: 10,
      showCentreLines: true,
    },
    palette: Array.isArray(raw.palette) ? raw.palette : [],
    metadata: { authorLabel: '', tags: [], notes: '' },
    status: 'draft',
    revision: 1,
    createdAt: stringOr(raw.createdAt, new Date().toISOString()),
    updatedAt: stringOr(raw.updatedAt, stringOr(raw.createdAt, new Date().toISOString())),
  }),
};

export const MIGRATIONS: readonly Migration[] = [migrateV0ToV1];

export function readSchemaVersion(raw: unknown): number | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const version = record.schemaVersion;
  if (typeof version === 'number' && Number.isInteger(version) && version >= 0) return version;
  // Documents written before versioning existed are treated as version 0.
  return 0;
}

export function isSupportedSchemaVersion(version: number): boolean {
  return version >= 0 && version <= CURRENT_SCHEMA_VERSION;
}

/**
 * Migrates untrusted JSON to the current schema version and validates it.
 * @returns the validated document, or a `ForgeError` describing why it cannot be loaded.
 */
export function migrateDocument(raw: unknown): Result<ForgeDocument> {
  const record = asRecord(raw);
  if (!record) {
    return err(
      forgeError('storage-corrupt', 'A stored project record was not an object and was skipped.'),
    );
  }

  const version = readSchemaVersion(record) ?? 0;
  if (!isSupportedSchemaVersion(version)) {
    return err(
      forgeError(
        'unsupported',
        `This project was saved by a newer version of Euler's Forge (schema v${version}) and was not loaded.`,
        { detail: `Supported versions: 0–${CURRENT_SCHEMA_VERSION}` },
      ),
    );
  }

  let working: Record<string, unknown> = { ...record, schemaVersion: version };
  for (const migration of MIGRATIONS) {
    if (working.schemaVersion === migration.from) {
      working = migration.migrate(working);
    }
  }

  const parsed = forgeDocumentSchema.safeParse(working);
  if (!parsed.success) {
    return err(
      forgeError('storage-corrupt', 'A stored project record failed validation and was skipped.', {
        detail: formatIssues(parsed.error.issues).join('; '),
      }),
    );
  }

  return ok(Object.freeze(parsed.data));
}

/** Migration steps that a record at `version` will pass through, for user-facing diagnostics. */
export function pendingMigrations(version: number): readonly Migration[] {
  return MIGRATIONS.filter((migration) => migration.from >= version);
}
