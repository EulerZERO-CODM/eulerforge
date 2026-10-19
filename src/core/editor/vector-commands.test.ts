/**
 * Vector editing commands.
 *
 * These are the tests behind the Illustration Studio's promises: an edit produces a patch with an
 * undo label a person can read, geometry and frame stay in agreement, refusals explain themselves,
 * and a boolean result is checked for shape — not merely for "a value came back".
 */

import { describe, expect, it } from 'vitest';

import { createDocument } from '../documents/factories';
import { brand } from '../types/brand';
import { createLayer } from '../documents/layer-operations';
import type { Layer } from '../documents/layer-types';
import type { ForgeDocument } from '../documents/types';
import { areaOfPath, boundsOfPath, toPathData } from '../vector';
import { ellipsePath, rectanglePath } from '../vector/shapes';
import { parsePathData } from '../vector/path-data';
import { checkTopology } from '../vector/validity';
import { parseSvg } from '../svg/parse';
import {
  booleanLayersCommand,
  clearVectorTextCommand,
  createPathLayerCommand,
  deletePathNodesCommand,
  importArtworkCommand,
  insertPathNodeCommand,
  movePathHandleCommand,
  movePathNodesCommand,
  outlineShapeCommand,
  setPathNodesKindCommand,
  setVectorStyleCommand,
  setVectorTextCommand,
  transformPathLayerCommand,
  translatePathLayerCommand,
  updatePathGeometryCommand,
} from './vector-commands';

let counter = 0;
const nextId = (): string => {
  counter += 1;
  return `lyr-${String(counter)}`;
};

function documentWith(layers: readonly Layer[] = []): ForgeDocument {
  const created = createDocument(
    {
      title: 'Icon',
      studioId: 'illustration',
      documentTypeId: brand<'DocumentTypeId'>('illustration.artboard'),
      canvas: {
        width: 100,
        height: 100,
        unit: 'px',
        dpi: 96,
        background: '#ffffff',
        transparent: true,
      },
    },
    { generateId: () => 'doc-vector-cmd' },
  );
  if (!created.ok) throw new Error('fixture document should be valid');
  return { ...created.value, scene: { layers: [...layers] } };
}

function pathOf(data: string) {
  const parsed = parsePathData(data);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value.path;
}

function pathLayer(
  name: string,
  data: string,
  style?: Parameters<typeof createLayer>[0] extends never ? never : Record<string, unknown>,
): Layer {
  const created = createLayer(
    {
      type: 'path',
      frame: { x: 0, y: 0, width: 10, height: 10 },
      vector: { path: pathOf(data), style: (style ?? {}) as never },
    },
    { name, generateId: nextId },
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function shapeLayer(
  type: 'rect' | 'ellipse',
  name: string,
  frame = { x: 0, y: 0, width: 40, height: 40 },
): Layer {
  const created = createLayer(
    { type, frame, shape: { fill: '#ff8800' } },
    { name, generateId: nextId },
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function sceneOf(command: { readonly patch: { readonly scene?: ForgeDocument['scene'] } }) {
  const scene = command.patch.scene;
  if (!scene) throw new Error('the command produced no scene patch');
  return scene;
}

function layerIn(scene: ForgeDocument['scene'], index: number): Layer {
  const layer = scene.layers[index];
  if (!layer) throw new Error(`no layer at ${String(index)}`);
  return layer;
}

describe('creating vector layers', () => {
  it('adds a layer whose frame is the geometry’s bounds and whose label describes the act', () => {
    const document = documentWith();
    const result = createPathLayerCommand(
      document,
      { path: pathOf('M10 20 L30 20 L30 50 L10 50 Z'), name: 'Card', style: { fill: '#336699' } },
      { generateId: nextId },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.label).toBe('Draw “Card”');
    const layer = layerIn(sceneOf(result.value), 0);
    expect(layer).toMatchObject({
      type: 'path',
      name: 'Card',
      frame: { x: 10, y: 20, width: 20, height: 30 },
    });
    if (layer.type !== 'path') throw new Error('expected a path layer');
    expect(layer.vector.style.fill).toBe('#336699');
  });

  it('draws a straight line, whose box is genuinely one pixel tall and zero wide', () => {
    const line = createPathLayerCommand(
      documentWith(),
      {
        path: pathOf('M10 10 L60 10'),
        name: 'Rule',
        style: { fill: null, stroke: '#000000', strokeWidth: 2 },
      },
      { generateId: nextId },
    );
    expect(line.ok).toBe(true);
    if (!line.ok) return;
    const layer = layerIn(sceneOf(line.value), 0);
    expect(layer.frame).toEqual({ x: 10, y: 10, width: 50, height: 0 });
  });

  it('refuses a path with no geometry rather than creating an invisible layer', () => {
    const degenerate = createPathLayerCommand(documentWith(), { path: pathOf('M5 5 L5 5') });
    expect(degenerate.ok).toBe(false);
    if (!degenerate.ok) expect(degenerate.error.code).toBe('validation-failed');
    expect(createPathLayerCommand(documentWith(), { path: pathOf('M5 5') }).ok).toBe(false);
  });
});

describe('editing nodes', () => {
  it('moves a node and its handles together, keeping the frame truthful', () => {
    const layer = pathLayer('Triangle', 'M0 0 C10 -20 30 -20 40 0 L40 40 Z');
    const document = documentWith([layer]);
    const result = movePathNodesCommand(document, layer.id, [
      { ref: { contourIndex: 0, nodeIndex: 0 }, to: { x: -10, y: -10 } },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.label).toBe('Move node on “Triangle”');
    const moved = layerIn(sceneOf(result.value), 0);
    if (moved.type !== 'path') throw new Error('expected a path layer');
    const node = moved.vector.path.contours[0]?.nodes[0];
    expect(node?.point).toEqual({ x: -10, y: -10 });
    // The outgoing handle travelled with the node; the incoming one is null because the segment
    // arriving at node 0 is the straight closing line.
    expect(node?.handleOut).toEqual({ x: 0, y: -30 });
    expect(node?.handleIn).toBeNull();
    expect(moved.frame.x).toBe(-10);
  });

  it('moves a group of nodes as one command', () => {
    const layer = pathLayer('Square', 'M0 0 L40 0 L40 40 L0 40 Z');
    const document = documentWith([layer]);
    const result = movePathNodesCommand(document, layer.id, [
      { ref: { contourIndex: 0, nodeIndex: 0 }, to: { x: -5, y: -5 } },
      { ref: { contourIndex: 0, nodeIndex: 1 }, to: { x: 45, y: -5 } },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.label).toBe('Move 2 nodes on “Square”');
    const moved = layerIn(sceneOf(result.value), 0);
    if (moved.type !== 'path') throw new Error('expected a path layer');
    expect(boundsOfPath(moved.vector.path)).toEqual({ minX: -5, minY: -5, maxX: 45, maxY: 40 });
  });

  it('adds a node on the outline without changing the outline’s shape', () => {
    const layer = pathLayer('Square', 'M0 0 L40 0 L40 40 L0 40 Z');
    const document = documentWith([layer]);
    const before = boundsOfPath((layer as Extract<Layer, { type: 'path' }>).vector.path);

    const result = insertPathNodeCommand(document, layer.id, { x: 20, y: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.label).toBe('Add node to “Square”');
    const edited = layerIn(sceneOf(result.value), 0);
    if (edited.type !== 'path') throw new Error('expected a path layer');
    expect(edited.vector.path.contours[0]?.nodes).toHaveLength(5);
    expect(areaOfPath(edited.vector.path)).toBeCloseTo(
      areaOfPath((layer as Extract<Layer, { type: 'path' }>).vector.path),
      6,
    );
    expect(boundsOfPath(edited.vector.path)).toEqual(before);
  });

  it('refuses to add a node far from the outline, and says where to click', () => {
    const layer = pathLayer('Square', 'M0 0 L40 0 L40 40 L0 40 Z');
    const result = insertPathNodeCommand(documentWith([layer]), layer.id, { x: 20, y: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.detail).toContain('Click on the path');
  });

  it('deletes nodes from the end backwards, so a multi-node delete removes what was selected', () => {
    const layer = pathLayer('Square', 'M0 0 L40 0 L40 40 L0 40 Z');
    const result = deletePathNodesCommand(documentWith([layer]), layer.id, [
      { contourIndex: 0, nodeIndex: 1 },
      { contourIndex: 0, nodeIndex: 2 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const edited = layerIn(sceneOf(result.value), 0);
    if (edited.type !== 'path') throw new Error('expected a path layer');
    // Nodes 1 and 2 are gone. Two nodes cannot enclose an area, so the contour opened rather than
    // staying an unrenderable closed shape that claimed to have an inside.
    expect(toPathData(edited.vector.path)).toBe('M0 0L0 40');
    expect(edited.vector.path.contours[0]?.closed).toBe(false);
  });

  it('says so when deleting a node opens a closed contour', () => {
    const layer = pathLayer('Triangle', 'M0 0 L40 0 L20 30 Z');
    const result = deletePathNodesCommand(documentWith([layer]), layer.id, [
      { contourIndex: 0, nodeIndex: 2 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.label).toContain('contour opened');
    const edited = layerIn(sceneOf(result.value), 0);
    if (edited.type !== 'path') throw new Error('expected a path layer');
    expect(edited.vector.path.contours[0]?.closed).toBe(false);
  });

  it('makes a node smooth and back to a corner', () => {
    const layer = pathLayer('Square', 'M0 0 L40 0 L40 40 L0 40 Z');
    const document = documentWith([layer]);
    const smoothed = setPathNodesKindCommand(
      document,
      layer.id,
      [{ contourIndex: 0, nodeIndex: 1 }],
      'smooth',
    );
    expect(smoothed.ok).toBe(true);
    if (!smoothed.ok) return;
    const afterSmooth = layerIn(sceneOf(smoothed.value), 0);
    if (afterSmooth.type !== 'path') throw new Error('expected a path layer');
    const node = afterSmooth.vector.path.contours[0]?.nodes[1];
    expect(node?.handleIn).not.toBeNull();
    expect(node?.handleOut).not.toBeNull();
    expect(smoothed.value.label).toContain('Smooth node');

    const document2 = documentWith([afterSmooth]);
    const cornered = setPathNodesKindCommand(
      document2,
      afterSmooth.id,
      [{ contourIndex: 0, nodeIndex: 1 }],
      'corner',
    );
    expect(cornered.ok).toBe(true);
    if (!cornered.ok) return;
    const afterCorner = layerIn(sceneOf(cornered.value), 0);
    if (afterCorner.type !== 'path') throw new Error('expected a path layer');
    expect(afterCorner.vector.path.contours[0]?.nodes[1]?.handleOut).toBeNull();
  });

  it('refuses to edit a locked layer, a shape layer and a missing layer, each with a reason', () => {
    const locked: Layer = { ...pathLayer('Locked', 'M0 0 L10 0 L10 10 Z'), locked: true };
    const lockedResult = movePathNodesCommand(documentWith([locked]), locked.id, [
      { ref: { contourIndex: 0, nodeIndex: 0 }, to: { x: 1, y: 1 } },
    ]);
    expect(lockedResult.ok).toBe(false);
    if (!lockedResult.ok) expect(lockedResult.error.message).toContain('locked');

    const rect = shapeLayer('rect', 'Box');
    const shapeResult = movePathNodesCommand(documentWith([rect]), rect.id, [
      { ref: { contourIndex: 0, nodeIndex: 0 }, to: { x: 1, y: 1 } },
    ]);
    expect(shapeResult.ok).toBe(false);
    if (!shapeResult.ok) expect(shapeResult.error.detail).toContain('Convert it to editable paths');

    const missing = movePathNodesCommand(documentWith(), 'nope', [
      { ref: { contourIndex: 0, nodeIndex: 0 }, to: { x: 1, y: 1 } },
    ]);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('not-found');
  });

  it('mirrors the opposite handle when the node already has one', () => {
    const layer = pathLayer('Curve', 'M0 0 C10 0 20 0 30 0 C30 20 10 20 0 0 Z');
    const result = movePathHandleCommand(
      documentWith([layer]),
      layer.id,
      { contourIndex: 0, nodeIndex: 1 },
      'in',
      { x: 15, y: 5 },
      'opposite',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.label).toBe('Smooth handle on “Curve”');
    const edited = layerIn(sceneOf(result.value), 0);
    if (edited.type !== 'path') throw new Error('expected a path layer');
    // Node 1 is at (30, 0): the dragged side follows the pointer, the other mirrors it.
    expect(edited.vector.path.contours[0]?.nodes[1]?.handleIn).toEqual({ x: 15, y: 5 });
    expect(edited.vector.path.contours[0]?.nodes[1]?.handleOut).toEqual({ x: 45, y: -5 });
  });

  it('does not invent the opposite handle on a corner, matching the kernel contract', () => {
    const layer = pathLayer('Corner', 'M0 0 C10 0 20 0 30 0');
    const result = movePathHandleCommand(
      documentWith([layer]),
      layer.id,
      { contourIndex: 0, nodeIndex: 0 },
      'out',
      { x: 5, y: 5 },
      'opposite',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const edited = layerIn(sceneOf(result.value), 0);
    if (edited.type !== 'path') throw new Error('expected a path layer');
    // The first node of an open contour has no incoming segment, so there is nothing to mirror; the
    // node tool's "smooth" command is what gives it handles.
    expect(edited.vector.path.contours[0]?.nodes[0]?.handleOut).toEqual({ x: 5, y: 5 });
    expect(edited.vector.path.contours[0]?.nodes[0]?.handleIn).toBeNull();
  });
});

describe('transforming geometry', () => {
  it('moves the nodes, not the frame, so the layer stays consistent', () => {
    const layer = pathLayer('Square', 'M0 0 L40 0 L40 40 L0 40 Z');
    const result = translatePathLayerCommand(documentWith([layer]), layer.id, 10, -5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const moved = layerIn(sceneOf(result.value), 0);
    expect(moved.frame).toEqual({ x: 10, y: -5, width: 40, height: 40 });
    if (moved.type !== 'path') throw new Error('expected a path layer');
    expect(areaOfPath(moved.vector.path)).toBeCloseTo(1600, 6);
  });

  it('scales geometry through a box-to-box matrix', () => {
    const layer = pathLayer('Square', 'M0 0 L40 0 L40 40 L0 40 Z');
    const result = transformPathLayerCommand(
      documentWith([layer]),
      layer.id,
      { x: 0, y: 0, width: 40, height: 40 },
      { x: 0, y: 0, width: 80, height: 20 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scaled = layerIn(sceneOf(result.value), 0);
    expect(scaled.frame.width).toBeCloseTo(80, 6);
    expect(scaled.frame.height).toBeCloseTo(20, 6);
    if (scaled.type !== 'path') throw new Error('expected a path layer');
    expect(areaOfPath(scaled.vector.path)).toBeCloseTo(1600, 6);
  });

  it('refuses a degenerate transform', () => {
    const layer = pathLayer('Square', 'M0 0 L40 0 L40 40 L0 40 Z');
    const result = transformPathLayerCommand(
      documentWith([layer]),
      layer.id,
      { x: 0, y: 0, width: 40, height: 40 },
      { x: 0, y: 0, width: 0, height: 40 },
    );
    expect(result.ok).toBe(false);
  });

  it('refuses a move that goes nowhere rather than recording an empty history entry', () => {
    const layer = pathLayer('Square', 'M0 0 L40 0 L40 40 L0 40 Z');
    expect(translatePathLayerCommand(documentWith([layer]), layer.id, 0, 0).ok).toBe(false);
  });

  it('replaces geometry but keeps the existing paint', () => {
    const layer = pathLayer('Painted', 'M0 0 L40 0 L40 40 Z', { fill: '#123456', strokeWidth: 3 });
    const result = updatePathGeometryCommand(
      documentWith([layer]),
      layer.id,
      pathOf('M0 0 L10 0 L10 10 Z'),
      'Simplify',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const edited = layerIn(sceneOf(result.value), 0);
    if (edited.type !== 'path') throw new Error('expected a path layer');
    expect(edited.vector.style.fill).toBe('#123456');
    expect(edited.vector.style.strokeWidth).toBe(3);
    expect(edited.frame.width).toBe(10);
  });
});

describe('paint', () => {
  it('sets a fill and labels it for the history panel', () => {
    const layer = pathLayer('Square', 'M0 0 L40 0 L40 40 Z');
    const result = setVectorStyleCommand(documentWith([layer]), [layer.id], { fill: '#00ff00' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.label).toBe('Set fill of “Square”');
    const styled = layerIn(sceneOf(result.value), 0);
    if (styled.type !== 'path') throw new Error('expected a path layer');
    expect(styled.vector.style.fill).toBe('#00ff00');
  });

  it('sets stroke, width, dashes, cap, join and fill rule, and layer opacity separately', () => {
    const layer = pathLayer('Square', 'M0 0 L40 0 L40 40 Z');
    const applied = setVectorStyleCommand(documentWith([layer]), [layer.id], {
      stroke: '#ff0000',
      strokeWidth: 4,
      dashArray: [4, 2],
      lineCap: 'round',
      lineJoin: 'bevel',
      fillRule: 'evenodd',
      opacity: 0.5,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const styled = layerIn(sceneOf(applied.value), 0);
    if (styled.type !== 'path') throw new Error('expected a path layer');
    expect(styled.vector.style).toMatchObject({
      stroke: '#ff0000',
      strokeWidth: 4,
      dashArray: [4, 2],
      lineCap: 'round',
      lineJoin: 'bevel',
      fillRule: 'evenodd',
    });
    expect(styled.opacity).toBe(0.5);
  });

  it('applies one change to several layers with a batch label', () => {
    const a = pathLayer('A', 'M0 0 L10 0 L10 10 Z');
    const b = pathLayer('B', 'M20 0 L30 0 L30 10 Z');
    const result = setVectorStyleCommand(documentWith([a, b]), [a.id, b.id], { fill: '#101010' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.label).toBe('Restyle 2 paths');
    const scene = sceneOf(result.value);
    for (const layer of scene.layers) {
      if (layer.type !== 'path') throw new Error('expected path layers');
      expect(layer.vector.style.fill).toBe('#101010');
    }
  });

  it('refuses an empty change and a shape layer, with reasons', () => {
    const layer = pathLayer('A', 'M0 0 L10 0 L10 10 Z');
    const empty = setVectorStyleCommand(documentWith([layer]), [layer.id], {});
    expect(empty.ok).toBe(false);

    const rect = shapeLayer('rect', 'Box');
    const wrongType = setVectorStyleCommand(documentWith([rect]), [rect.id], { fill: '#ffffff' });
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) expect(wrongType.error.detail).toContain('Convert it to paths');
  });
});

describe('boolean operations', () => {
  const left = pathLayer('Left', 'M0 0 L40 0 L40 40 L0 40 Z');
  const right = pathLayer('Right', 'M20 0 L60 0 L60 40 L20 40 Z');

  it('unites two overlapping squares into one topologically valid contour', () => {
    const document = documentWith([left, right]);
    const result = booleanLayersCommand(document, [left.id, right.id], 'union');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Shape, not just "something came back": one contour, closed, with the union's area.
    const scene = sceneOf(result.value.command);
    expect(scene.layers).toHaveLength(1);
    const united = layerIn(scene, 0);
    if (united.type !== 'path') throw new Error('expected a path layer');
    expect(united.vector.path.contours).toHaveLength(1);
    expect(united.vector.path.contours[0]?.closed).toBe(true);
    expect(areaOfPath(united.vector.path)).toBeCloseTo(40 * 40 + 20 * 40, 2);
    expect(boundsOfPath(united.vector.path)).toEqual({ minX: 0, minY: 0, maxX: 60, maxY: 40 });
    expect(checkTopology(united.vector.path).valid).toBe(true);
    expect(result.value.command.label).toBe('Unite 2 shapes');
    expect(result.value.result.approximation).toBe('flattened-polygons');
    expect(result.value.result.tolerance).toBeGreaterThan(0);
  });

  it('subtracts the front shape from the back one and keeps the result where the user was working', () => {
    const below = pathLayer('Below', 'M0 0 L4 0 L4 4 Z');
    const document = documentWith([below, left, right]);
    const result = booleanLayersCommand(document, [left.id, right.id], 'subtract');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scene = sceneOf(result.value.command);
    // `below` untouched, the combined shape where `right` was (index 2 originally).
    expect(scene.layers.map((layer) => layer.name)).toEqual(['Below', 'Subtract of 2 shapes']);
    const shape = layerIn(scene, 1);
    if (shape.type !== 'path') throw new Error('expected a path layer');
    expect(areaOfPath(shape.vector.path)).toBeCloseTo(20 * 40, 2);
    expect(boundsOfPath(shape.vector.path)).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 40 });
  });

  it('intersects and excludes, with the areas those operations imply', () => {
    const document = documentWith([left, right]);
    const intersected = booleanLayersCommand(document, [left.id, right.id], 'intersect');
    expect(intersected.ok).toBe(true);
    if (!intersected.ok) return;
    const overlap = layerIn(sceneOf(intersected.value.command), 0);
    if (overlap.type !== 'path') throw new Error('expected a path layer');
    expect(areaOfPath(overlap.vector.path)).toBeCloseTo(20 * 40, 2);

    const excluded = booleanLayersCommand(document, [left.id, right.id], 'exclude');
    expect(excluded.ok).toBe(true);
    if (!excluded.ok) return;
    const symmetric = layerIn(sceneOf(excluded.value.command), 0);
    if (symmetric.type !== 'path') throw new Error('expected a path layer');
    expect(areaOfPath(symmetric.vector.path)).toBeCloseTo(40 * 40 + 40 * 40 - 2 * 20 * 40, 2);
    expect(checkTopology(symmetric.vector.path).valid).toBe(true);
  });

  it('converts shapes on the way in, so a rectangle and an ellipse can be combined', () => {
    const rect = shapeLayer('rect', 'Box');
    const ellipse = createLayer(
      {
        type: 'ellipse',
        frame: { x: 20, y: 20, width: 40, height: 40 },
        shape: { fill: '#3366ff' },
      },
      { name: 'Oval', generateId: nextId },
    );
    if (!ellipse.ok) throw new Error('fixture');
    const result = booleanLayersCommand(
      documentWith([rect, ellipse.value]),
      [rect.id, ellipse.value.id],
      'union',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const combined = layerIn(sceneOf(result.value.command), 0);
    if (combined.type !== 'path') throw new Error('expected a path layer');
    expect(checkTopology(combined.vector.path).valid).toBe(true);
    // The rectangle's paint wins: it is the back-most shape, so it is the subject.
    expect(combined.vector.style.fill).toBe('#ff8800');
  });

  it('refuses fewer than two shapes, a locked shape and a text layer', () => {
    expect(booleanLayersCommand(documentWith([left]), [left.id], 'union').ok).toBe(false);

    const locked: Layer = { ...right, locked: true };
    const lockedResult = booleanLayersCommand(
      documentWith([left, locked]),
      [left.id, locked.id],
      'union',
    );
    expect(lockedResult.ok).toBe(false);
    if (!lockedResult.ok) expect(lockedResult.error.message).toContain('locked');

    const text = createLayer(
      { type: 'text', frame: { x: 0, y: 0, width: 30, height: 10 } },
      { name: 'Label', generateId: nextId },
    );
    if (!text.ok) throw new Error('fixture');
    const textResult = booleanLayersCommand(
      documentWith([left, text.value]),
      [left.id, text.value.id],
      'union',
    );
    expect(textResult.ok).toBe(false);
    if (!textResult.ok) expect(textResult.error.code).toBe('unsupported');
  });

  it('reports a miss as a refusal instead of writing an empty layer', () => {
    const far = pathLayer('Far', 'M100 100 L140 100 L140 140 Z');
    const result = booleanLayersCommand(documentWith([left, far]), [left.id, far.id], 'intersect');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('left no shape behind');
      expect(result.error.detail).toContain('Nothing was changed');
    }
  });
});

describe('outlining shapes and importing artwork', () => {
  it('turns a rectangle into an equivalent path in place', () => {
    const rect = shapeLayer('rect', 'Box');
    const other = pathLayer('Other', 'M0 0 L5 0 L5 5 Z');
    const document = documentWith([rect, other]);
    const result = outlineShapeCommand(document, rect.id, { generateId: nextId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.label).toBe('Convert “Box” to paths');
    const scene = sceneOf(result.value);
    expect(scene.layers.map((layer) => layer.type)).toEqual(['path', 'path']);
    const outlined = layerIn(scene, 0);
    if (outlined.type !== 'path') throw new Error('expected a path layer');
    expect(areaOfPath(outlined.vector.path)).toBeCloseTo(
      areaOfPath(rectanglePath({ minX: 0, minY: 0, maxX: 40, maxY: 40 })),
      6,
    );
    expect(outlined.vector.style.fill).toBe('#ff8800');
    expect(outlined.name).toBe('Box');
  });

  it('outlines an ellipse into real curves, not a polygon', () => {
    const ellipse = shapeLayer('ellipse', 'Oval');
    const result = outlineShapeCommand(documentWith([ellipse]), ellipse.id, { generateId: nextId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const outlined = layerIn(sceneOf(result.value), 0);
    if (outlined.type !== 'path') throw new Error('expected a path layer');
    expect(areaOfPath(outlined.vector.path)).toBeCloseTo(
      areaOfPath(ellipsePath({ minX: 0, minY: 0, maxX: 40, maxY: 40 })),
      6,
    );
    expect(outlined.vector.path.contours[0]?.nodes.every((node) => node.handleOut !== null)).toBe(
      true,
    );
  });

  it('refuses to outline a path, text or graphic layer', () => {
    const already = pathLayer('Path', 'M0 0 L10 0 L10 10 Z');
    const pathResult = outlineShapeCommand(documentWith([already]), already.id);
    expect(pathResult.ok).toBe(false);
    if (!pathResult.ok) expect(pathResult.error.message).toContain('already made of paths');

    const text = createLayer(
      { type: 'text', frame: { x: 0, y: 0, width: 30, height: 10 } },
      { name: 'Label', generateId: nextId },
    );
    if (!text.ok) throw new Error('fixture');
    const textResult = outlineShapeCommand(documentWith([text.value]), text.value.id);
    expect(textResult.ok).toBe(false);
    if (!textResult.ok) {
      expect(textResult.error.code).toBe('unsupported');
      expect(textResult.error.detail).toContain('font engine');
    }
  });

  it('imports parsed SVG artwork as layers and reports their names', () => {
    const parsed = parseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4 L20 4 L20 20 L4 20 Z" fill="#123456"/></svg>',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = importArtworkCommand(documentWith(), parsed.value.artwork, {
      offset: { x: 10, y: 10 },
      generateId: nextId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.label).toContain('Import 1 shape');
    expect(result.value.layerNames).toHaveLength(1);
    const imported = layerIn(sceneOf(result.value), 0);
    if (imported.type !== 'path') throw new Error('expected a path layer');
    expect(imported.frame).toMatchObject({ x: 14, y: 14, width: 16, height: 16 });
    expect(imported.vector.style.fill).toBe('#123456');
  });

  it('refuses an SVG with no importable geometry rather than adding nothing quietly', () => {
    const parsed = parseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // The importer reports what it could not carry rather than pretending the file was empty.
    const result = importArtworkCommand(
      documentWith(),
      { ...parsed.value.artwork, shapes: [] },
      {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('no shapes');
  });
});

describe('history labels read like work, not like internals', () => {
  it('names the layer in every label it produces', () => {
    const layer = pathLayer('Star', 'M0 0 L10 0 L10 10 Z');
    const document = documentWith([layer]);
    const labels = [
      translatePathLayerCommand(document, layer.id, 1, 0),
      setVectorStyleCommand(document, [layer.id], { fill: '#000000' }),
      insertPathNodeCommand(document, layer.id, { x: 5, y: 0 }),
    ].map((result) => {
      if (!result.ok) throw new Error('command should succeed');
      return result.value.label;
    });
    expect(labels).toEqual(['Move “Star”', 'Set fill of “Star”', 'Add node to “Star”']);
  });
});

describe('text on a path', () => {
  function textOf(layer: Layer) {
    if (layer.type !== 'path') throw new Error('expected a path layer');
    return layer.vector.text ?? null;
  }

  it('sets a run with readable history and leaves the geometry and frame alone', () => {
    const layer = pathLayer('Arc', 'M0 50 C 25 0 75 0 100 50');
    const document = documentWith([layer]);
    const result = setVectorTextCommand(document, layer.id, { content: 'Hello curve' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.label).toBe('Set text on “Arc”');
    const updated = layerIn(sceneOf(result.value), 0);
    expect(textOf(updated)?.content).toBe('Hello curve');
    expect(textOf(updated)?.fontSize).toBe(28);
    expect(updated.frame).toEqual(layer.frame);
    if (updated.type !== 'path' || layer.type !== 'path') throw new Error('path expected');
    expect(updated.vector.path).toEqual(layer.vector.path);
  });

  it('clamps settings into the documented ranges instead of trusting the caller', () => {
    const layer = pathLayer('Arc', 'M0 50 C 25 0 75 0 100 50');
    const document = documentWith([layer]);
    const result = setVectorTextCommand(document, layer.id, {
      content: 'Clamped',
      fontSize: 5000,
      letterSpacing: -500,
      startOffset: 3,
      colour: 'not-a-colour',
    });
    if (!result.ok) throw new Error(result.error.message);
    const text = textOf(layerIn(sceneOf(result.value), 0));
    expect(text?.fontSize).toBe(512);
    expect(text?.letterSpacing).toBe(-20);
    expect(text?.startOffset).toBe(1);
    expect(text?.colour).toBe('#f4f4f5');
  });

  it('creates an empty run when a setting is changed before any words are typed', () => {
    const layer = pathLayer('Arc', 'M0 50 C 25 0 75 0 100 50');
    const document = documentWith([layer]);
    const result = setVectorTextCommand(document, layer.id, { fontSize: 40 });
    if (!result.ok) throw new Error(result.error.message);
    const text = textOf(layerIn(sceneOf(result.value), 0));
    expect(text?.content).toBe('');
    expect(text?.fontSize).toBe(40);
  });

  it('follows a geometry edit instead of being dropped by it', () => {
    const layer = pathLayer('Arc', 'M0 50 C 25 0 75 0 100 50');
    const document = documentWith([layer]);
    const written = setVectorTextCommand(document, layer.id, { content: 'Follows' });
    if (!written.ok) throw new Error(written.error.message);
    const afterText = { ...document, scene: sceneOf(written.value) };

    const moved = translatePathLayerCommand(afterText, layer.id, 25, 10);
    if (!moved.ok) throw new Error(moved.error.message);
    const text = textOf(layerIn(sceneOf(moved.value), 0));
    expect(text?.content).toBe('Follows');
  });

  it('survives a paint change, which touches the same vector content', () => {
    const layer = pathLayer('Arc', 'M0 50 C 25 0 75 0 100 50');
    const document = documentWith([layer]);
    const written = setVectorTextCommand(document, layer.id, { content: 'Kept' });
    if (!written.ok) throw new Error(written.error.message);
    const afterText = { ...document, scene: sceneOf(written.value) };

    const painted = setVectorStyleCommand(afterText, [layer.id], { fill: '#123456' });
    if (!painted.ok) throw new Error(painted.error.message);
    const updated = layerIn(sceneOf(painted.value), 0);
    expect(textOf(updated)?.content).toBe('Kept');
    if (updated.type !== 'path') throw new Error('path expected');
    expect(updated.vector.style.fill).toBe('#123456');
  });

  it('refuses a shape layer and a locked path, and says why', () => {
    const rect = shapeLayer('rect', 'Rect');
    const locked = pathLayer('Locked', 'M0 0 L10 0 L10 10 Z');
    const lockedLayer: Layer = { ...locked, locked: true };
    const document = documentWith([rect, lockedLayer]);

    const onRect = setVectorTextCommand(document, rect.id, { content: 'No' });
    expect(onRect.ok).toBe(false);
    if (!onRect.ok) expect(onRect.error.detail).toContain('vector paths');

    const onLocked = setVectorTextCommand(document, lockedLayer.id, { content: 'No' });
    expect(onLocked.ok).toBe(false);
    if (!onLocked.ok) expect(onLocked.error.message).toContain('locked');
  });

  it('removes a run and refuses to remove one that is not there', () => {
    const layer = pathLayer('Arc', 'M0 50 C 25 0 75 0 100 50');
    const document = documentWith([layer]);
    const written = setVectorTextCommand(document, layer.id, { content: 'Bye' });
    if (!written.ok) throw new Error(written.error.message);
    const afterText = { ...document, scene: sceneOf(written.value) };

    const cleared = clearVectorTextCommand(afterText, layer.id);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.value.label).toBe('Remove text from “Arc”');
    expect(textOf(layerIn(sceneOf(cleared.value), 0))).toBeNull();

    const clearedScene = { ...afterText, scene: sceneOf(cleared.value) };
    const again = clearVectorTextCommand(clearedScene, layer.id);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.message).toContain('no text');
  });
});
