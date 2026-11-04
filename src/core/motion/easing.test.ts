/**
 * Easing: the curve the graph editor draws is the curve the evaluator solves.
 *
 * These tests pin the arithmetic, not a screenshot: known CSS presets at the midpoint, monotonicity
 * across the whole range, the deliberate exception that `hold` is a step, and clamping at both ends.
 */

import { describe, expect, it } from 'vitest';

import type { MotionEasing } from '../documents/payload';
import {
  applyEasing,
  cubicBezierAt,
  cubicEasing,
  defaultEasing,
  easingPoints,
  EASING_POINTS,
} from './easing';

function sample(easing: MotionEasing, count = 21): number[] {
  const values: number[] = [];
  for (let index = 0; index <= count; index += 1) values.push(applyEasing(easing, index / count));
  return values;
}

describe('applyEasing', () => {
  it('is the identity for linear, with exact endpoints', () => {
    expect(applyEasing({ kind: 'linear' }, 0)).toBe(0);
    expect(applyEasing({ kind: 'linear' }, 0.25)).toBeCloseTo(0.25, 12);
    expect(applyEasing({ kind: 'linear' }, 1)).toBe(1);
  });

  it('passes through the CSS preset midpoints', () => {
    // The symmetric presets are 0.5 at half time; ease-in is behind and ease-out is ahead.
    expect(applyEasing({ kind: 'ease-in-out' }, 0.5)).toBeCloseTo(0.5, 6);
    expect(applyEasing({ kind: 'ease-in' }, 0.5)).toBeLessThan(0.5);
    expect(applyEasing({ kind: 'ease-out' }, 0.5)).toBeGreaterThan(0.5);
  });

  it('is monotone and stays inside [0, 1] for every preset', () => {
    for (const kind of ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const) {
      const values = sample({ kind });
      for (let index = 1; index < values.length; index += 1) {
        expect(values[index] ?? 0).toBeGreaterThanOrEqual((values[index - 1] ?? 0) - 1e-9);
      }
      expect(Math.min(...values)).toBeGreaterThanOrEqual(-1e-9);
      expect(Math.max(...values)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('keeps the left value for a hold segment', () => {
    expect(applyEasing({ kind: 'hold' }, 0.999)).toBe(0);
    expect(applyEasing({ kind: 'hold' }, 0)).toBe(0);
  });

  it('clamps progress outside the segment instead of extrapolating', () => {
    expect(applyEasing({ kind: 'ease-in' }, -1)).toBe(0);
    expect(applyEasing({ kind: 'ease-in' }, 4)).toBe(1);
    expect(applyEasing({ kind: 'linear' }, Number.NaN)).toBe(0);
  });

  it('solves a custom cubic curve', () => {
    const points = { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 };
    const easing: MotionEasing = { kind: 'cubic', ...points };
    const values = sample(easing, 40);
    expect(values[0]).toBe(0);
    expect(values[values.length - 1]).toBe(1);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index] ?? 0).toBeGreaterThanOrEqual((values[index - 1] ?? 0) - 1e-9);
    }
    // Checked against an independent brute-force solve of the same cubic, not against itself.
    const bruteForce = (x: number): number => {
      let best = 0;
      let bestError = Number.POSITIVE_INFINITY;
      for (let step = 0; step <= 20_000; step += 1) {
        const t = step / 20_000;
        const inverse = 1 - t;
        const cx = 3 * inverse * inverse * t * points.x1 + 3 * inverse * t * t * points.x2 + t ** 3;
        if (Math.abs(cx - x) < bestError) {
          bestError = Math.abs(cx - x);
          best = 3 * inverse * inverse * t * points.y1 + 3 * inverse * t * t * points.y2 + t ** 3;
        }
      }
      return best;
    };
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(applyEasing(easing, x)).toBeCloseTo(bruteForce(x), 3);
    }
  });

  it('returns the curve the graph editor would draw', () => {
    expect(easingPoints({ kind: 'ease-in-out' })).toEqual(EASING_POINTS['ease-in-out']);
    expect(easingPoints({ kind: 'cubic', x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 })).toEqual({
      x1: 0.1,
      y1: 0.2,
      x2: 0.3,
      y2: 0.4,
    });
    expect(easingPoints({ kind: 'hold' })).toBeNull();
  });

  it('has a documented default and clamps editor points into schema bounds', () => {
    expect(defaultEasing()).toEqual({ kind: 'ease-in-out' });
    expect(cubicEasing({ x1: -1, y1: 9, x2: 2, y2: -9 })).toEqual({
      kind: 'cubic',
      x1: 0,
      y1: 3,
      x2: 1,
      y2: -2,
    });
  });

  it('is deterministic to the last bit', () => {
    const points = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
    expect(cubicBezierAt(points, 0.333)).toBe(cubicBezierAt(points, 0.333));
  });
});
