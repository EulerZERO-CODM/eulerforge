/**
 * Node editing operations.
 *
 * The property that matters most here is that an edit does what the label says without collateral
 * damage: inserting a node must not move the curve, deleting a node must never leave an
 * unrenderable shape, and a handle drag must respect the mirroring the caller asked for.
 */

import { describe, expect, it } from 'vitest';

import { areaOfPath } from './area';
import { boundsOfPath } from './bounds';
import { closestPointOnPath, pointOnSegment } from './flatten';
import {
  deleteNode,
  fitPathIntoBox,
  insertNodeAt,
  midpointOfSegment,
  moveHandle,
  moveNode,
  moveNodeBy,
  segmentCount,
  setNodeHandles,
  setNodeKind,
  simplifyPath,
} from './ops';
import { allSegments, isUsablePath, segmentsOf } from './path';
import { parsePathData } from './path-data';
import { ellipsePath, rectanglePath } from './shapes';
import { checkTopology } from './validity';
import type { VectorPath } from './types';
import { TOLERANCE } from './tolerance';

function parsed(d: string): VectorPath {
  const result = parsePathData(d);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.path;
}

const OPEN_CURVE = 'M0 0 C20 40 60 40 80 0';

describe('moving nodes', () => {
  it('moves a node and carries its handles', () => {
    const path = parsed(OPEN_CURVE);
    const moved = moveNode(path, 0, 0, { x: -5, y: 5 });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const node = moved.value.contours[0]?.nodes[0];
    expect(node?.point).toEqual({ x: -5, y: 5 });
    expect(node?.handleOut).toEqual({ x: 15, y: 45 });
  });

  it('moves by a delta without changing the rest of the path', () => {
    const path = parsed('M0 0 L10 0 L10 10 Z');
    const moved = moveNodeBy(path, 0, 1, 5, -5);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.contours[0]?.nodes.map((node) => node.point)).toEqual([
      { x: 0, y: 0 },
      { x: 15, y: -5 },
      { x: 10, y: 10 },
    ]);
  });

  it('refuses a node that does not exist, naming it', () => {
    const path = parsed('M0 0 L10 0 L10 10 Z');
    const missingNode = moveNode(path, 0, 9, { x: 0, y: 0 });
    expect(missingNode.ok).toBe(false);
    if (!missingNode.ok) expect(missingNode.error.message).toContain('Node 9');

    const missingContour = moveNode(path, 4, 0, { x: 0, y: 0 });
    expect(missingContour.ok).toBe(false);
    if (!missingContour.ok) expect(missingContour.error.message).toContain('Contour 4');
  });
});

describe('dragging handles', () => {
  it('moves the requested handle only when mirroring is off', () => {
    const path = parsed(OPEN_CURVE);
    const moved = moveHandle(path, 0, 1, 'in', { x: 50, y: 10 });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const node = moved.value.contours[0]?.nodes[1];
    expect(node?.handleIn).toEqual({ x: 50, y: 10 });
    expect(node?.handleOut).toBeNull();
  });

  it('mirrors the opposite handle at the same distance when asked to', () => {
    // A node that already has both handles: mirroring keeps it smooth.
    const path = parsed('M0 0 C10 10 20 10 30 0 C40 -10 50 -10 60 0');
    const moved = moveHandle(path, 0, 1, 'in', { x: 15, y: 5 }, 'opposite');
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const node = moved.value.contours[0]?.nodes[1];
    // Node at (30, 0); the opposite handle must be (30 + (30-15), 0 + (0-5)) = (45, -5).
    expect(node?.handleOut).toEqual({ x: 45, y: -5 });
  });

  it('does not create a mirror handle from nothing', () => {
    const path = parsed('M0 0 L30 0');
    const moved = moveHandle(path, 0, 0, 'out', { x: 10, y: 0 }, 'opposite');
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.contours[0]?.nodes[0]?.handleIn).toBeNull();
  });

  it('sets handles directly, including clearing them', () => {
    const path = parsed('M0 0 C10 10 20 10 30 0');
    // Clearing both ends of the segment turns it back into a straight line.
    const first = setNodeHandles(path, 0, 0, { handleIn: null, handleOut: null });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const cleared = setNodeHandles(first.value, 0, 1, { handleIn: null, handleOut: null });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(segmentsOf(cleared.value.contours[0]!)[0]?.kind).toBe('line');

    // Setting one handle on a single-node-to-node segment is enough to make it a curve again.
    const restored = setNodeHandles(cleared.value, 0, 0, {
      handleIn: null,
      handleOut: { x: 5, y: 5 },
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(segmentsOf(restored.value.contours[0]!)[0]?.kind).toBe('cubic');
  });
});

describe('corner and smooth nodes', () => {
  it('turns a curve node into a corner and back', () => {
    const path = parsed('M0 0 L10 0 C20 20 40 20 50 0');
    const corner = setNodeKind(path, 0, 0, 'corner');
    expect(corner.ok).toBe(true);
    if (!corner.ok) return;
    expect(corner.value.contours[0]?.nodes[0]?.handleOut).toBeNull();

    const smooth = setNodeKind(path, 0, 0, 'smooth');
    expect(smooth.ok).toBe(true);
    if (!smooth.ok) return;
    const node = smooth.value.contours[0]?.nodes[0];
    expect(node?.handleOut).not.toBeNull();
    // The handle points towards the next node.
    expect(node?.handleOut?.x).toBeGreaterThan(0);
  });

  it('refuses to smooth a node whose two neighbours are the same point', () => {
    // Nodes 0 and 1 coincide, so node 2 has no direction to smooth along.
    const path = parsed('M0 0 L0 0 L20 20 Z');
    const result = setNodeKind(path, 0, 2, 'smooth');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('same place');
  });
});

describe('inserting and deleting nodes', () => {
  it('inserts a node on the nearest segment without moving the geometry', () => {
    const path = parsed(OPEN_CURVE);
    const outcome = insertNodeAt(path, { x: 40, y: 27 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.refused).toBe(false);
    expect(outcome.value.contourIndex).toBe(0);
    expect(outcome.value.nodeIndex).toBe(1);
    expect(outcome.value.path.contours[0]?.nodes).toHaveLength(3);

    // Every point of the original curve is still on the new path.
    for (let step = 0; step <= 50; step += 1) {
      const original = pointOnSegment(allSegments(path)[0]!, step / 50);
      expect(closestPointOnPath(outcome.value.path, original)?.distance).toBeLessThan(0.01);
    }
  });

  it('refuses to insert when the click is nowhere near the path', () => {
    const path = parsed(OPEN_CURVE);
    const outcome = insertNodeAt(path, { x: 400, y: 400 }, TOLERANCE, 1);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.refused).toBe(true);
    expect(outcome.value.path).toBe(path);
  });

  it('deletes a node and keeps the shape usable', () => {
    const path = rectanglePath({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    const outcome = deleteNode(path, 0, 1);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.removedContour).toBe(false);
    expect(outcome.value.openedContour).toBe(false);
    expect(outcome.value.path.contours[0]?.nodes).toHaveLength(3);
    expect(isUsablePath(outcome.value.path)).toBe(true);
    expect(checkTopology(outcome.value.path).valid).toBe(true);
  });

  it('opens a closed contour rather than leaving two nodes and a close', () => {
    const triangle = parsed('M0 0 L10 0 L10 10 Z');
    const outcome = deleteNode(triangle, 0, 2);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.openedContour).toBe(true);
    expect(outcome.value.path.contours[0]?.closed).toBe(false);
    expect(checkTopology(outcome.value.path, { requireClosed: false }).valid).toBe(true);
  });

  it('removes a contour once its last node is deleted', () => {
    const dot = parsed('M5 5');
    const outcome = deleteNode(dot, 0, 0);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.removedContour).toBe(true);
    expect(outcome.value.path.contours).toHaveLength(0);
  });

  it('reports the midpoint of a segment for the add-node affordance', () => {
    const contour = rectanglePath({ minX: 0, minY: 0, maxX: 10, maxY: 20 }).contours[0]!;
    expect(midpointOfSegment(contour, 0)).toEqual({ x: 5, y: 0 });
    expect(midpointOfSegment(contour, 9)).toBeNull();
  });
});

describe('simplifying and scaling', () => {
  it('drops collinear and duplicate nodes from polygonal geometry', () => {
    const noisy = parsed('M0 0 L10 0 L20 0 L20 10 L20 20 L10 20 L0 20 L0 10 L0 0 Z');
    const simplified = simplifyPath(noisy);
    expect(noisy.contours[0]?.nodes.length).toBe(9);
    expect(simplified.contours[0]?.nodes.length).toBe(4);
    // The shape is unchanged: the corner nodes are still exactly where they were.
    expect(boundsOfPath(simplified)).toEqual(boundsOfPath(noisy));
    expect(areaOfPath(simplified)).toBeCloseTo(areaOfPath(noisy), 9);
  });

  it('keeps nodes that carry curve handles', () => {
    const curved = parsed('M0 0 L10 0 C12 4 14 4 16 0 L20 0');
    const simplified = simplifyPath(curved);
    expect(simplified.contours[0]?.nodes.length).toBe(4);
    expect(allSegments(simplified).some((segment) => segment.kind === 'cubic')).toBe(true);
  });

  it('fits a path into a box, preserving its proportions', () => {
    const circle = ellipsePath({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    const fitted = fitPathIntoBox(circle, { minX: 0, minY: 0, maxX: 200, maxY: 200 });
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;
    expect(boundsOfPath(fitted.value)).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 200 });
    expect(areaOfPath(fitted.value)).toBeCloseTo(areaOfPath(circle) * 4, 3);
  });

  it('refuses to fit a path with no extent into a box', () => {
    const line = parsed('M0 0 L50 0');
    const result = fitPathIntoBox(line, { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('no width or no height');
  });

  it('counts segments for the inspector', () => {
    expect(segmentCount(rectanglePath({ minX: 0, minY: 0, maxX: 10, maxY: 10 }))).toBe(4);
    expect(segmentCount(parsed('M0 0 L10 0 L10 10'))).toBe(2);
  });
});
