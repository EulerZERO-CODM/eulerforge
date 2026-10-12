import { describe, expect, it } from 'vitest';

import {
  PROJECT_FILE_SCHEMA,
  PROJECT_FILE_VERSION,
  createProjectFile,
  parseProjectFile,
  projectFileName,
  serialiseProjectFile,
} from './project-file';
import { createDocument } from '../documents/factories';
import { CURRENT_SCHEMA_VERSION } from '../documents/migrations';
import { brand } from '../types/brand';
import type { CreateDocumentInput, ForgeDocument } from '../documents/types';

const documentTypeId = brand<'DocumentTypeId'>('design.canvas');

function makeDocument(overrides: Partial<CreateDocumentInput> = {}): ForgeDocument {
  const result = createDocument(
    {
      title: 'Summer campaign',
      studioId: 'design',
      documentTypeId,
      canvas: {
        width: 1080,
        height: 1350,
        unit: 'px',
        dpi: 96,
        background: '#0f1115',
        transparent: false,
      },
      ...overrides,
    },
    { now: () => new Date('2026-05-01T00:00:00.000Z'), generateId: () => 'doc-export' },
  );
  if (!result.ok) throw new Error('fixture document should be valid');
  return result.value;
}

const exportedAt = new Date('2026-06-01T12:00:00.000Z');

describe('createProjectFile', () => {
  it('wraps the document in a documented envelope', () => {
    const envelope = createProjectFile(makeDocument(), exportedAt);
    expect(envelope.$schema).toBe(PROJECT_FILE_SCHEMA);
    expect(envelope.fileVersion).toBe(PROJECT_FILE_VERSION);
    expect(envelope.exportedAt).toBe(exportedAt.toISOString());
    expect(envelope.generator.name).toBe("Euler's Forge");
    expect(envelope.document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe('serialiseProjectFile', () => {
  it('produces human-readable JSON ending with a newline', () => {
    const raw = serialiseProjectFile(makeDocument(), exportedAt);
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('\n  ');
    expect(JSON.parse(raw)).toMatchObject({ $schema: PROJECT_FILE_SCHEMA });
  });
});

describe('parseProjectFile', () => {
  it('round-trips a document without loss', () => {
    const document = makeDocument({ palette: ['#ff8a3d', '#0f1115'], tags: ['campaign'] });
    const result = parseProjectFile(serialiseProjectFile(document, exportedAt));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(document);
  });

  it('rejects malformed JSON', () => {
    const result = parseProjectFile('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation-failed');
  });

  it('rejects JSON that is not a project file', () => {
    const result = parseProjectFile(JSON.stringify({ hello: 'world' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/not an Euler’s Forge project file/);
  });

  it('refuses a file written by a newer app version', () => {
    const envelope = createProjectFile(makeDocument(), exportedAt);
    const result = parseProjectFile(
      JSON.stringify({ ...envelope, fileVersion: PROJECT_FILE_VERSION + 1 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unsupported');
  });

  it('reports a corrupt embedded document', () => {
    const envelope = createProjectFile(makeDocument(), exportedAt);
    const result = parseProjectFile(
      JSON.stringify({
        ...envelope,
        // A current-version record with an impossible canvas fails validation rather than migrating.
        document: { ...envelope.document, canvas: { ...envelope.document.canvas, width: 0 } },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('storage-corrupt');
  });
});

describe('projectFileName', () => {
  it('builds a filesystem-safe name from the title', () => {
    expect(projectFileName(makeDocument())).toBe('summer-campaign.forge.json');
  });

  it('strips punctuation and accents', () => {
    const document = makeDocument({ title: 'Café — “Spring” launch!' });
    expect(projectFileName(document)).toBe('cafe-spring-launch.forge.json');
  });

  it('falls back to a stable name when the title has no usable characters', () => {
    expect(projectFileName(makeDocument({ title: '***' }))).toBe('untitled-project.forge.json');
  });
});
