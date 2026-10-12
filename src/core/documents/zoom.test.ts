import { describe, expect, it } from 'vitest';

import {
  MAX_FIT_SCALE,
  MIN_FIT_PERCENT,
  ZOOM_PERCENT_LEVELS,
  computeZoom,
  parseZoomSetting,
  stepZoom,
  type CanvasSize,
} from './zoom';

/**
 * Zoom arithmetic.
 *
 * These are the numbers the stage renders, so the cases that matter are the ones a user notices: a
 * portrait document must scale by its own declared width, an explicit percentage must be exactly
 * that percentage, `fit` must never magnify past 100%, and a zoom larger than the viewport must be
 * reported as clipped (so the stage scrolls) instead of being silently capped.
 */
const square: CanvasSize = { width: 1080, height: 1080 };
const portrait: CanvasSize = { width: 1080, height: 1920 };
const landscape: CanvasSize = { width: 1920, height: 1080 };
const viewport = { width: 900, height: 600 };

describe('explicit zoom percentages', () => {
  it('scales a landscape canvas by its declared pixel size', () => {
    expect(computeZoom(landscape, 100, viewport)).toMatchObject({
      width: 1920,
      height: 1080,
      percent: 100,
    });
    expect(computeZoom(landscape, 50, viewport)).toMatchObject({ width: 960, height: 540 });
    expect(computeZoom(landscape, 25, viewport)).toMatchObject({ width: 480, height: 270 });
    expect(computeZoom(landscape, 200, viewport)).toMatchObject({ width: 3840, height: 2160 });
  });

  it('scales a portrait canvas by its own width rather than a container cap', () => {
    const at100 = computeZoom(portrait, 100, viewport);

    expect(at100).toMatchObject({ width: 1080, height: 1920, percent: 100 });
    // The regression this guards: portrait documents used to be capped to a fixed narrow width, so
    // 100% rendered a 224px-wide canvas and 200% changed nothing.
    expect(computeZoom(portrait, 200, viewport)).toMatchObject({ width: 2160, height: 3840 });
    expect(computeZoom(portrait, 50, viewport)).toMatchObject({ width: 540, height: 960 });
  });

  it('keeps the aspect ratio through rounding', () => {
    const odd: CanvasSize = { width: 1234, height: 789 };

    for (const level of ZOOM_PERCENT_LEVELS) {
      const scale = computeZoom(odd, level, viewport);
      const ratio = scale.width / scale.height;
      expect(ratio, `${level}%`).toBeCloseTo(odd.width / odd.height, 2);
    }
  });

  it('reports a box larger than the viewport as clipped, in both orientations', () => {
    expect(computeZoom(landscape, 100, viewport).clipped).toBe(true);
    expect(computeZoom(portrait, 100, viewport).clipped).toBe(true);
    expect(computeZoom(square, 25, viewport).clipped).toBe(false);
    // Clipping is about the box, not about the orientation of the document.
    expect(computeZoom(portrait, 25, viewport)).toMatchObject({ width: 270, height: 480 });
    expect(computeZoom(portrait, 25, { width: 270, height: 480 }).clipped).toBe(false);
    expect(computeZoom(portrait, 25, { width: 269, height: 480 }).clipped).toBe(true);
  });

  it('always produces at least one pixel, even at the smallest level', () => {
    const tiny: CanvasSize = { width: 3, height: 2 };
    const scale = computeZoom(tiny, 25, viewport);

    expect(scale.width).toBeGreaterThanOrEqual(1);
    expect(scale.height).toBeGreaterThanOrEqual(1);
  });
});

describe('fit', () => {
  it('fits the height for a landscape document in a short viewport', () => {
    const scale = computeZoom(landscape, 'fit', { width: 2000, height: 540 });

    expect(scale.scale).toBeCloseTo(0.5, 5);
    expect(scale.width).toBe(960);
    expect(scale.height).toBe(540);
    expect(scale.percent).toBe(50);
    expect(scale.clipped).toBe(false);
  });

  it('fits the width for a portrait document in a narrow viewport', () => {
    const scale = computeZoom(portrait, 'fit', { width: 540, height: 2000 });

    expect(scale.scale).toBeCloseTo(0.5, 5);
    expect(scale.width).toBe(540);
    expect(scale.height).toBe(960);
    expect(scale.clipped).toBe(false);
  });

  it('never magnifies past 100%, so 100% keeps one meaning', () => {
    const scale = computeZoom(square, 'fit', { width: 4000, height: 4000 });

    expect(scale.scale).toBe(MAX_FIT_SCALE);
    expect(scale.percent).toBe(100);
    expect(scale.width).toBe(square.width);
  });

  it('falls back to the declared size when the viewport has not been measured', () => {
    const scale = computeZoom(square, 'fit', { width: 0, height: 0 });

    expect(scale).toMatchObject({ width: 1080, height: 1080, percent: 100, unmeasured: true });
    expect(scale.clipped).toBe(false);
  });

  it('keeps a usable floor when the viewport is measured but tiny', () => {
    const scale = computeZoom(landscape, 'fit', { width: 1, height: 1 });

    expect(scale.percent).toBe(MIN_FIT_PERCENT);
    expect(scale.unmeasured).toBe(false);
    // Still larger than the viewport at the floor, and reported as such rather than clamped away.
    expect(scale.clipped).toBe(true);
  });
});

describe('stepZoom', () => {
  it('walks the fixed levels and stops at the ends', () => {
    expect(stepZoom(25, -1, 25)).toBe(25);
    expect(stepZoom(25, 1, 25)).toBe(50);
    expect(stepZoom(50, 1, 50)).toBe(100);
    expect(stepZoom(100, 1, 100)).toBe(200);
    expect(stepZoom(200, 1, 200)).toBe(200);
    expect(stepZoom(200, -1, 200)).toBe(100);
  });

  it('steps out of `fit` relative to what is actually on screen', () => {
    expect(stepZoom('fit', 1, 42)).toBe(50);
    expect(stepZoom('fit', -1, 42)).toBe(25);
    expect(stepZoom('fit', 1, 12)).toBe(25);
    expect(stepZoom('fit', -1, 12)).toBe(25);
    expect(stepZoom('fit', 1, 100)).toBe(200);
    expect(stepZoom('fit', -1, 200)).toBe(100);
  });
});

describe('parseZoomSetting', () => {
  it('accepts the levels the control offers', () => {
    expect(parseZoomSetting('fit')).toBe('fit');
    for (const level of ZOOM_PERCENT_LEVELS) {
      expect(parseZoomSetting(String(level))).toBe(level);
    }
  });

  it('falls back to fit for anything else, rather than inventing a level', () => {
    expect(parseZoomSetting('')).toBe('fit');
    expect(parseZoomSetting('37')).toBe('fit');
    expect(parseZoomSetting('nonsense')).toBe('fit');
  });
});
