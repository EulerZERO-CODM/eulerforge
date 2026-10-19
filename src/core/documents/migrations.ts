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
import { freezeDocument } from './freeze';
import { formatIssues, forgeDocumentSchema } from './schema';
import type { ForgeDocument } from './types';
import { defaultStudioPayload } from './payload';
import { SCREEN_DPI } from './units';

export const CURRENT_SCHEMA_VERSION = 6;

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

/**
 * v1 → v2: documents gained an ordered layer scene and asset attribution records.
 *
 * An existing document had no artwork at all, so the honest result is an empty scene — not a
 * fabricated placeholder layer. Attribution starts empty for the same reason. Any layer data that
 * is already present (for example a file written by a development build of v2) is preserved rather
 * than discarded, so migrating is never lossy.
 */
const migrateV1ToV2: Migration = {
  from: 1,
  to: 2,
  description: 'Added the ordered layer scene and the asset attribution ledger.',
  migrate: (raw) => {
    const existingScene = asRecord(raw.scene);
    const existingLayers = existingScene?.layers;

    return {
      ...raw,
      schemaVersion: 2,
      scene: {
        layers: Array.isArray(existingLayers) ? existingLayers : [],
      },
      attribution: Array.isArray(raw.attribution) ? raw.attribution : [],
    };
  },
};

/**
 * v2 → v3: documents can hold vector path layers.
 *
 * Nothing has to be rewritten: a v2 document simply has no path layers, and every field it carries
 * means the same thing. The version is still bumped, because a v3 *writer* can produce documents a
 * v2 build cannot read, and the rule in ADR-0005 is that a reader must be able to tell. Stamping an
 * explicit step here means the migration chain is complete and testable rather than implicit.
 */
const migrateV2ToV3: Migration = {
  from: 2,
  to: 3,
  description: 'Documents may contain vector path layers; existing content is preserved unchanged.',
  migrate: (raw) => ({ ...raw, schemaVersion: 3 }),
};

/**
 * v4 → v5: vector styles can carry gradient or pattern paint.
 *
 * A v4 document's flat `fill`/`stroke` mean exactly what they meant before, so nothing is rewritten:
 * the optional `fillPaint`/`strokePaint` keys are simply absent, which the schema reads as "solid".
 * The version is bumped because a v5 *writer* can produce a document a v4 build would open with the
 * paint fields silently dropped — and ADR-0005 makes silent field loss the one thing a reader must be
 * able to detect. Stamping the step also keeps the migration chain complete and testable.
 */
const migrateV4ToV5: Migration = {
  from: 4,
  to: 5,
  description:
    'Vector styles may carry gradient or pattern paint; existing flat fills are unchanged.',
  migrate: (raw) => ({ ...raw, schemaVersion: 5 }),
};

/**
 * v5 → v6: a photo mask may carry source-pixel range selections.
 *
 * The key is optional, so a v5 mask keeps meaning exactly what it did: painted strokes only. The
 * version is bumped for the usual reason (ADR-0005): a v6 writer can produce a document a v5 build
 * would open with the ranges silently stripped.
 */
const migrateV5ToV6: Migration = {
  from: 5,
  to: 6,
  description:
    'Photo masks may carry luminance or colour range selections; existing masks are unchanged.',
  migrate: (raw) => ({ ...raw, schemaVersion: 6 }),
};

/**
 * v3 → v4: documents gained a studio payload for Photo, Motion and Video.
 *
 * Existing projects are design canvases and vector artboards, which carry no payload, so the honest
 * migration is `null`. A v3 file that already names one of the payload document types (created by a
 * development build) gets the empty payload for its type instead of failing validation.
 */
const migrateV3ToV4: Migration = {
  from: 3,
  to: 4,
  description: 'Added the studio payload block used by Photo, Motion and Video documents.',
  migrate: (raw) => ({
    ...raw,
    schemaVersion: 4,
    studioPayload:
      raw.studioPayload ?? defaultStudioPayload(stringOr(raw.documentTypeId, 'design.canvas')),
  }),
};

export const MIGRATIONS: readonly Migration[] = [
  migrateV0ToV1,
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
  migrateV4ToV5,
  migrateV5ToV6,
];

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

  return ok(freezeDocument(parsed.data));
}

/** Migration steps that a record at `version` will pass through, for user-facing diagnostics. */
export function pendingMigrations(version: number): readonly Migration[] {
  return MIGRATIONS.filter((migration) => migration.from >= version);
}
