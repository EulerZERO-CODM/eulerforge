/**
 * Primitive shapes.
 *
 * Each shape must be a real path that the rest of the kernel accepts: valid topologically, with the
 * bounds and area its geometry implies. The curves are checked against their analytic counterparts
 * (`πr²`, the exact circle constant) rather than against a golden string, so a shape that was
 * accidentally drawn as a squashed square would fail.
 */

import { describe, expect, it } from 'vitest';

import { areaOfContour, areaOfPath, centroidOfContour } from './area';
import { boundsOfPath } from './bounds';
import { allSegments, isUsablePath } from './path';
import { toPathData } from './path-data';
import {
  CIRCLE_KAPPA,
  ellipsePath,
  linePath,
  rectanglePath,
  regularPolygonPath,
  starPath,
} from './shapes';
import { checkTopology } from './validity';

const BOX = { minX: 0, minY: 0, maxX: 200, maxY: 100 };

describe('rectangles', () => {
  it('produces a four-node closed contour with the box bounds', () => {
    const path = rectanglePath(BOX);
    expect(path.contours[0]?.nodes).toHaveLength(4);
    expect(path.contours[0]?.closed).toBe(true);
    expect(boundsOfPath(path)).toEqual(BOX);
    expect(areaOfPath(path)).toBeCloseTo(20_000, 6);
    expect(checkTopology(path).valid).toBe(true);
  });

  it('rounds corners with real curve geometry that stays inside the box', () => {
    const path = rectanglePath(BOX, 20);
    expect(path.contours[0]?.nodes).toHaveLength(8);
    expect(path.contours[0]?.closed).toBe(true);
    expect(checkTopology(path).valid).toBe(true);
    expect(isUsablePath(path)).toBe(true);
    expect(allSegments(path).filter((segment) => segment.kind === 'cubic')).toHaveLength(4);

    const bounds = boundsOfPath(path);
    expect(bounds?.minX).toBeCloseTo(0, 6);
    expect(bounds?.maxY).toBeCloseTo(100, 6);
    // The area is the rectangle minus the four corner cut-offs, plus the quarter circles. The
    // 4-cubic circle approximation is itself the source of the remaining difference (~0.027 % per
    // corner), so the bound is 0.5 % rather than exact equality.
    const expected = 20_000 - 4 * (20 * 20) + Math.PI * 20 * 20;
    expect(Math.abs(areaOfPath(path) - expected) / expected).toBeLessThan(0.005);
  });

  it('clamps a corner radius that would exceed the shape', () => {
    const path = rectanglePath({ minX: 0, minY: 0, maxX: 40, maxY: 20 }, 500);
    expect(checkTopology(path).valid).toBe(true);
    expect(boundsOfPath(path)?.maxX).toBeCloseTo(40, 6);
    expect(areaOfPath(path)).toBeGreaterThan(0);
  });

  it('returns a single node for a box with no area rather than a degenerate ring', () => {
    const flat = rectanglePath({ minX: 0, minY: 0, maxX: 0, maxY: 100 });
    expect(flat.contours[0]?.nodes).toHaveLength(1);
    expect(areaOfPath(flat)).toBe(0);
  });
});

describe('ellipses', () => {
  it('uses four cubic segments and matches the analytic area', () => {
    const circle = ellipsePath({ minX: 0, minY: 0, maxX: 200, maxY: 200 });
    expect(circle.contours[0]?.nodes).toHaveLength(4);
    expect(allSegments(circle)).toHaveLength(4);
    expect(allSegments(circle).every((segment) => segment.kind === 'cubic')).toBe(true);
    const expected = Math.PI * 100 * 100;
    expect(Math.abs(areaOfPath(circle) - expected) / expected).toBeLessThan(0.0005);
  });

  it('sits inside its bounding box and passes through the axis extremes', () => {
    const ellipse = ellipsePath(BOX);
    const bounds = boundsOfPath(ellipse);
    expect(bounds?.minX).toBeCloseTo(0, 6);
    expect(bounds?.minY).toBeCloseTo(0, 6);
    expect(bounds?.maxX).toBeCloseTo(200, 6);
    expect(bounds?.maxY).toBeCloseTo(100, 6);
    expect(checkTopology(ellipse).valid).toBe(true);
  });

  it('measures an ellipse as πab', () => {
    const ellipse = ellipsePath({ minX: 0, minY: 0, maxX: 300, maxY: 100 });
    const expected = Math.PI * 150 * 50;
    expect(Math.abs(areaOfPath(ellipse) - expected) / expected).toBeLessThan(0.0005);
  });

  it('uses the documented circle constant', () => {
    expect(CIRCLE_KAPPA).toBeCloseTo(0.5522847498307936, 12);
  });

  it('centres a degenerate ellipse at its box centre instead of throwing', () => {
    const degenerate = ellipsePath({ minX: 10, minY: 10, maxX: 10, maxY: 10 });
    expect(degenerate.contours[0]?.nodes).toHaveLength(1);
    expect(boundsOfPath(degenerate)).toEqual({ minX: 10, minY: 10, maxX: 10, maxY: 10 });
  });
});

describe('polygons and stars', () => {
  it('creates a regular polygon with the requested number of nodes', () => {
    const hexagon = regularPolygonPath({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 6);
    expect(hexagon.contours[0]?.nodes).toHaveLength(6);
    expect(checkTopology(hexagon).valid).toBe(true);
    expect(isUsablePath(hexagon)).toBe(true);

    const centre = centroidOfContour(hexagon.contours[0]!);
    expect(centre?.x).toBeCloseTo(50, 6);
    expect(centre?.y).toBeCloseTo(50, 6);
  });

  it('clamps an absurd side count into the supported range', () => {
    expect(regularPolygonPath(BOX, 2).contours[0]?.nodes).toHaveLength(3);
    expect(regularPolygonPath(BOX, 500).contours[0]?.nodes).toHaveLength(24);
  });

  it('creates a star with alternating radii', () => {
    const star = starPath({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 5, 0.4);
    expect(star.contours[0]?.nodes).toHaveLength(10);
    expect(checkTopology(star).valid).toBe(true);
    // A star is strictly smaller than its bounding circle but never empty.
    expect(areaOfPath(star)).toBeGreaterThan(0);
    expect(areaOfPath(star)).toBeLessThan(Math.PI * 50 * 50);
  });

  it('creates a line as an open two-node contour', () => {
    const line = linePath({ x: 10, y: 10 }, { x: 60, y: 30 });
    expect(line.contours[0]?.nodes).toHaveLength(2);
    expect(line.contours[0]?.closed).toBe(false);
    expect(toPathData(line)).toBe('M10 10L60 30');
    // An open contour has no enclosed area of its own; the area a *renderer* fills is the implicit
    // closure, which for a single line is the triangle under it — reported, not hidden.
    expect(areaOfPath(line)).toBeCloseTo(150, 6);
    // `areaOfContour` reports the same implicit-closure region, so the honest predicate for "is
    // this a region?" is the contour's `closed` flag, not its area.
    expect(areaOfContour(line.contours[0]!)).toBeCloseTo(150, 6);
    expect(line.contours[0]!.closed).toBe(false);
  });
});
