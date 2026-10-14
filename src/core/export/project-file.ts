/**
 * Project file serialisation.
 *
 * The `.forge.json` file is the one export format actually implemented in Phase 1. It contains the
 * document definition — canvas, guides, palette and metadata — and nothing else. It is a backup and
 * an inspection format, not a rendered image, and the UI labels it that way.
 */

import { migrateDocument } from '../documents/migrations';
import type { ForgeDocument } from '../documents/types';
import { err, forgeError, type Result } from '../result';

export const PROJECT_FILE_SCHEMA = 'forge/project-file';
export const PROJECT_FILE_VERSION = 1;

export type ProjectFileEnvelope = {
  readonly $schema: typeof PROJECT_FILE_SCHEMA;
  readonly fileVersion: number;
  readonly exportedAt: string;
  readonly generator: { readonly name: string; readonly version: string };
  readonly document: ForgeDocument;
};

export function createProjectFile(
  document: ForgeDocument,
  now: Date = new Date(),
): ProjectFileEnvelope {
  return {
    $schema: PROJECT_FILE_SCHEMA,
    fileVersion: PROJECT_FILE_VERSION,
    exportedAt: now.toISOString(),
    generator: { name: "Euler's Forge", version: '0.1.0' },
    document,
  };
}

/** Pretty-printed so a downloaded file is readable and diffable. */
export function serialiseProjectFile(document: ForgeDocument, now: Date = new Date()): string {
  return `${JSON.stringify(createProjectFile(document, now), null, 2)}\n`;
}

/**
 * Reads a project file back.
 *
 * Implemented now (not planned) because it makes the export format testable: the round-trip test in
 * `src/core/export/project-file.test.ts` guarantees the documented format actually reloads. The UI
 * does not expose an import action yet.
 */
export function parseProjectFile(raw: string): Result<ForgeDocument> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return err(
      forgeError('validation-failed', 'That file is not valid JSON.', {
        detail: error instanceof Error ? error.message : undefined,
      }),
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return err(forgeError('validation-failed', 'That file does not contain a project.'));
  }

  const envelope = parsed as Partial<ProjectFileEnvelope>;
  if (envelope.$schema !== PROJECT_FILE_SCHEMA) {
    return err(
      forgeError('validation-failed', 'That file is not an Euler’s Forge project file.', {
        detail: `Expected $schema "${PROJECT_FILE_SCHEMA}".`,
      }),
    );
  }
  if (typeof envelope.fileVersion === 'number' && envelope.fileVersion > PROJECT_FILE_VERSION) {
    return err(
      forgeError(
        'unsupported',
        `That project file was written by a newer version (file v${envelope.fileVersion}).`,
      ),
    );
  }

  return migrateDocument(envelope.document);
}

/** Filesystem-safe filename for a document, e.g. `summer-campaign.forge.json`. */
export function projectFileName(document: ForgeDocument): string {
  const slug = document.title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60);
  return `${slug || 'untitled-project'}.forge.json`;
}

/**
 * The exact bytes and suggested name of a project file, ready to be saved.
 *
 * The core builds the payload; handing it to the browser is the caller's job, because that step
 * needs `document`, `window` and `URL.createObjectURL`, none of which belong in `src/core/**`
 * (ADR-0019). The interface composes this with the download adapter; a test can assert the payload
 * without a browser at all.
 */
export type ProjectFilePayload = {
  /** The file's contents: pretty-printed JSON with a trailing newline. */
  readonly contents: string;
  readonly fileName: string;
  readonly mimeType: 'application/json';
};

export function projectFilePayload(
  document: ForgeDocument,
  now: Date = new Date(),
): ProjectFilePayload {
  return {
    contents: serialiseProjectFile(document, now),
    fileName: projectFileName(document),
    mimeType: 'application/json',
  };
}
