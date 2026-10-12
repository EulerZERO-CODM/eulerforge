import { describe, expect, it } from 'vitest';

import { parseProjectFile, serialiseProjectFile } from '../export/project-file';
import { createDocument } from './factories';
import { migrateDocument } from './migrations';
import { forgeDocumentSchema } from './schema';
import {
  attributionRecord,
  imageLayer,
  rectLayer,
  sceneOf,
  textLayer,
  TEST_DOCUMENT_TYPE,
} from '../../testing/layers';
import type { ForgeDocument } from './types';

/**
 * Layer data must survive every container it can travel in.
 *
 * A layer model that only works in memory is not a document model. These tests take one populated
 * document — typography, shapes, a placed graphic and its attribution record — and push it through
 * JSON, the `.forge.json` envelope and the migration entry point, asserting the layer data comes back
 * byte-for-byte identical.
 */

function populated(): ForgeDocument {
  const scene = sceneOf(
    rectLayer('lyr-bg', {
      x: 0,
      y: 0,
      width: 1080,
      height: 1080,
      fill: '#101418',
      stroke: null,
      name: 'Backdrop',
    }),
    imageLayer('lyr-art', {
      x: 240,
      y: 240,
      width: 600,
      height: 600,
      href: '/forge-assets/waveform-motif.svg',
      assetId: 'graphic.waveform-motif',
      fit: 'contain',
      tint: null,
      name: 'Waveform motif',
    }),
    textLayer('lyr-title', {
      x: 80,
      y: 120,
      width: 920,
      height: 160,
      content: 'Launch night\nDoors 8pm',
      fontSize: 72,
      color: '#ff8a3d',
      align: 'center',
      name: 'Headline',
    }),
  );
  const created = createDocument(
    {
      title: 'Launch poster',
      studioId: 'design',
      documentTypeId: TEST_DOCUMENT_TYPE,
      canvas: {
        width: 1080,
        height: 1350,
        unit: 'px',
        dpi: 96,
        background: '#101418',
        transparent: false,
      },
      scene,
      palette: ['#ff8a3d', '#101418'],
    },
    { generateId: () => 'doc-layers', now: () => new Date('2026-04-02T03:04:05.000Z') },
  );
  if (!created.ok) {
    throw new Error(
      `fixture document is invalid: ${created.error.message} ${created.error.detail ?? ''}`,
    );
  }
  return { ...created.value, attribution: [attributionRecord()] };
}

describe('layer persistence', () => {
  it('round-trips a populated scene through JSON without loss', () => {
    const document = populated();
    const reloaded = JSON.parse(JSON.stringify(document)) as ForgeDocument;

    expect(reloaded.scene).toEqual(document.scene);
    expect(reloaded.attribution).toEqual(document.attribution);
    expect(reloaded.palette).toEqual(document.palette);
    expect(forgeDocumentSchema.safeParse(reloaded).success).toBe(true);
  });

  it('round-trips through the .forge.json envelope', () => {
    const document = populated();
    const parsed = parseProjectFile(serialiseProjectFile(document));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.scene).toEqual(document.scene);
    expect(parsed.value.attribution).toEqual(document.attribution);
    expect(forgeDocumentSchema.safeParse(parsed.value).success).toBe(true);
    // Nothing about the editing session travels with the file.
    expect(JSON.stringify(parsed.value)).not.toContain('selection');
  });

  it('keeps typography exactly as typed, including a newline and alignment', () => {
    const document = populated();
    const parsed = parseProjectFile(serialiseProjectFile(document));
    if (!parsed.ok) throw new Error('the fixture file should parse');

    const layer = parsed.value.scene.layers[2];
    if (layer?.type !== 'text') throw new Error('the third layer must be the text layer');
    expect(layer.text.content).toBe('Launch night\nDoors 8pm');
    expect(layer.text.fontSize).toBe(72);
    expect(layer.text.align).toBe('center');
    expect(layer.text.color).toBe('#ff8a3d');
  });

  it('writes the current schema version so a new document never needs migrating', () => {
    const document = populated();
    const migrated = migrateDocument(JSON.parse(JSON.stringify(document)));

    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.schemaVersion).toBe(document.schemaVersion);
    expect(migrated.value.scene).toEqual(document.scene);
    expect(migrated.value.attribution).toEqual(document.attribution);
  });

  it('opens a version 1 document with an empty scene rather than failing', () => {
    const document = populated();
    const versionOne: Record<string, unknown> = { ...document, schemaVersion: 1 };
    delete versionOne.scene;
    delete versionOne.attribution;

    const migrated = migrateDocument(versionOne);

    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.schemaVersion).toBe(2);
    expect(migrated.value.scene.layers).toEqual([]);
    expect(migrated.value.attribution).toEqual([]);
    // The migration must produce a document the current schema accepts, not just "something".
    expect(forgeDocumentSchema.safeParse(migrated.value).success).toBe(true);
    expect(migrated.value.canvas).toEqual(document.canvas);
  });
});
