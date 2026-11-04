import { describe, expect, it } from 'vitest';

import {
  applyRangeSelections,
  colourStrength,
  hexToRgb,
  luminanceStrength,
  rangeStrength,
  relativeLuminance,
  strongestRangeStrength,
} from './range';
import type { PhotoRangeSelection } from '../documents/payload';

const WHITE = { r: 255, g: 255, b: 255 } as const;

function luminance(min: number, max: number, feather = 0): PhotoRangeSelection {
  return { id: 'range-1', kind: 'luminance', min, max, feather };
}

function colour(value: string, tolerance: number, feather = 0): PhotoRangeSelection {
  return { id: 'range-2', kind: 'colour', colour: value, tolerance, feather };
}

describe('hexToRgb', () => {
  it('parses six-digit hex with or without a leading hash case difference', () => {
    expect(hexToRgb('#102030')).toEqual({ r: 16, g: 32, b: 48 });
    expect(hexToRgb('#AABBCC')).toEqual({ r: 170, g: 187, b: 204 });
  });

  it('refuses anything that is not a six-digit hex colour', () => {
    for (const value of ['#fff', 'tomato', 'rgb(1,2,3)', '', '#GGGGGG']) {
      expect(hexToRgb(value)).toBeNull();
    }
  });
});

describe('relativeLuminance', () => {
  it('maps black to 0 and white to 1', () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0);
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 10);
  });

  it('weights green above red and red above blue', () => {
    expect(relativeLuminance(0, 255, 0)).toBeGreaterThan(relativeLuminance(255, 0, 0));
    expect(relativeLuminance(255, 0, 0)).toBeGreaterThan(relativeLuminance(0, 0, 255));
  });
});

describe('luminanceStrength', () => {
  it('selects everything inside the window', () => {
    expect(luminanceStrength(0.4, 0.7, 0, 0.4)).toBe(1);
    expect(luminanceStrength(0.4, 0.7, 0, 0.7)).toBe(1);
    expect(luminanceStrength(0.4, 0.7, 0.5, 0.5)).toBe(1);
  });

  it('has a hard edge when feather is zero', () => {
    expect(luminanceStrength(0.4, 0.7, 0, 0.399)).toBe(0);
    expect(luminanceStrength(0.4, 0.7, 0, 0.701)).toBe(0);
  });

  it('falls off smoothly outside the window when feathered', () => {
    const window = luminance(0.4, 0.7, 1);
    const justOutside = rangeStrength(window, 90, 90, 90); // luminance ≈ 0.353
    const furtherOutside = rangeStrength(window, 40, 40, 40); // luminance ≈ 0.157
    expect(justOutside).toBeGreaterThan(0);
    expect(justOutside).toBeLessThan(1);
    expect(furtherOutside).toBeLessThan(justOutside);
  });

  it('treats a window given backwards the same as one given forwards', () => {
    expect(luminanceStrength(0.7, 0.4, 0, 0.5)).toBe(1);
  });
});

describe('colourStrength', () => {
  it('selects the exact target', () => {
    expect(colourStrength(WHITE, 0, 0, 255, 255, 255)).toBe(1);
  });

  it('selects an exact target at zero tolerance', () => {
    expect(colourStrength(WHITE, 0, 0, 250, 255, 255)).toBe(0);
  });

  it('accepts everything at tolerance 1, including black', () => {
    expect(colourStrength(WHITE, 1, 0, 0, 0, 0)).toBe(1);
  });

  it('moves monotonically from selected to unselected across a feathered tolerance', () => {
    const target = { r: 128, g: 128, b: 128 } as const;
    // Samples march away from the target in one direction, so the falloff can be asserted monotone.
    const strengths = [128, 150, 170, 190, 220, 255].map((value) =>
      colourStrength(target, 0.05, 1, value, value, value),
    );
    for (let index = 1; index < strengths.length; index += 1) {
      expect(strengths[index]!).toBeLessThanOrEqual(strengths[index - 1]!);
    }
    expect(strengths[0]).toBe(1);
    expect(strengths.at(-1)).toBe(0);
  });
});

describe('rangeStrength and strongestRangeStrength', () => {
  it('selects nothing for a colour that cannot be parsed', () => {
    expect(rangeStrength(colour('nonsense', 1, 1), 255, 255, 255)).toBe(0);
  });

  it('takes the strongest of several ranges', () => {
    const ranges = [luminance(0, 0.1, 0), colour('#ffffff', 0.05, 0)];
    expect(strongestRangeStrength(ranges, 255, 255, 255)).toBe(1);
    expect(strongestRangeStrength(ranges, 10, 10, 10)).toBe(1);
    expect(strongestRangeStrength(ranges, 128, 128, 128)).toBe(0);
  });

  it('is empty for an empty list', () => {
    expect(strongestRangeStrength([], 255, 255, 255)).toBe(0);
  });
});

describe('applyRangeSelections', () => {
  function sourceOf(...pixels: readonly (readonly [number, number, number, number])[]) {
    return new Uint8ClampedArray(pixels.flat());
  }

  it('returns the painted map unchanged when there are no ranges', () => {
    const painted = new Uint8ClampedArray([10, 20]);
    const result = applyRangeSelections(
      painted,
      [],
      sourceOf([0, 0, 0, 255], [255, 255, 255, 255]),
      2,
      1,
    );
    expect(result).toBe(painted);
  });

  it('unions a range with painted strokes using the maximum', () => {
    const painted = new Uint8ClampedArray([0, 255, 64]);
    const source = sourceOf([0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255]);
    const result = applyRangeSelections(painted, [luminance(0.9, 1, 0)], source, 3, 1);
    // Black pixels outside the bright window stay unpainted; the painted byte wins over 0; white 1.
    expect([...result]).toEqual([0, 255, 255]);
  });

  it('does not lower an already-painted pixel', () => {
    const painted = new Uint8ClampedArray([200]);
    const source = sourceOf([0, 0, 0, 255]);
    const result = applyRangeSelections(painted, [luminance(0.9, 1, 0)], source, 1, 1);
    expect(result[0]).toBe(200);
  });

  it('refuses a source buffer of the wrong size rather than ignoring the ranges', () => {
    expect(() =>
      applyRangeSelections(
        new Uint8ClampedArray([0]),
        [luminance(0, 1, 0)],
        new Uint8ClampedArray(3),
        1,
        1,
      ),
    ).toThrow(/source bytes/);
  });

  it('refuses a painted buffer of the wrong size', () => {
    expect(() =>
      applyRangeSelections(
        new Uint8ClampedArray(2),
        [luminance(0, 1, 0)],
        sourceOf([0, 0, 0, 255]),
        1,
        1,
      ),
    ).toThrow(/mask has/);
  });

  it('is deterministic: the same inputs produce identical bytes', () => {
    const painted = new Uint8ClampedArray([0, 3, 255]);
    const source = sourceOf([10, 20, 30, 255], [200, 210, 220, 255], [128, 128, 128, 255]);
    const ranges = [luminance(0.2, 0.8, 0.5), colour('#808080', 0.1, 0.5)];
    const first = applyRangeSelections(painted, ranges, source, 3, 1);
    const second = applyRangeSelections(painted, ranges, source, 3, 1);
    expect([...first]).toEqual([...second]);
  });
});
