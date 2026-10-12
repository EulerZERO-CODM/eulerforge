import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CANVAS,
  DEFAULT_GUIDES,
  applyDocumentPatch,
  createDocument,
  resolveGuides,
} from './factories';
import { CURRENT_SCHEMA_VERSION } from './migrations';
import { brand } from '../types/brand';
import type { CreateDocumentInput } from './types';

const documentTypeId = brand<'DocumentTypeId'>('design.canvas');

const input: CreateDocumentInput = {
  title: 'Launch poster',
  studioId: 'design',
  documentTypeId,
  canvas: DEFAULT_CANVAS,
};

const fixedDate = new Date('2026-03-04T05:06:07.000Z');

function create(overrides: Partial<CreateDocumentInput> = {}) {
  const result = createDocument(
    { ...input, ...overrides },
    { now: () => fixedDate, generateId: () => 'doc-fixed' },
  );
  if (!result.ok) throw new Error('the fixture document should be valid');
  return result.value;
}

describe('createDocument', () => {
  it('materialises a valid document with the current schema version', () => {
    const document = create();
    expect(document.id).toBe('doc-fixed');
    expect(document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(document.revision).toBe(1);
    expect(document.status).toBe('draft');
    expect(document.createdAt).toBe(fixedDate.toISOString());
    expect(document.updatedAt).toBe(document.createdAt);
  });

  it('returns a frozen value so callers cannot mutate a document in place', () => {
    const document = create();
    expect(Object.isFrozen(document)).toBe(true);
  });

  it('fills in documented defaults for optional input', () => {
    const document = create();
    expect(document.guides).toEqual(DEFAULT_GUIDES);
    expect(document.palette).toEqual([]);
    expect(document.metadata).toEqual({ authorLabel: '', tags: [], notes: '' });
    expect(document.summary).toBe('');
  });

  it('applies guide overrides without dropping the remaining fields', () => {
    const document = create({ guides: { showGrid: true, gridMm: 25 } });
    expect(document.guides).toEqual({ ...DEFAULT_GUIDES, showGrid: true, gridMm: 25 });
  });

  it('returns an error result instead of throwing for invalid input', () => {
    const result = createDocument({ ...input, title: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation-failed');
      expect(result.error.message).toMatch(/not valid/i);
    }
  });

  it('generates unique ids by default', () => {
    const first = createDocument(input);
    const second = createDocument(input);
    if (!first.ok || !second.ok) throw new Error('both documents should be valid');
    expect(first.value.id).not.toBe(second.value.id);
  });
});

describe('resolveGuides', () => {
  it('returns a copy of the defaults when nothing is overridden', () => {
    const guides = resolveGuides();
    expect(guides).toEqual(DEFAULT_GUIDES);
    expect(guides).not.toBe(DEFAULT_GUIDES);
  });

  it('keeps explicit falsy overrides', () => {
    expect(resolveGuides({ showCentreLines: false }).showCentreLines).toBe(false);
    expect(resolveGuides({ bleedMm: 0 }).bleedMm).toBe(0);
  });
});

describe('applyDocumentPatch', () => {
  it('merges the patch, bumps the revision and records the new timestamp', () => {
    const document = create();
    const patched = applyDocumentPatch(document, { title: 'Launch poster v2' }, fixedDate);
    expect(patched.title).toBe('Launch poster v2');
    expect(patched.revision).toBe(document.revision + 1);
    expect(Object.isFrozen(patched)).toBe(true);
    // The original value is untouched: documents are immutable.
    expect(document.title).toBe('Launch poster');
    expect(document.revision).toBe(1);
  });
});
