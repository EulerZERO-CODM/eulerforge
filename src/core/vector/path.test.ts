/**
 * Path structure: validation, segments and the structural helpers.
 */

import { describe, expect, it } from 'vitest';

import { parsePathData } from './path-data';
import {
  allSegments,
  hasCurves,
  isUsablePath,
  reversePath,
  setContourClosed,
  segmentsOf,
  translatePath,
  validatePath,
  withoutEmptyContours,
} from './path';
import {
  createContour,
  createNode,
  createPath,
  emptyPath,
  isPoint,
  nodeCount,
  samePoint,
} from './types';
import { TOLERANCE } from './tolerance';

function parsed(d: string) {
  const result = parsePathData(d);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.path;
}

describe('path structure', () => {
  it('reports an empty path as an issue rather than throwing', () => {
    const issues = validatePath(emptyPath());
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('empty');
    expect(issues[0]?.severe).toBe(true);
    expect(isUsablePath(emptyPath())).toBe(false);
  });

  it('accepts a well-formed closed contour', () => {
    expect(validatePath(parsed('M0 0 L10 0 L10 10 Z'))).toEqual([]);
    expect(isUsablePath(parsed('M0 0 L10 0 L10 10 Z'))).toBe(true);
  });

  it('flags a closed contour with two nodes as degenerate but not fatal to the whole path', () => {
    const path = parsed('M0 0 L10 0 Z');
    const issues = validatePath(path);
    expect(issues.some((entry) => entry.code === 'degenerate-contour')).toBe(true);
    expect(issues.some((entry) => entry.severe)).toBe(false);
  });

  it('reports non-finite coordinates with the contour and node they came from', () => {
    const path = createPath([
      createContour(
        [
          createNode({ x: 0, y: 0 }),
          createNode({ x: Number.NaN, y: 4 }),
          createNode({ x: 5, y: 5 }),
        ],
        true,
      ),
    ]);
    const issues = validatePath(path);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('non-finite');
    expect(issues[0]?.nodeIndex).toBe(1);
    expect(issues[0]?.contourIndex).toBe(0);
  });

  it('refuses coordinates outside the supported range', () => {
    const path = createPath([
      createContour([createNode({ x: 0, y: 0 }), createNode({ x: 2_000_000, y: 0 })], false),
    ]);
    expect(validatePath(path)[0]?.code).toBe('out-of-range');
  });

  it('counts nodes and detects curves', () => {
    const path = parsed('M0 0 L10 0 C12 2 14 4 16 6 Z');
    // Three nodes: the move, the line's end and the curve's end. `Z` adds the closing segment.
    expect(nodeCount(path)).toBe(3);
    expect(hasCurves(path)).toBe(true);
    expect(allSegments(path)).toHaveLength(3);
    expect(hasCurves(parsed('M0 0 L10 0 L10 10 Z'))).toBe(false);
  });

  it('treats a closed contour as one extra segment back to the first node', () => {
    const closed = parsed('M0 0 L10 0 L10 10 Z');
    expect(segmentsOf(closed.contours[0]!)).toHaveLength(3);
    const open = parsed('M0 0 L10 0 L10 10');
    expect(segmentsOf(open.contours[0]!)).toHaveLength(2);
  });

  it('translates every point of the path, handles included', () => {
    const path = parsed('M0 0 C5 0 10 5 10 10 Z');
    const moved = translatePath(path, 3, -2);
    expect(moved.contours[0]?.nodes[0]?.point).toEqual({ x: 3, y: -2 });
    expect(moved.contours[0]?.nodes[0]?.handleOut).toEqual({ x: 8, y: -2 });
    expect(translatePath(path, 0, 0)).toBe(path);
  });

  it('reverses a contour without changing its shape', () => {
    const path = parsed('M0 0 C5 0 10 5 10 10 L0 10 Z');
    const reversed = reversePath(path);
    expect(reversed.contours[0]?.nodes).toHaveLength(3);
    // Reversing twice is the identity.
    expect(reversePath(reversed).contours[0]?.nodes.map((node) => node.point)).toEqual(
      path.contours[0]?.nodes.map((node) => node.point),
    );
  });

  it('closes and opens a contour, refusing a close that would create a line', () => {
    const open = parsed('M0 0 L10 0 L10 10');
    const closed = setContourClosed(open, 0, true);
    expect(closed.ok).toBe(true);
    if (closed.ok) expect(closed.value.contours[0]?.closed).toBe(true);

    const line = parsed('M0 0 L10 0');
    const refused = setContourClosed(line, 0, true);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('three nodes');

    expect(setContourClosed(open, 9, true).ok).toBe(false);
  });

  it('drops contours that carry no geometry', () => {
    const withEmpty = createPath([
      createContour([], false),
      ...parsed('M0 0 L1 1 L2 0 Z').contours,
    ]);
    const cleaned = withoutEmptyContours(withEmpty);
    expect(cleaned.contours).toHaveLength(1);
    // Already-clean paths keep their identity, which keeps memoisation honest.
    expect(withoutEmptyContours(cleaned)).toBe(cleaned);
  });

  it('compares points at the documented tolerance', () => {
    expect(samePoint({ x: 0, y: 0 }, { x: 1e-9, y: 0 }, TOLERANCE.point)).toBe(true);
    expect(samePoint({ x: 0, y: 0 }, { x: 0.001, y: 0 }, TOLERANCE.point)).toBe(false);
  });

  it('validates point-shaped values from untrusted input', () => {
    expect(isPoint({ x: 1, y: 2 })).toBe(true);
    expect(isPoint({ x: 1 })).toBe(false);
    expect(isPoint(null)).toBe(false);
    expect(isPoint('1,2')).toBe(false);
  });
});
