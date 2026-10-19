/**
 * Turning a trace into layers.
 *
 * The interesting properties are placement, ordering, paint and undo granularity: a trace that lands
 * off-canvas, paints small details underneath large ones or takes twelve undos to remove would be a
 * feature that technically "worked" and practically did not.
 */

import { describe, expect, it } from 'vitest';

import { createDocument } from '../documents/factories';
import { createLayer } from '../documents/layer-operations';
import { MAX_LAYERS, type Layer } from '../documents/layer-types';
import type { ForgeDocument } from '../documents/types';
import { brand } from '../types/brand';
import { boundsOfPath, createContour, createNode, createPath } from '../vector';
import { traceImage } from '../vector/trace';
import { placeTrace, traceLayersCommand } from './trace-commands';

let counter = 0;
const nextId = (): string => {
  counter += 1;
  return `traced-${String(counter)}`;
};

function documentWith(layers: readonly Layer[] = []): ForgeDocument {
  const created = createDocument(
    {
      title: 'Trace',
      studioId: 'illustration',
      documentTypeId: brand<'DocumentTypeId'>('illustration.artboard'),
      canvas: {
        width: 400,
        height: 300,
        unit: 'px',
        dpi: 96,
        background: '#ffffff',
        transparent: false,
      },
    },
    { generateId: () => 'doc-trace' },
  );
  if (!created.ok) throw new Error(created.error.message);
  return { ...created.value, scene: { layers } };
}

function square(x: number, y: number, size: number) {
  return createPath([
    createContour(
      [
        createNode({ x, y }),
        createNode({ x: x + size, y }),
        createNode({ x: x + size, y: y + size }),
        createNode({ x, y: y + size }),
      ],
      true,
    ),
  ]);
}

function reportOf(
  regions: readonly { colour: string; path: ReturnType<typeof square>; area: number }[],
) {
  return {
    width: 100,
    height: 100,
    sampleWidth: 100,
    sampleHeight: 100,
    palette: regions.map((region) => region.colour),
    regions: regions.map((region) => ({
      colour: region.colour,
      path: region.path,
      area: region.area,
      contours: 1,
      nodes: 4,
    })),
    nodes: regions.length * 4,
    droppedRegions: 0,
    tolerance: 1,
  };
}

describe('placeTrace', () => {
  it('scales uniformly and centres inside the canvas', () => {
    const report = reportOf([
      { colour: '#111111', path: square(0, 0, 100), area: 10_000 },
      { colour: '#eeeeee', path: square(100, 0, 50), area: 2_500 },
    ]);
    const placement = placeTrace(report, { width: 400, height: 300 });
    // The trace spans x 0–150, y 0–100; the limiting axis is x, so scale = 400/150.
    expect(placement.scale).toBeCloseTo(400 / 150, 6);
    expect(placement.box).not.toBeNull();
    if (!placement.box) return;
    expect(placement.box.x).toBeCloseTo(0, 6);
    expect(placement.box.width).toBeCloseTo(400, 6);
    // Vertically centred: (300 − 266.67) / 2.
    expect(placement.box.y).toBeCloseTo((300 - (100 * 400) / 150) / 2, 6);
    expect(placement.layers).toHaveLength(2);
    expect(placement.layers[0]?.fill).toBe('#111111');
  });

  it('honours a margin and keeps the artwork inside it', () => {
    const report = reportOf([{ colour: '#123456', path: square(0, 0, 100), area: 10_000 }]);
    const placement = placeTrace(report, { width: 200, height: 200 }, { margin: 20 });
    expect(placement.box?.x).toBeCloseTo(20, 6);
    expect(placement.box?.width).toBeCloseTo(160, 6);
  });

  it('returns an empty placement for a trace with no geometry', () => {
    const placement = placeTrace(reportOf([]), { width: 100, height: 100 });
    expect(placement.layers).toHaveLength(0);
    expect(placement.box).toBeNull();
  });
});

describe('traceLayersCommand', () => {
  it('adds one labelled, undoable step that paints small regions on top', () => {
    const background = square(0, 0, 100);
    const detail = square(10, 10, 10);
    // A real trace arrives largest-first; the command preserves that order so details sit on top.
    const report = reportOf([
      { colour: '#ffffff', path: background, area: 10_000 },
      { colour: '#ff0000', path: detail, area: 100 },
    ]);
    const command = traceLayersCommand(documentWith(), report, { generateId: nextId });
    expect(command.ok).toBe(true);
    if (!command.ok) return;

    expect(command.value.label).toBe('Trace image (2 layers)');
    const layers = command.value.patch.scene?.layers ?? [];
    expect(layers).toHaveLength(2);
    expect(layers.map((layer) => layer.name)).toEqual(['Traced 1 (#ffffff)', 'Traced 2 (#ff0000)']);
    for (const layer of layers) {
      expect(layer.type).toBe('path');
      expect(layer.visible).toBe(true);
      if (layer.type !== 'path') continue;
      // Even-odd is what turns a region's inner contours into holes.
      expect(layer.vector.style.fillRule).toBe('evenodd');
      expect(layer.vector.style.stroke).toBeNull();
      const bounds = boundsOfPath(layer.vector.path);
      expect(bounds).not.toBeNull();
      if (!bounds) continue;
      expect(layer.frame.x).toBeCloseTo(bounds.minX, 6);
      expect(layer.frame.width).toBeCloseTo(bounds.maxX - bounds.minX, 6);
    }
  });

  it('places real traced pixels inside the canvas', () => {
    const width = 64;
    const height = 64;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 4;
        const red = x < 32;
        pixels[at] = red ? 255 : 0;
        pixels[at + 1] = 0;
        pixels[at + 2] = red ? 0 : 255;
        pixels[at + 3] = 255;
      }
    }
    const traced = traceImage(pixels, width, height, { colours: 2 });
    expect(traced.ok).toBe(true);
    if (!traced.ok) return;

    const document = documentWith();
    const command = traceLayersCommand(document, traced.value, { generateId: nextId });
    expect(command.ok).toBe(true);
    if (!command.ok) return;
    const layers = command.value.patch.scene?.layers ?? [];
    expect(layers.length).toBeGreaterThanOrEqual(2);
    for (const layer of layers) {
      if (layer.type !== 'path') throw new Error('a trace produces path layers');
      const bounds = boundsOfPath(layer.vector.path);
      expect(bounds).not.toBeNull();
      if (!bounds) continue;
      expect(bounds.minX).toBeGreaterThanOrEqual(-0.01);
      expect(bounds.maxX).toBeLessThanOrEqual(document.canvas.width + 0.01);
      expect(bounds.minY).toBeGreaterThanOrEqual(-0.01);
      expect(bounds.maxY).toBeLessThanOrEqual(document.canvas.height + 0.01);
    }
  });

  it('refuses a trace that would overflow the layer limit, and says how much room is left', () => {
    const existing: Layer[] = [];
    for (let index = 0; index < MAX_LAYERS - 1; index += 1) {
      const layer = createLayer(
        { type: 'rect', frame: { x: 0, y: 0, width: 10, height: 10 } },
        { generateId: nextId },
      );
      if (!layer.ok) throw new Error(layer.error.message);
      existing.push(layer.value);
    }
    const report = reportOf([
      { colour: '#ffffff', path: square(0, 0, 10), area: 100 },
      { colour: '#000000', path: square(20, 20, 10), area: 100 },
    ]);
    const refused = traceLayersCommand(documentWith(existing), report, { generateId: nextId });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.message).toMatch(/room for 1/i);
  });

  it('refuses an empty trace rather than adding an empty step', () => {
    const refused = traceLayersCommand(documentWith(), reportOf([]), { generateId: nextId });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.message).toMatch(/no regions/i);
  });
});
