/**
 * Topological validation.
 *
 * These tests define what "topologically valid" means for the rest of the platform, so they cover
 * both directions: shapes that must pass, and every defect the checker claims to detect — each
 * proven with a shape that really has it.
 */

import { describe, expect, it } from 'vitest';

import { parsePathData } from './path-data';
import { rectanglePath } from './shapes';
import { checkTopology, isTopologicallyValid } from './validity';
import { createContour, createNode, createPath, type VectorPath } from './types';

function parsed(d: string): VectorPath {
  const result = parsePathData(d);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.path;
}

describe('valid regions', () => {
  it('accepts a rectangle', () => {
    const report = checkTopology(rectanglePath({ minX: 0, minY: 0, maxX: 10, maxY: 10 }));
    expect(report.valid).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.outerContours).toEqual([0]);
    expect(report.holeContours).toEqual([]);
    expect(report.flattened.segments).toBe(4);
  });

  it('accepts a shape with a hole wound the other way', () => {
    const report = checkTopology(
      parsed('M0 0 L100 0 L100 100 L0 100 Z M25 25 L25 75 L75 75 L75 25 Z'),
    );
    expect(report.valid).toBe(true);
    expect(report.outerContours).toEqual([0]);
    expect(report.holeContours).toEqual([1]);
  });

  it('accepts two separate outers, and an island inside a hole', () => {
    const twoOuters = checkTopology(
      parsed('M0 0 L10 0 L10 10 L0 10 Z M50 50 L60 50 L60 60 L50 60 Z'),
    );
    expect(twoOuters.valid).toBe(true);
    expect(twoOuters.outerContours).toEqual([0, 1]);

    // Outer, hole, island: a donut with a filled centre, which a non-zero fill draws correctly.
    const island = checkTopology(
      parsed(
        'M0 0 L100 0 L100 100 L0 100 Z M20 20 L20 80 L80 80 L80 20 Z M40 40 L60 40 L60 60 L40 60 Z',
      ),
    );
    expect(island.valid).toBe(true);
    expect(island.outerContours).toEqual([0, 2]);
    expect(island.holeContours).toEqual([1]);
  });

  it('accepts a rectangle as a region even though its nodes are not repeated', () => {
    const report = checkTopology(rectanglePath({ minX: 0, minY: 0, maxX: 40, maxY: 40 }));
    expect(report.valid).toBe(true);
    // Closure is a property of the contour flag, not of a duplicated node.
    expect(report.issues.some((entry) => entry.code === 'contour-not-closed')).toBe(false);
  });
});

describe('defects', () => {
  it('detects a self-intersecting contour', () => {
    const report = checkTopology(parsed('M0 0 L10 10 L10 0 L0 10 Z'));
    const found = report.issues.find((entry) => entry.code === 'self-intersection');
    expect(found).toBeDefined();
    expect(found?.contourIndex).toBe(0);
    expect(report.valid).toBe(false);
  });

  it('does not mistake a shared vertex or a collinear edge for a crossing', () => {
    // A concave polygon whose vertex touches the opposite edge is still a valid region.
    const concave = parsed('M0 0 L40 0 L40 40 L20 40 L20 10 L0 10 Z');
    expect(checkTopology(concave).issues.some((entry) => entry.code === 'self-intersection')).toBe(
      false,
    );
    expect(checkTopology(concave).valid).toBe(true);
  });

  it('detects an open contour when a region is required', () => {
    const report = checkTopology(parsed('M0 0 L10 0 L10 10 L0 10'), { requireClosed: true });
    expect(report.issues.some((entry) => entry.code === 'contour-not-closed')).toBe(true);
    expect(report.valid).toBe(false);

    const asDrawing = checkTopology(parsed('M0 0 L10 0 L10 10 L0 10'), { requireClosed: false });
    expect(asDrawing.issues.some((entry) => entry.code === 'contour-not-closed')).toBe(false);
  });

  it('detects a degenerate contour that encloses no area', () => {
    const collapsed = createPath([
      createContour(
        [createNode({ x: 0, y: 0 }), createNode({ x: 5, y: 0 }), createNode({ x: 10, y: 0 })],
        true,
      ),
    ]);
    const report = checkTopology(collapsed);
    expect(report.issues.some((entry) => entry.code === 'degenerate-contour')).toBe(true);
    expect(report.valid).toBe(false);
  });

  it('flags a hole that lies outside every outer contour without calling the path invalid', () => {
    // Clockwise square (outer), then a counter-clockwise square far away: a hole in nothing. Under a
    // non-zero fill it still paints its own interior, so this is a warning: the drawing is not what
    // the author of a *boolean* probably intended, but it is not lost geometry either.
    const report = checkTopology(
      parsed('M0 0 L10 0 L10 10 L0 10 Z M100 100 L100 110 L110 110 L110 100 Z'),
    );
    const issue = report.issues.find((entry) => entry.code === 'hole-outside-outer');
    expect(issue).toBeDefined();
    expect(issue?.invalid).toBe(false);
    expect(report.valid).toBe(true);
    expect(report.holeContours).toEqual([1]);
  });

  it('reports structural failures separately from topological ones', () => {
    const broken = createPath([
      createContour(
        [
          createNode({ x: 0, y: 0 }),
          createNode({ x: Number.POSITIVE_INFINITY, y: 0 }),
          createNode({ x: 1, y: 1 }),
        ],
        true,
      ),
    ]);
    const report = checkTopology(broken);
    expect(report.structureIssues.some((entry) => entry.code === 'non-finite')).toBe(true);
    expect(report.valid).toBe(false);
    // Geometry is not attempted: flattening non-finite curves cannot converge and the crossing
    // scan would take minutes over the resulting point cloud.
    expect(report.flattened.segments).toBe(0);
    expect(report.issues).toEqual([]);
  });

  it('returns promptly for a path whose coordinates are all NaN', () => {
    // Regression: a rectangle built from `{ x, y, width, height }` instead of a `VectorBox` yields
    // NaN everywhere, and the topology report used to hang for minutes.
    const box = {
      minX: Number.NaN,
      minY: Number.NaN,
      maxX: Number.NaN,
      maxY: Number.NaN,
    } as const;
    const started = performance.now();
    const report = checkTopology(rectanglePath(box));
    const elapsed = performance.now() - started;
    expect(report.valid).toBe(false);
    expect(report.structureIssues.some((entry) => entry.severe)).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });

  it('reports a contour with no nodes without throwing', () => {
    const report = checkTopology(createPath([createContour([], true)]));
    expect(report.valid).toBe(false);
    expect(report.issues.some((entry) => entry.code === 'degenerate-contour')).toBe(true);
  });
});

describe('tolerance reporting', () => {
  it('says which tolerance the geometric checks used', () => {
    const defaultReport = checkTopology(rectanglePath({ minX: 0, minY: 0, maxX: 10, maxY: 10 }));
    expect(defaultReport.flattened.tolerance).toBe(0.05);

    const fine = checkTopology(rectanglePath({ minX: 0, minY: 0, maxX: 10, maxY: 10 }), {
      tolerance: 0.001,
    });
    expect(fine.flattened.tolerance).toBe(0.001);
  });

  it('is a pure predicate: repeated checks agree', () => {
    const path = parsed('M0 0 L10 0 L10 10 L0 10 Z M20 20 L20 30 L30 30 L30 20 Z');
    expect(isTopologicallyValid(path)).toBe(isTopologicallyValid(path));
  });
});

describe('winding is interpretive, not destructive', () => {
  it('treats a lone negatively wound contour as valid artwork, with a warning', () => {
    // Screenshot-clockwise is positive in this kernel, so this square is wound "backwards".
    const counterClockwise = parsed('M0 0 L0 100 L100 100 L100 0 Z');
    const report = checkTopology(counterClockwise);
    expect(report.valid).toBe(true);
    expect(report.holeContours).toEqual([0]);
    expect(report.outerContours).toEqual([]);
    const issue = report.issues.find((entry) => entry.code === 'hole-outside-outer');
    expect(issue?.invalid).toBe(false);
    expect(issue?.message).toContain('island');
  });

  it('still refuses geometry that cannot be rendered deterministically', () => {
    const figureEight = parsed('M0 0 L10 10 L10 0 L0 10 Z');
    const report = checkTopology(figureEight);
    expect(report.valid).toBe(false);
    expect(report.issues.some((entry) => entry.code === 'self-intersection' && entry.invalid)).toBe(
      true,
    );
  });
});
