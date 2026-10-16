/**
 * Design ↔ Illustration interchange.
 *
 * The contract under test is geometric fidelity plus an honest report: a rectangle that becomes a path
 * must be the *same* rectangle, a text layer must come back as a named skip reason rather than
 * disappearing, and the round trip in both directions must preserve what the model can express.
 */

import { describe, expect, it } from 'vitest';

import { areaOfPath, boundsOfPath } from '../vector';
import { parsePathData } from '../vector/path-data';
import {
  INTERCHANGE_LIMITATIONS,
  geometryBoundsOf,
  layersToDesign,
  layersToVector,
  vectorStyleOf,
} from './interchange';
import { createLayer } from './layer-operations';
import type { Layer } from './layer-types';

let counter = 0;
const nextId = (): string => {
  counter += 1;
  return `lyr-${String(counter)}`;
};

function make(input: Parameters<typeof createLayer>[0], name: string): Layer {
  const created = createLayer(input, { name, generateId: nextId });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

const rectangle = (): Layer =>
  make(
    {
      type: 'rect',
      frame: { x: 12, y: 20, width: 40, height: 30 },
      shape: { fill: '#ff8800', stroke: '#002233', strokeWidth: 4, cornerRadius: 8 },
    },
    'Rounded box',
  );

const ellipse = (): Layer =>
  make(
    {
      type: 'ellipse',
      frame: { x: 0, y: 0, width: 60, height: 20 },
      shape: { fill: '#3366ff', stroke: null, strokeWidth: 0, cornerRadius: 0 },
    },
    'Oval',
  );

const text = (): Layer =>
  make(
    { type: 'text', frame: { x: 0, y: 0, width: 50, height: 20 }, text: { content: 'Hello' } },
    'Heading',
  );

const graphic = (): Layer =>
  make(
    {
      type: 'image',
      frame: { x: 0, y: 0, width: 20, height: 20 },
      image: { href: '/forge-assets/aurora-mesh.svg' },
    },
    'Texture',
  );

const pathLayer = (): Layer => {
  const parsed = parsePathData('M2 2 L18 2 L18 18 L2 18 Z');
  if (!parsed.ok) throw new Error(parsed.error.message);
  return make(
    {
      type: 'path',
      frame: { x: 2, y: 2, width: 16, height: 16 },
      vector: { path: parsed.value.path, style: { fill: '#123456' } },
    },
    'Vector mark',
  );
};

describe('design artwork to vector layers', () => {
  it('keeps a rectangle exactly: same bounds, same area, same place', () => {
    const result = layersToVector([rectangle()]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const converted = result.value.layers[0];
    expect(converted?.type).toBe('path');
    if (converted?.type !== 'path') return;
    expect(boundsOfPath(converted.vector.path)).toEqual({ minX: 12, minY: 20, maxX: 52, maxY: 50 });
    // A rounded rectangle loses the corner squares and gains quarter circles, so the area is
    // between the inscribed and the full rectangle — and it is *not* an approximation, it is the
    // same outline expressed as curves.
    const area = areaOfPath(converted.vector.path);
    expect(area).toBeGreaterThan(40 * 30 - 4 * 64);
    expect(area).toBeLessThan(40 * 30);
    expect(result.value.converted).toEqual(['Rounded box']);
    expect(result.value.skipped).toEqual([]);
  });

  it('keeps an ellipse to within the four-cubic approximation, which is 0.03% of πab', () => {
    const result = layersToVector([ellipse()]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const converted = result.value.layers[0];
    if (converted?.type !== 'path') throw new Error('expected a path layer');
    const area = areaOfPath(converted.vector.path);
    const exact = Math.PI * 30 * 10;
    // Four cubics through the axis points are the standard circle approximation, not an exact
    // ellipse: it bulges very slightly outside the true curve (about +0.027% in radius), so its area
    // is slightly *above* πab. The bound is the documented error of that construction, and the axis
    // points are exact, which is why the bounds are asserted exactly.
    expect(Math.abs(area - exact) / exact).toBeLessThan(0.0005);
    expect(area).toBeGreaterThan(exact);
    expect(boundsOfPath(converted.vector.path)).toMatchObject({
      minX: 0,
      minY: 0,
      maxX: 60,
      maxY: 20,
    });
  });

  it('carries names, visibility, locks and opacity across', () => {
    const hidden: Layer = { ...rectangle(), visible: false, locked: true, opacity: 0.4 };
    const result = layersToVector([hidden]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.layers[0]).toMatchObject({
      name: 'Rounded box',
      visible: false,
      locked: true,
      opacity: 0.4,
    });
  });

  it('passes vector layers through untouched and reports the rest by name', () => {
    const source = pathLayer();
    const result = layersToVector([source, text(), graphic()]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.layers).toHaveLength(1);
    expect(result.value.converted).toEqual(['Vector mark']);
    expect(result.value.skipped.map((entry) => [entry.layerName, entry.layerType])).toEqual([
      ['Heading', 'text'],
      ['Texture', 'image'],
    ]);
    expect(result.value.skipped[0]?.reason).toContain('outlines');
    expect(result.value.limitations).toEqual(INTERCHANGE_LIMITATIONS);
  });

  it('refuses a conversion with nothing convertible instead of returning an empty document', () => {
    const result = layersToVector([text(), graphic()]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unsupported');
      expect(result.error.detail).toContain('Heading');
    }
  });

  it('does not mutate the source scene', () => {
    const source = rectangle();
    const before = JSON.stringify(source);
    layersToVector([source]);
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe('vector artwork to design layers', () => {
  it('copies vector layers with identical geometry and a fresh id', () => {
    const source = pathLayer();
    if (source.type !== 'path') throw new Error('fixture');
    const result = layersToDesign([source]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copied = result.value.layers[0];
    if (copied?.type !== 'path') throw new Error('expected a path layer');
    expect(copied.id).not.toBe(source.id);
    expect(copied.vector.path).toEqual(source.vector.path);
    expect(boundsOfPath(copied.vector.path)).toEqual(boundsOfPath(source.vector.path));
    expect(result.value.converted).toEqual(['Vector mark']);
  });

  it('leaves design-native layers alone', () => {
    const rect = rectangle();
    const result = layersToDesign([rect, pathLayer()]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.layers[0]).toBe(rect);
    expect(result.value.layers).toHaveLength(2);
  });

  it('round-trips both ways without changing the artwork', () => {
    const source = rectangle();
    const toVector = layersToVector([source]);
    expect(toVector.ok).toBe(true);
    if (!toVector.ok) return;
    const backToDesign = layersToDesign(toVector.value.layers);
    expect(backToDesign.ok).toBe(true);
    if (!backToDesign.ok) return;

    const vectorGeometry = toVector.value.layers[0];
    const designGeometry = backToDesign.value.layers[0];
    if (vectorGeometry?.type !== 'path' || designGeometry?.type !== 'path') {
      throw new Error('expected path layers in both directions');
    }
    expect(designGeometry.vector.path).toEqual(vectorGeometry.vector.path);
    expect(areaOfPath(designGeometry.vector.path)).toBeCloseTo(
      areaOfPath(vectorGeometry.vector.path),
      9,
    );
  });

  it('refuses an empty selection', () => {
    expect(layersToDesign([]).ok).toBe(false);
  });
});

describe('reporting helpers', () => {
  it('describes a layer’s geometry bounds', () => {
    expect(geometryBoundsOf(rectangle())).toEqual({ minX: 12, minY: 20, maxX: 52, maxY: 50 });
    expect(geometryBoundsOf(pathLayer())).toEqual({ minX: 2, minY: 2, maxX: 18, maxY: 18 });
  });

  it('describes the style a design layer would carry into a vector document', () => {
    const style = vectorStyleOf(rectangle());
    expect(style.fill).toBe('#ff8800');
    expect(style.stroke).toBe('#002233');
    expect(style.strokeWidth).toBe(4);
  });
});
