import { describe, expect, it } from 'vitest';

import { buildExportChecklist } from './checklist';
import { PROJECT_FILE_FORMAT_ID } from './formats';
import { createDocument } from '../documents/factories';
import { brand } from '../types/brand';
import type { CreateDocumentInput, ForgeDocument } from '../documents/types';

const documentTypeId = brand<'DocumentTypeId'>('design.canvas');

function makeDocument(overrides: Partial<CreateDocumentInput> = {}): ForgeDocument {
  const result = createDocument(
    {
      title: 'Launch poster',
      studioId: 'design',
      documentTypeId,
      canvas: {
        width: 2480,
        height: 3508,
        unit: 'mm',
        dpi: 300,
        background: '#0f1115',
        transparent: false,
      },
      palette: ['#ff8a3d', '#0f1115'],
      ...overrides,
    },
    { now: () => new Date('2026-05-01T00:00:00.000Z'), generateId: () => 'doc-export' },
  );
  if (!result.ok) throw new Error('fixture document should be valid');
  return result.value;
}

describe('buildExportChecklist for the project file', () => {
  it('is ready by default and reports the schema version', () => {
    const checklist = buildExportChecklist(makeDocument(), PROJECT_FILE_FORMAT_ID);
    expect(checklist.format.id).toBe(PROJECT_FILE_FORMAT_ID);
    expect(checklist.ready).toBe(true);
    expect(checklist.blocked).toEqual([]);
    expect(checklist.summary).toMatch(/ready/i);
    expect(checklist.checks.map((entry) => entry.id)).toEqual([
      'schema-valid',
      'titled',
      'canvas-limits',
      'palette',
    ]);
  });

  it('defaults to the project file when no format is given', () => {
    expect(buildExportChecklist(makeDocument()).format.id).toBe(PROJECT_FILE_FORMAT_ID);
  });

  it('warns about a vague name and a missing palette without blocking', () => {
    const checklist = buildExportChecklist(
      makeDocument({ title: 'untitled', palette: [] }),
      PROJECT_FILE_FORMAT_ID,
    );
    expect(checklist.ready).toBe(true);
    expect(checklist.warnings.map((entry) => entry.id).sort()).toEqual(['palette', 'titled']);
    expect(checklist.summary).toMatch(/warning/i);
    for (const warning of checklist.warnings) expect(warning.remedy).toBeDefined();
  });
});

describe('buildExportChecklist for planned formats', () => {
  it('blocks a raster export because no renderer exists yet', () => {
    const checklist = buildExportChecklist(makeDocument(), 'png');
    expect(checklist.ready).toBe(false);
    expect(checklist.blocked.map((entry) => entry.id)).toContain('implementation');
    expect(checklist.blocked.map((entry) => entry.id)).toContain('renderer');
    expect(checklist.summary).toMatch(/blocking issue/);
  });

  it('explains that choosing a planned format produces no file', () => {
    const checklist = buildExportChecklist(makeDocument(), 'mp4');
    const implementation = checklist.checks.find((entry) => entry.id === 'implementation');
    expect(implementation?.detail).toMatch(/does not produce a file/i);
  });

  it('warns about print bleed when a print-ready format is chosen for a physical canvas', () => {
    const checklist = buildExportChecklist(makeDocument(), 'pdf');
    const bleed = checklist.checks.find((entry) => entry.id === 'bleed');
    expect(bleed?.status).toBe('warning');
    expect(bleed?.remedy).toMatch(/3 mm/);
  });

  it('passes the transparency check when the format has no alpha but the document is opaque', () => {
    const checklist = buildExportChecklist(makeDocument(), 'jpg');
    expect(checklist.checks.find((entry) => entry.id === 'transparency')?.status).toBe('pass');
  });

  it('blocks a transparent document exported to a format without alpha', () => {
    const opaqueCanvas = makeDocument().canvas;
    const checklist = buildExportChecklist(
      makeDocument({ canvas: { ...opaqueCanvas, transparent: true } }),
      'jpg',
    );
    const transparency = checklist.checks.find((entry) => entry.id === 'transparency');
    expect(transparency?.status).toBe('blocked');
    expect(transparency?.remedy).toBeDefined();
  });
});

describe('buildExportChecklist guards', () => {
  it('rejects an unknown format id instead of inventing checks', () => {
    expect(() => buildExportChecklist(makeDocument(), 'not-a-format')).toThrow(
      /Unknown export format/,
    );
  });
});
