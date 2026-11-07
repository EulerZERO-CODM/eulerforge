/**
 * Picking: what the pointer is over, in what order, and which point is "the one the user meant".
 *
 * The cases that matter in practice are the awkward ones — a handle lying exactly on its node, a node
 * sitting on the middle of a segment, a click just outside the tolerance — so those are the ones
 * pinned down here.
 */

import { describe, expect, it } from 'vitest';

import { createContour, createPath, type VectorPath } from './types';
import { ellipsePath } from './shapes';
import { parsePathData } from './path-data';
import {
  allNodes,
  insertionPointFor,
  nodeKey,
  nodesInBox,
  PICK_RADIUS,
  pickPathTarget,
  sameNode,
  segmentTotal,
  visibleHandles,
} from './pick';

function pathOf(data: string): VectorPath {
  const parsed = parsePathData(data);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value.path;
}

const square = pathOf('M0 0 L40 0 L40 40 L0 40 Z');

describe('what is under the pointer', () => {
  it('finds the node inside the pick radius and nothing outside it', () => {
    expect(pickPathTarget(square, { x: 1, y: 1 })).toMatchObject({
      kind: 'node',
      contourIndex: 0,
      nodeIndex: 0,
    });
    // Just below the radius, so the *segment* is what is there, not the node.
    const far = pickPathTarget(square, { x: PICK_RADIUS + 2, y: 0 });
    expect(far?.kind).toBe('segment');
  });

  it('prefers a handle even when it lies exactly on its node', () => {
    const overlapping = createPath([
      createContour(
        [
          { point: { x: 0, y: 0 }, handleIn: null, handleOut: { x: 0, y: 0 } },
          { point: { x: 10, y: 0 }, handleIn: null, handleOut: null },
          { point: { x: 10, y: 10 }, handleIn: null, handleOut: null },
        ],
        false,
      ),
    ]);
    // Without handles in play the node wins; with them, the handle does — which is what makes a
    // handle grabbable at all.
    expect(pickPathTarget(overlapping, { x: 0, y: 0 })?.kind).toBe('node');
    expect(pickPathTarget(overlapping, { x: 0.5, y: 0 }, { includeHandles: true })).toMatchObject({
      kind: 'handle',
      side: 'out',
      nodeIndex: 0,
    });
  });

  it('reports a point on the outline for inserting a node, without inserting anything', () => {
    const target = pickPathTarget(square, { x: 20, y: 0 });
    expect(target).toMatchObject({ kind: 'segment', contourIndex: 0, segmentIndex: 0 });
    const insertion = insertionPointFor(square, { x: 21, y: 1 });
    // The closest point is found by sampling the segment, so the coordinate is within the sampling
    // tolerance of the true one rather than bit-exact.
    expect(insertion?.point.x).toBeCloseTo(21, 6);
    expect(insertion?.point.y).toBeCloseTo(0, 6);
    expect(insertion?.t).toBeCloseTo(0.525, 3);
    expect(insertionPointFor(square, { x: 20, y: 20 }, 3)).toBeNull();
  });

  it('returns null for empty geometry and for a click in the middle of the shape', () => {
    expect(pickPathTarget(createPath([]), { x: 0, y: 0 })).toBeNull();
    // Outline-only picking: the inside of a shape has nothing to grab, which is what lets a
    // select-and-drag gesture work on the filled area.
    expect(pickPathTarget(square, { x: 20, y: 20 })).toBeNull();
  });

  it('can be pinned to one node so a drag cannot jump to a neighbour', () => {
    const only = { contourIndex: 0, nodeIndex: 2 };
    // Pinned to a node, the outline near a *different* node is no longer a target either: a drag
    // that started on one node follows that node and cannot latch onto a neighbouring segment.
    expect(pickPathTarget(square, { x: 1, y: 1 }, { only, includeSegments: false })).toBeNull();
    expect(pickPathTarget(square, { x: 39, y: 39 }, { only })).toMatchObject({
      nodeIndex: 2,
    });
  });

  it('picks a node on a curve, not the segment beside it', () => {
    const ellipse = ellipsePath({ minX: 0, minY: 0, maxX: 100, maxY: 60 });
    expect(pickPathTarget(ellipse, { x: 50, y: 0 })).toMatchObject({ kind: 'node', nodeIndex: 0 });
    // A point on the curve between nodes is a segment, not a node.
    const midway = pickPathTarget(ellipse, { x: 92.4, y: 18 });
    expect(midway === null || midway.kind === 'segment').toBe(true);
  });
});

describe('node selections', () => {
  it('selects the nodes inside a marquee, across contours', () => {
    const two = pathOf('M0 0 L10 0 L10 10 Z M50 50 L60 50 L60 60 Z');
    const inside = nodesInBox(two, { minX: -1, minY: -1, maxX: 12, maxY: 12 });
    expect(inside).toHaveLength(3);
    expect(nodesInBox(two, { minX: 45, minY: 45, maxX: 65, maxY: 65 })).toHaveLength(3);
    expect(nodesInBox(two, { minX: 100, minY: 100, maxX: 200, maxY: 200 })).toEqual([]);
  });

  it('lists every node in contour order and keys them stably', () => {
    const two = pathOf('M0 0 L10 0 L10 10 Z M50 50 L60 50 Z');
    expect(allNodes(two).map(nodeKey)).toEqual(['0:0', '0:1', '0:2', '1:0', '1:1']);
    expect(sameNode({ contourIndex: 1, nodeIndex: 1 }, { contourIndex: 1, nodeIndex: 1 })).toBe(
      true,
    );
    expect(sameNode({ contourIndex: 0, nodeIndex: 1 }, { contourIndex: 1, nodeIndex: 0 })).toBe(
      false,
    );
  });

  it('reports the handles that exist, so a corner shows only its point', () => {
    const mixed = createPath([
      createContour(
        [
          { point: { x: 0, y: 0 }, handleIn: null, handleOut: { x: 5, y: -5 } },
          { point: { x: 10, y: 0 }, handleIn: { x: 8, y: 3 }, handleOut: null },
        ],
        false,
      ),
    ]);
    expect(visibleHandles(mixed)).toEqual([
      { contourIndex: 0, nodeIndex: 0, side: 'out' },
      { contourIndex: 0, nodeIndex: 1, side: 'in' },
    ]);
    expect(segmentTotal(square)).toBe(4);
    expect(segmentTotal(createPath([]))).toBe(0);
  });
});
