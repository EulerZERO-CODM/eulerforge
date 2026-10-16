/**
 * The scene ↔ artwork bridge.
 *
 * These tests are about the promises the bridge makes to the app: exact geometry for the layer types
 * it claims to support, a named report for the ones it does not, and a round trip through a real SVG
 * string that preserves the artwork within the documented tolerance.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_CANVAS, createDocument } from '../documents/factories';
import { createLayer, emptyScene } from '../documents/layer-operations';
import type { Layer, Scene } from '../documents/layer-types';
import { asLayerId } from '../documents/layer-types';
import { brand } from '../types/brand';
import type { ForgeDocument } from '../documents/types';
import { areaOfPath, boundsOfPath } from '../vector';
import { ellipsePath, rectanglePath } from '../vector/shapes';
import { parsePathData } from '../vector/path-data';
import { artworkFromDocument, layersFromArtwork, svgUnsupportedReasons } from './from-scene';
import { parseSvg } from './parse';
import { serializeSvg } from './serialize';

function documentWith(layers: readonly Layer[]): ForgeDocument {
  const created = createDocument(
    {
      title: 'Icon sheet',
      studioId: 'illustration',
      documentTypeId: brand<'DocumentTypeId'>('illustration.artboard'),
      canvas: { ...DEFAULT_CANVAS, width: 64, height: 64, transparent: true },
    },
    { generateId: () => 'doc-bridge' },
  );
  if (!created.ok) throw new Error('fixture document should be valid');
  return { ...created.value, scene: { layers: [...layers] } as Scene };
}

let counter = 0;
const nextId = (): string => {
  counter += 1;
  return `lyr-${String(counter)}`;
};

function aPathLayer(name: string): Layer {
  const parsed = parsePathData('M4 4 L28 4 L28 28 L4 28 Z');
  if (!parsed.ok) throw new Error(parsed.error.message);
  const created = createLayer(
    {
      type: 'path',
      frame: { x: 4, y: 4, width: 24, height: 24 },
      vector: { path: parsed.value.path, style: { fill: '#22cc88' } },
    },
    { name, generateId: nextId },
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

describe('scene to artwork', () => {
  it('writes path layers with their own geometry and paint', () => {
    const result = artworkFromDocument(documentWith([aPathLayer('Square')]));
    expect(result.empty).toBe(false);
    expect(result.unsupported).toEqual([]);
    expect(result.artwork.shapes).toHaveLength(1);
    expect(result.artwork.shapes[0]?.name).toBe('Square');
    expect(result.artwork.shapes[0]?.style.fill).toBe('#22cc88');
    expect(result.artwork.width).toBe(64);
    expect(result.artwork.viewBox).toEqual({ minX: 0, minY: 0, maxX: 64, maxY: 64 });
    expect(result.artwork.background).toBeNull();
  });

  it('turns a rectangle layer into the same rectangle as a path, exactly', () => {
    const rect = createLayer(
      {
        type: 'rect',
        frame: { x: 10, y: 12, width: 30, height: 20 },
        shape: { fill: '#ff0000', stroke: '#000000', strokeWidth: 2, cornerRadius: 0 },
      },
      { name: 'Box', generateId: nextId },
    );
    if (!rect.ok) throw new Error(rect.error.message);
    const result = artworkFromDocument(documentWith([rect.value]));
    const expected = rectanglePath({ minX: 10, minY: 12, maxX: 40, maxY: 32 });
    expect(boundsOfPath(result.artwork.shapes[0]!.path)).toEqual(boundsOfPath(expected));
    expect(areaOfPath(result.artwork.shapes[0]!.path)).toBeCloseTo(600, 9);
    expect(result.artwork.shapes[0]?.style.strokeWidth).toBe(2);
  });

  it('turns an ellipse layer into a curve with the same area to within a ten-thousandth', () => {
    const ellipse = createLayer(
      {
        type: 'ellipse',
        frame: { x: 0, y: 0, width: 80, height: 40 },
        shape: { fill: '#0000ff', stroke: null, strokeWidth: 0, cornerRadius: 0 },
      },
      { name: 'Oval', generateId: nextId },
    );
    if (!ellipse.ok) throw new Error(ellipse.error.message);
    const result = artworkFromDocument(documentWith([ellipse.value]));
    const expected = ellipsePath({ minX: 0, minY: 0, maxX: 80, maxY: 40 });
    expect(areaOfPath(result.artwork.shapes[0]!.path)).toBeCloseTo(areaOfPath(expected), 6);
    expect(
      Math.abs(areaOfPath(result.artwork.shapes[0]!.path) - Math.PI * 40 * 20) /
        (Math.PI * 40 * 20),
    ).toBeLessThan(0.0005);
  });

  it('reports text and graphics by name instead of writing a file without them', () => {
    const text = createLayer(
      { type: 'text', frame: { x: 0, y: 0, width: 40, height: 20 }, text: { content: 'Hi' } },
      { name: 'Caption', generateId: nextId },
    );
    const image = createLayer(
      {
        type: 'image',
        frame: { x: 0, y: 0, width: 20, height: 20 },
        image: { href: '/forge-assets/aurora-mesh.svg' },
      },
      { name: 'Photo', generateId: nextId },
    );
    if (!text.ok || !image.ok) throw new Error('fixtures should be valid');
    const result = artworkFromDocument(documentWith([text.value, image.value, aPathLayer('Kept')]));
    expect(result.artwork.shapes).toHaveLength(1);
    expect(result.unsupported.map((entry) => entry.layerName)).toEqual(['Caption', 'Photo']);
    expect(result.unsupported[0]?.reason).toContain('outlines');
    expect(result.unsupported[1]?.reason).toContain('bitmap');
  });

  it('skips hidden layers without calling them unsupported', () => {
    const hidden: Layer = { ...aPathLayer('Hidden'), visible: false };
    const result = artworkFromDocument(documentWith([hidden, aPathLayer('Shown')]));
    expect(result.artwork.shapes.map((shape) => shape.name)).toEqual(['Shown']);
    expect(result.unsupported).toEqual([]);
  });

  it('writes an opaque document background, and leaves a transparent one alone', () => {
    const opaque = documentWith([aPathLayer('Square')]);
    const withBackground = artworkFromDocument({
      ...opaque,
      canvas: { ...opaque.canvas, transparent: false, background: '#112233' },
    });
    expect(withBackground.artwork.background).toBe('#112233');
    const transparent = artworkFromDocument(opaque);
    expect(transparent.artwork.background).toBeNull();
    expect(artworkFromDocument(opaque, { includeBackground: false }).artwork.background).toBeNull();
  });

  it('lists which scene layers an SVG export would have to leave out', () => {
    const text = createLayer(
      { type: 'text', frame: { x: 0, y: 0, width: 10, height: 10 }, text: { content: 'x' } },
      { name: 'Label', generateId: nextId },
    );
    if (!text.ok) throw new Error(text.error.message);
    expect(svgUnsupportedReasons({ layers: [text.value] }).map((entry) => entry.layerName)).toEqual(
      ['Label'],
    );
    expect(svgUnsupportedReasons(emptyScene())).toEqual([]);
  });
});

describe('SVG round trip through the document model', () => {
  it('exports a document and imports the same geometry back', () => {
    const original = documentWith([aPathLayer('Square')]);
    const exported = artworkFromDocument(original);
    const written = serializeSvg(exported.artwork, { includeNames: true });
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    const read = parseSvg(written.value);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const imported = layersFromArtwork(read.value.artwork, { generateId: nextId });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    const layer = imported.value.layers[0];
    expect(layer?.name).toBe('Square');
    const before = boundsOfPath(exported.artwork.shapes[0]!.path);
    const after = boundsOfPath(layer!.vector.path);
    // Documented round-trip tolerance: a thousandth of a unit, the serialiser's default precision.
    expect(after!.minX).toBeCloseTo(before!.minX, 3);
    expect(after!.maxY).toBeCloseTo(before!.maxY, 3);
    expect(layer!.frame.width).toBeCloseTo(24, 3);
    expect(layer!.vector.style.fill).toBe('#22cc88');
  });

  it('places imported artwork at an offset or scaled into a box', () => {
    const parsed = parsePathData('M0 0 L10 0 L10 10 L0 10 Z');
    if (!parsed.ok) throw new Error(parsed.error.message);
    const artwork = {
      width: 10,
      height: 10,
      viewBox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      background: null,
      shapes: [
        {
          name: 'Square',
          path: parsed.value.path,
          style: {
            fill: '#000000',
            fillRule: 'nonzero' as const,
            fillOpacity: 1,
            stroke: null,
            strokeWidth: 1,
            strokeOpacity: 1,
            lineCap: 'butt' as const,
            lineJoin: 'miter' as const,
            dashArray: [],
          },
          opacity: 1,
        },
      ],
    };

    const moved = layersFromArtwork(artwork, { offset: { x: 100, y: 50 }, generateId: nextId });
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(moved.value.layers[0]?.frame).toMatchObject({ x: 100, y: 50, width: 10, height: 10 });
      expect(moved.value.summary.layerCount).toBe(1);
    }

    const scaled = layersFromArtwork(artwork, {
      fitTo: { minX: 0, minY: 0, maxX: 64, maxY: 64 },
      generateId: nextId,
    });
    expect(scaled.ok).toBe(true);
    if (scaled.ok) {
      expect(scaled.value.layers[0]?.frame).toMatchObject({ x: 0, y: 0, width: 64, height: 64 });
      expect(scaled.value.summary.scaledTo).toEqual({ minX: 0, minY: 0, maxX: 64, maxY: 64 });
    }
  });

  it('refuses artwork with no shapes rather than creating an empty layer', () => {
    const result = layersFromArtwork({
      width: 10,
      height: 10,
      viewBox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      background: '#ffffff',
      shapes: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('no shapes');
  });

  it('keeps every contour of a compound path, holes included', () => {
    const parsed = parsePathData('M0 0 L60 0 L60 60 L0 60 Z M20 20 L20 40 L40 40 L40 20 Z');
    if (!parsed.ok) throw new Error(parsed.error.message);
    const exported = artworkFromDocument(
      documentWith([
        {
          ...aPathLayer('Ring'),
          vector: {
            path: parsed.value.path,
            style:
              aPathLayer('Ring').type === 'path'
                ? (aPathLayer('Ring') as Extract<Layer, { type: 'path' }>).vector.style
                : undefined!,
          },
        } as Layer,
      ]),
    );
    expect(exported.artwork.shapes[0]?.path.contours).toHaveLength(2);
    const written = serializeSvg(exported.artwork);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const read = parseSvg(written.value);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.artwork.shapes[0]?.path.contours).toHaveLength(2);
    expect(read.value.artwork.shapes[0]?.path.contours[1]?.nodes).toHaveLength(4);
    expect(asLayerId('lyr-1')).toBe('lyr-1');
  });
});
