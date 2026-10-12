import { describe, expect, it } from 'vitest';

import {
  buildSnapTargets,
  computeSnap,
  handleAtPoint,
  handlePosition,
  hitTestScene,
  layerContainsPoint,
  layersInRect,
  layersTopFirst,
  MOVE_SNAP_EDGES,
  resizeFrame,
  snapEdgesForHandle,
  snapThresholdForZoom,
  toDocumentPoint,
  HANDLE_ANCHORS,
  TRANSFORM_HANDLES,
} from './scene-geometry';
import { createRect, rectCentre } from './geometry';
import { ellipseLayer, imageLayer, rectLayer, sceneOf, textLayer } from '../../testing/layers';

describe('hitTestScene', () => {
  const scene = sceneOf(
    rectLayer('lyr-back', { x: 0, y: 0, width: 200, height: 200 }),
    rectLayer('lyr-front', { x: 100, y: 100, width: 200, height: 200 }),
  );

  it('returns the top-most layer under the point, matching paint order', () => {
    expect(hitTestScene(scene, { x: 150, y: 150 })?.id).toBe('lyr-front');
    expect(hitTestScene(scene, { x: 50, y: 50 })?.id).toBe('lyr-back');
  });

  it('returns null outside every layer', () => {
    expect(hitTestScene(scene, { x: 900, y: 900 })).toBeNull();
  });

  it('skips hidden layers so a hidden layer cannot steal a click', () => {
    const hidden = sceneOf(
      rectLayer('lyr-hidden', { x: 0, y: 0, width: 100, height: 100 }),
      rectLayer('lyr-visible', { x: 0, y: 0, width: 100, height: 100 }),
    ).layers.map((layer) => (layer.id === 'lyr-hidden' ? { ...layer, visible: false } : layer));
    const result = hitTestScene(sceneOf(...hidden), { x: 10, y: 10 });
    expect(result?.id).toBe('lyr-visible');
  });

  it('skips locked layers but still allows selecting them from the tree', () => {
    const locked = sceneOf(rectLayer('lyr-locked')).layers.map((layer) => ({
      ...layer,
      locked: true,
    }));
    expect(hitTestScene(sceneOf(...locked), { x: 10, y: 10 })).toBeNull();
  });
});

describe('layerContainsPoint', () => {
  it('treats ellipses as ellipses, not as their bounding box', () => {
    const ellipse = ellipseLayer('lyr-ellipse', { x: 0, y: 0 });
    const frame = { x: 0, y: 0, width: 120, height: 120 };
    expect(ellipse.frame).toEqual(frame);
    expect(layerContainsPoint(ellipse, { x: 60, y: 60 })).toBe(true);
    // Corner of the bounding box: inside the box, outside the ellipse.
    expect(layerContainsPoint(ellipse, { x: 2, y: 2 })).toBe(false);
  });

  it('treats text boxes as rectangles so wrapping is clickable', () => {
    const text = textLayer('lyr-text', { x: 10, y: 10, width: 200, height: 50 });
    expect(layerContainsPoint(text, { x: 20, y: 20 })).toBe(true);
    expect(layerContainsPoint(text, { x: 400, y: 20 })).toBe(false);
  });
});

describe('handleAtPoint', () => {
  const frame = createRect(100, 100, 200, 120);

  it('identifies each of the eight handles at its own position', () => {
    for (const handle of TRANSFORM_HANDLES) {
      const position = handlePosition(frame, handle);
      expect(handleAtPoint(frame, position)).toBe(handle);
    }
  });

  it('reports no handle from the middle of a frame, so a click there is a move', () => {
    expect(handleAtPoint(frame, rectCentre(frame))).toBeNull();
  });

  it('uses a hit tolerance so a handle is grabbable at low zoom', () => {
    expect(handleAtPoint(frame, { x: 100, y: 100 })).toBe('nw');
    expect(handleAtPoint(frame, { x: 104, y: 104 })).toBe('nw');
    expect(handleAtPoint(frame, { x: 120, y: 120 })).toBeNull();
  });

  it('prefers the closest handle when two are nearby', () => {
    expect(handleAtPoint(createRect(0, 0, 4, 4), { x: 2, y: 2 })).toBe('nw');
  });

  it('places the anchors at the documented unit positions', () => {
    expect(HANDLE_ANCHORS.n).toEqual({ x: 0.5, y: 0 });
    expect(HANDLE_ANCHORS.w).toEqual({ x: 0, y: 0.5 });
  });
});

describe('resizeFrame', () => {
  const frame = createRect(100, 100, 200, 200);

  it('moves only the dragged edge', () => {
    expect(resizeFrame(frame, 'e', { x: 50, y: 999 })).toEqual({
      x: 100,
      y: 100,
      width: 250,
      height: 200,
    });
    expect(resizeFrame(frame, 'n', { x: 999, y: -30 })).toEqual({
      x: 100,
      y: 70,
      width: 200,
      height: 230,
    });
  });

  it('keeps the opposite corner pinned when dragging a corner', () => {
    const resized = resizeFrame(frame, 'nw', { x: -20, y: -20 });
    expect(resized.x + resized.width).toBe(300);
    expect(resized.y + resized.height).toBe(300);
    expect(resized.width).toBe(220);
  });

  it('never produces a degenerate or negative frame', () => {
    const collapsed = resizeFrame(frame, 'e', { x: -500, y: 0 });
    expect(collapsed.width).toBeGreaterThan(0);
    const flipped = resizeFrame(frame, 'w', { x: 5_000, y: 0 });
    // Dragging the left edge past the right one stops at the minimum size rather than inverting.
    expect(flipped.width).toBe(4);
    expect(flipped.x).toBe(296);
  });

  it('preserves the aspect ratio when asked', () => {
    const wide = createRect(0, 0, 400, 200);
    const resized = resizeFrame(wide, 'se', { x: 100, y: 0 }, { preserveAspectRatio: true });
    expect(resized.width).toBe(500);
    expect(resized.height).toBe(250);
    expect(resized.width / resized.height).toBeCloseTo(2, 5);
  });

  it('resizes around the centre when asked', () => {
    const resized = resizeFrame(frame, 'e', { x: 20, y: 0 }, { resizeFromCentre: true });
    expect(rectCentre(resized)).toEqual(rectCentre(frame));
    expect(resized.width).toBe(240);
  });

  it('is a pure function of the original frame, so a gesture cannot drift', () => {
    const first = resizeFrame(frame, 'se', { x: 10, y: 10 });
    const again = resizeFrame(frame, 'se', { x: 10, y: 10 });
    expect(again).toEqual(first);
  });
});

describe('snapping', () => {
  const canvas = { width: 1000, height: 1000 };
  const targets = buildSnapTargets({
    canvas,
    gridMm: 10,
    pixelsPerMm: 1,
    siblings: [rectLayer('lyr-sibling', { x: 300, y: 300, width: 100, height: 100 })],
    alignmentGuides: [],
  });

  it('includes the canvas edges, centre and tenth lines', () => {
    expect(targets.vertical).toContain(0);
    expect(targets.vertical).toContain(500);
    expect(targets.vertical).toContain(1000);
    expect(targets.vertical).toContain(100);
  });

  it('includes sibling edges and centres', () => {
    expect(targets.vertical).toContain(300);
    expect(targets.vertical).toContain(350);
    expect(targets.vertical).toContain(400);
    expect(targets.horizontal).toContain(350);
  });

  it('includes explicit alignment guides', () => {
    const withGuide = buildSnapTargets({
      canvas,
      gridMm: 10,
      pixelsPerMm: 1,
      siblings: [],
      alignmentGuides: [137],
    });
    expect(withGuide.vertical).toContain(137);
  });

  it('returns sorted, finite, de-duplicated targets', () => {
    const sorted = [...targets.vertical].every(
      (value, index) => index === 0 || value >= (targets.vertical[index - 1] ?? value),
    );
    expect(sorted).toBe(true);
    expect(targets.vertical.every((value) => Number.isFinite(value))).toBe(true);
    expect(new Set(targets.vertical).size).toBe(targets.vertical.length);
  });

  it('snaps a frame edge to the canvas centre', () => {
    const adjustment = computeSnap({
      frame: createRect(503, 200, 100, 100),
      targets,
      threshold: 6,
      edges: MOVE_SNAP_EDGES,
      enabled: true,
      mode: 'move',
    });
    expect(adjustment.delta.x).toBe(-3);
    expect(adjustment.guidesX).toEqual([500]);
  });

  it('reports no guides when nothing is within the threshold', () => {
    // A coarse grid, so the frame really is far from every target on both axes.
    const coarse = buildSnapTargets({
      canvas,
      gridMm: 200,
      pixelsPerMm: 1,
      siblings: [],
      alignmentGuides: [],
    });
    const adjustment = computeSnap({
      targets: coarse,
      frame: createRect(512, 512, 60, 60),
      threshold: 4,
      edges: MOVE_SNAP_EDGES,
      enabled: true,
      mode: 'move',
    });
    expect(adjustment.delta).toEqual({ x: 0, y: 0 });
    expect(adjustment.guidesX).toEqual([]);
  });

  it('snaps sibling edges to each other', () => {
    const adjustment = computeSnap({
      frame: createRect(302, 500, 80, 80),
      targets,
      threshold: 6,
      edges: MOVE_SNAP_EDGES,
      enabled: true,
      mode: 'move',
    });
    expect(adjustment.delta.x).toBe(-2);
    expect(adjustment.guidesX).toEqual([300]);
  });

  it('does nothing at all when snapping is disabled', () => {
    const adjustment = computeSnap({
      frame: createRect(501, 501, 100, 100),
      targets,
      threshold: 20,
      edges: MOVE_SNAP_EDGES,
      enabled: false,
      mode: 'move',
    });
    expect(adjustment).toEqual({ delta: { x: 0, y: 0 }, guidesX: [], guidesY: [] });
  });

  it('picks the nearest candidate when several are in range', () => {
    const adjustment = computeSnap({
      frame: createRect(496, 500, 100, 100),
      targets,
      threshold: 8,
      edges: MOVE_SNAP_EDGES,
      enabled: true,
      mode: 'move',
    });
    // 500 (centre) is 4 away, 1000 (right edge) is 404 away: only the centre qualifies.
    expect(adjustment.guidesX).toEqual([500]);
  });

  it('snaps only the edges a resize handle actually moves', () => {
    expect(snapEdgesForHandle('e')).toEqual(['right']);
    expect(snapEdgesForHandle('w')).toEqual(['left']);
    expect(snapEdgesForHandle('n')).toEqual(['top']);
    expect(snapEdgesForHandle('s')).toEqual(['bottom']);
    expect(snapEdgesForHandle('nw')).toEqual(['left', 'top']);
    expect(snapEdgesForHandle('se')).toEqual(['right', 'bottom']);
    expect(snapEdgesForHandle('ne')).toEqual(['right', 'top']);
    expect(snapEdgesForHandle('sw')).toEqual(['left', 'bottom']);
  });

  it('resizes with snapping without moving the pinned edges', () => {
    const frame = createRect(300, 300, 100, 100);
    const adjustment = computeSnap({
      frame,
      targets,
      threshold: 6,
      edges: snapEdgesForHandle('e'),
      enabled: true,
      mode: 'resize',
      handle: 'e',
    });
    // The right edge (400) is already on a sibling edge, so nothing moves.
    expect(adjustment.delta).toEqual({ x: 0, y: 0 });
  });

  it('keeps the snap threshold constant on screen across zoom levels', () => {
    expect(snapThresholdForZoom(1)).toBeCloseTo(6, 5);
    expect(snapThresholdForZoom(0.25)).toBeCloseTo(24, 5);
    expect(snapThresholdForZoom(4)).toBeCloseTo(1.5, 5);
    // 6 screen pixels at 25 % and at 400 % describe the same on-screen grab distance.
    expect(snapThresholdForZoom(0.25) * 0.25).toBeCloseTo(snapThresholdForZoom(4) * 4, 5);
  });
});

describe('toDocumentPoint', () => {
  it('converts client coordinates into document pixels at any zoom', () => {
    const point = toDocumentPoint({ x: 300, y: 200 }, { x: 100, y: 100 }, 0.5);
    expect(point).toEqual({ x: 400, y: 200 });
  });

  it('treats an invalid zoom as 1 instead of dividing by zero', () => {
    expect(toDocumentPoint({ x: 10, y: 10 }, { x: 0, y: 0 }, 0)).toEqual({ x: 10, y: 10 });
    expect(toDocumentPoint({ x: 10, y: 10 }, { x: 0, y: 0 }, Number.NaN)).toEqual({ x: 10, y: 10 });
  });
});

describe('scene listing helpers', () => {
  const scene = sceneOf(rectLayer('lyr-bottom'), textLayer('lyr-middle'), imageLayer('lyr-top'));

  it('lists layers top-first for the layer panel', () => {
    expect(layersTopFirst(scene).map((layer) => layer.id)).toEqual([
      'lyr-top',
      'lyr-middle',
      'lyr-bottom',
    ]);
  });

  it('selects everything a marquee touches and nothing it misses', () => {
    const marquee = createRect(0, 0, 10, 10);
    const hit = layersInRect(scene, marquee).map((layer) => layer.id);
    expect(hit).toEqual(['lyr-bottom', 'lyr-middle', 'lyr-top']);
    expect(layersInRect(scene, createRect(900, 900, 10, 10))).toEqual([]);
  });
});
