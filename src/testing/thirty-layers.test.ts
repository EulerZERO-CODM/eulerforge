// @vitest-environment node
/**
 * The thirty-layer fixture, checked before it is used to measure anything.
 *
 * A benchmark's document is part of its method: if the fixture quietly changed shape, or lost a
 * graphic, or started overflowing a text box, the numbers beside it would stop describing what the
 * document claims to be. So the fixture is asserted here:
 *
 * 1. **its shape** — thirty layers of the stated types, ten licence records matching the placed
 *    graphics, unique ids, every layer named and every text layer carrying copy;
 * 2. **that it is deterministic** — two builds are byte-identical, ids and timestamps included, so
 *    two runs measure the same picture;
 * 3. **that it renders cleanly against real metrics** — the plan is built with the same
 *    `contextMeasureFactory` and `buildRenderPlan` the artboard uses, against a native rasteriser and
 *    the repository's real SVG files, and it must report *no* render issues at all: no unresolvable
 *    graphic, no text overflowing its frame, no empty shape;
 * 4. **that the browser can load it** — the stored form is parsed by `migrateDocument`, the same
 *    function the repository runs on every read.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { migrateDocument } from '../core/documents/migrations';
import { contextMeasureFactory } from '../core/render/measure';
import { buildRenderPlan } from '../core/render/plan';
import { loadImageFixtures, nodeCanvasFactory } from './raster';
import {
  catalogueFiles,
  THIRTY_LAYER_COUNTS,
  THIRTY_LAYER_DOCUMENT_ID,
  THIRTY_LAYER_TOTAL,
  thirtyLayerDocument,
} from './thirty-layers';

const createCanvas = nodeCanvasFactory();

/** The catalogue's own files, decoded the way the browser decodes them: this is a real load. */
async function resolveCatalogueImages() {
  const sources: Record<string, Buffer> = {};
  for (const record of catalogueFiles()) {
    if (!record.file) throw new Error(`${record.name} should ship a file`);
    const name = record.file.href.split('/').pop();
    if (!name) throw new Error(`${record.name} has an href without a file name`);
    sources[record.file.href] = readFileSync(join(process.cwd(), 'public', 'forge-assets', name));
  }
  return loadImageFixtures(sources);
}

describe('the thirty-layer fixture', () => {
  it('holds thirty named layers of the stated types, and a licence for every graphic', () => {
    const document = thirtyLayerDocument();
    const layers = document.scene.layers;

    expect(layers).toHaveLength(THIRTY_LAYER_TOTAL);
    const counts: Record<string, number> = {};
    for (const layer of layers) counts[layer.type] = (counts[layer.type] ?? 0) + 1;
    expect(counts).toEqual(THIRTY_LAYER_COUNTS);

    // Ids are stable and unique: the browser spec addresses layers by id when it drives gestures.
    expect(new Set(layers.map((layer) => String(layer.id))).size).toBe(THIRTY_LAYER_TOTAL);
    expect(layers.every((layer) => layer.name.trim().length > 0)).toBe(true);
    // Real copy, not one-word placeholders: wrapping cost is what the benchmark is measuring, so the
    // fixture carries four paragraphs that each wrap over several lines.
    const copy = layers.filter((layer) => layer.type === 'text').map((layer) => layer.text.content);
    expect(copy.every((content) => content.trim().length >= 4)).toBe(true);
    expect(copy.filter((content) => content.length > 80)).toHaveLength(3);

    // Placing a catalogue record records its licence, and the fixture places ten of them.
    expect(document.attribution).toHaveLength(THIRTY_LAYER_COUNTS.image);
    const placedIds = layers
      .filter((layer) => layer.type === 'image')
      .map((layer) => (layer.type === 'image' ? layer.image.assetId : null));
    expect(placedIds).toEqual(document.attribution.map((record) => record.assetId));
    // Every record names where the work came from, which is the point of carrying it in the document.
    expect(
      document.attribution.every(
        (record) =>
          record.licenseId.length > 0 && record.author.length > 0 && record.source.length > 0,
      ),
    ).toBe(true);

    expect(document.id).toBe(THIRTY_LAYER_DOCUMENT_ID);
    expect(document.canvas).toMatchObject({ width: 1600, height: 1100 });
  });

  it('is byte-identical between two builds', () => {
    // Ids, `placedAt` and `updatedAt` are all fixed, so a benchmark's document cannot drift.
    expect(JSON.stringify(thirtyLayerDocument())).toBe(JSON.stringify(thirtyLayerDocument()));
  });

  it('loads through the same migration the repository runs on every read', () => {
    // The browser spec writes the document into storage and reopens it, so its stored form has to
    // parse: this is the same code path, without a browser.
    const stored = JSON.parse(JSON.stringify(thirtyLayerDocument())) as unknown;
    const migrated = migrateDocument(stored);
    expect(migrated.ok, migrated.ok ? '' : migrated.error.message).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.scene.layers).toHaveLength(THIRTY_LAYER_TOTAL);
    expect(migrated.value.attribution).toHaveLength(THIRTY_LAYER_COUNTS.image);
  });

  it('renders with no render issues at all, against real metrics and the real files', async () => {
    const document = thirtyLayerDocument();
    const canvas = createCanvas(document.canvas.width, document.canvas.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('the native rasteriser returned no 2D context');
    const resolveImage = await resolveCatalogueImages();

    const plan = buildRenderPlan(document, {
      measureFont: contextMeasureFactory(context),
      resolveImage,
    });

    // Text overflow, an empty shape or an unresolvable graphic would each be a defect in the fixture
    // rather than a fact about performance, so all three are failures here.
    expect(plan.issues.map((issue) => `${issue.kind}: ${issue.layerName}`)).toEqual([]);
    expect(plan.blocked).toBe(false);

    // Every layer really produced a draw op (the background is the first op, not a layer).
    const layerOps = plan.ops.filter((op) => op.kind !== 'background');
    expect(layerOps).toHaveLength(THIRTY_LAYER_TOTAL);
    const text = plan.ops.filter((op) => op.kind === 'text');
    expect(text.length).toBe(THIRTY_LAYER_COUNTS.text);
    // Wrapped copy, not one long line per box: this is what makes layout cost real.
    const lines = text.reduce((sum, op) => sum + (op.kind === 'text' ? op.lines.length : 0), 0);
    expect(lines).toBeGreaterThan(THIRTY_LAYER_COUNTS.text);
  });
});
