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

describe('buildExportChecklist for raster formats', () => {
  it('is ready for PNG when the environment can rasterise', () => {
    const checklist = buildExportChecklist(makeDocument(), 'png', {
      rasteriserAvailable: true,
      scale: 1,
    });

    expect(checklist.ready).toBe(true);
    expect(checklist.checks.map((entry) => entry.id)).toEqual([
      'renderer',
      'graphics',
      'output-size',
      'resolution',
      'transparency',
    ]);
    // No `implementation` check: this build really writes the file.
    expect(checklist.checks.map((entry) => entry.id)).not.toContain('implementation');
    expect(checklist.checks.find((entry) => entry.id === 'output-size')?.detail).toMatch(
      /2480 × 3508 px at 1x/,
    );
  });

  it('reports the real output size at the chosen scale', () => {
    const checklist = buildExportChecklist(makeDocument(), 'png', {
      rasteriserAvailable: true,
      scale: 0.5,
    });

    expect(checklist.checks.find((entry) => entry.id === 'output-size')?.detail).toMatch(
      /1240 × 1754 px at 0.5x/,
    );
  });

  it('blocks when the output would exceed the pixel budget', () => {
    const checklist = buildExportChecklist(makeDocument(), 'png', {
      rasteriserAvailable: true,
      scale: 4,
    });

    expect(checklist.ready).toBe(false);
    const size = checklist.checks.find((entry) => entry.id === 'output-size');
    expect(size?.status).toBe('blocked');
    expect(size?.remedy).toMatch(/smaller scale/i);
  });

  it('blocks when this environment cannot rasterise at all', () => {
    const checklist = buildExportChecklist(makeDocument(), 'png', {
      rasteriserAvailable: false,
      scale: 1,
    });

    const renderer = checklist.checks.find((entry) => entry.id === 'renderer');
    expect(renderer?.status).toBe('blocked');
    expect(renderer?.detail).toMatch(/did not provide a canvas 2D context/i);
  });

  it('blocks while a graphic in the document cannot be drawn', () => {
    const checklist = buildExportChecklist(makeDocument(), 'png', {
      rasteriserAvailable: true,
      scale: 1,
      renderIssues: [
        { message: 'Graphic "Logo" could not be drawn: the file is missing.', blocking: true },
        { message: '"Title" is taller than its box.', blocking: false },
      ],
    });

    const graphics = checklist.checks.find((entry) => entry.id === 'graphics');
    expect(graphics?.status).toBe('blocked');
    expect(graphics?.detail).toContain('the file is missing');
    // A non-blocking issue must not block the export.
    expect(graphics?.detail).not.toContain('taller than its box');
    expect(checklist.ready).toBe(false);
  });

  it('says which colour a transparent document flattens onto for JPEG', () => {
    const opaque = makeDocument().canvas;
    const transparent = makeDocument({ canvas: { ...opaque, transparent: true } });

    const white = buildExportChecklist(transparent, 'jpg', { jpegBackground: 'white' });
    const transparency = white.checks.find((entry) => entry.id === 'transparency');
    expect(transparency?.status).toBe('warning');
    expect(transparency?.detail).toContain('#ffffff');
    expect(transparency?.remedy).toMatch(/PNG/);
    // A warning explains itself; it must not be described as blocking.
    expect(white.ready).toBe(true);

    const black = buildExportChecklist(transparent, 'jpg', { jpegBackground: 'black' });
    expect(black.checks.find((entry) => entry.id === 'transparency')?.detail).toContain('#000000');
  });
});

describe('buildExportChecklist for planned formats', () => {
  it('blocks a format this build cannot write, and says so', () => {
    const checklist = buildExportChecklist(makeDocument(), 'svg');

    expect(checklist.ready).toBe(false);
    expect(checklist.blocked.map((entry) => entry.id)).toContain('implementation');
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

  it('warns, without blocking, when alpha has to be flattened for JPEG', () => {
    const opaqueCanvas = makeDocument().canvas;
    const checklist = buildExportChecklist(
      makeDocument({ canvas: { ...opaqueCanvas, transparent: true } }),
      'jpg',
    );
    const transparency = checklist.checks.find((entry) => entry.id === 'transparency');
    expect(transparency?.status).toBe('warning');
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
