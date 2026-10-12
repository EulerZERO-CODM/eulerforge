import { describe, expect, it } from 'vitest';

import {
  aspectRatio,
  aspectRatioLabel,
  bleedBand,
  fitScale,
  greatestCommonDivisor,
  gridLinePositions,
  insetRect,
  megapixelLabel,
  normaliseSize,
  orientationOf,
  pixelCount,
} from './geometry';

describe('greatestCommonDivisor', () => {
  it('reduces common screen sizes', () => {
    expect(greatestCommonDivisor(1920, 1080)).toBe(120);
    expect(greatestCommonDivisor(1080, 1080)).toBe(1080);
  });

  it('is safe for zero and negative inputs', () => {
    expect(greatestCommonDivisor(0, 0)).toBe(1);
    expect(greatestCommonDivisor(-1920, 1080)).toBe(120);
  });
});

describe('aspectRatio', () => {
  it('returns the reduced pair and a readable label', () => {
    expect(aspectRatio({ width: 1920, height: 1080 })).toEqual({ x: 16, y: 9 });
    expect(aspectRatioLabel({ width: 1080, height: 1080 })).toBe('1:1');
    expect(aspectRatioLabel({ width: 1080, height: 1350 })).toBe('4:5');
  });
});

describe('orientationOf', () => {
  it('classifies landscape, portrait and square sizes', () => {
    expect(orientationOf({ width: 1600, height: 900 })).toBe('landscape');
    expect(orientationOf({ width: 900, height: 1600 })).toBe('portrait');
    expect(orientationOf({ width: 1000, height: 1000 })).toBe('square');
  });
});

describe('insetRect', () => {
  it('insets by the margin on every side', () => {
    expect(insetRect({ width: 1000, height: 500 }, 50)).toEqual({
      x: 50,
      y: 50,
      width: 900,
      height: 400,
    });
  });

  it('clamps an oversized margin so the rectangle never inverts', () => {
    // The margin is capped at half of the smaller dimension, so the box collapses, never flips.
    const rect = insetRect({ width: 200, height: 100 }, 500);
    expect(rect).toEqual({ x: 50, y: 50, width: 100, height: 0 });
  });
});

describe('bleedBand', () => {
  it('grows the rectangle outwards', () => {
    expect(bleedBand({ width: 100, height: 200 }, 3)).toEqual({
      x: -3,
      y: -3,
      width: 106,
      height: 206,
    });
  });

  it('clamps negative bleed to zero', () => {
    expect(bleedBand({ width: 100, height: 200 }, -10).width).toBe(100);
  });
});

describe('gridLinePositions', () => {
  it('spaces lines evenly inside the smaller dimension', () => {
    // Lines are only produced strictly inside the canvas, so the 100px boundary is excluded.
    expect(gridLinePositions({ width: 300, height: 100 }, 50)).toEqual([50]);
    expect(gridLinePositions({ width: 300, height: 300 }, 100)).toEqual([100, 200]);
  });

  it('returns nothing for a non-positive step', () => {
    expect(gridLinePositions({ width: 300, height: 300 }, 0)).toEqual([]);
    expect(gridLinePositions({ width: 300, height: 300 }, Number.NaN)).toEqual([]);
  });
});

describe('fitScale', () => {
  it('scales down to fit the bounds and never up', () => {
    expect(fitScale({ width: 2000, height: 1000 }, { width: 1000, height: 1000 })).toBe(0.5);
  });

  it('falls back to 1 for degenerate input', () => {
    expect(fitScale({ width: 0, height: 100 }, { width: 1000, height: 1000 })).toBe(1);
  });
});

describe('normaliseSize', () => {
  it('rounds and enforces the minimum', () => {
    expect(normaliseSize({ width: 10.4, height: 0 })).toEqual({ width: 10, height: 1 });
    expect(normaliseSize({ width: 10.4, height: 0 }, 16)).toEqual({ width: 16, height: 16 });
  });
});

describe('pixel density labels', () => {
  it('counts pixels and formats megapixels', () => {
    expect(pixelCount({ width: 1920, height: 1080 })).toBe(2_073_600);
    expect(megapixelLabel({ width: 1920, height: 1080 })).toBe('2.07 MP');
    expect(megapixelLabel({ width: 6000, height: 4000 })).toBe('24.0 MP');
  });
});
