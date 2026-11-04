/**
 * Document factories.
 *
 * All creation goes through the schema so that an invalid document cannot enter the store.
 * Factories return a `Result` instead of throwing: an invalid input is a user-facing message, not
 * a crash.
 */

import { err, forgeError, ok, type Result } from '../result';
import { brand } from '../types/brand';
import type { PartialProps } from '../types/optional';
import { freezeDocument } from './freeze';
import { emptyScene } from './layer-operations';
import type { AttributionRecord, Scene } from './layer-types';
import { defaultStudioPayload } from './payload';
import { createDocumentInputSchema, formatIssues } from './schema';
import { CURRENT_SCHEMA_VERSION } from './migrations';
import type { Canvas, CreateDocumentInput, ForgeDocument, GuideSettings } from './types';
import { SCREEN_DPI } from './units';

export const DEFAULT_GUIDES: GuideSettings = {
  safeMarginMm: 8,
  bleedMm: 0,
  showGrid: false,
  gridMm: 10,
  showCentreLines: true,
};

export const DEFAULT_CANVAS: Canvas = {
  width: 1080,
  height: 1080,
  unit: 'px',
  dpi: SCREEN_DPI,
  background: '#0f1115',
  transparent: false,
};

export function resolveGuides(overrides?: PartialProps<GuideSettings>): GuideSettings {
  if (!overrides) return { ...DEFAULT_GUIDES };
  return {
    safeMarginMm: overrides.safeMarginMm ?? DEFAULT_GUIDES.safeMarginMm,
    bleedMm: overrides.bleedMm ?? DEFAULT_GUIDES.bleedMm,
    showGrid: overrides.showGrid ?? DEFAULT_GUIDES.showGrid,
    gridMm: overrides.gridMm ?? DEFAULT_GUIDES.gridMm,
    showCentreLines: overrides.showCentreLines ?? DEFAULT_GUIDES.showCentreLines,
  };
}

/** Scene for a document created without startup artwork: a real, empty artboard. */
export function resolveScene(overrides?: Scene): Scene {
  if (!overrides) return emptyScene();
  return Object.freeze({ layers: Object.freeze([...overrides.layers]) });
}

export type DocumentIdGenerator = () => string;

/** Default id generator: collision-resistant, dependency free, works in every runtime. */
export function createDocumentId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `doc-${Date.now().toString(36)}-${random}`;
}

export type CreateDocumentOptions = {
  readonly now?: () => Date;
  readonly generateId?: DocumentIdGenerator;
};

/**
 * Validates and materialises a new document.
 * The returned document is frozen — the platform treats documents as immutable values and writes
 * updates through the store (see docs/ARCHITECTURE.md → state management).
 */
export function createDocument(
  input: CreateDocumentInput,
  options: CreateDocumentOptions = {},
): Result<ForgeDocument> {
  const parsed = createDocumentInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      forgeError('validation-failed', 'The project details are not valid.', {
        detail: formatIssues(parsed.error.issues).join('; '),
      }),
    );
  }

  const value = parsed.data;
  const now = options.now ?? (() => new Date());
  const generateId = options.generateId ?? createDocumentId;
  const timestamp = now().toISOString();

  const document: ForgeDocument = {
    id: brand<'DocumentId'>(generateId()),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    studioId: value.studioId,
    documentTypeId: value.documentTypeId,
    title: value.title,
    summary: value.summary ?? '',
    canvas: value.canvas,
    guides: resolveGuides(value.guides),
    palette: value.palette ?? [],
    scene: resolveScene(value.scene),
    attribution: [] as readonly AttributionRecord[],
    metadata: {
      authorLabel: '',
      tags: value.tags ?? [],
      notes: '',
    },
    status: 'draft',
    revision: 1,
    studioPayload: value.studioPayload ?? defaultStudioPayload(value.documentTypeId),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return ok(freezeDocument(document));
}

/** Applies a partial patch and bumps `revision` + `updatedAt`. Used by the history layer. */
export function applyDocumentPatch(
  document: ForgeDocument,
  patch: Partial<Omit<ForgeDocument, 'id' | 'schemaVersion' | 'createdAt'>>,
  now: Date = new Date(),
): ForgeDocument {
  return freezeDocument({
    ...document,
    ...patch,
    revision: document.revision + 1,
    updatedAt: now.toISOString(),
  });
}
